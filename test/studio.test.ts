import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceRegistry } from "../src/daemon.js";
import { StudioConflictError, StudioService } from "../src/services/studio-service.js";
import { GaiaWebServer } from "../src/server/http.js";
import { initWorkspace } from "../src/domain/workspace.js";
import type { RoomService } from "../src/services/room-service.js";
import type { UiEvent } from "../src/core/types.js";

async function fixture(): Promise<{ root: string; registry: WorkspaceRegistry; service: StudioService; events: UiEvent[] }> {
  const root = await mkdtemp(join(tmpdir(), "gaia-studio-"));
  await mkdir(join(root, ".gaia", "rooms"), { recursive: true });
  await writeFile(join(root, "index.html"), "<h1>one</h1>");
  const registry = new WorkspaceRegistry(join(root, "app.json"));
  const record = await registry.add(root);
  const events: UiEvent[] = [];
  const service = new StudioService({
    registry,
    serviceFor: async (_workspaceId, roomId) => {
      await mkdir(join(root, ".gaia", "rooms", roomId), { recursive: true });
      await writeFile(join(root, ".gaia", "rooms", roomId, "state.json"), JSON.stringify({ activeRoles: {}, thinkingOverrides: {}, agentCursors: {} }));
      return { sendMessage: async () => ({ id: "task_test", agentId: "gaia", roomId, status: "queued", createdAt: new Date().toISOString() }) } as unknown as RoomService;
    },
    broadcast: (event) => events.push(event),
    baseUrl: () => "http://127.0.0.1:0",
  });
  assert.ok(record.id);
  return { root, registry, service, events };
}

test("studio open is idempotent and concurrent-safe", async () => {
  const { root, registry, service } = await fixture();
  const workspaceId = (await registry.list())[0]!.id;
  const [a, b] = await Promise.all([
    service.open({ workspaceId, path: join(root, "index.html") }),
    service.open({ workspaceId, path: join(root, "index.html") }),
  ]);
  assert.equal(a.project.projectId, b.project.projectId);
  assert.equal(a.project.roomId, b.project.roomId);
});

test("studio save rejects stale base and preserves version chain", async () => {
  const { root, registry, service } = await fixture();
  const workspaceId = (await registry.list())[0]!.id;
  const opened = await service.open({ workspaceId, path: join(root, "index.html") });
  const initial = opened.project.headVersionId;
  const saved = await service.save(opened.project.projectId, { baseVersionId: initial, files: [{ path: "index.html", content: "<h1>two</h1>" }], note: "save" });
  assert.equal(saved.version.parentVersionId, initial);
  assert.equal(await readFile(join(root, "index.html"), "utf8"), "<h1>two</h1>");
  await assert.rejects(
    service.save(opened.project.projectId, { baseVersionId: initial, files: [{ path: "index.html", content: "<h1>three</h1>" }] }),
    StudioConflictError,
  );
  const versions = await service.versions(opened.project.projectId);
  assert.equal(versions.versions.length, 2);
});

test("studio missing-room recovery marks binding instead of rebinding unrelated room", async () => {
  const { root, registry, service } = await fixture();
  const workspaceId = (await registry.list())[0]!.id;
  const opened = await service.open({ workspaceId, path: join(root, "index.html") });
  await import("node:fs/promises").then((fs) => fs.rm(join(root, ".gaia", "rooms", opened.project.roomId), { recursive: true, force: true }));
  const reopened = await service.open({ workspaceId, path: join(root, "index.html") });
  assert.equal(reopened.project.projectId, opened.project.projectId);
  assert.equal(reopened.project.roomId, opened.project.roomId);
  assert.equal(reopened.project.status, "missing-room");
});

test("studio HTTP routes delegate and return scoped responses", async () => {
  const home = await mkdtemp(join(tmpdir(), "gaia-home-studio-"));
  const root = await mkdtemp(join(tmpdir(), "gaia-studio-route-"));
  const originalHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = home;
  await initWorkspace(root);
  await writeFile(join(root, "index.html"), "<h1>route</h1>");
  const record = await new WorkspaceRegistry(join(home, "app.json")).add(root);
  const server = new GaiaWebServer({ cwd: root, host: "127.0.0.1", port: 0 });
  const running = await server.listen();
  try {
    const listResponse = await fetch(`${running.url}api/studio/projects?workspaceId=${encodeURIComponent(record.id)}`);
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), { projects: [] });
    const artifactsResponse = await fetch(`${running.url}api/rooms/test-room/artifacts`);
    assert.equal(artifactsResponse.status, 200);
  } finally {
    await running.close();
    if (originalHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = originalHome;
  }
});
