import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import plugin from "../plugins/corner-notes.mjs";
import { createTempDir } from "./helpers/temp.js";

function ctx(roomId: string, state?: Record<string, unknown>) {
  return { homedir: "/unused", roomId, workspaceRoot: "/workspace", agents: [], state };
}

function replyId(reply: string | undefined): string {
  const id = reply?.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/)?.[0];
  assert.ok(id, `missing note id in reply: ${reply}`);
  return id;
}

test("corner-notes plugin provides global CRUD, normalized persistence, and a sorted panel", async () => {
  const temp = await createTempDir("gaia-corner-notes-");
  const originalHome = process.env.GAIA_HOME;
  process.env.GAIA_HOME = temp.path;
  const path = join(temp.path, "corner-notes.json");

  try {
    assert.equal(plugin.id, "corner-notes");
    assert.equal(plugin.command, "notes");

    const opened = await plugin.run([], ctx("room-a"));
    assert.deepEqual(opened.state, { open: true });
    const emptyPanel = await plugin.panel(ctx("room-a", opened.state));
    assert.equal(emptyPanel?.forms?.[0]?.action, "add");
    assert.deepEqual(emptyPanel?.items, []);

    const alpha = await plugin.run(["add", "Alpha", "note"], ctx("room-a", opened.state));
    const alphaId = replyId(alpha.reply);
    const beta = await plugin.run(["add", "Beta"], ctx("room-b"));
    const betaId = replyId(beta.reply);

    const pinned = await plugin.run(["pin", betaId], ctx("room-b"));
    assert.match(pinned.reply ?? "", /^Pinned/);
    const panel = await plugin.panel(ctx("room-a", { open: true }));
    assert.deepEqual(panel?.items?.map((item) => item.title), ["Beta", "Alpha note"], "pinned notes sort before order");
    assert.deepEqual(panel?.items?.[0]?.actions?.map((action) => action.action), ["edit", "pin", "del"]);
    assert.equal(panel?.items?.[0]?.actions?.[2]?.danger, true);

    const editMode = await plugin.run(["edit", alphaId], ctx("room-a", { open: true }));
    const editPanel = await plugin.panel(ctx("room-a", editMode.state));
    assert.equal(editPanel?.forms?.[1]?.action, `edit:${alphaId}`);
    assert.equal(editPanel?.forms?.[1]?.fields[0]?.value, "Alpha note");

    const edited = await plugin.run(["edit", alphaId, "Alpha", "updated"], ctx("room-a", editMode.state));
    assert.match(edited.reply ?? "", /^Updated/);
    const deleted = await plugin.run(["del", alphaId], ctx("room-b"));
    assert.match(deleted.reply ?? "", /^Deleted/);
    const listed = await plugin.run(["list"], ctx("room-a"));
    assert.match(listed.reply ?? "", new RegExp(betaId));
    assert.doesNotMatch(listed.reply ?? "", new RegExp(alphaId));

    const stored = JSON.parse(await readFile(path, "utf8"));
    assert.equal(stored.notes.length, 1);
    assert.equal(stored.notes[0].text, "Beta");
    assert.equal(stored.notes[0].pinned, true);
    assert.equal(typeof stored.notes[0].createdAt, "string");
    assert.equal(typeof stored.notes[0].updatedAt, "string");

    await writeFile(path, JSON.stringify({ notes: [
      { id: "valid", text: "Recovered", order: "bad", pinned: "yes", createdAt: "bad", updatedAt: null },
      { id: "valid", text: "duplicate", order: 9, pinned: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "missing-text" },
    ] }));
    const normalizedPanel = await plugin.panel(ctx("room-c", { open: true }));
    assert.deepEqual(normalizedPanel?.items?.map((item) => item.title), ["Recovered"]);
    await plugin.run(["pin", "valid"], ctx("room-c"));
    const normalized = JSON.parse(await readFile(path, "utf8"));
    assert.equal(normalized.notes.length, 1);
    assert.deepEqual({ ...normalized.notes[0], updatedAt: undefined }, {
      id: "valid",
      text: "Recovered",
      order: 0,
      pinned: true,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: undefined,
    });
    assert.equal(Number.isFinite(Date.parse(normalized.notes[0].updatedAt)), true);
    assert.equal((await readdir(temp.path)).some((name) => name.endsWith(".tmp")), false);

    assert.equal(await plugin.panel(ctx("room-a", { open: false })), undefined);
    const missing = await plugin.run(["del", "unknown"], ctx("room-a"));
    assert.equal(missing.reply, "Corner note not found: unknown.");
  } finally {
    if (originalHome === undefined) delete process.env.GAIA_HOME;
    else process.env.GAIA_HOME = originalHome;
    await temp.cleanup();
  }
});
