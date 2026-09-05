import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_NOTES = 50;
const MAX_TEXT = 2_000;

function cleanText(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function cleanNote(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
  const text = cleanText(raw.text);
  if (!id || !text) return undefined;
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  return { id, text, createdAt };
}

function legacyNotes(ctx) {
  try {
    const statePath = join(ctx.workspaceRoot, ".gaia", "rooms", ctx.roomId, "state.json");
    if (!existsSync(statePath)) return [];
    const raw = JSON.parse(readFileSync(statePath, "utf8"));
    if (!Array.isArray(raw?.notes)) return [];
    return raw.notes.map(cleanNote).filter(Boolean).slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

function normalizeState(raw, ctx) {
  const existing = Array.isArray(raw?.items) ? raw.items.map(cleanNote).filter(Boolean).slice(0, MAX_NOTES) : undefined;
  if (existing) return { items: existing, seededLegacy: raw?.seededLegacy === true };
  return { items: legacyNotes(ctx), seededLegacy: true };
}

function nextId() {
  return `note_${randomUUID()}`;
}

function listReply(items) {
  if (items.length === 0) return "no notes pinned.";
  return items.map((note, index) => `${index + 1}. ${note.text}`).join("\n");
}

function action(args) {
  const first = args[0]?.toLowerCase();
  if (first === "list" || first === "ls") return { kind: "list" };
  if (first === "delete" || first === "del" || first === "rm" || first === "remove") return { kind: "delete", id: args[1] };
  if (first === "add") return { kind: "add", text: args.slice(1).join(" ") };
  return { kind: "add", text: args.join(" ") };
}

export default {
  command: "note",
  id: "note",
  description: "pin/list/delete sticky room notes: /note <text> | /note list | /note delete <id>",
  run(args, ctx) {
    const state = normalizeState(ctx.state, ctx);
    const requested = action(args);
    if (requested.kind === "list") return { state, reply: listReply(state.items) };
    if (requested.kind === "delete") {
      const id = requested.id;
      if (!id) return { state, reply: "usage: /note delete <id>" };
      const next = state.items.filter((note) => note.id !== id);
      const removed = next.length !== state.items.length;
      return { state: { ...state, items: next }, reply: removed ? "📌 note dismissed." : "note not found." };
    }
    const text = cleanText(requested.text);
    if (!text) return { state, reply: "usage: /note <text> — pin a sticky note under tasks" };
    if (state.items.length >= MAX_NOTES) return { state, reply: `Note limit reached (${MAX_NOTES} per room) — dismiss one first.` };
    const note = { id: nextId(), text, createdAt: new Date().toISOString() };
    return { state: { ...state, items: [...state.items, note] }, reply: `📌 noted — pinned under tasks: “${note.text}”` };
  },
  panel(ctx) {
    const state = normalizeState(ctx.state, ctx);
    if (!ctx.state && state.items.length === 0) return undefined;
    return {
      title: "notes",
      description: "Sticky room notes",
      items: state.items.map((note) => ({
        title: note.text,
        ...(note.createdAt ? { detail: note.createdAt } : {}),
        actions: [{ action: "delete", label: "✕", args: ["delete", note.id], danger: true }],
      })),
    };
  },
};
