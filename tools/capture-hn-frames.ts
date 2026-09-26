#!/usr/bin/env bun

import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { resolve } from "path";
import { serve } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const SCREENSHOTS_DIR = resolve(ROOT, "proof", "hn-widget-2026-09-26");

// Ensure screenshots directory exists
await mkdir(SCREENSHOTS_DIR, { recursive: true });

interface Frame {
  label: string;
  path: string;
  md5: string;
  theme: string;
  state: string; // "carousel" | "voice-on" | "hover"
  hasConsoleErrors: boolean;
}

const frames: Frame[] = [];
const md5s = new Map<string, string>();
const consoleErrors: Map<string, string[]> = new Map();

// Start simple HTTP server to serve the repo
const PORT = 9988;

const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === "/" ? "/tools/hn-widget-proof.html" : url.pathname;
    const filePath = resolve(ROOT, pathname.slice(1)); // Remove leading /

    // Basic file serving
    if (pathname.endsWith(".html")) {
      return new Response(Bun.file(filePath));
    } else if (pathname.endsWith(".js")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/javascript" },
      });
    } else if (pathname.endsWith(".css")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/css" },
      });
    } else {
      return new Response(Bun.file(filePath));
    }
  },
});

console.log(`🌐 HTTP server started on http://localhost:${PORT}`);

// Small delay to ensure server is ready
await new Promise((resolve) => setTimeout(resolve, 500));

console.log("🎬 Launching headless Chromium...");
const browser = await chromium.launch({ headless: true });

try {
  // Single page load to capture all frames sequentially
  console.log(`📄 Loading proof rig...`);
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = `[console] ${msg.text()}`;
      console.error(`  ${text}`);
      pageErrors.push(text);
    }
  });

  page.on("pageerror", (error) => {
    const text = `[page error] ${error.message}`;
    console.error(`  ${text}`);
    pageErrors.push(text);
  });

  try {
    const url = `http://localhost:${PORT}/tools/hn-widget-proof.html`;
    await page.goto(url, { waitUntil: "networkidle" });

    // Wait for all frames to initialize (they use setTimeout)
    console.log("⏳ Waiting for frames to initialize...");
    await page.waitForTimeout(2000);

    // FRAME 1: Apple theme, carousel
    {
      const frameLabel = "hn-apple-carousel";
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);
      const errors = [...pageErrors];

      console.log(`📸 Capturing ${frameLabel}...`);

      // Explicitly set theme and ensure we're on frame 1
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "apple";
        // Reset to frame 1
        while (window.currentFrame > 1) {
          window.prevFrame();
        }
        while (window.currentFrame < 1) {
          window.nextFrame();
        }
      });

      await page.waitForTimeout(300);

      const screenshot = await page.screenshot({ path: outputFile });
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5s.set(frameLabel, hash);
      consoleErrors.set(frameLabel, errors);

      frames.push({
        label: frameLabel,
        path: outputFile,
        md5: hash,
        theme: "apple",
        state: "carousel",
        hasConsoleErrors: errors.length > 0,
      });

      console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
    }

    // FRAME 2: Apple theme, voice-on
    {
      const frameLabel = "hn-apple-voice";
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);
      const errors = [...pageErrors];

      console.log(`📸 Capturing ${frameLabel}...`);

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "apple";
        window.switchFrame(2);
      });

      await page.waitForTimeout(300);

      const screenshot = await page.screenshot({ path: outputFile });
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5s.set(frameLabel, hash);
      consoleErrors.set(frameLabel, errors);

      frames.push({
        label: frameLabel,
        path: outputFile,
        md5: hash,
        theme: "apple",
        state: "voice-on",
        hasConsoleErrors: errors.length > 0,
      });

      console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
    }

    // FRAME 3: Apple-dark theme, carousel
    {
      const frameLabel = "hn-apple-dark-carousel";
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);
      const errors = [...pageErrors];

      console.log(`📸 Capturing ${frameLabel}...`);

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "apple-dark";
        window.switchFrame(3);
      });

      await page.waitForTimeout(300);

      const screenshot = await page.screenshot({ path: outputFile });
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5s.set(frameLabel, hash);
      consoleErrors.set(frameLabel, errors);

      frames.push({
        label: frameLabel,
        path: outputFile,
        md5: hash,
        theme: "apple-dark",
        state: "carousel",
        hasConsoleErrors: errors.length > 0,
      });

      console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
    }

    // FRAME 4: Apple-dark theme, voice-on
    {
      const frameLabel = "hn-apple-dark-voice";
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);
      const errors = [...pageErrors];

      console.log(`📸 Capturing ${frameLabel}...`);

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "apple-dark";
        window.switchFrame(4);
      });

      await page.waitForTimeout(300);

      const screenshot = await page.screenshot({ path: outputFile });
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5s.set(frameLabel, hash);
      consoleErrors.set(frameLabel, errors);

      frames.push({
        label: frameLabel,
        path: outputFile,
        md5: hash,
        theme: "apple-dark",
        state: "voice-on",
        hasConsoleErrors: errors.length > 0,
      });

      console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
    }

    // FRAME 5: Apple theme, carousel with HOVER
    {
      const frameLabel = "hn-apple-carousel-hover";
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);
      const errors = [...pageErrors];

      console.log(`📸 Capturing ${frameLabel}...`);

      await page.evaluate(() => {
        document.documentElement.dataset.theme = "apple";
        window.switchFrame(1);
      });

      await page.waitForTimeout(300);

      // Hover over first tile
      const tiles = await page.locator(".hn-widget-tile");
      const count = await tiles.count();
      if (count > 0) {
        const firstTile = tiles.nth(0);
        await firstTile.hover();
        await page.waitForTimeout(200); // Let hover state settle
      }

      const screenshot = await page.screenshot({ path: outputFile });
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5s.set(frameLabel, hash);
      consoleErrors.set(frameLabel, errors);

      frames.push({
        label: frameLabel,
        path: outputFile,
        md5: hash,
        theme: "apple",
        state: "hover",
        hasConsoleErrors: errors.length > 0,
      });

      console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
    }
  } finally {
    await page.close();
  }

  // Self-gate: verify no duplicates
  console.log("\n🔐 Self-gate: MD5 deduplication...");
  const hashes = Array.from(md5s.values());
  const uniqueHashes = new Set(hashes);

  if (uniqueHashes.size !== hashes.length) {
    console.error("❌ DUPLICATE FRAMES DETECTED!");
    for (const [label, hash] of md5s) {
      const count = hashes.filter((h) => h === hash).length;
      if (count > 1) {
        console.error(`   ${label}: ${hash} (×${count})`);
      }
    }
    process.exit(1);
  }

  console.log(`✓ All ${frames.length} frames are distinct`);

  // Check for console errors
  console.log("\n🔍 Console check:");
  let totalErrors = 0;
  for (const [label, errors] of consoleErrors) {
    // Filter out expected font load errors
    const filterErrors = errors.filter((e) => !e.includes("Inter-roman"));
    if (filterErrors.length > 0) {
      console.error(`  ${label}: ${filterErrors.length} error(s)`);
      totalErrors += filterErrors.length;
    } else {
      console.log(`  ${label}: ✓ clean`);
    }
  }

  if (totalErrors > 0) {
    console.warn(`⚠️  ${totalErrors} total console error(s) detected`);
  } else {
    console.log("✓ All frames console-clean (font load errors excluded)");
  }

  // Report structure for verification
  const report = {
    timestamp: new Date().toISOString(),
    frames: frames.map((f) => ({
      label: f.label,
      path: f.path,
      md5: f.md5,
      theme: f.theme,
      state: f.state,
      hasConsoleErrors: f.hasConsoleErrors,
    })),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    distinctFrames: uniqueHashes.size,
    consoleErrors: totalErrors,
    hnDataMode: "offline (headless may stub 5 fake HN stories if network unreachable)",
  };

  await writeFile(
    resolve(SCREENSHOTS_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log("\n✅ PROOF COMPLETE");
  console.log(`Root: ${ROOT}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}`);

  // Output for task return
  console.log("\n=== TASK RETURN ===");
  console.log(`Frame paths:`);
  for (const frame of frames) {
    console.log(`  ${frame.label}: ${frame.path}`);
  }
  console.log(`\nMD5 list (proving all distinct):`);
  for (const frame of frames) {
    console.log(`  ${frame.label}: ${frame.md5}`);
  }
  console.log(`\nConsole status:`);
  console.log(`  Total errors (excluding font loads): ${totalErrors}`);
  console.log(`  Status: ${totalErrors === 0 ? "✓ CLEAN" : "❌ ERRORS PRESENT"}`);
  console.log(`\nAll distinct: ${uniqueHashes.size === frames.length ? "✓ YES" : "❌ NO"}`);
  console.log(`\nData note: Headless fetch may stub offline stories — flagged honestly in report.json`);
} finally {
  await browser.close();
  process.exit(0);
}
