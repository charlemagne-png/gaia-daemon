import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { RoomHandle } from "../src/domain/rooms.js";
import { initWorkspace } from "../src/domain/workspace.js";
import { registerHarness } from "../src/harness/spec.js";
import { GaiaWebServer } from "../src/server/http.js";
import { createTempDir } from "./helpers/temp.js";

registerHarness({
  id: "pi",
  capabilities: {
    gaiaTools: [],
    nativeTools: [],
    granularTools: true,
    supportsPermissionMode: false,
    supportsMcp: false,
    supportsSteer: false,
    supportsCompact: false,
    supportsNativeCommands: false,
    fanOutTools: [],
  },
  ui: { label: "HTTP promote test", description: "endpoint test harness" },
  create: () => {
    throw new Error("not used: endpoint test never starts a turn");
  },
});

type WebInternals = {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  daemon: {
    registry: { add(path: string): Promise<{ id: string }> };
    dispose(): Promise<void>;
  };
};

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
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test("POST /promote swaps a child with its parent and returns the refreshed room list", async () => {
  const temp = await createTempDir();
  const previousHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = join(temp.path, "home");
  let server: HttpServer | undefined;
  let web: WebInternals | undefined;
  try {
    const workspace = join(temp.path, "workspace");
    await mkdir(workspace, { recursive: true });
    await initWorkspace(workspace);
    const parent = await RoomHandle.open(workspace, "default");
    await parent.updateState((state) => {
      state.title = "Main title";
      state.titleSource = "manual";
    });
    const child = await RoomHandle.open(workspace, "child");
    await child.updateState((state) => {
      state.parentRoomId = "default";
      state.subroom = true;
      state.title = "Child title";
      state.titleSource = "auto";
    });

    web = new GaiaWebServer({ cwd: workspace }) as unknown as WebInternals;
    const record = await web.daemon.registry.add(workspace);
    const listening = await listenRoute(web);
    server = listening.server;
    const route = `${listening.baseUrl}/api/workspaces/${encodeURIComponent(record.id)}/rooms/child/promote`;

    const response = await fetch(route, { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const body = await response.json() as { promotedRoomId: string; demotedRoomId: string; rooms: Array<{ id: string; parentRoomId?: string; title?: string }> };
    assert.equal(body.promotedRoomId, "child");
    assert.equal(body.demotedRoomId, "default");
    assert.equal(body.rooms.find((room) => room.id === "child")?.parentRoomId, undefined);
    assert.equal(body.rooms.find((room) => room.id === "default")?.parentRoomId, "child");

    const rootAttempt = await fetch(route, { method: "POST", body: "{}" });
    assert.equal(rootAttempt.status, 400);
    await rootAttempt.json();
  } finally {
    if (server) await closeServer(server);
    await web?.daemon.dispose();
    if (previousHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = previousHome;
    await temp.cleanup();
  }
});
