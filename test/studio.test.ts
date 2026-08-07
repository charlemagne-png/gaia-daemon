import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WorkspaceRegistry } from "../src/daemon.js";
import { workspacePaths } from "../src/core/paths.js";
import { StudioConflictError, StudioService } from "../src/services/studio-service.js";
import { GaiaWebServer } from "../src/server/http.js";
import { DEFAULT_ROOM, initWorkspace } from "../src/domain/workspace.js";
import { createArtifact, readArtifact } from "../src/services/artifacts.js";
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

test("studio artifact payload binding is idempotent and save refreshes manifest", async () => {
  const { root, registry, service } = await fixture();
  const workspaceId = (await registry.list())[0]!.id;
  const roomId = "artifact-room";
  await mkdir(join(root, ".gaia", "rooms", roomId), { recursive: true });
  await writeFile(join(root, ".gaia", "rooms", roomId, "state.json"), JSON.stringify({ activeRoles: {}, thinkingOverrides: {}, agentCursors: {} }));
  const manifest = await createArtifact({ rootDir: root, roomId }, { name: "Landing", kind: "html", mediaType: "text/html; charset=utf-8", payload: "<h1>old</h1>" }, { id: () => "artifact_landing", now: () => "2026-01-01T00:00:00.000Z" });
  const payload = workspacePaths.roomArtifactPayload(root, roomId, manifest.artifactId);
  const opened = await service.open({ workspaceId, path: payload, roomId, artifact: { roomId, artifactId: manifest.artifactId }, entryView: { id: "payload", path: "payload", title: manifest.name } });
  assert.equal(opened.project.roomId, roomId);
  assert.equal(opened.project.artifact?.artifactId, manifest.artifactId);
  assert.equal(opened.project.entryViews[0]!.title, "Landing");
  const initial = opened.project.headVersionId;
  const saved = await service.save(opened.project.projectId, { baseVersionId: initial, files: [{ path: "payload", content: "<h1>new</h1>" }] });
  assert.equal(saved.version.parentVersionId, initial);
  const refreshed = await readArtifact({ rootDir: root, roomId }, manifest.artifactId);
  assert.equal(Buffer.from(refreshed.payload).toString("utf8"), "<h1>new</h1>");
  assert.notEqual(refreshed.manifest.sha256, manifest.sha256);
  const reopened = await service.open({ workspaceId, path: payload, roomId, artifact: { roomId, artifactId: manifest.artifactId }, entryView: { id: "payload", path: "payload", title: manifest.name } });
  assert.equal(reopened.project.projectId, opened.project.projectId);
  assert.equal(reopened.project.roomId, roomId);
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
    const manifest = await createArtifact({ rootDir: root, roomId: DEFAULT_ROOM }, { name: "fixture", kind: "html", mediaType: "text/html; charset=utf-8", payload: "<h1>artifact</h1>" }, { id: () => "artifact_fixture", now: () => "2026-01-01T00:00:00.000Z" });
    const artifactsResponse = await fetch(`${running.url}api/rooms/${DEFAULT_ROOM}/artifacts`);
    assert.equal(artifactsResponse.status, 200);
    assert.deepEqual(await artifactsResponse.json(), { artifacts: [manifest] });
    const payloadResponse = await fetch(`${running.url}api/rooms/${DEFAULT_ROOM}/artifacts/${manifest.artifactId}/payload`);
    assert.equal(payloadResponse.status, 200);
    assert.equal(payloadResponse.headers.get("content-type"), manifest.mediaType);
    assert.equal(payloadResponse.headers.get("etag"), `"${manifest.sha256}"`);
    assert.equal(await payloadResponse.text(), "<h1>artifact</h1>");
    await writeFile(workspacePaths.roomArtifactPayload(root, DEFAULT_ROOM, manifest.artifactId), "corrupt");
    const corruptResponse = await fetch(`${running.url}api/rooms/${DEFAULT_ROOM}/artifacts/${manifest.artifactId}/payload`);
    assert.equal(corruptResponse.status, 404);
    const missingResponse = await fetch(`${running.url}api/rooms/${DEFAULT_ROOM}/artifacts/nope/payload`);
    assert.equal(missingResponse.status, 404);
  } finally {
    await running.close();
    if (originalHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = originalHome;
  }
});
