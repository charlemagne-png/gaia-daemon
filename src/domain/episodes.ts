// Episodic memory: one JSONL line per settled task, captured mechanically
// post-commit (no LLM, no hot-path latency). Append-only source of truth;
// any index over it is derived and rebuildable.

import { join } from "node:path";
import type { JsonlPage } from "../core/store.js";
import { appendJsonl, appendText, readJsonlFrom, readText, writeTextAtomic } from "../core/store.js";

export type EpisodeOutcome = "complete" | "error" | "cancelled" | "user_corrected";

export interface Episode {
  id: string;
  ts: string;
  roomId: string;
  agentId: string;
  task: string;
  reply: string;
  outcome: EpisodeOutcome;
  tools?: string[];
  channel?: "text" | "voice";
  /** Added later by the consolidator, never at capture time. */
  lesson?: string;
}

export const EPISODES_FILE = "episodes.jsonl";

// task/reply are heads, not transcripts — the full text stays in the room log.
const HEAD_LIMIT = 400;

const OUTCOMES: readonly string[] = ["complete", "error", "cancelled", "user_corrected"];

export async function appendEpisode(dir: string, episode: Episode): Promise<void> {
  await appendJsonl(join(dir, EPISODES_FILE), {
    ...episode,
    task: episode.task.slice(0, HEAD_LIMIT),
    reply: episode.reply.slice(0, HEAD_LIMIT),
  });
}

export async function readEpisodesFrom(dir: string, cursor: number): Promise<JsonlPage<Episode>> {
  return readJsonlFrom(join(dir, EPISODES_FILE), cursor, episodeFrom);
}

/** Remove every episode captured in `roomId` from this agent's log — used when a
 * room is deleted so its turns stop surfacing in recall. This is the ONE place
 * the otherwise append-only log is rewritten; the write is atomic and every
 * other line (including unparseable ones) is preserved verbatim. When
 * `backupPath` is given the removed lines are copied there first, so a room
 * delete stays reversible. Returns how many episodes were removed. */
export async function purgeRoomEpisodes(dir: string, roomId: string, backupPath?: string): Promise<number> {
  const path = join(dir, EPISODES_FILE);
  const text = await readText(path);
  if (!text) return 0;
  const lines = text.split("\n").filter((line) => line.trim());
  const kept: string[] = [];
  const removed: string[] = [];
  for (const line of lines) {
    let room: unknown;
    try {
      room = (JSON.parse(line) as { roomId?: unknown }).roomId;
    } catch {
      kept.push(line); // leave anything unparseable untouched
      continue;
    }
    (room === roomId ? removed : kept).push(line);
  }
  if (!removed.length) return 0;
  if (backupPath) await appendText(backupPath, `${removed.join("\n")}\n`);
  await writeTextAtomic(path, kept.length ? `${kept.join("\n")}\n` : "");
  return removed.length;
}

/** Sanitize-apply propagation (thanks-dario): rewrite this room's episodes in
 * place with the SAME quote→replacement edits the human approved for the
 * transcript. Episodes hold 400-char HEADS of raw turns, so a quote may be cut
 * mid-way — a long tail-prefix of the quote (≥48 chars) at the end of a head
 * is treated as the same poison and replaced too. Originals are appended to
 * `backupPath` first (append-only, mirrors purgeRoomEpisodes), so the rewrite
 * stays reversible. Returns the rewritten episodes (for the derived index).
 * `roomId: null` = whole-memory sweep (08-30 lesson: the wound metastasizes —
 * summon lanes + sibling rooms captured the same poison into THEIR episodes,
 * so a room-scoped rewrite left recall bleeding). */
export async function rewriteRoomEpisodes(
  dir: string,
  roomId: string | null,
  replacements: Array<{ quote: string; replacement: string }>,
  backupPath?: string,
): Promise<Episode[]> {
  const path = join(dir, EPISODES_FILE);
  const text = await readText(path);
  if (!text) return [];
  const lines = text.split("\n").filter((line) => line.trim());
  const out: string[] = [];
  const originals: string[] = [];
  const rewritten: Episode[] = [];
  for (const line of lines) {
    let episode: Episode | undefined;
    try {
      episode = episodeFrom(JSON.parse(line));
    } catch {
      // unparseable lines stay verbatim
    }
    if (!episode || (roomId !== null && episode.roomId !== roomId)) {
      out.push(line);
      continue;
    }
    const task = applyReplacements(episode.task, replacements);
    const reply = applyReplacements(episode.reply, replacements);
    const lesson = episode.lesson === undefined ? undefined : applyReplacements(episode.lesson, replacements);
    if (task === episode.task && reply === episode.reply && lesson === episode.lesson) {
      out.push(line);
      continue;
    }
    originals.push(line);
    const next: Episode = { ...episode, task: task.slice(0, HEAD_LIMIT), reply: reply.slice(0, HEAD_LIMIT), ...(lesson !== undefined ? { lesson } : {}) };
    rewritten.push(next);
    out.push(JSON.stringify(next));
  }
  if (!rewritten.length) return [];
  if (backupPath) await appendText(backupPath, `${originals.join("\n")}\n`);
  await writeTextAtomic(path, out.length ? `${out.join("\n")}\n` : "");
  return rewritten;
}

/** Longest-prefix-aware replacement over a truncated head. */
const TAIL_PREFIX_MIN = 48;

export function applyReplacements(text: string, replacements: Array<{ quote: string; replacement: string }>): string {
  let next = text;
  for (const { quote, replacement } of replacements) {
    if (!quote) continue;
    if (next.includes(quote)) {
      next = next.split(quote).join(replacement);
      continue;
    }
    // Head truncated mid-quote: the head ends with a long prefix of the quote.
    for (let cut = Math.min(quote.length - 1, next.length); cut >= TAIL_PREFIX_MIN; cut -= 1) {
      const prefix = quote.slice(0, cut);
      if (next.endsWith(prefix)) {
        next = next.slice(0, next.length - cut) + replacement;
        break;
      }
    }
  }
  return next;
}

function episodeFrom(raw: unknown): Episode | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.ts !== "string" || typeof record.task !== "string") return undefined;
  if (!OUTCOMES.includes(record.outcome as string)) return undefined;
  return record as unknown as Episode;
}
