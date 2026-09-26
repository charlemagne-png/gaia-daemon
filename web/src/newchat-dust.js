// HUGR gold-dust — the design language of the new-chat empty state. Fine
// sparkling gold particles drift through dark air on gently curving paths,
// each trailing a tapering tail, the odd one flaring into a glint. Not
// confetti, not game particles: slow-motion dust, luminous on near-black
// (apple-dark) and restrained-but-still-gold on white (apple).
//
// Lifecycle discipline. emptyState() is rebuilt on every empty-room render
// (container.replaceChildren), so a naive per-canvas rAF would stack loops.
// Here there is exactly ONE module-level loop for the whole document. It walks
// a registry of live canvases, drops any that have left the DOM
// (canvas.isConnected === false), pauses whenever document.hidden, and stops
// itself the moment the registry empties — no wasted frames when the view is
// gone or the window is in the background.

/**
 * @typedef {Object} Particle
 * @property {number} x @property {number} y
 * @property {number} vx @property {number} vy
 * @property {number} size @property {number} alpha
 * @property {number} hue        // 0..1 pick within the gold ramp
 * @property {number} seed       // phase offset for the flow field
 * @property {number} glint      // 0 = none, else countdown of a sparkle flare
 * @property {number} life @property {number} maxLife
 * @property {number[]} trail    // flattened x,y history (head last)
 */

/**
 * @typedef {Object} DustField
 * @property {HTMLCanvasElement} canvas
 * @property {CanvasRenderingContext2D} ctx
 * @property {Particle[]} parts
 * @property {number} w @property {number} h @property {number} dpr
 * @property {number} spawnAcc
 */

/** @type {Set<DustField>} */
const fields = new Set();
/** @type {number} */
let rafId = 0;
/** @type {number} */
let lastT = 0;
/** @type {boolean} */
let reduced = false;

// Gold ramp drawn from the HUGR mark (#d9a94a family). Kept as RGB triples so a
// per-particle alpha can be applied without per-frame string parsing.
const GOLD = [
  [0xd9, 0xa9, 0x4a], // core gold
  [0xe8, 0xbf, 0x6a], // warm highlight
  [0xf0, 0xd0, 0x89], // bright glint
  [0xc9, 0x92, 0x2f], // deep amber
];

const TRAIL_LEN = 5; // history points per particle (× tapering segments)

/** @param {number} min @param {number} max @returns {number} */
function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** Theme-tuned rendering weights. Dark = luminous; light = restrained, still gold. */
function themeWeights() {
  const dark = document.documentElement.dataset.theme === "apple-dark";
  return dark
    ? { alpha: 1, count: 132, headBoost: 1, additive: true, sizeMul: 1 }
    : { alpha: 0.5, count: 104, headBoost: 0.72, additive: false, sizeMul: 0.92 };
}

/** @param {DustField} f @param {boolean} initial */
function seedParticle(f, initial) {
  const g = Math.random();
  /** @type {Particle} */
  const p = {
    x: rand(0, f.w),
    y: initial ? rand(0, f.h) : rand(f.h * 0.15, f.h * 1.05),
    vx: rand(-4, 4),
    vy: rand(-14, -5), // gentle upward drift, like dust rising in still air
    size: rand(0.6, 2.2),
    alpha: rand(0.35, 1),
    hue: g < 0.08 ? 2 : g < 0.4 ? 1 : g < 0.85 ? 0 : 3,
    seed: rand(0, Math.PI * 2),
    glint: 0,
    life: 0,
    maxLife: rand(6, 13),
    trail: [],
  };
  return p;
}

/** @param {HTMLCanvasElement} canvas @returns {boolean} did-resize */
function measure(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

/**
 * Curl-ish flow field: a smooth, slowly-evolving vector nudge so trails curve
 * gently and coherently instead of jittering. Cheap trig, no noise tables.
 * @param {number} x @param {number} y @param {number} t @param {number} seed
 */
function flow(x, y, t, seed) {
  const s = 0.0016;
  const ax = Math.sin(y * s + t * 0.18 + seed) + 0.5 * Math.cos(x * s * 1.7 - t * 0.12);
  const ay = Math.cos(x * s - t * 0.15 + seed) * 0.6;
  return [ax, ay];
}

/** @param {DustField} f @param {number} dt @param {ReturnType<typeof themeWeights>} w */
function step(f, dt, w) {
  const ctx = f.ctx;
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.globalCompositeOperation = w.additive ? "lighter" : "source-over";

  const target = Math.round(w.count * (f.w / (900 * f.dpr))); // scale count to width
  // Top up toward target gradually (no burst on resize).
  f.spawnAcc += dt * 8;
  while (f.parts.length < target && f.spawnAcc > 0) {
    f.parts.push(seedParticle(f, false));
    f.spawnAcc -= 1;
  }

  for (let i = f.parts.length - 1; i >= 0; i--) {
    const p = f.parts[i];
    p.life += dt;
    const [ax, ay] = flow(p.x, p.y, lastT / 1000, p.seed);
    p.vx += ax * dt * 6;
    p.vy += ay * dt * 6;
    // Mild damping keeps speeds dust-slow and bounded.
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 - 1.6 * dt; // steady faint buoyancy
    p.x += p.vx * dt * f.dpr;
    p.y += p.vy * dt * f.dpr;

    // Record trail head (in device px).
    p.trail.push(p.x, p.y);
    if (p.trail.length > TRAIL_LEN * 2) p.trail.splice(0, p.trail.length - TRAIL_LEN * 2);

    // Occasional glint: a brief flare a particle triggers rarely.
    if (p.glint > 0) p.glint -= dt;
    else if (Math.random() < 0.0016) p.glint = rand(0.25, 0.5);

    // Fade in over first second, out over last second of life.
    const fadeIn = Math.min(1, p.life / 1);
    const fadeOut = Math.min(1, (p.maxLife - p.life) / 1.4);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    const a = p.alpha * envelope * w.alpha;

    const [r, g, b] = GOLD[p.hue];
    const dpr = f.dpr;

    // Trail: tapering polyline, tail transparent → head gold.
    if (p.trail.length >= 4) {
      for (let t = 2; t < p.trail.length; t += 2) {
        const frac = t / p.trail.length; // 0..1 toward head
        const seg = a * frac * 0.5;
        if (seg <= 0.01) continue;
        ctx.strokeStyle = `rgba(${r},${g},${b},${seg})`;
        ctx.lineWidth = Math.max(0.4, p.size * frac * dpr);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.trail[t - 2], p.trail[t - 1]);
        ctx.lineTo(p.trail[t], p.trail[t + 1]);
        ctx.stroke();
      }
    }

    // Head: a soft halo + a crisp core so it reads as a luminous mote.
    const flare = p.glint > 0 ? 1 + p.glint * 3.2 : 1;
    const hr = p.size * dpr * flare;
    ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.32 * w.headBoost})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hr * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a * 1.1 * w.headBoost)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hr * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Glint cross — a quiet four-point sparkle at peak flare only.
    if (p.glint > 0.32) {
      const len = hr * 5;
      ctx.strokeStyle = `rgba(${GOLD[2][0]},${GOLD[2][1]},${GOLD[2][2]},${a * 0.5 * (p.glint - 0.32) * 3})`;
      ctx.lineWidth = Math.max(0.5, dpr * 0.6);
      ctx.beginPath();
      ctx.moveTo(p.x - len, p.y);
      ctx.lineTo(p.x + len, p.y);
      ctx.moveTo(p.x, p.y - len);
      ctx.lineTo(p.x, p.y + len);
      ctx.stroke();
    }

    // Recycle when spent or drifted off the top/sides.
    if (p.life >= p.maxLife || p.y < -f.h * 0.1 || p.x < -60 || p.x > f.w + 60) {
      f.parts[i] = seedParticle(f, false);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

/** @param {number} now */
function frame(now) {
  rafId = 0;
  // Prune canvases that have left the DOM (empty state re-rendered / room changed).
  for (const f of fields) {
    if (!f.canvas.isConnected) fields.delete(f);
  }
  if (fields.size === 0) return; // loop stops; attachDust restarts it
  if (document.hidden) {
    lastT = now;
    schedule();
    return; // paused: no draw work while backgrounded
  }
  const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
  lastT = now;
  const w = themeWeights();
  for (const f of fields) {
    if (measure(f.canvas)) {
      f.w = f.canvas.width;
      f.h = f.canvas.height;
      f.dpr = Math.min(window.devicePixelRatio || 1, 2);
    }
    // Seed once the canvas has real, connected dimensions (attachDust runs
    // before insertion, when clientWidth is still 0).
    if (f.parts.length === 0 && f.w > 2) {
      const initial = Math.round(w.count * (f.w / (900 * f.dpr)));
      for (let i = 0; i < initial; i++) f.parts.push(seedParticle(f, true));
    }
    if (reduced) {
      // Reduced-motion: draw a single calm frame of static dust, then idle.
      staticFrame(f, w);
    } else {
      step(f, dt, w);
    }
  }
  if (!reduced) schedule();
}

/** @param {DustField} f @param {ReturnType<typeof themeWeights>} w */
function staticFrame(f, w) {
  const ctx = f.ctx;
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.globalCompositeOperation = w.additive ? "lighter" : "source-over";
  for (const p of f.parts) {
    const [r, g, b] = GOLD[p.hue];
    const a = p.alpha * 0.7 * w.alpha;
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * f.dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function schedule() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

/**
 * Register a canvas to be painted with gold dust. Idempotent per element; the
 * shared loop owns all lifecycle. Call once when the canvas is created.
 * @param {HTMLCanvasElement} canvas
 */
export function attachDust(canvas) {
  const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  reduced = !!mql?.matches;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  measure(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  /** @type {DustField} */
  const f = {
    canvas,
    ctx,
    parts: [],
    w: canvas.width,
    h: canvas.height,
    dpr,
    spawnAcc: 0,
  };
  fields.add(f);
  schedule();
}

// Resume promptly when the tab returns to the foreground.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && fields.size) {
    lastT = 0;
    schedule();
  }
});
