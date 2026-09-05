import test from "node:test";
import assert from "node:assert/strict";
import { relocateClaudeSystemPrompt } from "../src/harness/pi/claude-code-identity.js";

test("Pi Claude OAuth keeps only Claude Code identity in system", () => {
  const payload = {
    model: "claude-sonnet-4-5",
    system: [
      { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
      { type: "text", text: "GAIA persona and tools" },
    ],
    messages: [{ role: "user", content: "hello" }],
  };

  assert.deepEqual(relocateClaudeSystemPrompt(payload), {
    model: payload.model,
    system: [payload.system[0]],
    messages: [
      { role: "user", content: [{ type: "text", text: "GAIA persona and tools" }] },
      payload.messages[0],
    ],
  });
});

test("Pi non-OAuth Anthropic payload is unchanged", () => {
  assert.equal(relocateClaudeSystemPrompt({
    system: [{ type: "text", text: "GAIA persona and tools" }],
    messages: [],
  }), undefined);
});
