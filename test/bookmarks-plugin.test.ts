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

test("bookmark event action sets plugin state and projects a host jump", async () => {
  const {service,root}=await makeService(); const event=await service.room.addUserMessage("lock the spec",["gaia"]);
  await service.runPluginEventAction("bookmarks",event.id,"set",["spec locked"]);
  const state=await (await RoomHandle.open(root,"default")).state(); assert.equal(state.bookmarks,undefined); assert.equal(state.pluginState?.bookmarks?.items?.[0]?.name,"spec locked");
  const snapshot=await service.getSnapshot(); const action=snapshot.room.events[0].pluginActions?.[0]; assert.equal(action?.plugin,"bookmarks");
  const panel=snapshot.room.pluginPanels?.bookmarks; assert.equal(panel?.placement,"room"); assert.equal(panel?.items?.[0]?.actions?.[0]?.jumpToEvent,event.id);
  assert.match((await service.pluginPrompt(await service.room.state(),"gaia")) ?? "",/spec locked/);
});

test("bookmark plugin seeds legacy state on set and leaves the original untouched", async () => {
  const legacy=[{id:"legacy-bookmark",eventId:"evt_legacy",name:"old point",author:"gaia",excerpt:"old excerpt",eventAt:"2026-01-01T00:00:00.000Z",createdAt:"2026-01-01T00:00:01.000Z"}];
  const {service,root}=await makeService({activeRoles:{},thinkingOverrides:{},agentCursors:{},bookmarks:legacy}); const event=await service.room.addUserMessage("new point",["gaia"]);
  await service.runPluginEventAction("bookmarks",event.id,"set",["new anchor"]);
  const state=await (await RoomHandle.open(root,"default")).state(); assert.deepEqual(state.bookmarks,legacy); assert.equal(state.pluginState?.bookmarks?.seededLegacy,true); assert.deepEqual(state.pluginState?.bookmarks?.items?.map(item=>item.name),["old point","new anchor"]);
});
