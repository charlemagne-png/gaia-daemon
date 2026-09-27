// reload.ts unit tests: pidfile path selection, childEnv stripping, arg filtering.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { pidfilePath, prepareChildArgs, prepareChildEnv, reclaimPortFromPriorDaemon } from "../src/server/reload.js";

function listenOn(handler: (path: string) => { status: number; body: unknown } | undefined): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const out = handler(req.url ?? "/");
      if (!out) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !pidAlive(pid);
}

test("reclaimPortFromPriorDaemon: foreign holder (no gaia identity) is never killed", async () => {
  // A stranger occupies the port and a live dummy process exists; reclaim must
  // refuse (return false) and leave the process untouched.
  const victim: ChildProcess = spawn("sleep", ["30"]);
  const { server, port } = await listenOn(() => ({ status: 200, body: { not: "gaia" } }));
  try {
    const freed = await reclaimPortFromPriorDaemon(port, "127.0.0.1");
    assert.equal(freed, false);
    assert.ok(victim.pid !== undefined && pidAlive(victim.pid), "foreign process must not be signalled");
  } finally {
    server.close();
    if (victim.pid) victim.kill("SIGKILL");
  }
});

test("reclaimPortFromPriorDaemon: nothing on the port → false, fast", async () => {
  // Bind then immediately close to obtain a port with no listener.
  const { server, port } = await listenOn(() => undefined);
  await new Promise<void>((r) => server.close(() => r()));
  const freed = await reclaimPortFromPriorDaemon(port, "127.0.0.1");
  assert.equal(freed, false);
});

test("reclaimPortFromPriorDaemon: verified prior gaia daemon is terminated and port reclaimed", async () => {
  // Stand up a real process to play the wedged prior daemon, and a server that
  // reports THAT pid via the identity probe. reclaim must SIGTERM it and free.
  const prior: ChildProcess = spawn("sleep", ["30"]);
  const priorPid = prior.pid;
  assert.ok(priorPid !== undefined);
  const { server, port } = await listenOn((path) =>
    path === "/api/daemon/identity" ? { status: 200, body: { gaia: true, pid: priorPid } } : undefined,
  );
  try {
    const freed = await reclaimPortFromPriorDaemon(port, "127.0.0.1");
    assert.equal(freed, true);
    assert.ok(await waitGone(priorPid!, 2_000), "prior gaia daemon process must be terminated");
  } finally {
    server.close();
    if (priorPid && pidAlive(priorPid)) prior.kill("SIGKILL");
  }
});

test("reclaimPortFromPriorDaemon: never suicides on its own pid", async () => {
  const { server, port } = await listenOn((path) =>
    path === "/api/daemon/identity" ? { status: 200, body: { gaia: true, pid: process.pid } } : undefined,
  );
  try {
    const freed = await reclaimPortFromPriorDaemon(port, "127.0.0.1");
    assert.equal(freed, false);
    assert.ok(pidAlive(process.pid));
  } finally {
    server.close();
  }
});

test("pidfilePath: default port → daemon.pid", () => {
  const path = pidfilePath(8787);
  assert.ok(path.endsWith("/daemon.pid"));
  assert.ok(!path.includes("8787"));
});

test("pidfilePath: undefined port → daemon.pid", () => {
  const path = pidfilePath(undefined);
  assert.ok(path.endsWith("/daemon.pid"));
});

test("pidfilePath: non-default port → daemon-<port>.pid", () => {
  const path = pidfilePath(9999);
  assert.ok(path.endsWith("/daemon-9999.pid"));
});

test("pidfilePath: another non-default port", () => {
  const path = pidfilePath(8797);
  assert.ok(path.endsWith("/daemon-8797.pid"));
});

test("prepareChildEnv: strips ANTHROPIC_BASE_URL", () => {
  const original = process.env;
  try {
    process.env = { ...original, ANTHROPIC_BASE_URL: "https://polluted.example.com" };
    const cleaned = prepareChildEnv();
    assert.equal(cleaned.ANTHROPIC_BASE_URL, undefined);
  } finally {
    process.env = original;
  }
});

test("prepareChildEnv: strips GAIA_PARENT_PID", () => {
  const original = process.env;
  try {
    process.env = { ...original, GAIA_PARENT_PID: "12345" };
    const cleaned = prepareChildEnv();
    assert.equal(cleaned.GAIA_PARENT_PID, undefined);
  } finally {
    process.env = original;
  }
});

test("prepareChildEnv: preserves other env vars", () => {
  const original = process.env;
  try {
    process.env = {
      ...original,
      ANTHROPIC_BASE_URL: "https://polluted.example.com",
      GAIA_PARENT_PID: "12345",
      GAIA_PORT: "8888",
      PATH: "/usr/bin",
    };
    const cleaned = prepareChildEnv();
    assert.equal(cleaned.ANTHROPIC_BASE_URL, undefined);
    assert.equal(cleaned.GAIA_PARENT_PID, undefined);
    assert.equal(cleaned.GAIA_PORT, "8888");
    assert.equal(cleaned.PATH, "/usr/bin");
  } finally {
    process.env = original;
  }
});

test("prepareChildArgs: filters --dev flag", () => {
  const originalArgv = process.argv;
  try {
    process.argv = ["bun", "src/cli.ts", "--dev", "--port", "8888"];
    const filtered = prepareChildArgs(true);
    assert.deepEqual(filtered, ["src/cli.ts", "--port", "8888"]);
  } finally {
    process.argv = originalArgv;
  }
});

test("prepareChildArgs: filters bun internal /$bunfs/ paths", () => {
  const originalArgv = process.argv;
  try {
    process.argv = ["bun", "/$bunfs/root/src/cli.ts", "--port", "8888"];
    const filtered = prepareChildArgs(true);
    assert.deepEqual(filtered, ["--port", "8888"]);
  } finally {
    process.argv = originalArgv;
  }
});

test("prepareChildArgs: filters ~BUN markers", () => {
  const originalArgv = process.argv;
  try {
    process.argv = ["bun", "src/cli.ts", "~BUN_INTERNAL", "--port", "8888"];
    const filtered = prepareChildArgs(true);
    assert.deepEqual(filtered, ["src/cli.ts", "--port", "8888"]);
  } finally {
    process.argv = originalArgv;
  }
});

test("prepareChildArgs: includeScript=false drops argv[1]", () => {
  const originalArgv = process.argv;
  try {
    process.argv = ["bun", "src/cli.ts", "--port", "8888"];
    const filtered = prepareChildArgs(false);
    assert.deepEqual(filtered, ["--port", "8888"]);
  } finally {
    process.argv = originalArgv;
  }
});

test("prepareChildArgs: includeScript=true keeps argv[1] (unless filtered)", () => {
  const originalArgv = process.argv;
  try {
    process.argv = ["bun", "dist/gaia-daemon", "--port", "8888"];
    const filtered = prepareChildArgs(true);
    assert.deepEqual(filtered, ["dist/gaia-daemon", "--port", "8888"]);
  } finally {
    process.argv = originalArgv;
  }
});

test("prepareChildArgs: complex filter scenario", () => {
  const originalArgv = process.argv;
  try {
    process.argv = [
      "bun",
      "/$bunfs/root/src/cli.ts",
      "--dev",
      "--port",
      "8888",
      "~BUN_TEST",
      "--host",
      "localhost",
    ];
    const filtered = prepareChildArgs(true);
    assert.deepEqual(filtered, ["--port", "8888", "--host", "localhost"]);
  } finally {
    process.argv = originalArgv;
  }
});
