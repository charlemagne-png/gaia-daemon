// reload.ts unit tests: pidfile path selection, childEnv stripping, arg filtering.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pidfilePath, prepareChildArgs, prepareChildEnv } from "../src/server/reload.js";

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
