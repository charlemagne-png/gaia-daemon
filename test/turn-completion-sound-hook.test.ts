import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomService } from "../src/services/room-service.js";
import { MemoryStore } from "../src/domain/memory.js";
import type { AgentDef, AgentEvent, Workspace } from "../src/core/types.js";
import type { AgentRuntime } from "../src/harness/spec.js";

process.env.GAIA_HOME = await mkdtemp(join(tmpdir(), "gaia-sound-home-"));

function sh(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

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
      yield { type: "text-delta", delta: "done" };
    },
    async abort() {},
    dispose() {},
    resetRoom() {},
    refreshContext() {},
  };
}

async function waitForFile(path: string, timeoutMs = 2_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const text = await readFile(path, "utf8");
      if (text.trim()) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${path}`);
}

test("turn-completion sound hook fires from postTurn settlement and writes the audit ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "gaia-sound-hook-"));
  const roomId = "default";
  const sound = join(root, "sound.mp3");
  const ledger = join(root, "ledger.jsonl");
  const script = join(process.cwd(), "scripts", "turn-completion-sound-hook.mjs");
  await mkdir(join(root, ".gaia", "rooms", roomId), { recursive: true });
  await writeFile(sound, "not real audio", "utf8");
  const command = `GAIA_TURN_COMPLETION_SOUND_PLAYER=/usr/bin/true GAIA_TURN_COMPLETION_SOUND_PATH=${sh(sound)} GAIA_TURN_COMPLETION_SOUND_LEDGER=${sh(ledger)} bun ${sh(script)}`;
  await writeFile(join(root, ".gaia", "config.json"), JSON.stringify({ hooks: { postTurn: [{ command }], error: [{ command }] } }), "utf8");
  const agents = { gaia: makeAgent("gaia", root) };
  const workspace: Workspace = {
    rootDir: root,
    dir: join(root, ".gaia"),
    configPath: join(root, ".gaia", "config.json"),
    agentsOverrideDir: join(root, ".gaia", "agents"),
    roomsDir: join(root, ".gaia", "rooms"),
    globalAgentsDir: join(root, "agents"),
    config: { defaultAgent: "gaia", room: roomId, transcriptWindow: 20, hooks: { postTurn: [{ command }], error: [{ command }] } },
    contextFiles: [],
    agents,
  };
  const service = await RoomService.open({ workspaceId: "ws", workspace, roomId, memoryStore: new MemoryStore(), runtimeFactory: runtime });
  const task = await service.sendMessage("hello");
  const line = (await waitForFile(ledger)).trim();
  const entry = JSON.parse(line);
  assert.equal(entry.event, "postTurn");
  assert.equal(entry.roomId, roomId);
  assert.equal(entry.agentId, "gaia");
  assert.equal(entry.taskId, task.id);
  assert.equal(entry.outcome, "complete");
  assert.equal(entry.sound, sound);
});
