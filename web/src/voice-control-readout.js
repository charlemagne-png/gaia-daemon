const REPLY_CHUNK_CHARS = 450;
const REPLY_TOTAL_CHARS = 1200;
export const REPLY_MORE_NOTICE = "…more in the chat";

/** @param {Date} [date] @returns {string} */
export function voiceControlRoomTitle(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `voice control — ${month}/${day} ${hour}:${minute}`;
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
