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
 * @property {number} flowTime   // drift phase for the flow field
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

/** Theme-tuned rendering weights. Dark = luminous; light = bold amber for contrast. */
function themeWeights() {
  const dark = document.documentElement.dataset.theme === "apple-dark";
  return dark
    ? { alpha: 1, count: 220, headBoost: 1, additive: true, sizeMul: 1 }
    : { alpha: 1, count: 200, headBoost: 0.9, additive: false, sizeMul: 1.05 };
}

/** @param {DustField} f @param {boolean} initial */
function seedParticle(f, initial) {
  const g = Math.random();
  // Spawn in a ring around the center; particles flow in from the field
  const cx = f.w / 2;
  const cy = f.h / 2.2;
  const spawnRadius = initial ? rand(150, 280) : rand(180, 320);
  const spawnAngle = rand(0, Math.PI * 2);
  
  // Hue selection: dark theme uses full ramp (0,1,2,3); light theme uses only deep amber (3) + core gold (0)
  let hue;
  const isDark = document.documentElement.dataset.theme === "apple-dark";
  if (isDark) {
    hue = g < 0.08 ? 2 : g < 0.4 ? 1 : g < 0.85 ? 0 : 3;
  } else {
    // Light theme: bias toward deep amber #c9922f (hue 3) for contrast on white
    hue = g < 0.6 ? 3 : 0;
  }
  
  /** @type {Particle} */
  const p = {
    x: cx + Math.cos(spawnAngle) * spawnRadius,
    y: cy + Math.sin(spawnAngle) * spawnRadius,
    vx: rand(-1.5, 1.5),
    vy: rand(-1.5, 1.5),
    size: rand(0.5, 1.9),  // smaller base for sharper cores
    alpha: rand(0.4, 1),
    hue: hue,
    seed: rand(0, Math.PI * 2),
    glint: 0,
    life: 0,
    maxLife: rand(7, 14),
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

// ──────────────────────────────────────────────────────────────────────────────
// FLOW FIELD — curl noise for school-of-fish coherence
// ──────────────────────────────────────────────────────────────────────────────
// Simple 2D noise basis (hash-based, no external lib). Particles sample velocity
// from this field → locally aligned → ribbon/stream motion. Curl (∇⊥) keeps
// the field divergence-free so dust doesn't pool/disperse, just flows.

/** Hash-based 2D noise. @param {number} x @param {number} y @returns {number} [-1..1] */
function noise2d(x, y) {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const fx = x - X;
  const fy = y - Y;
  // Smooth interpolation
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  
  // Hash corners
  /**
   * @param {number} ix
   * @param {number} iy
   * @returns {number}
   */
  const hash = (ix, iy) => {
    let n = ix * 374761393 + iy * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) & 0x7fffffff) / 0x7fffffff * 2 - 1;
  };
  
  const a = hash(X, Y);
  const b = hash(X + 1, Y);
  const c = hash(X, Y + 1);
  const d = hash(X + 1, Y + 1);
  
  return a * (1 - u) * (1 - v) +
         b * u * (1 - v) +
         c * (1 - u) * v +
         d * u * v;
}

/**
 * Curl of a scalar potential field → divergence-free 2D velocity.
 * Instead of using noise directly as velocity (causes pooling), we take the
 * perpendicular gradient of a noise-based potential. Result: particles flow
 * in coherent streams that wrap and weave.
 * @param {number} x @param {number} y @param {number} t — drift time
 * @param {number} seed @param {number} scale — noise frequency
 * @returns {[number, number]} [vx, vy]
 */
function curlField(x, y, t, seed, scale) {
  const eps = 0.5;
  const s = scale;
  // Potential function (noise)
  /**
   * @param {number} px
   * @param {number} py
   * @returns {number}
   */
  const pot = (px, py) => noise2d(px * s + seed, py * s + t * 0.08);
  // Curl: (−∂ψ/∂y, ∂ψ/∂x)
  const dx = (pot(x + eps, y) - pot(x - eps, y)) / (2 * eps);
  const dy = (pot(x, y + eps) - pot(x, y - eps)) / (2 * eps);
  return [dy * 22, -dx * 22]; // swapped + scaled for flow strength
}

/**
 * Flow field combining curl stream + radial mask around logo + gentle drift.
 * Particles follow coherent wind-like ribbons, avoiding logo center.
 * @param {number} x @param {number} y @param {number} flowTime @param {number} seed @param {number} cx @param {number} cy
 * @returns {[number, number]} [ax, ay]
 */
function flow(x, y, flowTime, seed, cx, cy) {
  // Curl velocity at this point (stream motion)
  const [vx, vy] = curlField(x, y, flowTime, seed, 0.004);
  
  // Logo deflection: soft repulsion from center zone
  const dx = x - cx;
  const dy = y - cy;
  const distToCenter = Math.sqrt(dx * dx + dy * dy);
  const logoRadius = 100;
  let repelX = 0;
  let repelY = 0;
  if (distToCenter < logoRadius * 1.8) {
    const force = Math.max(0, (logoRadius * 1.8 - distToCenter) / logoRadius) * 12;
    const nx = dx / (distToCenter + 1);
    const ny = dy / (distToCenter + 1);
    repelX = nx * force;
    repelY = ny * force;
  }
  
  // Slow radial drift outward (gentle expansion bias so particles don't cluster)
  const driftX = dx * 0.008;
  const driftY = dy * 0.008;
  
  return [vx + repelX + driftX, vy + repelY + driftY];
}

/** @param {DustField} f @param {number} dt @param {ReturnType<typeof themeWeights>} w */
function step(f, dt, w) {
  const ctx = f.ctx;
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.globalCompositeOperation = w.additive ? "lighter" : "source-over";

  const target = Math.round(w.count * (f.w / (900 * f.dpr))); // scale count to width
  // Top up toward target gradually (no burst on resize).
  f.spawnAcc += dt * 10;
  while (f.parts.length < target && f.spawnAcc > 0) {
    f.parts.push(seedParticle(f, false));
    f.spawnAcc -= 1;
  }

  // Advance flow field drift
  f.flowTime += dt * 0.6;

  // Center of the canvas: logo/text zone
  const cx = f.w / 2;
  const cy = f.h / 2.2;

  for (let i = f.parts.length - 1; i >= 0; i--) {
    const p = f.parts[i];
    p.life += dt;
    
    // Flow field acceleration (school-of-fish coherence)
    const [ax, ay] = flow(p.x, p.y, f.flowTime, p.seed, cx, cy);
    p.vx += ax * dt * 0.35;
    p.vy += ay * dt * 0.35;
    
    // Damping keeps speed bounded + dust-slow
    p.vx *= 0.96;
    p.vy *= 0.96;
    
    p.x += p.vx * dt * f.dpr;
    p.y += p.vy * dt * f.dpr;

    // Record trail head
    p.trail.push(p.x, p.y);
    if (p.trail.length > TRAIL_LEN * 2) p.trail.splice(0, p.trail.length - TRAIL_LEN * 2);

    // Glint: brief sparkle flare, more frequent now
    if (p.glint > 0) p.glint -= dt * 4;  // faster decay for brief pops
    else if (Math.random() < 0.005) p.glint = rand(0.3, 0.65);  // ~3× more frequent

    // Fade in over first second, out over last 1.4s
    const fadeIn = Math.min(1, p.life / 1);
    const fadeOut = Math.min(1, (p.maxLife - p.life) / 1.4);
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    const a = p.alpha * envelope * w.alpha;

    const [r, g, b] = GOLD[p.hue];
    const dpr = f.dpr;

    // Trail: tapering polyline, tail transparent → head gold
    if (p.trail.length >= 4) {
      for (let t = 2; t < p.trail.length; t += 2) {
        const frac = t / p.trail.length;
        const seg = a * frac * 0.45;
        if (seg <= 0.01) continue;
        ctx.strokeStyle = `rgba(${r},${g},${b},${seg})`;
        ctx.lineWidth = Math.max(0.4, p.size * frac * dpr * 0.9);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.trail[t - 2], p.trail[t - 1]);
        ctx.lineTo(p.trail[t], p.trail[t + 1]);
        ctx.stroke();
      }
    }

    // Head: SHARP core + tight glow (smaller, crisper)
    const flare = p.glint > 0 ? 1 + p.glint * 4.5 : 1;
    const hr = p.size * dpr * flare;
    
    // Outer glow: tighter radius, lower alpha for less smear
    ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.22 * w.headBoost})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hr * 1.9, 0, Math.PI * 2);
    ctx.fill();
    
    // Core: smaller, brighter (the sharp center)
    ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, a * 1.4 * w.headBoost)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, hr * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // Glint cross — star-point flash when glinting
    if (p.glint > 0.25) {
      const len = hr * 6;
      const glintAlpha = (p.glint - 0.25) * 2.8;  // ramp up sharply
      ctx.strokeStyle = `rgba(${GOLD[2][0]},${GOLD[2][1]},${GOLD[2][2]},${a * 0.7 * glintAlpha})`;
      ctx.lineWidth = Math.max(0.5, dpr * 0.5);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.x - len, p.y);
      ctx.lineTo(p.x + len, p.y);
      ctx.moveTo(p.x, p.y - len);
      ctx.lineTo(p.x, p.y + len);
      ctx.stroke();
    }

    // Recycle when spent or drifted far out
    const dcx = p.x - cx;
    const dcy = p.y - cy;
    const distFromCenter = Math.sqrt(dcx * dcx + dcy * dcy);
    if (p.life >= p.maxLife || distFromCenter > f.h * 0.75) {
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
    flowTime: Math.random() * 100,  // random phase so multiple canvases differ
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
