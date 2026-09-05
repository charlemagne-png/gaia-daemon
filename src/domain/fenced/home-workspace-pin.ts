// FENCED FORK FEATURE — agent home-workspace pin configuration + redirect.
// Owning commits: 0dafdde + restoration commit.
// Rollback: inline config normalization in domain/agents.ts; remove redirect hooks.
import type { AgentDef, RoomEvent, Snapshot, Task, UiEvent, Workspace, WorkspaceRecord } from "../../core/types.js";
import { deriveRoomTitle, newRoomEventId, RoomHandle } from "../rooms.js";
import { ensureWorkspaceRoom } from "../workspace.js";

export function inheritHomeWorkspacePin(base: unknown, override: unknown): unknown {
  return override !== undefined ? override : base;
}

export function normalizeHomeWorkspacePin(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export interface HomeWorkspaceRedirectRequest {
  agent: AgentDef;
  text: string;
  fromWorkspaceId: string;
  fromRoomId: string;
}

export interface HomeWorkspaceRedirectResult {
  workspaceId: string;
  roomId: string;
  workspaceName: string;
  roomRef?: string;
}

interface RedirectTargetService {
  readonly roomId: string;
  sendMessage(text: string): Promise<unknown>;
  getSnapshot(): Promise<Pick<Snapshot, "room">>;
  listRooms(): Promise<Snapshot["rooms"]>;
}

export interface HomeWorkspaceRedirectTargetHost {
  registry: {
    list(): Promise<WorkspaceRecord[]>;
    find(id: string): Promise<WorkspaceRecord | undefined>;
  };
  serviceFor(workspaceId: string, roomId: string): Promise<RedirectTargetService>;
  scanRooms(workspaceRoot: string): Promise<Snapshot["rooms"]>;
  broadcast(event: UiEvent): void;
}

/** Daemon-owned half: resolve the home, preserve target-room single-writer
 * custody, forward the message, then return the navigation destination. */
export async function redirectHomeWorkspace(
  host: HomeWorkspaceRedirectTargetHost,
  request: HomeWorkspaceRedirectRequest,
): Promise<HomeWorkspaceRedirectResult | undefined> {
  const key = request.agent.homeWorkspace?.trim();
  if (!key) return undefined;
  const source = await host.registry.find(request.fromWorkspaceId);
  const candidates = (await host.registry.list()).filter(
    (record) => record.isInitialized && record.humanId === source?.humanId,
  );
  const lowered = key.toLowerCase();
  const home = candidates.find((record) => record.name.toLowerCase() === lowered) ?? candidates.find((record) => record.id === key);
  if (!home || home.id === request.fromWorkspaceId) return undefined;

  let roomId = (await host.scanRooms(home.path)).find((room) => room.agent === request.agent.id)?.id;
  if (!roomId) {
    roomId = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await ensureWorkspaceRoom(home.path, roomId);
    const room = await RoomHandle.open(home.path, roomId);
    const title = deriveRoomTitle(request.text) || `${home.name} conversation`;
    await room.updateState((state) => {
      state.activeAgent = request.agent.id;
      state.title = title;
      state.titleSource = "auto";
    });
  }

  const service = await host.serviceFor(home.id, roomId);
  await service.sendMessage(request.text);
  const snapshot = await service.getSnapshot();
  host.broadcast({ type: "rooms", workspaceId: home.id, rooms: await service.listRooms() });
  return {
    workspaceId: home.id,
    roomId: service.roomId,
    workspaceName: home.name,
    ...(snapshot.room.refCode ? { roomRef: snapshot.room.refCode } : {}),
  };
}

export interface HomeWorkspaceRedirectSourceHost {
  readonly workspace: Workspace;
  readonly workspaceId: string;
  readonly roomId: string;
  readonly room: { appendEvent(event: RoomEvent): Promise<void> };
  readonly recentTasks: Task[];
  readonly options: {
    homeWorkspaceRedirect?: (request: HomeWorkspaceRedirectRequest) => Promise<HomeWorkspaceRedirectResult | undefined>;
  };
  createTask(text: string, targets: string[]): Task;
  emit(event: UiEvent): void;
  emitSnapshot(): Promise<void>;
}

/** Room-owned half: only human messages redirect; internal producers remain in
 * their assigned room. A completed local task acknowledges target forwarding. */
export async function redirectPinnedAgentMessage(
  host: HomeWorkspaceRedirectSourceHost,
  text: string,
  targets: string[],
  options: { origin?: "human"; nativeCommand?: boolean; fromAgentDialogue?: boolean },
): Promise<Task | undefined> {
  if (options.origin !== "human" || options.nativeCommand || options.fromAgentDialogue) return undefined;
  const agent = targets.map((id) => host.workspace.agents[id]).find((candidate) => candidate?.homeWorkspace);
  if (!agent?.homeWorkspace || !host.options.homeWorkspaceRedirect) return undefined;
  const redirect = await host.options.homeWorkspaceRedirect({
    agent,
    text,
    fromWorkspaceId: host.workspaceId,
    fromRoomId: host.roomId,
  });
  if (!redirect) return undefined;

  const label = agent.displayName || `@${agent.id}`;
  const roomRef = redirect.roomRef ? `#${redirect.roomRef}` : redirect.roomId;
  const note: RoomEvent = {
    id: newRoomEventId(),
    timestamp: new Date().toISOString(),
    author: "system",
    text: `${label} is homed in ${redirect.workspaceName} → continuing in ${roomRef}`,
  };
  await host.room.appendEvent(note);
  host.emit({ type: "room-event", workspaceId: host.workspaceId, roomId: host.roomId, event: note });
  host.emit({
    type: "room-redirect",
    workspaceId: redirect.workspaceId,
    roomId: redirect.roomId,
    fromWorkspaceId: host.workspaceId,
    fromRoomId: host.roomId,
  });
  void host.emitSnapshot();

  const task = host.createTask(text, targets);
  host.emit({ type: "task-start", workspaceId: host.workspaceId, roomId: host.roomId, task });
  task.status = "complete";
  task.endedAt = new Date().toISOString();
  host.recentTasks.push(task);
  if (host.recentTasks.length > 10) host.recentTasks.splice(0, host.recentTasks.length - 10);
  host.emit({ type: "task-end", workspaceId: host.workspaceId, roomId: host.roomId, task });
  return task;
}

/** Redirect navigation is authorized/scoped by its source room; workspace-wide
 * voice navigation remains scoped to its destination workspace. */
export function homeWorkspaceRedirectDeliveryScope(event: UiEvent): { workspaceId?: string; roomId?: string } | undefined {
  if (event.type !== "room-redirect") return undefined;
  return event.scope === "workspace"
    ? { workspaceId: event.workspaceId }
    : { workspaceId: event.fromWorkspaceId, roomId: event.fromRoomId };
}
