// agent.json read/write helpers — tiny, generic, and core-layer only. HTTP and
// domain code hand in the already-resolved config path; this module knows no
// workspace, harness, or account registry.

import { readJson, writeJsonAtomic } from "./store.js";
import type { AgentModelConfig } from "./types.js";

export interface AgentConfigPatch {
  model?: AgentModelConfig | null;
  account?: string | null;
}

export function normalizeAgentModelInput(raw: unknown): AgentModelConfig | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "string") {
    const spec = raw.trim();
    if (!spec || spec === "none" || spec === "default") return null;
    const slash = spec.indexOf("/");
    if (slash <= 0 || slash === spec.length - 1) throw new Error(`Invalid model '${raw}'. Use provider/name.`);
    const provider = spec.slice(0, slash).trim();
    const name = spec.slice(slash + 1).trim();
    if (!provider || !name) throw new Error(`Invalid model '${raw}'. Use provider/name.`);
    return { provider, name };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const provider = typeof record.provider === "string" ? record.provider.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!provider || !name) throw new Error("Invalid model object. Use { provider, name }.");
    return { provider, name };
  }
  throw new Error("Invalid model. Use provider/name.");
}

export function normalizeAgentAccountInput(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") throw new Error("Invalid account. Use an account id or null.");
  const account = raw.trim();
  return account ? account : null;
}

export async function readAgentDefConfig(configPath: string): Promise<Record<string, unknown>> {
  return ((await readJson(configPath)) ?? {}) as Record<string, unknown>;
}

export async function patchAgentDefConfig(configPath: string, patch: AgentConfigPatch): Promise<Record<string, unknown>> {
  const config = await readAgentDefConfig(configPath);
  if (patch.model !== undefined) {
    if (patch.model === null) delete config.model;
    else config.model = { provider: patch.model.provider, name: patch.model.name };
  }
  if (patch.account !== undefined) {
    if (patch.account === null) delete config.account;
    else config.account = patch.account;
  }
  await writeJsonAtomic(configPath, config);
  return config;
}
