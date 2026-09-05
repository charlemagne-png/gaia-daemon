// The UI's symbol vocabulary — ONE place, ported from gaia-daemon v2
// (v2 web/src/normalize.ts AGENT_GLYPHS + transcript.ts KIND/STATE glyphs).
//
// Law: monochrome unicode, NEVER emoji — anywhere, including activity kinds
// and agent avatars (v1 emoji + v2's own 💭🛠🧩 both rejected, Pascal 09-02).
// Emoji-capable codepoints carry U+FE0E (text variation selector) so the
// platform can never promote them to colour glyphs. Colour comes from the
// theme's CSS variables, never from the glyph — so every palette recolours
// the whole symbol set for free.
//
// Call sites import from here; no component defines its own glyph.

/** Per-agent identity marks (v2 normalize.ts), extended for v1's roster. */
export const AGENT_GLYPHS = /** @type {Record<string, string>} */ ({
  ari: "♛",
  nyari: "☾",
  lampas: "⚵",
  gaia: "☉",
  code: "▣",
  codex: "◈",
  dario: "♜",
  echo: "◌",
});

/** Deterministic monochrome pool for agents with no declared mark: the same
 * id always lands on the same glyph (id hash), so the roster stays visually
 * distinguishable without anybody hand-assigning an emoji. */
const GLYPH_POOL = ["◇", "△", "▽", "◻", "◫", "⬡", "✦", "✧", "⌾", "⊙", "⊛", "◑", "⍟", "⊚", "♁", "◉"];

/** @param {string} agentId @returns {string} */
export function agentGlyph(agentId) {
  const id = (agentId ?? "").toLowerCase();
  if (AGENT_GLYPHS[id]) return AGENT_GLYPHS[id];
  if (id.startsWith("ghoul")) return "⛧";
  if (!id) return "◈";
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GLYPH_POOL[hash % GLYPH_POOL.length];
}

/** Activity kinds inside a turn (v2 transcript.ts KIND_GLYPH). */
export const KIND = {
  thinking: "◌",
  tool: "⚙\uFE0E",
  skill: "❖",
  compaction: "✂\uFE0E",
  handoff: "↩︎",
  warning: "⚠\uFE0E",
};

/** Run states (v2 transcript.ts STATE_GLYPH). */
export const STATE = {
  running: "⠧",
  done: "✓\uFE0E", // VS15: 0xProto draws bare U+2713 root-shaped
  error: "×",
};

/** Chrome + control glyphs. v2 where v2 has one; same monochrome family
 * where the element exists only in v1 (attachments, incognito, calls). */
const SVG_NS = "http://www.w3.org/2000/svg";

/** @returns {SVGSVGElement} */
export function micIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("style", "vertical-align:-2px");
  for (const d of ["M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z", "M5 10v1a7 7 0 0 0 14 0v-1", "M12 18v3", "M8 21h8"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const UI = {
  brand: "◆",
  theme: "◈",
  human: "❯",
  system: "◇",
  send: "▸",
  sendBusy: "»",
  edit: "✎",
  retry: "↻",
  close: "×",
  search: "⌕",
  favorite: "★",
  favoriteOff: "☆",
  incognito: "⊚",
  attach: "▤",
  memory: "◍",
  watchdog: "◉",
  mic: "⌁",
  recording: "⏺",
  micMuted: "⌁̸",
  call: "☏",
  stop: "◼",
  twistyOpen: "▾",
  twistyClosed: "▸",
};
