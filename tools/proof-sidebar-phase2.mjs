#!/usr/bin/env bun
// Phase-2 right-sidebar proof. The live /Applications/GAIA.app on :9333 serves
// its build snapshot, not unmerged code, so this boots an ISOLATED daemon
// (GAIA_HOME + cwd + port all scratched) from the ROOT checkout (it has the
// design/ submodule the worktree lacks) but points GAIA_BUNDLE_DIR at THIS
// worktree so serveStatic serves THIS branch's web/. All Phase-2 changes are
// in web/, so this renders the real, edited frontend against a real backend.
// Headless (WINDOW-LAW safe). A seeded snapshot drives deterministic agents.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const WORKTREE = resolve(import.meta.dir, "..");
const ROOT = resolve(WORKTREE, "../../.."); // root checkout holds the design/ submodule
const OUT = resolve(WORKTREE, "proof/sidebar-phase2");
const HOME = "/tmp/dieter-proof-home";
const CWD = "/tmp/dieter-proof-ws";
const PORT = 8800 + Math.floor(Math.random() * 900); // fresh port, dodge stale daemons
const URL = `http://127.0.0.1:${PORT}`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await rm(HOME, { recursive: true, force: true });
await mkdir(HOME, { recursive: true });
await mkdir(CWD, { recursive: true });

console.log("booting isolated daemon…", { ROOT, serveWeb: WORKTREE, cwd: CWD });
// Abs script path from ROOT (design/ submodule resolves there); process.cwd()
// is the SCRATCH workspace so no room-store writes ever touch the root checkout.
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
      // Require the ES module route to serve real JS — a 200 on / alone can
      // precede static wiring and races the browser into a text/html main.js.
      const r = await fetch(`${URL}/src/main.js`, { signal: AbortSignal.timeout(1500) });
      const ct = r.headers.get("content-type") || "";
      if (r.ok && ct.includes("javascript")) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("daemon not ready");
}
await waitReady();
console.log("daemon ready");

// ---- seeded snapshot (deterministic agents across groups) -------------------
const SNAPSHOT = {
  buildMock: true,
};

const INJECT = `
(async () => {
  const st = await import('/src/state.js');
  const rd = await import('/src/render.js');
  function avatar(letter, c1, c2) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="'+c1+'"/><stop offset="1" stop-color="'+c2+'"/></linearGradient></defs>' +
      '<rect width="108" height="108" fill="url(#g)"/>' +
      '<text x="54" y="70" font-family="Inter,system-ui" font-size="52" font-weight="600" ' +
      'fill="rgba(255,255,255,0.92)" text-anchor="middle">'+letter+'</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  const A = (id, displayName, workspace, model, av, status) => ({
    id, displayName, workspace, modelLabel: model, avatarUrl: av, status: status || 'idle',
    icon: '●', configuredModel: model, tools: [], roles: [], harness: 'pi', isDefault: false, description: '',
  });
  const agents = [
    A('gaia','Gaia','GENERAL','anthropic/claude-opus-4-8', avatar('G','#0a84ff','#0040a0')),
    A('hermes','Hermes','GENERAL','anthropic/claude-sonnet-4-5', avatar('H','#ff9f0a','#c25e00'),'running'),
    A('huginn','Huginn','GENERAL','anthropic/claude-sonnet-4-5', avatar('H','#30d158','#0a7d3a')),
    A('keymaker','','GENERAL','anthropic/claude-sonnet-4-5', avatar('K','#5e5ce6','#2a2ab0')),
    A('luna','','GENERAL','anthropic/claude-haiku-4-5', null),
    A('neil','','GENERAL','anthropic/claude-sonnet-4-5', null),
    A('dieter','Dieter','PERSONAL','anthropic/claude-opus-4-8', avatar('D','#64d2ff','#0071a0')),
    A('morpheus','Morpheus','PERSONAL','anthropic/claude-sonnet-4-5', avatar('M','#bf5af2','#7b1fa2')),
    A('remington','','PERSONAL','anthropic/claude-haiku-4-5', null),
    A('xena','Xena','FENYX','anthropic/claude-sonnet-4-5', avatar('X','#ff453a','#a01008')),
  ];
  st.state.snapshot = {
    room: { id:'proof-room', refCode:'W61', statePath:'/Users/charleshamilton/Documents/proof/.gaia/rooms/proof-room/transcript.jsonl', activeAgent:'dieter', agentDialogue:false },
    workspace: { id:'ws', defaultAgent:'gaia' },
    rooms: [{ id:'proof-room', isCurrent:true, bookmarks:[] }],
    agents,
    tasks: [
      { id:'t1', status:'complete', text:"Your summon 'otl-mui33wcdyqooq4' finished — its result is in the message just above. Continue from it." },
      { id:'t2', status:'queued', text:'Regate the tabbar chrome across both Apple themes before landing.' },
    ],
    notes: [],
  };
  st.state.voice = null;
  rd.markDirty('panel');
  return true;
})()
`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 }, deviceScaleFactor: 2 });
page.on("console", (m) => { if (m.type() === "error") console.log("[page error]", m.text()); });

await page.goto(URL, { waitUntil: "load" });
await page.waitForSelector("#right", { timeout: 15000 }); // app mounted its skeleton
await page.waitForTimeout(1200); // loader settle

const md5 = (buf) => createHash("md5").update(buf).digest("hex");
const frames = {};
async function shot(name, opts = {}) {
  const target = opts.full ? page : await page.$("#right");
  const buf = await (target).screenshot({ path: resolve(OUT, name) });
  frames[name] = md5(buf);
  console.log(name, frames[name]);
}

async function setTheme(t) {
  await page.evaluate((theme) => document.documentElement.setAttribute("data-theme", theme), t);
  await page.waitForTimeout(150);
}

// inject snapshot, let HN fetch settle
await setTheme("apple");
await page.evaluate(INJECT);
await page.waitForTimeout(2500);

await shot("01-apple.png");

await setTheme("apple-dark");
await page.waitForTimeout(400);
await shot("02-apple-dark.png");

// agent-tile hover popover (full page — popover is position:fixed on body)
await setTheme("apple");
await page.waitForTimeout(200);
const tile = await page.$('.agent-tile[data-agent-id="gaia"]');
if (tile) { await tile.hover(); await page.waitForTimeout(300); }
await shot("03-apple-hover-popover.png", { full: true });

// voice ON → hermes slot replaces the carousel
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
await page.evaluate(async () => {
  const st = await import('/src/state.js');
  const rd = await import('/src/render.js');
  st.state.voice = { agentId: 'dieter', roomId: 'proof-room', startedAt: Date.now() };
  rd.markDirty('panel');
});
await page.waitForTimeout(500);
await shot("04-apple-voice-hermes.png");

await setTheme("apple-dark");
await page.waitForTimeout(300);
await shot("05-apple-dark-voice-hermes.png");

// non-Apple theme must not break: universal tokens, no pinned palette
await page.evaluate(async () => {
  const st = await import('/src/state.js');
  const rd = await import('/src/render.js');
  st.state.voice = null;
  rd.markDirty('panel');
});
await setTheme("tokyo-night");
await page.waitForTimeout(500);
await shot("06-tokyo-night.png");

await writeFile(resolve(OUT, "manifest.json"), JSON.stringify({ port: PORT, capturedAt: new Date().toISOString(), md5: frames }, null, 2));

// distinctness assertion
const hashes = Object.values(frames);
const uniq = new Set(hashes);
console.log(`\nframes=${hashes.length} distinct=${uniq.size}`);
if (uniq.size !== hashes.length) console.error("!! DUPLICATE FRAMES — proof invalid");

await browser.close();
daemon.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 500));
console.log("done →", OUT);
