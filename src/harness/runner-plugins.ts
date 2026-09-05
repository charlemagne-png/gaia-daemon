// Runner-side plugin loader. A runner plugin is a single .mjs file dropped in
// ~/.gaia/plugins/runner/ that hooks the agent runner subprocess at boot,
// BEFORE any harness runtime is built. Loaded uniformly for every harness.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { bundledDir, globalPaths } from "../core/paths.js";
import type { AgentEvent } from "../core/types.js";
import type { AgentInput } from "./spec.js";
import { RUNNER_ENV } from "./protocol.js";

const runnerPlugins: RunnerPlugin[] = [];

type FetchFn = typeof globalThis.fetch;

export interface RunnerTransformContext {
  readonly workspacePath: string;
  readonly roomId: string;
  readonly agentId: string;
  readonly spillContent: (content: string | Uint8Array, meta?: Record<string, unknown>) => Promise<{ path: string; bytes: number; sha256: string }>;
}

export interface RunnerPlugin {
  name?: string;
  wrapFetch?(next: FetchFn): FetchFn;
  transformInput?(input: AgentInput, ctx: RunnerTransformContext): AgentInput | Promise<AgentInput>;
  transformEvent?(event: AgentEvent, ctx: RunnerTransformContext): AgentEvent | Promise<AgentEvent>;
}

async function defaultSpillContent(content: string | Uint8Array, meta: Record<string, unknown> = {}): Promise<{ path: string; bytes: number; sha256: string }> {
  const roomDir = process.env[RUNNER_ENV.roomDir];
  if (!roomDir) throw new Error("runner spill sink unavailable: missing room dir");
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = join(roomDir, "runner-payloads");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${Date.now()}-${sha256.slice(0, 16)}.payload`);
  await writeFile(path, bytes);
  if (Object.keys(meta).length > 0) await writeFile(`${path}.json`, JSON.stringify({ ...meta, bytes: bytes.length, sha256 }, null, 2));
  return { path, bytes: bytes.length, sha256 };
}

export function runnerTransformContext(): RunnerTransformContext {
  return {
    workspacePath: process.env[RUNNER_ENV.workspacePath] ?? "",
    roomId: process.env[RUNNER_ENV.roomId] ?? "",
    agentId: process.env[RUNNER_ENV.agentId] ?? "",
    spillContent: defaultSpillContent,
  };
}

export async function transformRunnerInput(input: AgentInput, ctx: RunnerTransformContext = runnerTransformContext()): Promise<AgentInput> {
  let next = input;
  for (const plugin of runnerPlugins) {
    if (!plugin.transformInput) continue;
    try {
      next = await plugin.transformInput(next, ctx);
    } catch (error) {
      console.warn(`[runner-plugins] transformInput ${plugin.name ?? "plugin"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return next;
}

export async function transformRunnerEvent(event: AgentEvent, ctx: RunnerTransformContext = runnerTransformContext()): Promise<AgentEvent> {
  let next = event;
  for (const plugin of runnerPlugins) {
    if (!plugin.transformEvent) continue;
    try {
      next = await plugin.transformEvent(next, ctx);
    } catch (error) {
      console.warn(`[runner-plugins] transformEvent ${plugin.name ?? "plugin"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return next;
}

export async function installRunnerPlugins(): Promise<void> {
  for (const dir of [bundledDir("plugins", "runner"), globalPaths.runnerPluginsDir()]) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".mjs")).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
    try {
      const mod = await import(pathToFileURL(path).href);
      const plugin = (mod.default ?? mod) as RunnerPlugin;
      if (!plugin || typeof plugin !== "object") {
        console.warn(`[runner-plugins] skipped ${file}: invalid plugin export`);
        continue;
      }
      const hasHook = typeof plugin.wrapFetch === "function" || typeof plugin.transformInput === "function" || typeof plugin.transformEvent === "function";
      if (!hasHook) {
        console.warn(`[runner-plugins] skipped ${file}: no runner hook export`);
        continue;
      }
      if (typeof plugin.wrapFetch === "function") {
        const next: FetchFn = globalThis.fetch.bind(globalThis);
        const wrapped = plugin.wrapFetch(next);
        if (typeof wrapped !== "function") {
          console.warn(`[runner-plugins] skipped ${file}: wrapFetch did not return a function`);
          continue;
        }
        globalThis.fetch = wrapped;
      }
      runnerPlugins.push(plugin);
      console.warn(`[runner-plugins] loaded ${plugin.name ?? file}`);
    } catch (error) {
      console.warn(`[runner-plugins] skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    }
  }
}
