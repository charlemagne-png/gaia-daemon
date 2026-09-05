import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomService } from "../src/services/room-service.js";
import { RoomHandle } from "../src/domain/rooms.js";
import { MemoryStore } from "../src/domain/memory.js";
import { workspacePaths } from "../src/core/paths.js";
import type { AgentDef, AgentEvent, Workspace } from "../src/core/types.js";
import type { AgentRuntime } from "../src/harness/spec.js";

process.env.GAIA_HOME = await mkdtemp(join(tmpdir(), "gaia-note-home-"));

function makeAgent(id: string, root: string): AgentDef {
  const dir = join(root, "agents", id);
  return {
    id,
    displayName: id,
    icon: "🤖",
    dir,
    configPath: join(dir, "agent.json"),
    personaDir: join(dir, "persona"),
    rolesDir: join(dir, "persona", "roles"),
    soulPath: join(dir, "persona", "SOUL.md"),
    memoryDir: join(dir, "persona", "memory"),
    tools: [],
  };
}

function runtime(agent: AgentDef): AgentRuntime {
  return {
    agent,
    modelLabel: "test/model",
    capabilities: { gaiaTools: [], granularTools: true, supportsPermissionMode: false },
    async *send(): AsyncGenerator<AgentEvent> {
      yield { type: "text-delta", delta: "unused" };
    },
    async abort() {},
    dispose() {},
    resetRoom() {},
    refreshContext() {},
  };
}

async function makeService(seed?: object): Promise<{ service: RoomService; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "gaia-note-plugin-"));
  const roomId = "default";
  await mkdir(join(root, ".gaia", "rooms", roomId), { recursive: true });
  await writeFile(join(root, ".gaia", "config.json"), "{}", "utf8");
  if (seed) await writeFile(workspacePaths.roomState(root, roomId), JSON.stringify(seed), "utf8");
  const agents = { gaia: makeAgent("gaia", root) };
  const workspace: Workspace = {
    rootDir: root,
    dir: join(root, ".gaia"),
    configPath: join(root, ".gaia", "config.json"),
    agentsOverrideDir: join(root, ".gaia", "agents"),
    roomsDir: join(root, ".gaia", "rooms"),
    globalAgentsDir: join(root, "agents"),
    config: { defaultAgent: "gaia", room: roomId, transcriptWindow: 20 },
    contextFiles: [],
    agents,
  };
  const service = await RoomService.open({ workspaceId: "ws", workspace, roomId, memoryStore: new MemoryStore(), runtimeFactory: runtime });
  return { service, root };
}

test("/note dispatch falls through to the bundled command plugin", async () => {
  const { service, root } = await makeService();
  await service.sendMessage("/note bring tea");
  const state = await (await RoomHandle.open(root, "default")).state();
  assert.equal(state.notes, undefined, "core RoomState.notes is not written for new plugin notes");
  assert.equal(state.pluginState?.note?.items?.[0]?.text, "bring tea");
  const snapshot = await service.getSnapshot();
  assert.equal(snapshot.room.pluginPanels?.note?.items?.[0]?.title, "bring tea");
});

test("/note plugin seeds legacy RoomState.notes on first touch and leaves them for rollback", async () => {
  const legacy = [{ id: "legacy-note", text: "legacy milk", createdAt: "2026-01-01T00:00:00.000Z" }];
  const { service, root } = await makeService({ activeRoles: {}, thinkingOverrides: {}, agentCursors: {}, notes: legacy });
  await service.sendMessage("/note list");
  let state = await (await RoomHandle.open(root, "default")).state();
  assert.deepEqual(state.notes, legacy, "legacy shelf remains untouched");
  assert.deepEqual(state.pluginState?.note?.items, legacy, "plugin bucket receives rollback-safe seed");

  await service.runPluginAction("note", ["delete", "legacy-note"]);
  state = await (await RoomHandle.open(root, "default")).state();
  assert.deepEqual(state.notes, legacy, "plugin delete still leaves legacy state untouched");
  assert.deepEqual(state.pluginState?.note?.items, [], "plugin delete owns the active shelf");
  const snapshot = await service.getSnapshot();
  assert.deepEqual(snapshot.room.pluginPanels?.note?.items, [], "empty plugin panel suppresses legacy fallback in the web panel");
});
