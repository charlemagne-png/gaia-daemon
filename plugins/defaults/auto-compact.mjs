const autoCompactAt = new Map();

function autoCompactPercent() {
  const parsed = Number.parseFloat(process.env.GAIA_AUTO_COMPACT_PERCENT ?? "");
  return Number.isFinite(parsed) ? parsed : 15;
}

export default {
  id: "auto-compact",
  async turnSettled(ctx) {
    if (ctx.status !== "complete") return;
    const threshold = autoCompactPercent();
    if (threshold <= 0) return;
    for (const target of ctx.targets) {
      if (ctx.capabilities[target]?.supportsCompact !== true) continue;
      const usage = ctx.contextUsage[target];
      if (!usage?.maxTokens || usage.usedTokens <= 0) continue;
      const percent = (usage.usedTokens / usage.maxTokens) * 100;
      if (!(percent > threshold)) continue;
      if (autoCompactAt.get(target) === usage.usedTokens) continue;
      autoCompactAt.set(target, usage.usedTokens);
      await ctx.enqueueCommand(`/compact @${target}`);
    }
  },
};
