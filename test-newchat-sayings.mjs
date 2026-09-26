#!/usr/bin/env bun

import fs from "fs";
import path from "path";

const CDP_HOST = "localhost:9333";
const SCREENSHOTS_DIR = path.resolve(
  ".gaia/worktrees/hermes-mui1l1tm2zylyn/screenshots"
);

// Ensure screenshots dir exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Fetch CDP endpoint and connect to Chrome DevTools Protocol.
 */
async function connectCDP() {
  const resp = await fetch(`http://${CDP_HOST}/json/version`);
  const json = await resp.json();
  const wsUrl = json.webSocketDebuggerUrl;
  console.log("📡 CDP ws:", wsUrl);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;

    const send = (method, params = {}) => {
      return new Promise((res, rej) => {
        const msgId = ++id;
        const handler = (event) => {
          const data = JSON.parse(event.data);
          if (data.id === msgId) {
            ws.removeEventListener("message", handler);
            if (data.error) {
              rej(new Error(`CDP error: ${data.error.message}`));
            } else {
              res(data.result);
            }
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    };

    ws.addEventListener("open", () => resolve({ send, ws }));
    ws.addEventListener("error", reject);
  });
}

/**
 * Navigate to a new chat, wait for empty state, take screenshot.
 */
async function testNewchatSayings() {
  const { send, ws } = await connectCDP();

  try {
    console.log("🎬 Enable Page domain");
    await send("Page.enable");

    console.log("🎬 Navigate to new chat");
    await send("Page.navigate", { url: "http://localhost:5173/" });

    // Wait for load
    await new Promise((r) => setTimeout(r, 2000));

    console.log("🎬 Taking screenshot at t=0 (apple theme)");
    const shot0_apple = await send("Page.captureScreenshot", {
      format: "png",
    });
    const img0_apple = Buffer.from(shot0_apple.data, "base64");
    const path0_apple = path.join(SCREENSHOTS_DIR, "t0-apple.png");
    fs.writeFileSync(path0_apple, img0_apple);
    console.log(`✅ Saved: ${path0_apple}`);

    // Extract title at t0
    const title0 = await send("Runtime.evaluate", {
      expression:
        'document.querySelector(".newchat-title")?.textContent ?? "NOT_FOUND"',
    });
    console.log(`📝 Title at t=0: "${title0.result.value}"`);

    console.log("🎬 Switching to apple-dark theme");
    await send("Runtime.evaluate", {
      expression: 'document.documentElement.setAttribute("data-theme", "apple-dark")',
    });

    console.log("🎬 Taking screenshot at t=0 (apple-dark theme)");
    const shot0_dark = await send("Page.captureScreenshot", {
      format: "png",
    });
    const img0_dark = Buffer.from(shot0_dark.data, "base64");
    const path0_dark = path.join(SCREENSHOTS_DIR, "t0-apple-dark.png");
    fs.writeFileSync(path0_dark, img0_dark);
    console.log(`✅ Saved: ${path0_dark}`);

    console.log("⏳ Waiting for saying swap (t=2100ms)...");
    await new Promise((r) => setTimeout(r, 2100));

    console.log("🎬 Back to apple theme");
    await send("Runtime.evaluate", {
      expression: 'document.documentElement.setAttribute("data-theme", "apple")',
    });

    console.log("🎬 Taking screenshot at t=2600 (apple theme)");
    const shot2600_apple = await send("Page.captureScreenshot", {
      format: "png",
    });
    const img2600_apple = Buffer.from(shot2600_apple.data, "base64");
    const path2600_apple = path.join(SCREENSHOTS_DIR, "t2600-apple.png");
    fs.writeFileSync(path2600_apple, img2600_apple);
    console.log(`✅ Saved: ${path2600_apple}`);

    // Extract title at t2600
    const title2600 = await send("Runtime.evaluate", {
      expression:
        'document.querySelector(".newchat-title")?.textContent ?? "NOT_FOUND"',
    });
    console.log(`📝 Title at t=2600: "${title2600.result.value}"`);

    console.log("🎬 Switching to apple-dark theme");
    await send("Runtime.evaluate", {
      expression: 'document.documentElement.setAttribute("data-theme", "apple-dark")',
    });

    console.log("🎬 Taking screenshot at t=2600 (apple-dark theme)");
    const shot2600_dark = await send("Page.captureScreenshot", {
      format: "png",
    });
    const img2600_dark = Buffer.from(shot2600_dark.data, "base64");
    const path2600_dark = path.join(SCREENSHOTS_DIR, "t2600-apple-dark.png");
    fs.writeFileSync(path2600_dark, img2600_dark);
    console.log(`✅ Saved: ${path2600_dark}`);

    // Verify swap
    const swapped = title0.result.value !== title2600.result.value;
    console.log(
      `\n✅ SWAP VERIFICATION: ${swapped ? "PASS" : "FAIL"}`
    );
    console.log(
      `   Original: "${title0.result.value}"\n   New: "${title2600.result.value}"`
    );

    // Get corpus stats
    const stats = await send("Runtime.evaluate", {
      expression: `
        (async () => {
          const { getCorpusStats } = await import('/web/src/newchat-sayings.js');
          return await getCorpusStats();
        })()
      `,
    });
    console.log(`\n📊 Corpus stats:`, stats.result.value);

    ws.close();
  } catch (e) {
    console.error("❌ Test failed:", e);
    ws.close();
    process.exit(1);
  }
}

testNewchatSayings();
