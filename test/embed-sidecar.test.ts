// embed-sidecar.test.ts — port-squat immunity + lifecycle gates
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import type { ChildProcess } from "node:child_process";
import { EmbedSidecar } from "../src/services/embed-sidecar.js";

describe("EmbedSidecar port-squat immunity", () => {
  let squatter: Server | undefined;
  const SQUAT_PORT = 8790;

  before(() => {
    // Spawn a foreign squatter on the preferred embedder port.
    squatter = createServer();
    return new Promise<void>((resolve) => {
      squatter!.listen(SQUAT_PORT, "127.0.0.1", () => {
        console.log(`[test] squatter listening on :${SQUAT_PORT}`);
        resolve();
      });
    });
  });

  after(() => {
    return new Promise<void>((resolve) => {
      if (squatter) {
        squatter.close(() => {
          console.log(`[test] squatter closed`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  });

  it("falls back to ephemeral port when preferred port is squatted", async () => {
    const logs: string[] = [];
    const progressEvents: Array<{ state: string; detail: string; role: string }> = [];

    // Mock spawn that immediately reports success via health endpoint simulation.
    let spawnedPort: number | undefined;
    const spawnImpl = (_bin: string, args: string[]) => {
      const portIdx = args.indexOf("--port");
      spawnedPort = portIdx >= 0 ? Number.parseInt(args[portIdx + 1], 10) : undefined;
      const fake: Partial<ChildProcess> = {
        on: () => fake as ChildProcess,
        kill: () => true,
      };
      return fake as ChildProcess;
    };

    // Mock fetch that returns 200 for health checks on the spawned port.
    const fetchImpl = async (url: string | URL) => {
      const urlStr = url.toString();
      const match = urlStr.match(/:(\d+)\/health/);
      const port = match ? Number.parseInt(match[1], 10) : undefined;
      if (port === spawnedPort) {
        return { ok: true } as Response;
      }
      return { ok: false } as Response;
    };

    const sidecar = new EmbedSidecar({
      log: (msg) => logs.push(msg),
      onProgress: (state, detail, role) => progressEvents.push({ state, detail, role }),
      spawnImpl,
      fetchImpl,
      binaryPath: () => "/mock/llama-server",
    });

    const result = await sidecar.ensure("embeddinggemma-300m");

    assert.ok(result, "ensure should succeed");
    assert.ok(spawnedPort, "should have spawned");
    assert.notEqual(spawnedPort, SQUAT_PORT, "should NOT spawn on squatted port");
    assert.ok(spawnedPort! > 1024, "should use ephemeral port");

    // Verify logging mentioned the squat.
    const squatLog = logs.find((line) => line.includes("foreign process"));
    assert.ok(squatLog, "should log port squat detection");
    assert.ok(squatLog!.includes(String(SQUAT_PORT)), "log should mention squatted port");
    assert.ok(squatLog!.includes(String(spawnedPort)), "log should mention fallback port");

    // Verify progress event reported the squat.
    const squatProgress = progressEvents.find((e) => e.detail.includes("squatted"));
    assert.ok(squatProgress, "should emit squat progress event");

    sidecar.dispose();
  });
});
