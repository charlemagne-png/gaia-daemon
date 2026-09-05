import test from "node:test";
import assert from "node:assert/strict";
import queuePlugin from "../plugins/defaults/queue.mjs";

test("queue plugin enqueues text and pauses/resumes owned entries through ctx.queue", async () => {
  const entries = new Map<string, { taskId: string; text: string; targets: string[]; paused: boolean; queuedAt: string }>();
  const ctx = {
    queue: {
      async enqueue(text: string) {
        entries.set("task_1", { taskId: "task_1", text, targets: ["gaia"], paused: false, queuedAt: "now" });
      },
      async listOwn() {
        return [...entries.values()];
      },
      async setPaused(taskId: string, on: boolean) {
        const entry = entries.get(taskId);
        if (!entry) return false;
        entry.paused = on;
        return true;
      },
    },
  };

  assert.equal((await queuePlugin.run(["check", "this"], ctx)).reply, "queued: check this");
  assert.equal(entries.get("task_1")?.text, "check this");
  assert.equal((await queuePlugin.run(["pause", "task_1"], ctx)).reply, "paused: task_1");
  assert.equal(entries.get("task_1")?.paused, true);
  assert.equal((await queuePlugin.run(["resume", "task_1"], ctx)).reply, "resumed: task_1");
  assert.equal(entries.get("task_1")?.paused, false);
});
