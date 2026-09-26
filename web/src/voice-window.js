// The torn-off full-screen Hermes voice window (voice.html). Self-contained:
// it reads its session room from the query string, seeds the transcript from
// the room's events, follows live deltas over the room event channel, and
// animates the shared Hermes orb from mic telemetry broadcast by the main
// window. No app state machine is imported — this window stands alone so it
// keeps rendering even if the main window navigates away.
import { h } from "./dom.js";
import { openEventChannel } from "./eventchannel.js";
import { startOrb } from "./voice-orb.js";
import { VOICE_TELEMETRY_CHANNEL } from "./voice-window-link.js";

const params = new URLSearchParams(location.search);
const workspaceId = params.get("ws") ?? "";
const roomId = params.get("room") ?? "";

const statusEl = /** @type {HTMLElement} */ (document.getElementById("voice-stage-status"));
const scrollEl = /** @type {HTMLElement} */ (document.getElementById("voice-transcript-scroll"));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("voice-stage-orb"));

// -- Orb telemetry ----------------------------------------------------------
// The main window owns the mic and broadcasts level/pulse/phase. We decay a
// stale level toward zero so the orb calmly idles (rather than freezing loud)
// if that window closes.
const telemetry = { level: 0, pulse: 0, phase: "idle", active: false };
let telemetryAt = 0;
let smoothedLevel = 0;

if (typeof BroadcastChannel !== "undefined") {
  try {
    const channel = new BroadcastChannel(VOICE_TELEMETRY_CHANNEL);
    channel.addEventListener("message", (event) => {
      const data = /** @type {any} */ (event.data) ?? {};
      telemetry.level = Number(data.level) || 0;
      telemetry.pulse = Number(data.pulse) || 0;
      telemetry.phase = typeof data.phase === "string" ? data.phase : "idle";
      telemetry.active = Boolean(data.active);
      telemetryAt = Date.now();
      paintStatus();
    });
  } catch {
    // No cross-window telemetry — the orb still breathes on its own.
  }
}

startOrb(canvas, () => {
  const stale = Date.now() - telemetryAt > 500;
  const target = stale || !telemetry.active ? 0 : telemetry.level;
  smoothedLevel += (target - smoothedLevel) * 0.2;
  const pulseFresh = telemetry.active && !stale ? telemetry.pulse : 0;
  return { active: canvas.isConnected, level: smoothedLevel, pulse: pulseFresh };
});

function paintStatus() {
  const stale = Date.now() - telemetryAt > 2500;
  if (!telemetry.active || stale) {
    statusEl.textContent = "idle";
    statusEl.dataset.phase = "idle";
    return;
  }
  statusEl.textContent = telemetry.phase === "processing" ? "thinking…" : "listening…";
  statusEl.dataset.phase = telemetry.phase;
}
window.setInterval(paintStatus, 1500);

// -- Transcript -------------------------------------------------------------
/** @type {Map<string, { row: HTMLElement, body: HTMLElement, author: string, text: string }>} */
const rows = new Map();

/** @param {string} author @returns {boolean} */
function isSpeakable(author) {
  return author !== "system";
}

/** @param {string} id @param {string} author @param {string} text */
function upsertRow(id, author, text) {
  if (!isSpeakable(author)) return;
  const clean = String(text ?? "");
  const existing = rows.get(id);
  if (existing) {
    existing.text = clean;
    existing.author = author;
    renderBody(existing.body, author, clean);
    return;
  }
  const mine = author === "user";
  const body = h("div", { class: "voice-msg-body" });
  const row = h("div", { class: `voice-msg ${mine ? "mine" : "hermes"}` },
    h("div", { class: "voice-msg-who", text: mine ? "You" : `@${author}` }),
    body,
  );
  renderBody(body, author, clean);
  const rec = { row, body, author, text: clean };
  rows.set(id, rec);
  const empty = scrollEl.querySelector(".voice-transcript-empty");
  if (empty) empty.remove();
  scrollEl.append(row);
  scrollToEnd();
}

/** @param {string} id @param {string} author @param {string} delta */
function appendDelta(id, author, delta) {
  if (!delta || !isSpeakable(author)) return;
  const existing = rows.get(id);
  const next = (existing?.text ?? "") + delta;
  upsertRow(id, author, next);
}

let pinned = true;
scrollEl.addEventListener("scroll", () => {
  pinned = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 48;
});
function scrollToEnd() {
  if (pinned) scrollEl.scrollTop = scrollEl.scrollHeight;
}

// -- Minimal markdown -------------------------------------------------------
// Kept local (no links.js/render.js import) so the window never pulls the main
// app's state machine. Handles the shapes Hermes actually speaks: paragraphs,
// bullet/numbered lists, `inline code`, **bold**, *italic*, fenced code.
/** @param {HTMLElement} body @param {string} author @param {string} text */
function renderBody(body, author, text) {
  body.replaceChildren();
  if (author === "user") {
    body.append(h("p", { class: "voice-p", text }));
    return;
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  /** @type {string[]} */
  let para = [];
  /** @type {HTMLElement|null} */
  let list = null;
  /** @type {{ node: HTMLElement, lines: string[] }|null} */
  let code = null;

  const flushPara = () => {
    if (!para.length) return;
    body.append(inlineParagraph(para.join(" ")));
    para = [];
  };
  const flushList = () => { list = null; };

  for (const raw of lines) {
    const line = raw;
    const fence = /^```/.test(line.trim());
    if (code) {
      if (fence) { code.node.textContent = code.lines.join("\n"); code = null; }
      else code.lines.push(line);
      continue;
    }
    if (fence) {
      flushPara(); flushList();
      const pre = h("pre", { class: "voice-code" });
      body.append(pre);
      code = { node: pre, lines: [] };
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (!list || list.dataset.ordered !== String(ordered)) {
        list = h(ordered ? "ol" : "ul", { class: "voice-list" });
        list.dataset.ordered = String(ordered);
        body.append(list);
      }
      const li = h("li", {});
      applyInline(li, (bullet ?? numbered)?.[1] ?? "");
      list.append(li);
      continue;
    }
    if (line.trim() === "") { flushPara(); flushList(); continue; }
    flushList();
    para.push(line.trim());
  }
  if (code) code.node.textContent = code.lines.join("\n");
  flushPara();
}

/** @param {string} text @returns {HTMLElement} */
function inlineParagraph(text) {
  const p = h("p", { class: "voice-p" });
  applyInline(p, text);
  return p;
}

/** @param {HTMLElement} parent @param {string} text */
function applyInline(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parent.append(document.createTextNode(text.slice(last, match.index)));
    const token = match[0];
    if (token.startsWith("**")) parent.append(h("strong", { text: token.slice(2, -2) }));
    else if (token.startsWith("`")) parent.append(h("code", { class: "voice-inline-code", text: token.slice(1, -1) }));
    else parent.append(h("em", { text: token.slice(1, -1) }));
    last = pattern.lastIndex;
  }
  if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
}

// -- Load + follow ----------------------------------------------------------
async function seedTranscript() {
  if (!workspaceId || !roomId) {
    statusEl.textContent = "no session";
    return;
  }
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rooms/${encodeURIComponent(roomId)}/events?limit=200`);
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    const events = Array.isArray(data?.events) ? data.events : [];
    for (const event of events) {
      if (event?.id && typeof event.text === "string" && event.text.trim()) upsertRow(event.id, String(event.author ?? ""), event.text);
    }
  } catch {
    // Live channel below still delivers new turns even if the seed failed.
  }
}

function followRoom() {
  if (!workspaceId || !roomId) return;
  const query = new URLSearchParams({ workspaceId, roomId });
  const source = openEventChannel(`/api/events?${query}`);
  source.addEventListener("text-delta", (event) => {
    const payload = JSON.parse(event.data);
    const eventId = String(payload.eventId ?? "");
    const author = String(payload.agentId ?? "");
    if (eventId && author && author !== "user") appendDelta(eventId, author, String(payload.delta ?? ""));
  });
  source.addEventListener("room-event", (event) => {
    const payload = JSON.parse(event.data);
    const ev = payload.event;
    if (ev?.id && typeof ev.text === "string") upsertRow(ev.id, String(ev.author ?? ""), ev.text);
  });
  window.addEventListener("pagehide", () => source.close());
}

paintStatus();
void seedTranscript().then(followRoom);
