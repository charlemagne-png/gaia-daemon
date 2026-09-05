import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
    supportsForkAtMessage: false,
    supportsNativeCommands: false,
    fanOutTools: [],
  },
  ui: { label: "HTTP applications test", description: "endpoint test harness" },
  create: () => { throw new Error("not used: endpoint test never starts a turn"); },
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
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections?.();
}

test("GET workspace applications returns Design and Studio and seeds snapshot catalog", async () => {
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

    const response = await fetch(`${listening.baseUrl}/api/workspaces/${record.id}/applications`);
    assert.equal(response.status, 200);
    const catalog = await response.json() as { schema: number; applications: Array<{ source: string; manifest: { id: string; panel: { entry: string } } }> };
    assert.equal(catalog.schema, 1);
    assert.deepEqual(catalog.applications.map((entry) => [entry.manifest.id, entry.manifest.panel.entry, entry.source]), [
      ["design", "design", "builtin"],
      ["studio", "studio", "builtin"],
    ]);

    const snapshotResponse = await fetch(`${listening.baseUrl}/api/workspaces/${record.id}/snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshotBody = await snapshotResponse.json() as { snapshot: { applications?: { applications: Array<{ manifest: { id: string } }> }; room: { id: string; applications?: { activeInstanceId?: string; instances: Record<string, unknown> } } } };
    assert.deepEqual(snapshotBody.snapshot.applications?.applications.map((entry) => entry.manifest.id), ["design", "studio"]);

    const instanceBase = `${listening.baseUrl}/api/workspaces/${record.id}/rooms/${snapshotBody.snapshot.room.id}/application-instances`;
    const createdResponse = await fetch(instanceBase, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "request-http-1234", appId: "design", resource: { kind: "artifacts" } }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { instance: { instanceId: string; updatedAt: string }; snapshot: { room: { applications: { activeInstanceId: string } } } };
    assert.equal(created.snapshot.room.applications.activeInstanceId, created.instance.instanceId);

    const patchResponse = await fetch(`${instanceBase}/${created.instance.instanceId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource: { kind: "artifacts", id: "artifact-http" }, baseUpdatedAt: created.instance.updatedAt }) });
    assert.equal(patchResponse.status, 200);
    const staleResponse = await fetch(`${instanceBase}/${created.instance.instanceId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ view: "stale", baseUpdatedAt: created.instance.updatedAt }) });
    assert.equal(staleResponse.status, 409);

    const restoredResponse = await fetch(`${listening.baseUrl}/api/workspaces/${record.id}/snapshot`);
    const restored = await restoredResponse.json() as { snapshot: { room: { applications: { activeInstanceId: string } } } };
    assert.equal(restored.snapshot.room.applications.activeInstanceId, created.instance.instanceId);

    const closedResponse = await fetch(`${instanceBase}/${created.instance.instanceId}`, { method: "DELETE" });
    assert.equal(closedResponse.status, 200);
    const closed = await closedResponse.json() as { snapshot: { room: { applications: { activeInstanceId?: string } } } };
    assert.equal(closed.snapshot.room.applications.activeInstanceId, undefined);

    const missing = await fetch(`${listening.baseUrl}/api/workspaces/missing/applications`);
    assert.equal(missing.status, 404);
  } finally {
    if (server) await closeServer(server);
    await web?.daemon.dispose();
    if (previousHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = previousHome;
    await temp.cleanup();
  }
});
