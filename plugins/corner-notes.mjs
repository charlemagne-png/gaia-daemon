import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const EPOCH = "1970-01-01T00:00:00.000Z";
let writeSequence = 0;
let mutations = Promise.resolve();

function filePath(ctx) {
  const home = process.env.GAIA_HOME?.trim() || join(ctx.homedir, ".gaia");
  return join(home, "corner-notes.json");
}

function timestamp(value, fallback = EPOCH) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function normalizeState(raw) {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const input = Array.isArray(record.notes) ? record.notes : [];
  const ids = new Set();
  const notes = [];
  for (const [index, value] of input.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    if (!id || ids.has(id) || typeof value.text !== "string") continue;
    ids.add(id);
    const createdAt = timestamp(value.createdAt);
    notes.push({
      id,
      text: value.text,
      order: typeof value.order === "number" && Number.isFinite(value.order) ? value.order : index,
      pinned: value.pinned === true,
      createdAt,
      updatedAt: timestamp(value.updatedAt, createdAt),
    });
  }
  return { notes };
}

function normalizeUiState(raw) {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const state = {};
  if (typeof record.editing === "string" && record.editing) state.editing = record.editing;
  return state;
}

async function readState(ctx) {
  try {
    return normalizeState(JSON.parse(await readFile(filePath(ctx), "utf8")));
  } catch {
    return normalizeState(undefined);
  }
}

async function writeState(ctx, state) {
  const path = filePath(ctx);
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.corner-notes.${process.pid}.${writeSequence++}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

async function mutate(ctx, change) {
  let release;
  const previous = mutations;
  mutations = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    const state = await readState(ctx);
    const result = change(state);
    await writeState(ctx, state);
    return result;
  } finally {
    release();
  }
}

function sorted(notes) {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

function listReply(notes) {
  if (notes.length === 0) return "No corner notes.";
  return sorted(notes).map((note) => `${note.pinned ? "📌 " : ""}${note.id} · ${note.text}`).join("\n");
}

function usage() {
  return "Usage: /notes add <text> | edit <id> <text> | del <id> | pin <id> | list";
}

export default {
  id: "corner-notes",
  command: "notes",
  description: "manage global corner notes",

  async run(args, ctx) {
    const [action, ...values] = args;
    const ui = normalizeUiState(ctx.state);

    if (!action || action === "list") {
      const state = await readState(ctx);
      return { state: ui, reply: listReply(state.notes) };
    }
    if (action === "close") return { state: ui };
    if (action === "add") {
      const text = values.join(" ").trim();
      if (!text) return { state: ui, reply: usage() };
      const note = await mutate(ctx, (state) => {
        const now = new Date().toISOString();
        const nextOrder = state.notes.reduce((max, item) => Math.max(max, item.order), -1) + 1;
        const created = { id: randomUUID(), text, order: nextOrder, pinned: false, createdAt: now, updatedAt: now };
        state.notes.push(created);
        return created;
      });
      return { state: ui, reply: `Added corner note ${note.id}.` };
    }

    const panelEdit = action.startsWith("edit:");
    if (action === "edit" || panelEdit) {
      const id = panelEdit ? action.slice("edit:".length) : values[0];
      const textValues = panelEdit ? values : values.slice(1);
      if (!id) return { state: ui, reply: usage() };
      if (textValues.length === 0) {
        const state = await readState(ctx);
        if (!state.notes.some((note) => note.id === id)) return { state: ui, reply: `Corner note not found: ${id}.` };
        return { state: { editing: id }, reply: "Edit corner note." };
      }
      const text = textValues.join(" ").trim();
      if (!text) return { state: { editing: id }, reply: "Corner note text is required." };
      const note = await mutate(ctx, (state) => {
        const found = state.notes.find((item) => item.id === id);
        if (!found) return undefined;
        found.text = text;
        found.updatedAt = new Date().toISOString();
        return found;
      });
      return note
        ? { state: {}, reply: `Updated corner note ${id}.` }
        : { state: ui, reply: `Corner note not found: ${id}.` };
    }

    if (action === "del") {
      const id = values[0];
      if (!id) return { state: ui, reply: usage() };
      const removed = await mutate(ctx, (state) => {
        const index = state.notes.findIndex((note) => note.id === id);
        if (index < 0) return false;
        state.notes.splice(index, 1);
        return true;
      });
      return removed
        ? { state: ui.editing === id ? {} : ui, reply: `Deleted corner note ${id}.` }
        : { state: ui, reply: `Corner note not found: ${id}.` };
    }

    if (action === "pin") {
      const id = values[0];
      if (!id) return { state: ui, reply: usage() };
      const note = await mutate(ctx, (state) => {
        const found = state.notes.find((item) => item.id === id);
        if (!found) return undefined;
        found.pinned = !found.pinned;
        found.updatedAt = new Date().toISOString();
        return found;
      });
      return note
        ? { state: ui, reply: `${note.pinned ? "Pinned" : "Unpinned"} corner note ${id}.` }
        : { state: ui, reply: `Corner note not found: ${id}.` };
    }

    return { state: ui, reply: usage() };
  },

  async panel(ctx) {
    const ui = normalizeUiState(ctx.state);
    const state = await readState(ctx);
    const editing = state.notes.find((note) => note.id === ui.editing);
    return {
      title: "Corner notes",
      placement: "corner",
      corner: "br",
      description: "Global across rooms.",
      forms: [
        { action: "add", label: "Add note", fields: [{ name: "text", label: "Quick add", type: "textarea" }] },
        ...(editing ? [{ action: `edit:${editing.id}`, label: "Save edit", fields: [{ name: "text", label: "Note", type: "textarea", value: editing.text }] }] : []),
      ],
      items: sorted(state.notes).map((note) => ({
        title: note.text,
        detail: note.id,
        actions: [
          { action: "edit", label: "Edit", args: [note.id] },
          { action: "pin", label: note.pinned ? "Unpin" : "Pin", args: [note.id] },
          { action: "del", label: "Delete", args: [note.id], danger: true },
        ],
      })),
    };
  },
};
