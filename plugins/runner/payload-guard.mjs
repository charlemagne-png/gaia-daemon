const DEFAULT_PAYLOAD_MAX = 1024 * 1024;
const DEFAULT_CONTEXT_MAX = 24 * 1024 * 1024;

function byteLength(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function limit(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function marker(kind, spill) {
  return `[payload spilled: ${kind}; ${spill.bytes} bytes; sha256=${spill.sha256}; path=${spill.path}]`;
}

async function guardValue(value, ctx, path, payloadMax) {
  if (typeof value === "string") {
    if (byteLength(value) <= payloadMax) return value;
    const spill = await ctx.spillContent(value, { plugin: "payload-guard", path, kind: "string" });
    return marker(path, spill);
  }
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i += 1) out.push(await guardValue(value[i], ctx, `${path}[${i}]`, payloadMax));
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = await guardValue(child, ctx, path ? `${path}.${key}` : key, payloadMax);
    return out;
  }
  return value;
}

async function shrinkInput(input, ctx, contextMax, payloadMax) {
  let next = input;
  if (byteLength(next) <= contextMax) return next;
  const transcript = Array.isArray(next.transcript) ? [...next.transcript] : [];
  for (let i = 0; i < transcript.length && byteLength(next) > contextMax; i += 1) {
    const event = transcript[i];
    if (!event || typeof event !== "object") continue;
    const text = typeof event.text === "string" ? event.text : undefined;
    const details = event.details;
    if (!text && details === undefined) continue;
    const payload = JSON.stringify({ text, details });
    const spill = await ctx.spillContent(payload, { plugin: "payload-guard", path: `input.transcript[${i}]`, kind: "context" });
    transcript[i] = { ...event, text: marker(`input.transcript[${i}]`, spill), ...(details !== undefined ? { details: undefined } : {}) };
    next = { ...next, transcript };
  }
  if (byteLength(next) > contextMax && typeof next.message === "string") {
    const spill = await ctx.spillContent(next.message, { plugin: "payload-guard", path: "input.message", kind: "context" });
    next = { ...next, message: marker("input.message", spill) };
  }
  return byteLength(next) > contextMax ? await guardValue(next, ctx, "input", payloadMax) : next;
}

export default {
  name: "payload-guard",
  async transformInput(input, ctx) {
    const payloadMax = limit("GAIA_PAYLOAD_MAX_BYTES", DEFAULT_PAYLOAD_MAX);
    const contextMax = limit("GAIA_CONTEXT_MAX_BYTES", DEFAULT_CONTEXT_MAX);
    const guarded = await guardValue(input, ctx, "input", payloadMax);
    return shrinkInput(guarded, ctx, contextMax, payloadMax);
  },
  async transformEvent(event, ctx) {
    const payloadMax = limit("GAIA_PAYLOAD_MAX_BYTES", DEFAULT_PAYLOAD_MAX);
    return guardValue(event, ctx, "event", payloadMax);
  },
};
