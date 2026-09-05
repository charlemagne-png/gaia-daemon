import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePluginPanel } from "../src/services/plugins.js";

test("plugin panel sanitizer preserves default overlay shape when placement is omitted", () => {
  const panel = sanitizePluginPanel({
    title: "RPG table",
    description: "Character creation and GM/NPC assignment. Play itself stays in room chat.",
    forms: [{ action: "gm", label: "Assign GM", fields: [{ name: "agent", label: "GM agent", type: "select", options: [{ value: "gm", label: "🎲 @gm" }] }] }],
  });
  assert.deepEqual(panel, {
    title: "RPG table",
    description: "Character creation and GM/NPC assignment. Play itself stays in room chat.",
    forms: [{ action: "gm", label: "Assign GM", fields: [{ name: "agent", label: "GM agent", type: "select", options: [{ value: "gm", label: "🎲 @gm" }] }] }],
  });
});

test("plugin panel sanitizer admits corner placement and valid corners only", () => {
  assert.deepEqual(sanitizePluginPanel({ title: "Notes", placement: "corner", corner: "bl", items: [{ title: "One" }] }), {
    title: "Notes",
    placement: "corner",
    corner: "bl",
    items: [{ title: "One" }],
  });
  assert.deepEqual(sanitizePluginPanel({ title: "Notes", placement: "corner", corner: "nope" as "br", items: [{ title: "One" }] }), {
    title: "Notes",
    placement: "corner",
    items: [{ title: "One" }],
  });
});