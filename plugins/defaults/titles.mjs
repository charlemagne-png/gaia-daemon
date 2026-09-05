const TITLE_DRIFT_EVERY = 8;

function isAutoRoomId(roomId) {
  return /^chat-[a-z0-9-]+$/.test(roomId);
}
function titleFrom(text) {
  return String(text || "")
    .replace(/^@\w+\s+/, "")
    .replace(/[`*_#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .replace(/[.!?:;,]+$/g, "");
}
function cleanTitle(text) {
  const title = String(text || "").replace(/["“”]/g, "").replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
  return title.length <= 80 ? title : title.slice(0, 80).replace(/\s+\S*$/, "");
}
async function refine(ctx, firstMessage, fallback) {
  if (!ctx.llm) return;
  const reply = await ctx.llm({
    system: "You name chat rooms by PURPOSE, in the user's own words. Return ONLY a concise title, 2-6 words, no quotes, no period. Name what the room is FOR (the task or topic), never echo the sentence itself. Preserve key project or product names. Do not mention the assistant.",
    user: `First user message:\n${firstMessage}\n\nTitle:`,
  });
  const title = cleanTitle(reply);
  if (title && title !== fallback) await ctx.setAutoTitle({ title: fallback, titleSource: "auto" }, title, "model");
}
async function drift(ctx, title) {
  if (!ctx.llm) return;
  const events = await ctx.recentEvents(60);
  const userLines = events.filter((event) => event.author === "user" && typeof event.text === "string" && event.text.trim()).slice(-10).map((event) => {
    const text = event.text.replace(/\s+/g, " ").trim();
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
  });
  if (userLines.length < 3) return;
  const reply = await ctx.llm({
    system: "You keep chat-room titles honest. Given the current title and the room's recent user messages, decide whether the title still names the room's PURPOSE in the user's own words. If it still fits, return it UNCHANGED. If the room has drifted, return a new concise title, 2-6 words, no quotes, no period — generalize if the room broadened, specialize if it crystallized. Return ONLY the title.",
    user: `Current title: ${title}\n\nRecent user messages (oldest first):\n${userLines.map((line) => `- ${line}`).join("\n")}\n\nTitle:`,
  });
  const next = cleanTitle(reply);
  if (next && next !== title) await ctx.setAutoTitle({ title }, next, "model");
}

export default {
  id: "titles",
  async roomMetadataPolicy(ctx) {
    if (ctx.event !== "post-user-commit" || !isAutoRoomId(ctx.roomId)) return;
    const policyState = ctx.state || {};
    if (ctx.imported || ctx.titleSource === "manual") return policyState;
    if (!ctx.title) {
      const fallback = titleFrom(ctx.text);
      if (!fallback) return;
      const changed = await ctx.setAutoTitle({ title: undefined, titleSource: undefined }, fallback, "auto");
      if (changed) {
        policyState.titleDrift = 1;
        await refine(ctx, ctx.text, fallback).catch((error) => console.warn(`[titles] refine failed for ${ctx.roomId}: ${error.message || error}`));
      }
      return policyState;
    }
    const n = Number.isInteger(policyState.titleDrift) ? policyState.titleDrift + 1 : 1;
    policyState.titleDrift = n >= TITLE_DRIFT_EVERY ? 0 : n;
    if (n >= TITLE_DRIFT_EVERY) await drift(ctx, ctx.title).catch((error) => console.warn(`[titles] drift failed for ${ctx.roomId}: ${error.message || error}`));
    return policyState;
  },
};
