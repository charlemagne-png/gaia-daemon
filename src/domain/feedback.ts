import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentPaths, globalPaths } from "../core/paths.js";
import { readJson, writeJsonAtomic } from "../core/store.js";
import type { AgentFeedbackScore, FeedbackRemark, FeedbackScores, FeedbackVerdict } from "../core/types.js";

const REMARK_LIMIT = 20;

function safeAgentId(agentId: string): string {
  const id = agentId.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid agent id: ${agentId}. Use letters, numbers, dash, or underscore.`);
  return id;
}

function normalizeRemark(raw: unknown): FeedbackRemark | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.ts !== "string" ||
    typeof value.room !== "string" ||
    (value.verdict !== "good" && value.verdict !== "bad") ||
    typeof value.quote !== "string"
  ) return undefined;
  return { ts: value.ts, room: value.room, verdict: value.verdict, quote: value.quote };
}

function normalizeScore(raw: unknown): AgentFeedbackScore | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || !Array.isArray(value.lastRemarks)) return undefined;
  return {
    score: value.score,
    lastRemarks: value.lastRemarks.map(normalizeRemark).filter((remark): remark is FeedbackRemark => remark !== undefined).slice(-REMARK_LIMIT),
  };
}

/** Public precedence surface → plain scores.json data; malformed entries skipped. */
export async function readFeedbackScores(path: string = globalPaths.feedbackScores()): Promise<FeedbackScores> {
  const raw = await readJson(path);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries: Array<[string, AgentFeedbackScore]> = [];
  for (const [agentId, value] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_-]+$/.test(agentId)) continue;
    const score = normalizeScore(value);
    if (score) entries.push([agentId, score]);
  }
  return Object.fromEntries(entries);
}

export async function logFeedback(params: {
  agentId: string;
  verdict: FeedbackVerdict;
  quote: string;
  room?: string;
  now?: Date;
  scoresPath?: string;
}): Promise<AgentFeedbackScore> {
  const agentId = safeAgentId(params.agentId);
  if (params.verdict !== "good" && params.verdict !== "bad") throw new Error("Verdict must be good or bad.");
  const quote = params.quote.trim();
  if (!quote) throw new Error("Feedback quote must not be empty.");
  const scoresPath = params.scoresPath ?? globalPaths.feedbackScores();
  const scores = await readFeedbackScores(scoresPath);
  const current = scores[agentId] ?? { score: 0, lastRemarks: [] };
  const remark: FeedbackRemark = {
    ts: (params.now ?? new Date()).toISOString(),
    room: params.room?.trim() || "cli",
    verdict: params.verdict,
    quote,
  };
  const next = {
    score: current.score + (params.verdict === "good" ? 1 : -1),
    lastRemarks: [...current.lastRemarks, remark].slice(-REMARK_LIMIT),
  };
  await writeJsonAtomic(scoresPath, { ...scores, [agentId]: next });
  return next;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** Charles-feedback context → one uniform block consumed by shared prompt assembly. */
export async function feedbackPromptBlock(params: {
  agentId: string;
  agentDir: string;
  feedbackDir?: string;
}): Promise<string> {
  const dir = params.feedbackDir ?? globalPaths.feedbackDir();
  const [taste, ownFeedback, scores] = await Promise.all([
    readOptional(join(dir, "TASTE-CANON.md")),
    readOptional(agentPaths.feedback(params.agentDir)),
    readFeedbackScores(join(dir, "scores.json")),
  ]);
  const sections = [
    taste.trim() ? `# Charles Taste Canon\n\n${taste.trim()}` : "",
    [`# Charles Feedback — @${params.agentId}`, `Standing → ${scores[params.agentId]?.score ?? 0}`, ownFeedback.trim()].filter(Boolean).join("\n\n"),
  ];
  return sections.filter(Boolean).join("\n\n---\n\n");
}
