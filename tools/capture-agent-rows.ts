#!/usr/bin/env bun

import { chromium } from "playwright";
import { mkdir, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { resolve } from "path";
import { serve } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const SCREENSHOTS_DIR = resolve(ROOT, "screenshots", "agent-rows");

// Ensure screenshots directory exists
await mkdir(SCREENSHOTS_DIR, { recursive: true });

interface FrameSpec {
  label: string;
  theme: "apple" | "apple-dark";
  actions?: (page: any) => Promise<void>;
  description: string;
}

const frames: FrameSpec[] = [
  {
    label: "01-light-base",
    theme: "apple",
    description: "Base layout (light theme) with agent rows grouped by workspace",
  },
  {
    label: "02-dark-base",
    theme: "apple-dark",
    description: "Base layout (dark theme) — theme consistency",
  },
  {
    label: "03-light-hover-popover",
    theme: "apple",
    actions: async (page) => {
      // Hover over first agent tile to open popover
      await page.hover(".agent-tile:first-child");
      await page.waitForTimeout(400); // Wait for popover animation
    },
    description: "Hover-popover open (light theme) — metadata visibility",
  },
  {
    label: "04-light-scrolled",
    theme: "apple",
    actions: async (page) => {
      // Scroll SCROLL_TEST strip to show horizontal scrolling
      await page.evaluate(() => {
        const strip = document.querySelector('[data-workspace="SCROLL_TEST"]');
        if (strip) {
          strip.scrollLeft = strip.scrollWidth / 2;
        }
      });
      await page.waitForTimeout(300);
    },
    description: "Horizontal scroll (light theme) — scroll position preserved",
  },
  {
    label: "05-light-exclusion",
    theme: "apple",
    description: "Exclusion verification (light theme) — FENYX/WORK/gaia-daemon excluded",
  },
];

const md5sMap = new Map<string, string>();
const PORT = 9989;

// Start HTTP server
const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === "/" ? "/tools/agent-rows-proof.html" : url.pathname;
    const filePath = resolve(ROOT, pathname.slice(1));

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
await new Promise((resolve) => setTimeout(resolve, 500));

console.log("🎬 Launching headless Chromium...");
const browser = await chromium.launch({ headless: true });

try {
  for (const spec of frames) {
    const outputFile = resolve(SCREENSHOTS_DIR, `${spec.label}.png`);

    console.log(`\n📸 Capturing ${spec.label}...`);
    console.log(`   ${spec.description}`);

    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`  [console] ${msg.text()}`);
      }
    });

    page.on("pageerror", (error) => {
      console.error(`  [page error] ${error.message}`);
    });

    try {
      // Load the HTML via HTTP
      const url = `http://localhost:${PORT}/tools/agent-rows-proof.html`;
      await page.goto(url, { waitUntil: "networkidle" });

      // Set the theme
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, spec.theme);

      // Wait for any initial rendering
      await page.waitForTimeout(300);

      // Execute any frame-specific actions
      if (spec.actions) {
        await spec.actions(page);
      }

      // Take screenshot
      const screenshot = await page.screenshot({ path: outputFile });

      // Compute MD5
      const hash = createHash("md5").update(screenshot).digest("hex");
      md5sMap.set(spec.label, hash);

      console.log(`  ✓ ${spec.label} (md5: ${hash.slice(0, 8)}...)`);

      // Verify visible groups for frame 05
      if (spec.label === "05-light-exclusion") {
        const visibleGroups = await page.evaluate(() => {
          return Array.from(document.querySelectorAll(".agent-rows-group-label")).map((el) =>
            el.textContent?.trim()
          );
        });
        console.log(`  → Visible groups: ${visibleGroups.join(", ")}`);
        const excluded = ["FENYX", "WORK", "gaia-daemon"];
        const hasExcluded = visibleGroups.some((g) =>
          excluded.some((e) => e.toLowerCase() === g?.toLowerCase())
        );
        if (hasExcluded) {
          console.error(`  ❌ ERROR: Excluded groups found in visible list!`);
          process.exit(1);
        }
        console.log(`  ✓ Excluded groups NOT in visible list`);
      }
    } finally {
      await page.close();
    }
  }

  // Self-gate: verify no duplicates
  console.log("\n🔐 Self-gate: MD5 deduplication...");
  const hashes = Array.from(md5sMap.values());
  const uniqueHashes = new Set(hashes);

  if (uniqueHashes.size !== hashes.length) {
    console.error("❌ DUPLICATE FRAMES DETECTED!");
    for (const [label, hash] of md5sMap) {
      const count = hashes.filter((h) => h === hash).length;
      if (count > 1) {
        console.error(`   ${label}: ${hash} (×${count})`);
      }
    }
    process.exit(1);
  }

  console.log(`✓ All ${frames.length} frames are distinct`);

  // Report
  const report = {
    timestamp: new Date().toISOString(),
    frames: frames.map((spec, i) => ({
      index: i + 1,
      label: spec.label,
      path: resolve(SCREENSHOTS_DIR, `${spec.label}.png`),
      md5: md5sMap.get(spec.label),
      theme: spec.theme,
      description: spec.description,
    })),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    distinctFrames: uniqueHashes.size,
    selfGatePass: uniqueHashes.size === frames.length,
  };

  await writeFile(resolve(SCREENSHOTS_DIR, "report.json"), JSON.stringify(report, null, 2));

  console.log("\n✅ PROOF COMPLETE");
  console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
  console.log(`Report: ${resolve(SCREENSHOTS_DIR, "report.json")}`);

  // Output for task return
  console.log("\n=== TASK RETURN ===");
  console.log("Frames (absolute paths):");
  for (const spec of frames) {
    const hash = md5sMap.get(spec.label);
    const path = resolve(SCREENSHOTS_DIR, `${spec.label}.png`);
    console.log(`  ${path}`);
    console.log(`    md5: ${hash}`);
    console.log(`    theme: ${spec.theme}`);
  }
  console.log(`\nAll distinct: ${uniqueHashes.size === frames.length ? "✓" : "❌"}`);
  console.log(`Self-gate: ${report.selfGatePass ? "✓ PASS" : "❌ FAIL"}`);
} finally {
  await browser.close();
  process.exit(0);
}
