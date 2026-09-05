import { readFileSync } from "node:fs";
import { join } from "node:path";

const CHARGE = "⚔️ The berserker is summoned — a task in this room has hit a wall. Name the plateaued task and exact wall, split it into independent attack vectors, summon worker lanes where useful, cross-examine the findings, and report the breach plan.";
const PROMPT = [
  "# ⚔️ BERSERK — ADVERSARIAL DEATHMODE (active across this room and every subroom until the human says /berserk off)",
  "Every claim you output may be cross-examined by the other agents. Defend with verifiable evidence: artifacts, reproductions, citations, measurements.",
  "Use the mode to break plateaus: name the wall, split it into independent attack vectors, summon worker lanes when useful, and arbitrate findings into a breach plan.",
].join("\n");
function legacyActive(ctx) {
  try { const raw=JSON.parse(readFileSync(join(ctx.workspaceRoot,".gaia","rooms",ctx.stateRoomId ?? ctx.roomId,"state.json"),"utf8")); return raw?.berserk===true; } catch { return false; }
}
function active(ctx) { return ctx.state?.active === true || (!ctx.state && legacyActive(ctx)); }
export default {
  command: "berserk",
  id: "berserk",
  description: "summon adversarial plateau-break mode across this room tree: /berserk | /berserk off",
  roomMode: { key: "active", inheritance: "root-tree", chromeToken: "danger" },
  run(args, ctx) {
    const off=args[0]?.toLowerCase()==="off";
    if (off) return { state:{active:false}, reply:"⚔️ berserk off — the room tree stands down." };
    return { state:{active:true}, reply:"⚔️ berserk on — adversarial plateau-break mode active for this room.", rewriteAsMessage:CHARGE };
  },
  prompt(ctx) { return active(ctx) ? PROMPT : undefined; },
};
