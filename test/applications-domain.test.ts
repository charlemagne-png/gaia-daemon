import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_APPLICATION_MANIFESTS,
  parseApplicationManifest,
  validateApplicationRelativePath,
  type ApplicationManifestV1,
} from "../src/domain/applications.js";

const manifest: ApplicationManifestV1 = {
  schema: 1,
  id: "campaign-planner",
  name: "Campaign Planner",
  description: "Plan launches",
  icon: { kind: "symbol", value: "◎" },
  panel: { kind: "studio", entry: "index.html", defaultSize: "workspace", popout: false },
  agent: { preferred: ["gaia"], role: "builder", fallback: "active", context: "campaign source" },
  tools: ["read", "write", "edit"],
  resources: ["files", "versions", "preview"],
  source: { root: ".", entry: "index.html" },
  createdBy: { kind: "human", id: "charles" },
  createdAt: "2026-09-05T12:00:00.000Z",
  updatedAt: "2026-09-05T12:00:00.000Z",
};

test("application manifest parse normalizes and round-trips", () => {
  const parsed = parseApplicationManifest(structuredClone(manifest), { origin: "workspace" });
  assert.deepEqual(parsed, manifest);
  assert.deepEqual(parseApplicationManifest(JSON.parse(JSON.stringify(parsed)), { origin: "workspace" }), parsed);
  assert.deepEqual(BUILTIN_APPLICATION_MANIFESTS.map((item) => item.id), ["design", "studio"]);
});

test("application manifest rejects unknown fields, tools, and workspace native panels", () => {
  assert.throws(
    () => parseApplicationManifest({ ...manifest, token: "secret" }, { origin: "workspace" }),
    /unknown field 'token'/,
  );
  assert.throws(
    () => parseApplicationManifest({ ...manifest, tools: ["read", "credential-admin"] }, { origin: "workspace" }),
    /unknown tool 'credential-admin'/,
  );
  assert.throws(
    () => parseApplicationManifest({ ...manifest, panel: { kind: "native", entry: "campaign-planner" } }, { origin: "workspace" }),
    /workspace manifest\.panel\.kind/,
  );
  assert.throws(
    () => parseApplicationManifest({ ...manifest, panel: { kind: "electron", entry: "index.html" } }, { origin: "workspace" }),
    /manifest\.panel\.kind/,
  );
});

test("application relative paths reject absolute and traversal input", () => {
  assert.equal(validateApplicationRelativePath("assets/icon.svg", "path"), "assets/icon.svg");
  assert.equal(validateApplicationRelativePath(".", "path", true), ".");
  for (const path of ["/tmp/app.js", "../app.js", "assets/../app.js", "C:\\app.js", "assets//app.js"]) {
    assert.throws(() => validateApplicationRelativePath(path, "path"), /relative|normalized/);
  }
});
