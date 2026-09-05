const USAGE = "usage: /queue <text> — park an idea on the durable queue; /queue pause <taskId>; /queue resume <taskId>";

function textOf(args) {
  return args.join(" ").trim();
}

export default {
  command: "queue",
  id: "queue",
  description: "park an idea on the durable queue without steering the running turn: /queue <text>",
  async run(args, ctx) {
    if (!ctx.queue) return { reply: "queue facade is unavailable." };
    const [sub, id] = args;
    if (sub === "pause" || sub === "resume") {
      if (!id) return { reply: USAGE, panel: this.panel };
      const ok = await ctx.queue.setPaused(id, sub === "pause");
      return { reply: ok ? `${sub === "pause" ? "paused" : "resumed"}: ${id}` : `queue entry not found: ${id}`, panel: this.panel };
    }
    const text = textOf(args);
    if (!text) return { reply: USAGE, panel: this.panel };
    await ctx.queue.enqueue(text, { force: true });
    return { reply: `queued: ${text}`, panel: this.panel };
  },
  async panel(ctx) {
    const items = ctx.queue ? await ctx.queue.listOwn() : [];
    return {
      title: "Queue",
      description: "Plugin-owned parked messages.",
      items: items.map((entry) => ({
        title: entry.text,
        detail: `${entry.paused ? "paused" : "queued"} · ${entry.taskId}`,
        actions: [{
          action: entry.paused ? "resume" : "pause",
          label: entry.paused ? "Resume" : "Pause",
          args: [entry.taskId],
        }],
      })),
    };
  },
};
