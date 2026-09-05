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

test("root-tree mode reads, mutates, prompts, and projects through descendants cycle-safely", async () => {
  const root=await mkdtemp(join(tmpdir(),"gaia-mode-")); await mkdir(join(root,".gaia","rooms"),{recursive:true}); await writeFile(join(root,".gaia","config.json"),"{}");
  for (const [id,parent] of [["root",undefined],["child","root"],["grand","child"]] as const) { const h=await RoomHandle.open(root,id); if(parent) await h.updateState(s=>{s.parentRoomId=parent}); }
  const plugin:CommandPlugin={command:"mode",id:"mode",roomMode:{key:"active",inheritance:"root-tree",chromeToken:"danger"},run(args,ctx){return {state:{active:args[0]!=="off"}}},prompt(ctx){return ctx.state?.active===true?"MODE ACTIVE":undefined}};
  const grand=await service(root,"grand",plugin); await grand.runPluginAction("mode",["on"]);
  assert.equal((await (await RoomHandle.open(root,"root")).state()).pluginState?.mode?.active,true);
  assert.equal((await (await RoomHandle.open(root,"grand")).state()).pluginState?.mode,undefined);
  assert.deepEqual((await grand.getSnapshot()).room.pluginChromeTokens,["danger"]);
  assert.equal(await grand.pluginPrompt(await grand.room.state(),"gaia"),"MODE ACTIVE");
  await grand.runPluginAction("mode",["off"]); assert.equal((await (await RoomHandle.open(root,"root")).state()).pluginState?.mode?.active,false);
  await (await RoomHandle.open(root,"root")).updateState(s=>{s.parentRoomId="grand"});
  await grand.runPluginAction("mode",["on"]); assert.equal((await (await RoomHandle.open(root,"child")).state()).pluginState?.mode?.active,true);
});
