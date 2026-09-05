// FENCED FORK FEATURE — boot auto-wake + stuck-turn watchdog retry.
// Owning commits: dcb7c2b, 8350bb2, 0c93466.
// Rollback: inline recoverPendingTurns() into daemon/wiring.ts and maybeRequeueStall() into room-service.ts.
import { newId } from "../../core/ids.js";
import { workspacePaths } from "../../core/paths.js";
import { readJson } from "../../core/store.js";
import type { MessageAttachment, QueuedMessage, RoomEvent, RoomState, Task, UiEvent, WorkspaceRecord } from "../../core/types.js";
import { normalizeRoomState } from "../../domain/rooms.js";

export interface AutoWakeHost {
  registry: { list(): Promise<WorkspaceRecord[]> };
  log(message: string): void;
}

export async function recoverPendingTurns(
  host: AutoWakeHost,
  roomIdsOnDisk: (workspaceRoot: string) => string[],
  wake: (workspaceId: string, roomId: string) => Promise<unknown>,
): Promise<void> {
  for (const record of await host.registry.list()) {
    if (!record.isInitialized) continue;
    for (const roomId of roomIdsOnDisk(record.path)) {
      let state: RoomState;
      try {
        state = normalizeRoomState(await readJson(workspacePaths.roomState(record.path, roomId)));
      } catch {
        continue;
      }
      if (!state.pendingTurn && !state.queue?.length) continue;
      host.log(`turn recovery: waking ${record.id}::${roomId} (pending=${Boolean(state.pendingTurn)}, queued=${state.queue?.length ?? 0})`);
      try {
        await wake(record.id, roomId);
      } catch (error) {
        host.log(`turn recovery failed for ${record.id}::${roomId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export interface StuckTurnWatchdogHost {
  workspaceId: string;
  roomId: string;
  room: {
    appendEvent(event: RoomEvent): Promise<unknown>;
    enqueue(message: QueuedMessage): Promise<unknown>;
  };
  queuedTasks: Task[];
  createTask(text: string, targets: string[]): Task;
  emit(event: UiEvent): void;
  emitSnapshot(): Promise<void>;
}

export async function maybeRequeueStall(
  host: StuckTurnWatchdogHost,
  targets: string[],
  agentId: string,
  text: string,
  error: unknown,
  partialReply: string,
  channel: "voice" | undefined,
  attachments: MessageAttachment[] | undefined,
  queued: Pick<QueuedMessage, "stallRetried"> | undefined,
): Promise<boolean> {
  const isStall = error instanceof Error && error.name === "UpstreamStallError";
  if (!isStall || partialReply.trim() || queued?.stallRetried) return false;
  const event: RoomEvent = {
    id: newId("system_stallretry"),
    timestamp: new Date().toISOString(),
    author: "system",
    text: `⚠ turn aborted after upstream stall (@${agentId}) — message requeued, retrying once`,
  };
  await host.room.appendEvent(event);
  host.emit({ type: "room-event", workspaceId: host.workspaceId, roomId: host.roomId, event });
  const retryTask = host.createTask(text, targets);
  retryTask.status = "queued";
  await host.room.enqueue({
    taskId: retryTask.id,
    text,
    targets,
    ...(channel ? { channel } : {}),
    ...(attachments?.length ? { attachments } : {}),
    stallRetried: true,
    queuedAt: retryTask.startedAt,
  });
  host.queuedTasks.push(retryTask);
  host.emit({ type: "task-start", workspaceId: host.workspaceId, roomId: host.roomId, task: retryTask });
  void host.emitSnapshot();
  return true;
}
