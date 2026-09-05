import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
const MAX=50;
function clean(raw){if(!raw||typeof raw!=="object"||typeof raw.id!=="string"||typeof raw.eventId!=="string"||typeof raw.name!=="string")return undefined;return {id:raw.id,eventId:raw.eventId,name:raw.name.trim().slice(0,80),author:typeof raw.author==="string"?raw.author:"user",excerpt:typeof raw.excerpt==="string"?raw.excerpt.slice(0,240):"",eventAt:typeof raw.eventAt==="string"?raw.eventAt:"",createdAt:typeof raw.createdAt==="string"?raw.createdAt:""};}
function legacy(ctx){try{const raw=JSON.parse(readFileSync(join(ctx.workspaceRoot,".gaia","rooms",ctx.roomId,"state.json"),"utf8"));return Array.isArray(raw?.bookmarks)?raw.bookmarks.map(clean).filter(Boolean).slice(0,MAX):[];}catch{return [];}}
function state(raw,ctx){if(raw?.seededLegacy===true&&Array.isArray(raw.items))return {items:raw.items.map(clean).filter(Boolean).slice(0,MAX),seededLegacy:true};return {items:legacy(ctx),seededLegacy:true};}
function block(items){return items.length?`# Room checkpoints\n\n${items.map(mark=>`- ${mark.name} (${mark.author}, ${mark.eventAt}): ${mark.excerpt}`).join("\n")}`:undefined;}
function set(items,event,name){const cleanName=String(name??"").trim().slice(0,80);if(!cleanName)throw new Error("Checkpoint name is required.");const existing=items.find(mark=>mark.eventId===event.id);if(!existing&&items.length>=MAX)throw new Error(`Checkpoint limit reached (${MAX} per room) — remove one first.`);const mark=existing?{...existing,name:cleanName,excerpt:event.text}:{id:`bookmark_${randomUUID()}`,eventId:event.id,name:cleanName,author:event.author,excerpt:event.text,eventAt:event.timestamp,createdAt:new Date().toISOString()};return [...items.filter(item=>item.id!==mark.id),mark].sort((a,b)=>a.eventAt.localeCompare(b.eventAt)).slice(0,MAX);}
export default {
  command:["bookmark","bookmarks"],id:"bookmarks",description:"list or remove named transcript checkpoints",
  run(args,ctx){const current=state(ctx.state,ctx);if(["remove","delete","rm"].includes(args[0]?.toLowerCase()))return {state:{...current,items:current.items.filter(mark=>mark.id!==args[1])},reply:"checkpoint removed."};return {state:current,reply:current.items.length?current.items.map(mark=>`${mark.name} — ${mark.excerpt}`).join("\n"):"no checkpoints."};},
  eventActions:{
    actions(ctx,event){if(event.author==="system")return [];const current=state(ctx.state,ctx);const mark=current.items.find(item=>item.eventId===event.id);return [{action:"set",icon:"🔖",label:mark?`checkpoint: ${mark.name} — rename`:"save as named checkpoint",prompt:{label:mark?"Rename checkpoint":"Name this checkpoint",placeholder:"e.g. final spec locked",...(mark?{value:mark.name}:{})}}];},
    run(action,args,ctx,event){if(action!=="set")throw new Error(`Unknown bookmark action: ${action}`);const current=state(ctx.state,ctx);return {state:{...current,items:set(current.items,event,args[0])},reply:"checkpoint saved."};},
  },
  panel(ctx){const current=state(ctx.state,ctx);if(!ctx.state&&current.items.length===0)return undefined;return {title:"checkpoints",placement:"room",items:current.items.map(mark=>({title:mark.name,detail:`@${mark.author} · ${mark.excerpt}`,actions:[{action:"jump",label:"↗",jumpToEvent:mark.eventId},{action:"remove",label:"✕",args:["remove",mark.id],danger:true}]}))};},
  prompt(ctx){return block(state(ctx.state,ctx).items);},
};
