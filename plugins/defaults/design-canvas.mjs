import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

function field(body, key) {
  return body && typeof body === "object" && typeof body[key] === "string" ? body[key] : undefined;
}
function value(body, key, fallback) {
  return body && typeof body === "object" && key in body ? body[key] : fallback;
}
function gaiaHome() {
  return process.env.GAIA_HOME || join(homedir(), ".gaia");
}
async function appConfig() {
  try { return JSON.parse(await readFile(join(gaiaHome(), "app.json"), "utf8")); } catch { return {}; }
}
async function writeAppConfig(config) {
  const dir = gaiaHome();
  await mkdir(dir, { recursive: true });
  const target = join(dir, "app.json");
  const temp = `${target}.canvas-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temp, target);
}
async function resolvePromptRoom(rooms, body) {
  const providedRoomId = field(body, "roomId");
  const workspaces = await rooms.listWorkspaces();
  if (providedRoomId) {
    for (const workspace of workspaces) {
      if (!workspace.isInitialized) continue;
      if (existsSync(join(workspace.path, ".gaia", "rooms", providedRoomId, "transcript.jsonl"))) {
        return { workspaceId: workspace.id, roomId: providedRoomId };
      }
    }
    return undefined;
  }
  const key = (field(body, "design")?.trim() || "untitled").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 64);
  const config = await appConfig();
  const stored = config.canvasPromptRooms?.[key];
  if (stored && workspaces.some((workspace) => workspace.id === stored.workspaceId && workspace.isInitialized)) return stored;
  const workspace = workspaces.find((candidate) => candidate.isInitialized);
  if (!workspace) throw new Error("No initialized workspace found");
  const entry = { workspaceId: workspace.id, roomId: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
  await writeAppConfig({ ...config, canvasPromptRooms: { ...config.canvasPromptRooms, [key]: entry } });
  return entry;
}

export default {
  id: "design-canvas",
  run() { return {}; },
  httpRoutes: [
    {
      method: "POST",
      path: "/api/canvas",
      async handle(ctx) {
        const body = await ctx.body();
        const command = field(body, "command");
        if (!command) return { status: 400, body: { error: "Missing command" } };
        const params = value(body, "params", {});
        return { body: { ok: true, command }, events: [{ type: "canvas-command", command, params }] };
      },
    },
    {
      method: "POST",
      path: "/api/canvas/prompt",
      async handle(ctx) {
        const body = await ctx.body();
        const text = field(body, "text");
        if (!text?.trim()) return { status: 400, body: { error: "Missing text" } };
        const resolved = await resolvePromptRoom(ctx.rooms, body);
        if (!resolved) return { status: 404, body: { error: `Room not found: ${field(body, "roomId")}` } };
        const addressedText = text.trim().startsWith("@dieter") ? text.trim() : `@dieter ${text.trim()}`;
        const task = await ctx.rooms.sendMessage(resolved.workspaceId, resolved.roomId, addressedText, { recordUserMessage: true });
        return {
          body: { ok: true, roomId: resolved.roomId, task },
          events: [{ type: "canvas-command", command: "prompt-ack", params: { roomId: resolved.roomId } }],
        };
      },
    },
    {
      method: "POST",
      path: "/api/canvas/save",
      async handle(ctx) {
        const body = await ctx.body();
        const design = field(body, "design");
        if (!design?.trim()) return { status: 400, body: { error: "Missing design" } };
        const data = value(body, "data", undefined);
        if (data === undefined) return { status: 400, body: { error: "Missing data" } };
        const safe = design.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 64) || "untitled";
        const dir = join(homedir(), "Designs", "gaia-design");
        await mkdir(dir, { recursive: true });
        const file = join(dir, `${safe}.json`);
        await writeFile(file, JSON.stringify({ design: design.trim(), savedAt: new Date().toISOString(), data }, null, 2));
        return { body: { ok: true, file } };
      },
    },
  ],
};
