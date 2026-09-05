import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { initWorkspace } from "../src/domain/workspace.js";
import { GaiaWebServer } from "../src/server/http.js";
import { createTempDir } from "./helpers/temp.js";

test("design-canvas plugin registers routes and broadcasts client-shaped SSE", async () => {
  const temp = await createTempDir();
  const previousHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = join(temp.path, "home");
  const workspace = join(temp.path, "workspace");
  await initWorkspace(workspace);
  const web = new GaiaWebServer({ cwd: workspace, host: "127.0.0.1", port: 0 });
  let live: Awaited<ReturnType<GaiaWebServer["listen"]>> | undefined;
  try {
    live = await web.listen();
    const base = live.url.replace(/\/$/, "");
    const stream = await fetch(`${base}/api/events`);
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("event: ready")) received += decoder.decode((await reader.read()).value, { stream: true });

    const missing = await fetch(`${base}/api/canvas`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "Missing command" });
    const missingPrompt = await fetch(`${base}/api/canvas/prompt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missingPrompt.status, 400);
    assert.deepEqual(await missingPrompt.json(), { error: "Missing text" });
    const missingSave = await fetch(`${base}/api/canvas/save`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missingSave.status, 400);
    assert.deepEqual(await missingSave.json(), { error: "Missing design" });

    const params = { type: "rectangle", x: 17, y: 23, width: 80, height: 40, fill: "#123456" };
    const posted = await fetch(`${base}/api/canvas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "create", params }),
    });
    assert.equal(posted.status, 200);
    assert.deepEqual(await posted.json(), { ok: true, command: "create" });
    while (!received.includes("event: canvas-command")) received += decoder.decode((await reader.read()).value, { stream: true });
    const data = received.split("event: canvas-command\n")[1]!.split("\n\n")[0]!.replace(/^data: /, "");
    assert.deepEqual(JSON.parse(data), { type: "canvas-command", command: "create", params });
    await reader.cancel();
  } finally {
    await live?.close();
    if (previousHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = previousHome;
    await temp.cleanup();
  }
});
