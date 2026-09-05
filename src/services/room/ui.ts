import { newId } from "../../core/ids.js";
import { DEFAULTS } from "../../core/config.js";
import type { AgentEvent, PetProgressStatus, Task, UiEvent } from "../../core/types.js";
import { HOOK_TEXT_CAP, runHooks, type HookEvent } from "../hooks.js";
import { applyEventToDetails } from "../turns.js";
import type { ConsolidateLlmInput } from "../consolidate.js";
import { maybeAutoHeal as runAutoHeal } from "../fenced/auto-heal.js";


export class RoomUiMixin {
  [key: string]: any;
  petTargetKey(taskId: string, agentId: string): string {
    return `${taskId}\u0000${agentId}`;
  }

  /** Emit one workspace-wide, room+agent-scoped pet update. The status is
   * derived only from the shared AgentEvent vocabulary in the caller below. */
  emitPetProgress(task: Task, agentId: string, status: PetProgressStatus, toolName?: string): void {
    this.emit({
      type: "pet-progress",
      workspaceId: this.workspaceId,
      roomId: this.roomId,
      agentId,
      taskId: task.id,
      status,
      ...(status === "tool" && toolName ? { toolName } : {}),
    });
  }

  settlePetTarget(task: Task, agentId: string, status: "done" | "failed"): void {
    const key = this.petTargetKey(task.id, agentId);
    if (this.settledPetTargets.has(key)) return;
    this.settledPetTargets.add(key);
    this.emitPetProgress(task, agentId, status);
  }

  createTask(text: string, targets: string[]): Task {
    return { id: newId("task"), roomId: this.roomId, text, targets, status: "running", startedAt: new Date().toISOString() };
  }

  settleTask(task: Task, status: "complete" | "error" | "cancelled", error?: unknown): void {
    task.status = status;
    task.endedAt = new Date().toISOString();
    if (error !== undefined) task.error = error instanceof Error ? error.message : String(error);
    this.recentTasks = [...this.recentTasks.slice(-9), task];
    if (this.activeTask?.id === task.id) this.activeTask = undefined;
    if (this.activeAgentTurn?.id === task.id) this.activeAgentTurn = undefined;
    // Close the settle->drain gap now, synchronously, in the SAME tick as the
    // activeTask clear above — see `draining`'s doc comment. `resolveDraining`
    // fires from inside drain() the instant it has decided (see onDecided).
    let resolveDraining: () => void = () => {};
    this.draining = new Promise<void>((resolve) => {
      resolveDraining = resolve;
    });
    for (const agentId of task.targets) {
      if (this.startedPetTargets.has(this.petTargetKey(task.id, agentId))) {
        this.settlePetTarget(task, agentId, status === "complete" ? "done" : "failed");
      }
    }
    for (const agentId of task.targets) {
      this.settledPetTargets.delete(this.petTargetKey(task.id, agentId));
      this.startedPetTargets.delete(this.petTargetKey(task.id, agentId));
    }
    if (status === "error") {
      this.fireHooks("error", { taskId: task.id, agentIds: task.targets, error: (task.error ?? "").slice(0, HOOK_TEXT_CAP) });
      this.emit({ type: "task-error", workspaceId: this.workspaceId, roomId: this.roomId, task, error: task.error ?? "" });
    } else {
      this.emit({ type: "task-end", workspaceId: this.workspaceId, roomId: this.roomId, task });
    }
    this.maybeAutoHeal(task);
    void this.emitRoomsChanged();
    // Emit the settle snapshot BEFORE draining the next queued turn. SSE is a
    // single ordered stream and the client REPLACES its snapshot wholesale, so a
    // settle snapshot that got built before the drain commits the queued
    // message's user event must still be sent FIRST — otherwise a stale copy
    // lands after that room-event and blanks the just-committed bubble for the
    // whole next turn (the "queued message vanished after /compact" bug). The
    // drained turn then emits its own authoritative snapshot post-commit
    // (runAgentTask), which drops the ghost and keeps the committed bubble.
    void this.emitSnapshot()
      .catch(() => {})
      .finally(() => {
        void this.drain(resolveDraining).finally(() => {
          // Defensive: drain() always calls onDecided via its own try/finally,
          // but a second resolve() is a no-op, so this just guarantees the
          // promise can never dangle unresolved if drain() were ever changed.
          resolveDraining();
          if (this.draining) this.draining = undefined;
        });
      });
  }

  maybeAutoHeal(task: Task): void {
    runAutoHeal(this, task);
  }

  taskCancelled(task: Task): boolean {
    return task.status === "cancelled";
  }

  /** Observer hooks (config.json `hooks`), fire-and-forget: run at the room
   * layer, so they behave identically for every harness. Never awaited on the
   * turn path — a hook can neither block nor fail a turn. */
  fireHooks(event: HookEvent, payload: Record<string, unknown>): void {
    const hooks = this.workspace.config.hooks?.[event];
    if (!hooks?.length) return;
    void runHooks(hooks, event, { roomId: this.roomId, ...payload }, {
      cwd: this.workspace.rootDir,
      log: (message) => console.warn(`[gaia] ${message}`),
    });
  }

  /** Fold one streamed AgentEvent into the live-turn mirror. Delegates to the
   * SAME `applyEventToDetails` folder that builds the committed event's details
   * (turns.ts) — one shared implementation, so the mid-turn snapshot mirror, the
   * live client stream, and the final committed event agree by construction
   * (text + thinking + tools + ordered blocks). Guarded on eventId so a stray
   * event from a prior target can't bleed in. */
  applyLiveTurn(eventId: string, event: AgentEvent): void {
    const live = this.liveTurn;
    if (!live || live.eventId !== eventId) return;
    // Mirror the harness's own stall bookkeeping (RunnerHost.arm/clearStallDeadline):
    // an upstream-stall notice marks the turn as reconnecting so a client that
    // (re)subscribes mid-stall renders the retry state from the snapshot rather
    // than a frozen bubble; ANY real output (a non-notice event) proves the
    // harness recovered and clears it. Uniform for every harness — the notice is
    // harness-agnostic (no `=== "claude"` branch).
    if (event.type === "notice") {
      if (event.kind === "upstream-stall") live.stalled = true;
    } else if (live.stalled) {
      live.stalled = false;
    }
    if (event.type === "text-delta") live.text += event.delta;
    applyEventToDetails(live.details, event);
  }

  toUiEvent(taskId: string, agentId: string, eventId: string, event: AgentEvent): UiEvent | undefined {
    const scope = { workspaceId: this.workspaceId, roomId: this.roomId, taskId, agentId, eventId };
    switch (event.type) {
      case "model-info":
        return { ...scope, type: "model-info", provider: event.provider, modelId: event.modelId, subscription: event.subscription };
      case "model-fallback":
        return { ...scope, type: "model-fallback", fromModel: event.fromModel, toModel: event.toModel, reason: event.reason, ...(event.refusal ? { refusal: true } : {}) };
      case "context-usage":
        // The onEvent handler has already stored the resolved window (turn-end
        // value, last-known, or a-priori fallback); ride it out so the live chip
        // renders a % even before the harness reports the window at turn-end.
        return { ...scope, type: "context-usage", usedTokens: event.usedTokens, maxTokens: event.maxTokens ?? this.contextUsage[agentId]?.maxTokens };
      case "text-delta":
        return { ...scope, type: "text-delta", delta: event.delta };
      case "thinking-start":
        return { ...scope, type: "thinking-start" };
      case "thinking-delta":
        return { ...scope, type: "thinking-delta", delta: event.delta };
      case "thinking-end":
        return { ...scope, type: "thinking-end", content: event.content };
      case "skill-invocation":
        return { ...scope, type: "skill-invocation", skill: event.skill };
      case "tool-start":
        return { ...scope, type: "tool-start", toolName: event.toolName, toolCallId: event.toolCallId, args: event.args };
      case "tool-update":
        return { ...scope, type: "tool-update", toolName: event.toolName, toolCallId: event.toolCallId, partialResult: event.partialResult };
      case "tool-end":
        return { ...scope, type: "tool-end", toolName: event.toolName, toolCallId: event.toolCallId, result: event.result, isError: event.isError };
      case "steered":
        return { ...scope, type: "steered", steerEventId: event.eventId };
      case "notice":
        // Not a UI transport event — no-op. Never rendered as reply text.
        return undefined;
    }
  }

  async emitSnapshot(): Promise<void> {
    this.emit({ type: "snapshot", workspaceId: this.workspaceId, roomId: this.roomId, snapshot: await this.getSnapshot() });
  }

  emit(event: UiEvent): void {
    this.bus.emit(event);
  }

  /** Broadcast the workspace's room list to EVERY client in the workspace (no
   * roomId scope), so a sidebar updates a room's running dot / unread badge even
   * when that room isn't the one being viewed — the per-room SSE only carries
   * the open room's own events. Best-effort chrome; never breaks a turn. */
  async emitRoomsChanged(): Promise<void> {
    try {
      this.emit({ type: "rooms", workspaceId: this.workspaceId, rooms: await this.listRooms() });
    } catch {
      // A rooms refresh is decorative; a failed disk read must not surface.
    }
  }

  async maybeAutoTitle(text: string): Promise<void> {
    if (this.incognito) return;
    await this.pluginRoomMetadataPolicy(text);
  }

  withTitleLlmAccount(input: ConsolidateLlmInput): ConsolidateLlmInput {
    const provider = input.model?.provider ?? DEFAULTS.roomTitleModel.provider;
    const account = this.options.titleLlmAccount?.(provider);
    if (!account) throw new Error(`no named title LLM account for provider: ${provider}`);
    return { ...input, model: input.model ?? DEFAULTS.roomTitleModel, account };
  }

  async maybeRetitleOnDrift(): Promise<void> {}

  unknownAgentMessage(agentId: string): string {
    return `Unknown agent: @${agentId}\nAvailable agents: ${Object.keys(this.workspace.agents)
      .map((id) => `@${id}`)
      .join(", ")}`;
  }}

export function installRoomUi(target: object): void {
  for (const name of Object.getOwnPropertyNames(RoomUiMixin.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(RoomUiMixin.prototype, name)!);
  }
}
