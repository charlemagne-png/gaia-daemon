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
  ui: { label: "HTTP project test", description: "endpoint test harness" },
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
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  server.closeAllConnections?.();
}

test("POST /project sets, surfaces, and clears the room's project label", async () => {
  const temp = await createTempDir();
  const previousHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = join(temp.path, "home");
  let server: HttpServer | undefined;
  let web: WebInternals | undefined;
  try {
    const workspace = join(temp.path, "workspace");
    await mkdir(workspace, { recursive: true });
    await initWorkspace(workspace);

    web = new GaiaWebServer({ cwd: workspace }) as unknown as WebInternals;
    const record = await web.daemon.registry.add(workspace);
    const listening = await listenRoute(web);
    server = listening.server;
    const route = `${listening.baseUrl}/api/workspaces/${encodeURIComponent(record.id)}/rooms/default/project`;

    const set = await fetch(route, { method: "POST", body: JSON.stringify({ project: "  Potluck   Empire  " }) });
    assert.equal(set.status, 200);
    const setBody = await set.json() as { rooms: { id: string; project?: string }[] };
    assert.equal(setBody.rooms.find((room) => room.id === "default")?.project, "Potluck Empire");
    let room = await RoomHandle.open(workspace, "default");
    assert.equal((await room.state()).project, "Potluck Empire");

    const clear = await fetch(route, { method: "POST", body: JSON.stringify({ project: "" }) });
    assert.equal(clear.status, 200);
    const clearBody = await clear.json() as { rooms: { id: string; project?: string }[] };
    assert.equal(clearBody.rooms.find((room) => room.id === "default")?.project, undefined);
    room = await RoomHandle.open(workspace, "default");
    assert.equal((await room.state()).project, undefined);
  } finally {
    if (server) await closeServer(server);
    await web?.daemon.dispose();
    if (previousHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = previousHome;
    await temp.cleanup();
  }
});
