import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomService } from "../src/services/room-service.js";
import { RoomHandle } from "../src/domain/rooms.js";
import { MemoryStore } from "../src/domain/memory.js";
import type { AgentDef, AgentEvent, Workspace } from "../src/core/types.js";
import type { AgentRuntime } from "../src/harness/spec.js";
import type { CommandPlugin } from "../src/services/plugins.js";

process.env.GAIA_HOME = await mkdtemp(join(tmpdir(), "gaia-mode-home-"));
function agent(root: string): AgentDef { const dir=join(root,"agents","gaia"); return { id:"gaia",displayName:"gaia",icon:"x",dir,configPath:join(dir,"agent.json"),personaDir:join(dir,"persona"),rolesDir:join(dir,"persona","roles"),soulPath:join(dir,"persona","SOUL.md"),memoryDir:join(dir,"persona","memory"),tools:[] }; }
function runtime(a: AgentDef): AgentRuntime { return { agent:a,modelLabel:"test/model",capabilities:{gaiaTools:[],granularTools:true,supportsPermissionMode:false},async *send():AsyncGenerator<AgentEvent>{},async abort(){},dispose(){},resetRoom(){},refreshContext(){} }; }
async function service(root:string, roomId:string, plugin:CommandPlugin) { const a=agent(root); const workspace:Workspace={rootDir:root,dir:join(root,".gaia"),configPath:join(root,".gaia","config.json"),agentsOverrideDir:join(root,".gaia","agents"),roomsDir:join(root,".gaia","rooms"),globalAgentsDir:join(root,"agents"),config:{defaultAgent:"gaia",room:roomId,transcriptWindow:20},contextFiles:[],agents:{gaia:a}}; const s=await RoomService.open({workspaceId:"ws",workspace,roomId,memoryStore:new MemoryStore(),runtimeFactory:runtime}); Object.defineProperty(s,"pluginsPromise",{value:Promise.resolve(new Map([["mode",plugin]]))}); return s; }

test("bundled berserk owns root state, descendant off, charge rewrite, prompt, and chrome", async () => {
  const root=await mkdtemp(join(tmpdir(),"gaia-berserk-")); await mkdir(join(root,".gaia","rooms"),{recursive:true}); await writeFile(join(root,".gaia","config.json"),"{}");
  await RoomHandle.open(root,"root"); const childHandle=await RoomHandle.open(root,"child"); await childHandle.updateState(s=>{s.parentRoomId="root"});
  const placeholder:CommandPlugin={command:"placeholder",run(){return {}}}; const child=await service(root,"child",placeholder);
  const { loadCommandPlugins } = await import("../src/services/plugins.js"); Object.defineProperty(child,"pluginsPromise",{value:loadCommandPlugins()});
  const plugin=(await child.pluginsPromise).get("berserk"); assert.ok(plugin);
  const result=await child.runPlugin(plugin,[],"berserk");
  assert.equal(typeof result.rewriteAsMessage,"string"); assert.match(String(result.rewriteAsMessage),/plateaued task/);
  assert.equal((await (await RoomHandle.open(root,"root")).state()).pluginState?.berserk?.active,true);
  assert.match((await child.pluginPrompt(await child.room.state(),"gaia")) ?? "",/BERSERK/);
  assert.deepEqual((await child.getSnapshot()).room.pluginChromeTokens,["danger"]);
  await child.runPluginAction("berserk",["off"]);
  assert.equal((await (await RoomHandle.open(root,"root")).state()).pluginState?.berserk?.active,false);
});
