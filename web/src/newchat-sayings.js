/**
 * Fetch and cache curated quotes corpus from web/newchat-sayings.json.
 * If fetch fails, fall back to 6 inlined canonical quotes.
 * Rotation: random pick avoiding immediate repeat via localStorage.
 *
 * @typedef {Object} Saying
 * @property {string} id — unique key
 * @property {string} text — quote (≤90 chars)
 * @property {string} author — name only
 * @property {string} field — philosophy|physics|math|science|engineering|technology|news|research
 * @property {string} source — reference/attribution
 * @property {string} added — date (YYYY-MM-DD format)
 */

/** Fallback 6-quote corpus used if fetch fails */
const FALLBACK_SAYINGS = [
  {
    id: "feynman-1",
    text: "What I cannot create, I do not understand.",
    author: "Feynman",
    field: "physics",
    source: "Blackboard at Caltech",
    added: "2026-09-26",
  },
  {
    id: "einstein-1",
    text: "Imagination is more important than knowledge.",
    author: "Einstein",
    field: "physics",
    source: "Essays",
    added: "2026-09-26",
  },
  {
    id: "kay-1",
    text: "The best way to predict the future is to invent it.",
    author: "Kay",
    field: "technology",
    source: "Talks",
    added: "2026-09-26",
  },
  {
    id: "davinci-2",
    text: "Simplicity is the ultimate sophistication.",
    author: "da Vinci",
    field: "engineering",
    source: "Notebooks",
    added: "2026-09-26",
  },
  {
    id: "hardy-1",
    text: "Beauty is the first test: there is no permanent place in the world for ugly mathematics.",
    author: "Hardy",
    field: "math",
    source: "A Mathematician's Apology",
    added: "2026-09-26",
  },
  {
    id: "sagan-1",
    text: "Imagination will often carry us to worlds that never were, but without it we go nowhere.",
    author: "Sagan",
    field: "science",
    source: "Cosmos",
    added: "2026-09-26",
  },
];

/** @type {Saying[] | null} Cached corpus loaded from JSON or fallback */
let cachedSayings = null;
/** @type {Promise<Saying[]> | null} */
let cachePromise = null;

/**
 * Load corpus from web/newchat-sayings.json with fallback.
 * Result is cached across calls. If JSON fails, uses FALLBACK_SAYINGS.
 * @returns {Promise<Saying[]>}
 */
async function loadSayings() {
  if (cachedSayings) return cachedSayings;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    try {
      const resp = await fetch("/newchat-sayings.json", {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      cachedSayings = await resp.json();
      if (!cachedSayings) cachedSayings = FALLBACK_SAYINGS;
    } catch (e) {
      console.warn("newchat-sayings.js: JSON fetch failed, using fallback", e);
      cachedSayings = FALLBACK_SAYINGS;
    }
    return cachedSayings || FALLBACK_SAYINGS;
  })();

  return cachePromise;
}

/**
 * Pick a random saying, avoiding immediate repeat.
 * Last selection persisted in localStorage under `hugr.newchat.saying`.
 * @returns {Promise<Saying>}
 */
export async function getRandomSaying() {
  const sayings = await loadSayings();
  const lastId = localStorage.getItem("hugr.newchat.saying");

  let candidates = sayings;
  if (lastId) {
    candidates = sayings.filter((s) => s.id !== lastId);
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  localStorage.setItem("hugr.newchat.saying", picked.id);
  return picked;
}

/**
 * Get corpus stats (for verification). Includes fallback awareness.
 * @returns {Promise<{total: number, byField: {[key: string]: number}, isFallback: boolean}>}
 */
export async function getCorpusStats() {
  const sayings = await loadSayings();
  const isFallback = sayings === FALLBACK_SAYINGS;
  /** @type {{[key: string]: number}} */
  const byField = {};
  for (const saying of sayings) {
    byField[saying.field] = (byField[saying.field] ?? 0) + 1;
  }
  return { total: sayings.length, byField, isFallback };
}
