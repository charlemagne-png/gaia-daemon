import { test } from "node:test";
import assert from "node:assert/strict";
import payloadGuard from "../plugins/runner/payload-guard.mjs";

test("payload guard spills oversized input and event strings through host sink", async () => {
  const prevPayload = process.env.GAIA_PAYLOAD_MAX_BYTES;
  const prevContext = process.env.GAIA_CONTEXT_MAX_BYTES;
  process.env.GAIA_PAYLOAD_MAX_BYTES = "16";
  process.env.GAIA_CONTEXT_MAX_BYTES = "256";
  const spills: Array<{ content: string; meta?: Record<string, unknown> }> = [];
  const ctx = {
    workspacePath: "/tmp/ws",
    roomId: "room",
    agentId: "gaia",
    async spillContent(content: string, meta?: Record<string, unknown>) {
      spills.push({ content, meta });
      return { path: `/sink/${spills.length}`, bytes: Buffer.byteLength(content), sha256: `sha${spills.length}` };
    },
  };
  try {
    const input = await payloadGuard.transformInput({
      roomId: "room",
      message: "x".repeat(32),
      transcript: [{ id: "e1", timestamp: "t", author: "user", text: "short" }],
    }, ctx);
    assert.match(input.message, /payload spilled: input\.message/);

    const event = await payloadGuard.transformEvent({ type: "tool-end", toolName: "read", result: "y".repeat(32), isError: false }, ctx);
    assert.equal(event.type, "tool-end");
    assert.match(String(event.result), /payload spilled: event\.result/);
    assert.equal(spills.length >= 2, true);
  } finally {
    if (prevPayload === undefined) delete process.env.GAIA_PAYLOAD_MAX_BYTES;
    else process.env.GAIA_PAYLOAD_MAX_BYTES = prevPayload;
    if (prevContext === undefined) delete process.env.GAIA_CONTEXT_MAX_BYTES;
    else process.env.GAIA_CONTEXT_MAX_BYTES = prevContext;
  }
});
