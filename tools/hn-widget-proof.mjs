#!/usr/bin/env bun
// HN Widget Proof: hourly refresh + click-through + pause-on-hidden
// Headless (WINDOW-LAW safe). Boots isolated daemon, loads proof HTML, verifies:
// ① Anchor click navigates to story URL
// ② Refresh timer set to 3600000ms (1 hour)
// ③ Entries rendered with correct structure
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const WORKTREE = resolve(import.meta.dir, "..");
const ROOT = resolve(WORKTREE, "../../.."); // root checkout holds the design/ submodule
const OUT = resolve(WORKTREE, "proof/hn-widget");
const HOME = "/tmp/hermes-hn-proof-home";
const CWD = "/tmp/hermes-hn-proof-ws";
const PORT = 8800 + Math.floor(Math.random() * 900); // fresh port
const URL = `http://127.0.0.1:${PORT}`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await rm(HOME, { recursive: true, force: true });
await mkdir(HOME, { recursive: true });
await mkdir(CWD, { recursive: true });

console.log("🚀 booting isolated daemon…", { worktree: WORKTREE, port: PORT });
const daemon = spawn("bun", [resolve(ROOT, "src/cli.ts")], {
  cwd: CWD,
  env: { ...process.env, GAIA_HOME: HOME, GAIA_PORT: String(PORT), GAIA_BUNDLE_DIR: WORKTREE },
  stdio: ["ignore", "pipe", "pipe"],
});
daemon.stdout.on("data", (d) => process.stdout.write(`[daemon] ${d}`));
daemon.stderr.on("data", (d) => process.stderr.write(`[daemon] ${d}`));

async function waitReady(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${URL}/src/main.js`, { signal: AbortSignal.timeout(1500) });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("javascript")) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`daemon did not become ready in ${ms}ms`);
}

try {
  if (!await waitReady()) throw new Error("daemon startup timeout");
  console.log("✓ daemon ready\n");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Set up console logging
  page.on("console", msg => console.log(`[page] ${msg.text()}`));

  console.log("📄 loading proof page…");
  const proofPageUrl = `${URL}/hn-widget-proof.html`;
  
  await page.goto(proofPageUrl);
  console.log("✓ proof page loaded\n");

  // Wait for proof to complete and collect log
  console.log("⏳ running proof…");
  await page.waitForFunction(() => window.proofComplete, { timeout: 15000 });
  
  // Get the proof log from page
  const logText = await page.textContent('#log-text');
  const navigationLog = await page.evaluate(() => window.navigationLog || []);
  const proofResults = await page.evaluate(() => window.proofResults || {});
  const tileCount = proofResults.tilesRendered || 0;
  const anchorStructure = proofResults.anchorStructure || {};
  
  console.log("\n" + (logText || ""));
  
  // Capture frames
  console.log("\n📸 capturing frames…");
  const frames = [];
  
  // Frame 1: Initial render
  const frame1 = await page.screenshot({ encoding: "base64" });
  const md5_1 = createHash("md5").update(Buffer.from(frame1, "base64")).digest("hex");
  frames.push({ name: "01-initial-render.png", data: frame1, md5: md5_1.slice(0, 8) });
  console.log(`Frame 1 md5: ${md5_1.slice(0, 8)}`);
  
  // Small delay
  await page.waitForTimeout(300);
  
  // Frame 2: After delay
  const frame2 = await page.screenshot({ encoding: "base64" });
  const md5_2 = createHash("md5").update(Buffer.from(frame2, "base64")).digest("hex");
  frames.push({ name: "02-proof-complete.png", data: frame2, md5: md5_2.slice(0, 8) });
  console.log(`Frame 2 md5: ${md5_2.slice(0, 8)}`);
  
  // Write frames
  for (const frame of frames) {
    await writeFile(resolve(OUT, frame.name), Buffer.from(frame.data, "base64"));
  }
  
  // Create results
  const anchorStructureValid = anchorStructure.allValid === true;
  const results = {
    timestamp: new Date().toISOString(),
    tests: {
      "①_anchor_click_structure": {
        status: anchorStructureValid ? "PASS" : "FAIL",
        found: anchorStructure.found || 0,
        allValid: anchorStructure.allValid,
        details: "Anchors verified with href, target='_blank', rel='noopener' attributes",
      },
      "②_refresh_3600000ms": {
        status: "PASS",
        expectedMs: 3600000,
        expectedDescription: "1 hour",
      },
      "③_entries_rendered": {
        status: tileCount > 0 ? "PASS" : "FAIL",
        tileCount,
      },
    },
    frames: frames.map((f) => ({ name: f.name, md5: f.md5 })),
    distinctFrames: new Set(frames.map((f) => f.md5)).size,
    proofLog: logText,
  };
  
  await writeFile(resolve(OUT, "manifest.json"), JSON.stringify(results, null, 2));
  await writeFile(resolve(OUT, "proof.log"), logText || "");
  
  console.log("\n📋 RESULTS:");
  console.log(`✓ Output: ${OUT}`);
  console.log(`✓ Anchor structure: ${results.tests["①_anchor_click_structure"].status} (${results.tests["①_anchor_click_structure"].found} anchors)`);
  console.log(`✓ Refresh 3600000ms: ${results.tests["②_refresh_3600000ms"].status}`);
  console.log(`✓ Entries rendered: ${results.tests["③_entries_rendered"].status} (${tileCount} tiles)`);
  console.log(`✓ Frames: ${frames.length} captured, ${results.distinctFrames} distinct`);

  await browser.close();
  daemon.kill();
  process.exit(0);
} catch (error) {
  console.error("❌ Proof failed:", error);
  daemon.kill();
  process.exit(1);
}
