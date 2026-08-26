import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { GaiaWebServer } from "../src/server/http.js";
import { cancelSpeechQueue, setSaySpawnForTest } from "../src/services/tts-apple.js";
import { createTempDir } from "./helpers/temp.js";

type WebInternals = {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  daemon: { dispose(): Promise<void> };
};

class FakeSayChild extends EventEmitter {
  stderr = new EventEmitter();
  killed = false;
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, signal ?? "SIGTERM"));
    return true;
  }
}

async function listenRoute(web: WebInternals): Promise<{ server: HttpServer; baseUrl: string }> {
  const server = createServer((request, response) => {
    void web.handle(request, response).catch((error) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  server.closeAllConnections?.();
}

test("POST /api/voice/speak/cancel kills active say child and drains queued speech", async () => {
  const temp = await createTempDir();
  const previousHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = join(temp.path, "home");
  await mkdir(process.env.GAIA_HOME, { recursive: true });
  const children: FakeSayChild[] = [];
  const restore = setSaySpawnForTest((() => {
    const child = new FakeSayChild();
    children.push(child);
    return child;
  }) as never);
  let server: HttpServer | undefined;
  let web: WebInternals | undefined;
  try {
    web = new GaiaWebServer({ cwd: temp.path }) as unknown as WebInternals;
    const listening = await listenRoute(web);
    server = listening.server;
    const speakOne = fetch(`${listening.baseUrl}/api/voice/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "first" }) });
    while (children.length < 1) await new Promise((resolve) => setTimeout(resolve, 0));
    const speakTwo = fetch(`${listening.baseUrl}/api/voice/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "second" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(children.length, 1);

    const cancelled = await fetch(`${listening.baseUrl}/api/voice/speak/cancel`, { method: "POST", body: "{}" });
    assert.equal(cancelled.status, 200);
    assert.equal(children[0]?.killed, true);

    const [first, second] = await Promise.all([speakOne, speakTwo]);
    assert.equal(first.status, 502);
    assert.equal(second.status, 502);
    assert.equal(children.length, 1);
  } finally {
    restore();
    cancelSpeechQueue();
    if (server) await closeServer(server);
    await web?.daemon.dispose();
    if (previousHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = previousHome;
    await temp.cleanup();
  }
});
