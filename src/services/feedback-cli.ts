import { env } from "../core/env.js";
import { globalPaths } from "../core/paths.js";
import { logFeedback, readFeedbackScores } from "../domain/feedback.js";
import type { FeedbackVerdict } from "../core/types.js";

const USAGE = 'Usage:\n  gaia feedback log <agent> <good|bad> "<quote>"\n  gaia feedback show [agent]';

export async function runFeedbackCli(args: string[], scoresPath: string = globalPaths.feedbackScores()): Promise<number> {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return args.length ? 0 : 1;
  }

  try {
    if (args[0] === "log") {
      const agentId = args[1] ?? "";
      const verdict = args[2];
      const quote = args.slice(3).join(" ");
      if (!agentId || (verdict !== "good" && verdict !== "bad") || !quote.trim()) {
        console.error(USAGE);
        return 1;
      }
      const score = await logFeedback({
        agentId,
        verdict: verdict as FeedbackVerdict,
        quote,
        room: env("GAIA_ROOM_ID") ?? "cli",
        scoresPath,
      });
      console.log(JSON.stringify({ [agentId]: score }, null, 2));
      return 0;
    }

    if (args[0] === "show" && args.length <= 2) {
      const scores = await readFeedbackScores(scoresPath);
      const agentId = args[1];
      console.log(JSON.stringify(agentId ? { [agentId]: scores[agentId] ?? { score: 0, lastRemarks: [] } } : scores, null, 2));
      return 0;
    }

    console.error(USAGE);
    return 1;
  } catch (error) {
    console.error(`gaia feedback: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
