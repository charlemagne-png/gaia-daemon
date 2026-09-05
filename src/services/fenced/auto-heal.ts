// FENCED FORK FEATURE — automatic refusal recovery.
// Owning commit: 773caa6.
// Rollback: inline maybeAutoHeal() into room/ui.ts; remove this hook.
import type { ModelFallback, RoomState, Task } from "../../core/types.js";

export interface AutoHealHost {
  modelFallbacks?: Record<string, ModelFallback>;
  room: { state(): Promise<RoomState> };
  sendMessage(text: string, options: { recordUserMessage: false; queue: true }): Promise<unknown>;
}

export function maybeAutoHeal(host: AutoHealHost, task: Task): void {
  if (process.env.GAIA_AUTO_HEAL === "0") return;
  const tripped = task.targets.some((agentId) => {
    const fallback = host.modelFallbacks?.[agentId];
    return fallback?.refusal === true || /refusal|safety|safeguard|policy/i.test(fallback?.reason ?? "");
  });
  if (!tripped) return;
  void host.room.state()
    .then((state) => host.sendMessage(state.autoHeals ? "/love sanitize rebirth" : "/love sanitize auto", { recordUserMessage: false, queue: true }))
    .catch(() => {});
}
