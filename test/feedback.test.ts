import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logFeedback, readFeedbackScores } from "../src/domain/feedback.js";
import { runFeedbackCli } from "../src/services/feedback-cli.js";

test("feedback ledger: good/bad remarks append and score atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-feedback-"));
  const scoresPath = join(dir, "scores.json");
  await logFeedback({ agentId: "luna", verdict: "good", quote: " crisp proof ", room: "room-a", now: new Date("2026-09-06T12:00:00Z"), scoresPath });
  const result = await logFeedback({ agentId: "luna", verdict: "bad", quote: "repeated itself", room: "room-b", now: new Date("2026-09-06T12:01:00Z"), scoresPath });

  assert.deepEqual(result, {
    score: 0,
    lastRemarks: [
      { ts: "2026-09-06T12:00:00.000Z", room: "room-a", verdict: "good", quote: "crisp proof" },
      { ts: "2026-09-06T12:01:00.000Z", room: "room-b", verdict: "bad", quote: "repeated itself" },
    ],
  });
  assert.deepEqual(await readFeedbackScores(scoresPath), { luna: result });
  assert.equal((await readFile(scoresPath, "utf8")).endsWith("\n"), true);
});

test("feedback ledger: missing/malformed files are readable as empty data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-feedback-bad-"));
  const scoresPath = join(dir, "scores.json");
  assert.deepEqual(await readFeedbackScores(scoresPath), {});
  await writeFile(scoresPath, "not-json");
  assert.deepEqual(await readFeedbackScores(scoresPath), {});
});

test("feedback CLI: log + show expose scores.json without routing gates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-feedback-cli-"));
  const scoresPath = join(dir, "scores.json");
  const previousLog = console.log;
  const output: string[] = [];
  console.log = (...args: unknown[]) => output.push(args.join(" "));
  try {
    assert.equal(await runFeedbackCli(["log", "ghoul-sonnet", "good", "direct", "answer"], scoresPath), 0);
    assert.equal(await runFeedbackCli(["show", "ghoul-sonnet"], scoresPath), 0);
  } finally {
    console.log = previousLog;
  }
  const logged = JSON.parse(output[0]!) as Record<string, { score: number; lastRemarks: Array<{ quote: string }> }>;
  const shown = JSON.parse(output[1]!) as typeof logged;
  assert.equal(logged["ghoul-sonnet"]?.score, 1);
  assert.equal(logged["ghoul-sonnet"]?.lastRemarks[0]?.quote, "direct answer");
  assert.deepEqual(shown, logged);
});
