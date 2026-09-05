import test from "node:test";
import assert from "node:assert/strict";
import { summarizeUpstreamFeatures, type UpstreamCommit } from "../src/services/upstream-divergence.js";

const commits: UpstreamCommit[] = [
  { sha: "a".repeat(40), subject: "fix(summons): seal resumed delivery", files: ["src/services/summons.ts", "test/summons.test.ts"] },
  { sha: "b".repeat(40), subject: "ui(sidebar): add favorites", files: ["web/src/sidebar.js"] },
  { sha: "c".repeat(40), subject: "docs: release notes", files: ["docs/RELEASE.md"] },
];

test("summarizeUpstreamFeatures emits named selectable features with subsystem and verdict hints", () => {
  const features = summarizeUpstreamFeatures(
    commits,
    new Set(["src/services/summons.ts"]),
    new Set(["c".repeat(40)]),
  );
  const delivery = features.find((feature) => feature.name === "Summon delivery");
  assert.ok(delivery);
  assert.equal(delivery.verdict, "conflicts-with-ours");
  assert.deepEqual(delivery.subsystems, ["src/services", "test/summons.test.ts"]);

  const sidebar = features.find((feature) => feature.name === "Sidebar + workspace UI");
  assert.equal(sidebar?.verdict, "STEAL-candidate");
  assert.deepEqual(sidebar?.subsystems, ["web/src"]);

  const policy = features.find((feature) => feature.name === "Build + engineering policy");
  assert.equal(policy?.verdict, "already-ported");
});
