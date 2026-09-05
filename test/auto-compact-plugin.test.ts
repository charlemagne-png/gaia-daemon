import test from "node:test";
import assert from "node:assert/strict";
import autoCompact from "../plugins/defaults/auto-compact.mjs";

test("auto-compact plugin queues /compact above the default 15% threshold once per usage", async () => {
  const commands: string[] = [];
  delete process.env.GAIA_AUTO_COMPACT_PERCENT;
  const ctx = {
    status: "complete" as const,
    targets: ["gaia"],
    contextUsage: { gaia: { usedTokens: 16, maxTokens: 100 } },
    capabilities: { gaia: { supportsCompact: true } },
    enqueueCommand: async (command: string) => { commands.push(command); },
  };
  await autoCompact.turnSettled(ctx);
  await autoCompact.turnSettled(ctx);
  assert.deepEqual(commands, ["/compact @gaia"]);
});

test("auto-compact plugin honors env threshold and guards", async () => {
  const commands: string[] = [];
  process.env.GAIA_AUTO_COMPACT_PERCENT = "20";
  try {
    const base = {
      targets: ["terry"],
      contextUsage: { terry: { usedTokens: 16, maxTokens: 100 } },
      capabilities: { terry: { supportsCompact: true } },
      enqueueCommand: async (command: string) => { commands.push(command); },
    };
    await autoCompact.turnSettled({ ...base, status: "complete" as const });
    await autoCompact.turnSettled({ ...base, status: "cancelled" as const, contextUsage: { terry: { usedTokens: 30, maxTokens: 100 } } });
    await autoCompact.turnSettled({ ...base, status: "complete" as const, contextUsage: { terry: { usedTokens: 30, maxTokens: 100 } }, capabilities: { terry: { supportsCompact: false } } });
    assert.deepEqual(commands, []);
  } finally {
    delete process.env.GAIA_AUTO_COMPACT_PERCENT;
  }
});
