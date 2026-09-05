import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationService, ApplicationWorkspaceNotFoundError } from "../src/services/application-service.js";
import { createTempDir } from "./helpers/temp.js";

function workspaceManifest(id: string): Record<string, unknown> {
  return {
    schema: 1,
    id,
    name: id.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
    icon: { kind: "symbol", value: "◎" },
    panel: { kind: "studio", entry: "index.html", defaultSize: "workspace", popout: false },
    agent: { preferred: [], fallback: "active" },
    tools: ["read", "write", "edit"],
    resources: ["files", "versions", "preview"],
    source: { root: ".", entry: "index.html" },
    createdBy: { kind: "human" },
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:00:00.000Z",
  };
}

async function writePackage(root: string, id: string, manifest: unknown = workspaceManifest(id)): Promise<void> {
  const dir = join(root, "apps", id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "app.gaia.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "index.html"), `<h1>${id}</h1>`);
}

test("application catalog merges built-ins first and prevents shadowing", async () => {
  const temp = await createTempDir();
  try {
    await mkdir(join(temp.path, ".gaia"), { recursive: true });
    await writePackage(temp.path, "campaign-planner");
    await writePackage(temp.path, "design");
    const service = new ApplicationService({ workspaceFor: async (id) => id === "ws" ? { path: temp.path, isInitialized: true } : undefined });
    const catalog = await service.catalog("ws");

    assert.deepEqual(catalog.applications.map((entry) => entry.manifest.id), ["design", "studio", "campaign-planner"]);
    assert.deepEqual(catalog.applications.map((entry) => entry.source), ["builtin", "builtin", "workspace"]);
    assert.equal(catalog.diagnostics.find((item) => item.code === "builtin-shadowed")?.relativeRoot, "apps/design");
  } finally {
    await temp.cleanup();
  }
});

test("application catalog rejects malformed manifests without hiding valid definitions", async () => {
  const temp = await createTempDir();
  try {
    await mkdir(join(temp.path, ".gaia"), { recursive: true });
    await writePackage(temp.path, "valid-app");
    await writePackage(temp.path, "broken-app", { ...workspaceManifest("broken-app"), tools: ["root-access"] });
    const service = new ApplicationService({ workspaceFor: async () => ({ path: temp.path, isInitialized: true }) });
    const catalog = await service.catalog("ws");

    assert.ok(catalog.applications.some((entry) => entry.manifest.id === "valid-app"));
    assert.ok(!catalog.applications.some((entry) => entry.manifest.id === "broken-app"));
    assert.match(catalog.diagnostics.find((item) => item.relativeRoot === "apps/broken-app")?.message ?? "", /unknown tool/);
  } finally {
    await temp.cleanup();
  }
});

test("application catalog rejects package and entry symlink escapes", async () => {
  const temp = await createTempDir();
  const external = await createTempDir();
  try {
    await mkdir(join(temp.path, ".gaia"), { recursive: true });
    const outside = external.path;
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "app.gaia.json"), JSON.stringify(workspaceManifest("linked-app")));
    await writeFile(join(outside, "index.html"), "outside");
    await mkdir(join(temp.path, "apps"), { recursive: true });
    await symlink(outside, join(temp.path, "apps", "linked-app"));

    await writePackage(temp.path, "entry-escape");
    await writeFile(join(outside, "outside.html"), "outside");
    await import("node:fs/promises").then((fs) => fs.unlink(join(temp.path, "apps", "entry-escape", "index.html")));
    await symlink(join(outside, "outside.html"), join(temp.path, "apps", "entry-escape", "index.html"));

    const service = new ApplicationService({ workspaceFor: async () => ({ path: temp.path, isInitialized: true }) });
    const catalog = await service.catalog("ws");
    assert.ok(!catalog.applications.some((entry) => entry.source === "workspace"));
    assert.equal(catalog.diagnostics.length, 2);
    assert.ok(catalog.diagnostics.every((item) => /escapes/.test(item.message)));
  } finally {
    await temp.cleanup();
    await external.cleanup();
  }
});

test("application catalog reports unknown workspaces", async () => {
  const service = new ApplicationService({ workspaceFor: async () => undefined });
  await assert.rejects(service.catalog("missing"), ApplicationWorkspaceNotFoundError);
});
