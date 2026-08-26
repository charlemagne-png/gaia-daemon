export const REPLY_CHUNK_CHARS = 449;
export const REPLY_TOTAL_CHARS = 1200;
export const REPLY_MORE_NOTICE = "…more in the chat";

/** @param {Date} [date] @returns {string} */
export function voiceControlRoomTitle(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `gaiavoice — ${month}/${day} ${hour}:${minute}`;
}

/** @param {string} text @returns {string} */
export function sanitizeVoiceReplyText(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[`*_~|]/g, "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/&amp;/g, "and")
    .replace(/&lt;/g, "less than")
    .replace(/&gt;/g, "greater than")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} text @returns {string[]} */
export function chunkVoiceReplyText(text) {
  const clean = sanitizeVoiceReplyText(text);
  if (!clean) return [];
  const truncated = clean.length > REPLY_TOTAL_CHARS;
  const source = truncated ? clean.slice(0, REPLY_TOTAL_CHARS).trim() : clean;
  const chunks = [];
  let rest = source;
  while (rest.length > REPLY_CHUNK_CHARS) {
    let cut = Math.max(rest.lastIndexOf(". ", REPLY_CHUNK_CHARS), rest.lastIndexOf("? ", REPLY_CHUNK_CHARS), rest.lastIndexOf("! ", REPLY_CHUNK_CHARS));
    if (cut < REPLY_CHUNK_CHARS * 0.55) cut = rest.lastIndexOf(" ", REPLY_CHUNK_CHARS);
    if (cut < REPLY_CHUNK_CHARS * 0.55) cut = REPLY_CHUNK_CHARS;
    chunks.push(rest.slice(0, cut + (/[.!?]/.test(rest[cut]) ? 1 : 0)).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  if (truncated) chunks.push(REPLY_MORE_NOTICE);
  return chunks.filter(Boolean);
}

/** @param {string} workspaceId @param {string} roomId @param {string} eventId @returns {string} */
export function voiceReadoutEventKey(workspaceId, roomId, eventId) {
  return `${workspaceId}:${roomId}:${eventId}`;
}

/**
 * @param {{ workspaceId: string, roomId: string, event: { id?: string, timestamp?: string, author?: string, text?: string } }} payload
 * @param {{ workspaceId: string, roomId: string } | null} target
 * @param {number} sinceMs
 * @param {Set<string>} spokenEventKeys
 * @returns {boolean}
 */
export function shouldReadVoiceRoomEvent(payload, target, sinceMs, spokenEventKeys) {
  if (!target || payload.workspaceId !== target.workspaceId || payload.roomId !== target.roomId) return false;
  const event = payload.event;
  if (!event?.id || event.author === "user" || event.author === "system" || !String(event.text ?? "").trim()) return false;
  const timestampMs = Date.parse(String(event.timestamp ?? ""));
  if (!Number.isFinite(timestampMs) || timestampMs < sinceMs) return false;
  return !spokenEventKeys.has(voiceReadoutEventKey(payload.workspaceId, payload.roomId, event.id));
}

/** @returns {{ pending: string, inCodeFence: boolean, spokenChars: number, capReached: boolean, moreSpoken: boolean, stopped: boolean, complete: boolean }} */
export function createVoiceStreamReadoutState() {
  return { pending: "", inCodeFence: false, spokenChars: 0, capReached: false, moreSpoken: false, stopped: false, complete: false };
}

/**
 * @param {ReturnType<typeof createVoiceStreamReadoutState>} readout
 * @param {string} text
 * @returns {string[]}
 */
export function appendVoiceReadoutDelta(readout, text) {
  if (readout.stopped || readout.complete) return [];
  const chunks = [];
  const source = String(text ?? "");
  for (let index = 0; index < source.length; index += 1) {
    if (source.startsWith("```", index)) {
      readout.inCodeFence = !readout.inCodeFence;
      index += 2;
      continue;
    }
    const char = source[index] ?? "";
    if (readout.inCodeFence) continue;
    readout.pending += char;
    if (char === "\n" || char === "." || char === "!" || char === "?") chunks.push(...takeVoiceReadoutPending(readout));
  }
  return chunks;
}

/**
 * @param {ReturnType<typeof createVoiceStreamReadoutState>} readout
 * @returns {string[]}
 */
export function finalizeVoiceReadoutStream(readout) {
  if (readout.stopped || readout.complete) return [];
  const chunks = takeVoiceReadoutPending(readout);
  readout.complete = true;
  if (readout.capReached && !readout.moreSpoken) {
    readout.moreSpoken = true;
    chunks.push(REPLY_MORE_NOTICE);
  }
  return chunks;
}

/** @param {ReturnType<typeof createVoiceStreamReadoutState>} readout */
export function stopVoiceReadoutStream(readout) {
  readout.stopped = true;
  readout.complete = true;
  readout.pending = "";
}

/**
 * @param {ReturnType<typeof createVoiceStreamReadoutState>} readout
 * @returns {string[]}
 */
function takeVoiceReadoutPending(readout) {
  const clean = sanitizeVoiceReplyText(readout.pending);
  readout.pending = "";
  if (!clean) return [];
  if (readout.spokenChars >= REPLY_TOTAL_CHARS) {
    readout.capReached = true;
    return [];
  }
  const remaining = REPLY_TOTAL_CHARS - readout.spokenChars;
  const overflow = clean.length > remaining;
  const limited = overflow ? clean.slice(0, remaining).trim() : clean;
  if (!limited) return [];
  if (overflow) readout.capReached = true;
  readout.spokenChars += limited.length;
  return chunkLimitedVoiceReplyText(limited);
}

/** @param {string} clean @returns {string[]} */
function chunkLimitedVoiceReplyText(clean) {
  const chunks = [];
  let rest = clean;
  while (rest.length > REPLY_CHUNK_CHARS) {
    let cut = Math.max(rest.lastIndexOf(". ", REPLY_CHUNK_CHARS), rest.lastIndexOf("? ", REPLY_CHUNK_CHARS), rest.lastIndexOf("! ", REPLY_CHUNK_CHARS));
    if (cut < REPLY_CHUNK_CHARS * 0.55) cut = rest.lastIndexOf(" ", REPLY_CHUNK_CHARS);
    if (cut < REPLY_CHUNK_CHARS * 0.55) cut = REPLY_CHUNK_CHARS;
    chunks.push(rest.slice(0, cut + (/[.!?]/.test(rest[cut]) ? 1 : 0)).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** @returns {{ echoEma: number, startedAtMs: number }} */
export function createBargeWatchState() {
  return { echoEma: 0, startedAtMs: 0 };
}

/**
 * @param {ReturnType<typeof createBargeWatchState>} watch
 * @param {number} level
 * @param {number} speakAt
 * @param {number} nowMs
 * @returns {{ barging: boolean, threshold: number, echoEma: number }}
 */
export function observeBargeLevel(watch, level, speakAt, nowMs) {
  if (!Number.isFinite(watch.echoEma) || watch.echoEma <= 0) watch.echoEma = Math.max(0.001, level);
  const threshold = Math.max(watch.echoEma * 1.6, speakAt * 1.8);
  if (level >= threshold) {
    watch.startedAtMs = watch.startedAtMs || nowMs;
    return { barging: nowMs - watch.startedAtMs >= 150, threshold, echoEma: watch.echoEma };
  }
  watch.startedAtMs = 0;
  watch.echoEma = watch.echoEma * 0.92 + level * 0.08;
  return { barging: false, threshold, echoEma: watch.echoEma };
}
