#!/usr/bin/env bun

import { chromium } from "playwright";
import { writeFile, readFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { resolve, dirname } from "path";
import { serve } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const SCREENSHOTS_DIR = resolve(ROOT, "screenshots");

// Ensure screenshots directory exists
await mkdir(SCREENSHOTS_DIR, { recursive: true });

const THEMES = ["apple", "apple-dark"];
const TIMESTAMPS = [0, 1500, 3000, 2600]; // ms

interface Frame {
  label: string;
  path: string;
  md5: string;
  theme: string;
  timestamp: number;
  t2600Title?: string;
}

const frames: Frame[] = [];
const md5s = new Map<string, string>();

// Start simple HTTP server to serve the repo
const PORT = 9988;

const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === "/" ? "/tools/newchat-proof.html" : url.pathname;
    const filePath = resolve(ROOT, pathname.slice(1)); // Remove leading /

    // Basic file serving
    if (pathname.endsWith(".html")) {
      return new Response(Bun.file(filePath));
    } else if (pathname.endsWith(".js")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/javascript" },
      });
    } else if (pathname.endsWith(".json")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "application/json" },
      });
    } else if (pathname.endsWith(".css")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "text/css" },
      });
    } else if (pathname.endsWith(".png")) {
      return new Response(Bun.file(filePath), {
        headers: { "Content-Type": "image/png" },
      });
    } else {
      // Try serving as-is for any other file
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
  for (const theme of THEMES) {
    for (const ts of TIMESTAMPS) {
      const frameLabel = `${theme}-t${ts}`;
      const outputFile = resolve(SCREENSHOTS_DIR, `${frameLabel}.png`);

      console.log(`📸 Capturing ${frameLabel}...`);

      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });

      // Capture console for debugging
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
        const url = `http://localhost:${PORT}/tools/newchat-proof.html`;
        await page.goto(url, { waitUntil: "networkidle" });

        // Set the theme BEFORE we wait
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t;
        }, theme);

        // Wait for the specified timestamp to let dust/animations play
        if (ts > 0) {
          await page.waitForTimeout(ts);
        }

        // Take screenshot
        const screenshot = await page.screenshot({ path: outputFile });

        // For t2600, extract the title for verification
        let t2600Title: string | undefined;
        if (ts === 2600) {
          t2600Title = await page.evaluate(() => {
            const el = document.querySelector(".newchat-title");
            return el ? el.textContent : "NOT FOUND";
          });
        }

        // Compute MD5
        const hash = createHash("md5").update(screenshot).digest("hex");
        md5s.set(frameLabel, hash);

        frames.push({
          label: frameLabel,
          path: outputFile,
          md5: hash,
          theme,
          timestamp: ts,
          t2600Title,
        });

        console.log(`  ✓ ${frameLabel} (md5: ${hash.slice(0, 8)}...)`);
        if (t2600Title && t2600Title !== "Creation is at your fingertips.") {
          console.log(`  → t2600 saying: "${t2600Title}"`);
        }
      } finally {
        await page.close();
      }
    }
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

  console.log(`✓ All 8 frames are distinct`);

  // Report structure for verification
  const report = {
    timestamp: new Date().toISOString(),
    frames: frames.map((f) => ({
      label: f.label,
      path: f.path,
      md5: f.md5,
      theme: f.theme,
      timestamp: f.timestamp,
      t2600Title: f.t2600Title,
    })),
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
    themes: THEMES,
    timestamps: TIMESTAMPS,
    distinctFrames: uniqueHashes.size,
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
    console.log(`  ${frame.path}`);
  }
  console.log(`\nMD5 list (proving all distinct):`);
  for (const frame of frames) {
    console.log(`  ${frame.label}: ${frame.md5}`);
  }
  console.log(`\nT2600 titles (per theme):`);
  for (const frame of frames.filter((f) => f.timestamp === 2600)) {
    console.log(`  ${frame.theme}: "${frame.t2600Title}"`);
  }
  console.log(`\nAll distinct: ${uniqueHashes.size === 8 ? "✓" : "❌"}`);
} finally {
  await browser.close();
  process.exit(0);
}
