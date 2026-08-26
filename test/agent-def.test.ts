import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeAgentAccountInput, normalizeAgentModelInput, patchAgentDefConfig, readAgentDefConfig } from "../src/core/agent-def.js";
import { createTempDir } from "./helpers/temp.js";

test("agent-def normalizers parse model/account patch fields", () => {
  assert.deepEqual(normalizeAgentModelInput("anthropic/fable"), { provider: "anthropic", name: "fable" });
  assert.equal(normalizeAgentModelInput("none"), null);
  assert.equal(normalizeAgentModelInput(null), null);
  assert.equal(normalizeAgentModelInput(undefined), undefined);
  assert.throws(() => normalizeAgentModelInput("fable"), /provider\/name/);
  assert.equal(normalizeAgentAccountInput(" work "), "work");
  assert.equal(normalizeAgentAccountInput(""), null);
  assert.equal(normalizeAgentAccountInput(undefined), undefined);
});

test("agent-def patch writes model/account atomically", async () => {
  const temp = await createTempDir("agent-def-");
  try {
    const configPath = join(temp.path, "agent.json");
    await patchAgentDefConfig(configPath, { model: { provider: "deepseek", name: "deepseek-v4-pro" }, account: "work" });
    assert.deepEqual(await readAgentDefConfig(configPath), { model: { provider: "deepseek", name: "deepseek-v4-pro" }, account: "work" });
    await patchAgentDefConfig(configPath, { model: null, account: null });
    assert.deepEqual(await readAgentDefConfig(configPath), {});
  } finally {
    await temp.cleanup();
  }
});
