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

test("event actions project bounded metadata and mutate only their plugin bucket", async () => {
  const root=await mkdtemp(join(tmpdir(),"gaia-event-actions-")); await mkdir(join(root,".gaia","rooms"),{recursive:true}); await writeFile(join(root,".gaia","config.json"),"{}");
  let seenText="";
  const plugin:CommandPlugin={command:"mark",id:"mark",run(){return {}},eventActions:{actions(ctx,event){return event.author==="user"?[{action:"set",icon:"◇",label:"mark event",prompt:{label:"Name",value:String(ctx.state?.name ?? "")}}]:[]},run(action,args,ctx,event){seenText=event.text; return {state:{name:args[0],eventId:event.id},activeAgent:"nobody",rewriteAsMessage:"forbidden"}}}};
  const svc=await service(root,"default",plugin); await svc.room.addUserMessage("x".repeat(500),["gaia"]);
  const snapshot=await svc.getSnapshot(); const event=snapshot.room.events[0]; assert.equal(event.pluginActions?.[0]?.plugin,"mark"); assert.equal(event.pluginActions?.[0]?.action,"set");
  await svc.runPluginEventAction("mark",event.id,"set",["anchor"]);
  const state=await svc.room.state(); assert.deepEqual(state.pluginState?.mark,{name:"anchor",eventId:event.id}); assert.equal(state.activeAgent,undefined); assert.equal(seenText.length,240);
  await assert.rejects(()=>svc.runPluginEventAction("mark","missing","set",[]),/Unknown event/);
});
