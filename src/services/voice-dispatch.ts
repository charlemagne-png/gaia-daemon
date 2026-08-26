import type { AgentDef, RoomState, WorkspaceConfig } from "../core/types.js";

export const DEFAULT_VOICE_DISPATCHER_AGENT_ID = "hermes";
const DEFAULT_STICKY_SECS = 120;

export interface VoiceAddressMatch {
  targetId: string;
  label: string;
}

function normalizeTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/@/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function labelsForAgent(agent: AgentDef): string[] {
  return [agent.id, agent.displayName, ...(agent.aliases ?? [])].filter((label, index, labels) => label.trim() && labels.indexOf(label) === index);
}

function aliasEntries(agents: Record<string, AgentDef>, aliases?: Record<string, string>): VoiceAddressMatch[] {
  if (!aliases) return [];
  return Object.entries(aliases)
    .map(([label, targetId]) => ({ label, targetId }))
    .filter((entry) => Boolean(entry.label.trim() && agents[entry.targetId]));
}

export function voiceStickySecs(): number {
  const parsed = Number.parseInt(process.env.GAIA_VOICE_STICKY_SECS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STICKY_SECS;
}

export function voiceDispatcherAgentId(config: WorkspaceConfig, voiceSettingsAgentId?: string): string {
  return config.voice?.dispatcherAgentId || voiceSettingsAgentId || DEFAULT_VOICE_DISPATCHER_AGENT_ID;
}

export function availableVoiceDispatcherAgentId(agents: Record<string, AgentDef>, config: WorkspaceConfig, voiceSettingsAgentId?: string): string | undefined {
  const dispatcher = voiceDispatcherAgentId(config, voiceSettingsAgentId);
  return agents[dispatcher] ? dispatcher : undefined;
}

export function findLeadingVoiceAddress(text: string, agents: Record<string, AgentDef>, config: WorkspaceConfig): VoiceAddressMatch | undefined {
  const textTokens = normalizeTokens(text);
  if (textTokens.length === 0) return undefined;
  const entries = [
    ...Object.values(agents).flatMap((agent) => labelsForAgent(agent).map((label) => ({ targetId: agent.id, label }))),
    ...aliasEntries(agents, config.voice?.agentAliases),
  ]
    .map((entry) => ({ ...entry, tokens: normalizeTokens(entry.label) }))
    .filter((entry) => entry.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length || a.targetId.localeCompare(b.targetId));

  for (const entry of entries) {
    if (entry.tokens.every((token, index) => textTokens[index] === token)) return { targetId: entry.targetId, label: entry.label };
  }
  return undefined;
}

export function findVoiceTargetMention(text: string, agents: Record<string, AgentDef>, config: WorkspaceConfig, excludeAgentId?: string): VoiceAddressMatch | undefined {
  const textTokens = normalizeTokens(text);
  if (textTokens.length === 0) return undefined;
  const entries = [
    ...Object.values(agents)
      .filter((agent) => agent.id !== excludeAgentId)
      .flatMap((agent) => labelsForAgent(agent).map((label) => ({ targetId: agent.id, label }))),
    ...aliasEntries(agents, config.voice?.agentAliases).filter((entry) => entry.targetId !== excludeAgentId),
  ]
    .map((entry) => ({ ...entry, tokens: normalizeTokens(entry.label) }))
    .filter((entry) => entry.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length || a.targetId.localeCompare(b.targetId));

  for (const entry of entries) {
    for (let start = 0; start <= textTokens.length - entry.tokens.length; start += 1) {
      if (entry.tokens.every((token, index) => textTokens[start + index] === token)) return { targetId: entry.targetId, label: entry.label };
    }
  }
  return undefined;
}

export function stickyVoiceTarget(state: RoomState, agents: Record<string, AgentDef>, nowMs = Date.now(), stickySecs = voiceStickySecs()): string | undefined {
  const raw = state.voiceDispatch;
  const targetId = raw?.lastTarget;
  const at = raw?.lastTargetAt ? Date.parse(raw.lastTargetAt) : Number.NaN;
  if (!targetId || !agents[targetId] || !Number.isFinite(at)) return undefined;
  if (stickySecs <= 0) return undefined;
  return nowMs - at <= stickySecs * 1000 ? targetId : undefined;
}

export function setStickyVoiceTarget(state: RoomState, targetId: string, at = new Date().toISOString()): void {
  state.voiceDispatch = { lastTarget: targetId, lastTargetAt: at };
}
