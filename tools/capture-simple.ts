#!/usr/bin/env bun

import { chromium } from "playwright";
import { writeFile, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { resolve } from "path";
import { serve } from "bun";

const ROOT = resolve(import.meta.dir, "..");
const SCREENSHOTS_DIR = resolve(ROOT, "proof", "hn-frames");

await mkdir(SCREENSHOTS_DIR, { recursive: true });

const frames = [
  { name: "hn-apple-carousel", url: "/tools/hn-proof-1.html", theme: "apple", state: "carousel" },
  { name: "hn-apple-voice", url: "/tools/hn-proof-2.html", theme: "apple", state: "voice-on" },
  { name: "hn-apple-dark-carousel", url: "/tools/hn-proof-3.html", theme: "apple-dark", state: "carousel" },
  { name: "hn-apple-dark-voice", url: "/tools/hn-proof-4.html", theme: "apple-dark", state: "voice-on" },
  { name: "hn-apple-carousel-hover", url: "/tools/hn-proof-5.html", theme: "apple", state: "hover" },
];

const PORT = 9988;
const server = serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const filePath = resolve(ROOT, pathname.slice(1));

    if (pathname.endsWith(".html") || pathname.endsWith(".js") || pathname.endsWith(".css")) {
      return new Response(Bun.file(filePath));
    }
    return new Response("404", { status: 404 });
  },
});

console.log(`🌐 Server on :${PORT}`);
await new Promise((resolve) => setTimeout(resolve, 500));

const browser = await chromium.launch({ headless: true });

const results: any[] = [];
const md5s = new Map<string, string>();

try {
  for (const frame of frames) {
    console.log(`📸 ${frame.name}...`);

    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !msg.text().includes("Inter-roman")) {
        console.error(`  ${msg.text()}`);
        errors.push(msg.text());
      }
    });

    try {
      await page.goto(`http://localhost:${PORT}${frame.url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(800); // Wait for render

      const path = resolve(SCREENSHOTS_DIR, `${frame.name}.png`);
      const screenshot = await page.screenshot({ path });
      const hash = createHash("md5").update(screenshot).digest("hex");

      md5s.set(frame.name, hash);
      results.push({
        label: frame.name,
        path,
        md5: hash,
        theme: frame.theme,
        state: frame.state,
        errors: errors.length,
      });

      console.log(`  ✓ ${hash.slice(0, 8)}... (${screenshot.length} bytes)`);
    } finally {
      await page.close();
    }
  }

  // Verify distinctness
  console.log("\n🔐 MD5 check...");
  const hashes = Array.from(md5s.values());
  const unique = new Set(hashes);

  if (unique.size !== hashes.length) {
    console.error("❌ DUPLICATE HASHES!");
    for (const [name, hash] of md5s) {
      const count = hashes.filter((h) => h === hash).length;
      if (count > 1) console.error(`  ${name}: ${hash} (×${count})`);
    }
    process.exit(1);
  }

  console.log(`✓ All ${hashes.length} frames distinct`);

  // Report
  const report = {
    timestamp: new Date().toISOString(),
    frames: results,
    distinctFrames: unique.size,
    totalFrames: results.length,
    allDistinct: unique.size === results.length,
  };

  await writeFile(resolve(SCREENSHOTS_DIR, "report.json"), JSON.stringify(report, null, 2));

  console.log("\n✅ DONE");
  console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
  console.log(`\nFrame MD5s:`);
  for (const r of results) {
    console.log(`  ${r.label}: ${r.md5}`);
  }
  console.log(`\nAll distinct: ${unique.size === results.length ? "✓" : "❌"}`);
} finally {
  await browser.close();
  process.exit(0);
}
