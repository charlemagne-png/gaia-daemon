import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const TURN_COMPLETION_SOUND_PATH = "/Users/charleshamilton/Downloads/denielcz-achievement-unlocked-463070.mp3";
export const TURN_COMPLETION_SOUND_LEDGER = join(homedir(), ".gaia", "turn-completion-sound.jsonl");

export interface TurnCompletionNotice {
  workspaceId: string;
  roomId: string;
  taskId: string;
  agentIds: string[];
  status: "complete" | "error" | "cancelled";
  settledAt: string;
}

/** Durable commit → detached macOS playback. Audio failure never affects turn custody. */
export function playTurnCompletionSound(notice: TurnCompletionNotice): void {
  if (process.platform !== "darwin" || !existsSync(TURN_COMPLETION_SOUND_PATH)) return;
  const child = spawn("/usr/bin/afplay", [TURN_COMPLETION_SOUND_PATH], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  child.once("error", (error) => {
    console.error(`[turn-completion-sound] failed room=${notice.roomId} task=${notice.taskId}: ${error.message}`);
  });
  child.once("exit", (code) => {
    if (code !== 0) {
      console.error(`[turn-completion-sound] afplay exited ${code ?? "unknown"} room=${notice.roomId} task=${notice.taskId}`);
      return;
    }
    const entry = JSON.stringify({ ...notice, sound: TURN_COMPLETION_SOUND_PATH, playedAt: new Date().toISOString() }) + "\n";
    void mkdir(dirname(TURN_COMPLETION_SOUND_LEDGER), { recursive: true })
      .then(() => appendFile(TURN_COMPLETION_SOUND_LEDGER, entry, "utf8"))
      .then(() => console.info(`[turn-completion-sound] played room=${notice.roomId} task=${notice.taskId}`))
      .catch((error: unknown) => {
        console.error(`[turn-completion-sound] ledger failed room=${notice.roomId} task=${notice.taskId}: ${error instanceof Error ? error.message : String(error)}`);
      });
  });
}
