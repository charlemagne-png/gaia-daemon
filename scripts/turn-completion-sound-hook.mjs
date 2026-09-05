#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SOUND_PATH = "/Users/charleshamilton/Downloads/denielcz-achievement-unlocked-463070.mp3";
export const DEFAULT_LEDGER_PATH = join(homedir(), ".gaia", "turn-completion-sound.jsonl");
export const DEFAULT_PLAYER = "/usr/bin/afplay";

function stringField(value) {
  return typeof value === "string" ? value : undefined;
}

export function completionNotice(payload, env = process.env, now = new Date()) {
  const event = stringField(payload?.event) ?? stringField(env.GAIA_HOOK_EVENT);
  if (event !== "postTurn" && event !== "error") return undefined;
  const roomId = stringField(payload?.roomId) ?? stringField(env.GAIA_ROOM_ID);
  const agentId = stringField(payload?.agentId) ?? stringField(env.GAIA_AGENT_ID);
  const outcome = event === "error" ? "error" : (stringField(payload?.outcome) ?? "complete");
  return {
    event,
    roomId,
    ...(agentId ? { agentId } : {}),
    ...(typeof payload?.taskId === "string" ? { taskId: payload.taskId } : {}),
    ...(Array.isArray(payload?.agentIds) ? { agentIds: payload.agentIds.filter((id) => typeof id === "string") } : {}),
    outcome,
    sound: env.GAIA_TURN_COMPLETION_SOUND_PATH || DEFAULT_SOUND_PATH,
    playedAt: now.toISOString(),
  };
}

export function playTurnCompletionSoundFromHook(payload, env = process.env) {
  const notice = completionNotice(payload, env);
  if (!notice) return { played: false, reason: "ignored-event" };
  const sound = env.GAIA_TURN_COMPLETION_SOUND_PATH || DEFAULT_SOUND_PATH;
  const player = env.GAIA_TURN_COMPLETION_SOUND_PLAYER || DEFAULT_PLAYER;
  const ledger = env.GAIA_TURN_COMPLETION_SOUND_LEDGER || DEFAULT_LEDGER_PATH;
  if (!existsSync(sound)) return { played: false, reason: "missing-sound", notice };
  if (!existsSync(player)) return { played: false, reason: "missing-player", notice };
  const result = spawnSync(player, [sound], { stdio: "ignore" });
  if (result.status !== 0) return { played: false, reason: `player-exit-${result.status ?? "signal"}`, notice };
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, JSON.stringify(notice) + "\n", "utf8");
  return { played: true, notice };
}

function readStdin() {
  const raw = readFileSync(0, "utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = playTurnCompletionSoundFromHook(readStdin());
  if (!result.played && result.reason && result.reason !== "ignored-event" && result.reason !== "missing-sound") {
    console.error(`[turn-completion-sound] ${result.reason}`);
  }
}
