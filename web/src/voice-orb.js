// Shared Hermes voice orb — the audio-reactive splat/sphere visual.
// Rendered both inline under the composer (voice-control.js) and full-screen
// in the torn-off voice window (voice-window.js). The caller owns the live
// state; this module only draws. getState() returns the current animation
// inputs so one renderer serves both the in-app panel and a separate window
// that receives its level/pulse over a BroadcastChannel.

const HERMES_SPLAT_URL = "/img/hermes-splat-samples.json";

/** @typedef {{kind:"sphere", x:number, y:number, z:number, seed:number, size:number, audio:number, warm:boolean}} SphereOrbPoint */
/** @typedef {{kind:"hermes", nx:number, ny:number, r:number, g:number, b:number, aspect:number, seed:number, depth:number, size:number, audio:number}} HermesOrbPoint */
/** @typedef {SphereOrbPoint|HermesOrbPoint} VoiceOrbPoint */
/** @typedef {{ active: boolean, level: number, pulse: number }} VoiceOrbState */

/**
 * Drive an audio-reactive Hermes orb on a canvas until getState().active is
 * false and the canvas leaves the DOM.
 * @param {HTMLCanvasElement} canvas
 * @param {() => VoiceOrbState} getState
 * @param {{ vivid?: boolean }} [opts] vivid = full-screen window: densified
 *   points, additive brilliance, size scaled to the canvas (the compact inline
 *   panel stays plain so it never bleeds light into the composer).
 */
export function startOrb(canvas, getState, opts = {}) {
  if (!canvas.isConnected) return;
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) return;
  const ctx = maybeCtx;
  const vivid = opts.vivid === true;
  /** @type {VoiceOrbPoint[]} */
  let points = [];
  const fallback = window.setTimeout(() => {
    if (!points.length) points = orbPoints();
  }, 1200);
  void hermesSplatPoints().then((loaded) => {
    window.clearTimeout(fallback);
    points = vivid ? densify(loaded) : loaded;
  }).catch(() => {
    window.clearTimeout(fallback);
    points = orbPoints();
  });
  const startedAt = performance.now();

  /** @param {number} now */
  function draw(now) {
    const snap = getState();
    if (!canvas.isConnected || !snap.active) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = width / dpr;
    const hgt = height / dpr;
    const t = (now - startedAt) / 1000;
    const level = snap.level;
    const pulseAge = snap.pulse ? Math.max(0, (now - snap.pulse) / 1000) : 99;
    const pulse = Math.exp(-pulseAge * 5.2);
    // Point sizes are authored for a ~320px inline canvas; scale them to the
    // real canvas so a full-screen Hermes reads dense, not sparse.
    const scale = vivid ? Math.max(1, Math.min(w, hgt) / 300) : 1;
    ctx.clearRect(0, 0, w, hgt);
    const coreAlpha = vivid ? 0.2 + level * 0.24 + pulse * 0.18 : 0.12 + level * 0.16 + pulse * 0.12;
    const glow = ctx.createRadialGradient(w / 2, hgt / 2, 4, w / 2, hgt / 2, Math.max(w, hgt) * (vivid ? 0.55 : 0.48));
    glow.addColorStop(0, `rgba(255,225,150,${coreAlpha})`);
    glow.addColorStop(vivid ? 0.34 : 0.46, `rgba(214,168,86,${(vivid ? 0.12 : 0.06) + level * 0.12})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hgt);

    if (!points.length) {
      requestAnimationFrame(draw);
      return;
    }
    // Additive compositing turns overlapping gold points into real luminance —
    // the "brilliance" a flat source-over scatter can never reach.
    if (vivid) ctx.globalCompositeOperation = "lighter";
    for (const p of points) {
      if (p.kind === "hermes") drawHermesPoint(ctx, p, w, hgt, t, level, pulse, scale, vivid);
      else drawSpherePoint(ctx, p, w, hgt, t, level, pulse);
    }
    if (vivid) ctx.globalCompositeOperation = "source-over";
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

/** Fill the silhouette between sampled points with jittered satellites so a
 * large orb reads as a dense figure, not a sparse constellation. Each source
 * point spawns two dimmer neighbours; the pigment/depth is inherited so the
 * form and shading hold. @param {VoiceOrbPoint[]} base @returns {VoiceOrbPoint[]} */
function densify(base) {
  /** @type {VoiceOrbPoint[]} */
  const out = [];
  for (let i = 0; i < base.length; i += 1) {
    const p = base[i];
    out.push(p);
    if (p.kind !== "hermes") continue;
    for (let k = 0; k < 2; k += 1) {
      const jitterSeed = seededUnit(i * 2 + k + 3.1);
      const angle = jitterSeed * Math.PI * 2;
      const radius = 0.004 + seededUnit(i * 2 + k + 7.7) * 0.006;
      out.push({
        ...p,
        nx: clamp01(p.nx + Math.cos(angle) * radius),
        ny: clamp01(p.ny + Math.sin(angle) * radius / p.aspect),
        seed: seededUnit(i * 5 + k + 11.3),
        size: p.size * 0.82,
        audio: p.audio * 0.9,
      });
    }
  }
  return out;
}

/** @type {Promise<VoiceOrbPoint[]>|null} */
let hermesSplatPromise = null;

/** @returns {Promise<VoiceOrbPoint[]>} */
function hermesSplatPoints() {
  hermesSplatPromise ??= fetch(HERMES_SPLAT_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Hermes splat missing: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const sample = /** @type {{w?: unknown, h?: unknown, points?: unknown}} */ (data?.hermes ?? {});
      const w = typeof sample.w === "number" && sample.w > 0 ? sample.w : 1;
      const hgt = typeof sample.h === "number" && sample.h > 0 ? sample.h : 1;
      const rows = Array.isArray(sample.points) ? sample.points : [];
      return rows.map((row, index) => hermesPointFrom(row, index, w / hgt)).filter((point) => point !== null);
    });
  return hermesSplatPromise;
}

/** @param {unknown} row @param {number} index @param {number} aspect @returns {HermesOrbPoint|null} */
function hermesPointFrom(row, index, aspect) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const [nx, ny, r, g, b] = row;
  if (![nx, ny, r, g, b].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const seed = seededUnit(index + 1);
  // Pseudo-depth from luminance: bright pigment reads as near, shadow recedes.
  const depth = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 - 0.5;
  return {
    kind: "hermes",
    nx: clamp01(nx),
    ny: clamp01(ny),
    r: Math.max(0, Math.min(255, Math.round(r))),
    g: Math.max(0, Math.min(255, Math.round(g))),
    b: Math.max(0, Math.min(255, Math.round(b))),
    aspect,
    seed,
    depth,
    size: seededUnit(index + 101),
    audio: 0.35 + seededUnit(index + 211) * 0.9,
  };
}

/** @param {CanvasRenderingContext2D} ctx @param {HermesOrbPoint} p @param {number} w @param {number} hgt @param {number} t @param {number} level @param {number} pulse @param {number} [scale] @param {boolean} [vivid] */
function drawHermesPoint(ctx, p, w, hgt, t, level, pulse, scale = 1, vivid = false) {
  const targetH = Math.min(hgt * 0.93, (w * 0.86) / p.aspect);
  const targetW = targetH * p.aspect;
  const left = (w - targetW) / 2;
  const top = (hgt - targetH) / 2;
  const cx = w / 2;
  const cy = hgt / 2;
  const tx = left + p.nx * targetW;
  const ty = top + p.ny * targetH;
  const breath = 1 + Math.sin(t * 1.35) * 0.012 + level * p.audio * 0.052 + pulse * p.audio * 0.034;
  const drift = 0.55 + level * 2.2 + pulse * 1.3;
  const depth = p.depth ?? 0;
  // Slight 3D: bright (near) points sway with a slow virtual camera, dark points counter-sway.
  const sway = Math.sin(t * 0.55) * depth * targetW * 0.055;
  const lift = Math.cos(t * 0.42) * depth * targetH * 0.02;
  const x = cx + (tx - cx) * breath + sway + Math.sin(t * 1.9 + p.seed * 12.7) * drift;
  const y = cy + (ty - cy) * breath + lift + Math.cos(t * 1.6 + p.seed * 10.1) * drift;
  const alpha = Math.max(0.24, Math.min(0.95, 0.52 + depth * 0.22 + level * 0.24 + pulse * 0.18 + Math.sin(p.seed * 8.3) * 0.06));
  const size = (0.30 + p.size * 0.55 + level * 0.55 + pulse * 0.4) * (1 + depth * 0.55) * scale;
  if (vivid) {
    // Brighten toward a warm white core + additive alpha, and let bright
    // pigment sparkle harder on speech peaks. Sits under "lighter" compositing.
    const lift = 0.35 + level * 0.5 + pulse * 0.5;
    const r = Math.min(255, p.r + (255 - p.r) * lift * 0.6);
    const g = Math.min(255, p.g + (255 - p.g) * lift * 0.5);
    const b = Math.min(255, p.b + (255 - p.b) * lift * 0.35);
    const va = Math.max(0.16, Math.min(0.9, alpha * 0.7 + depth * 0.12 + level * 0.18));
    ctx.beginPath();
    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${va})`;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    // A tight hot core on the brightest points reads as specular glint.
    if (p.depth > 0.12) {
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,246,214,${Math.min(0.6, 0.14 + level * 0.3 + pulse * 0.3)})`;
      ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  ctx.beginPath();
  ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`;
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {CanvasRenderingContext2D} ctx @param {SphereOrbPoint} p @param {number} w @param {number} hgt @param {number} t @param {number} level @param {number} pulse */
function drawSpherePoint(ctx, p, w, hgt, t, level, pulse) {
  const radius = Math.min(w, hgt) * (0.30 + 0.018 * Math.sin(t * 1.6) + level * 0.07 + pulse * 0.05);
  const cx = w / 2;
  const cy = hgt * 0.52;
  const rotY = t * 0.34;
  const rotX = Math.sin(t * 0.27) * 0.34;
  const y1 = p.y * Math.cos(rotX) - p.z * Math.sin(rotX);
  const z1 = p.y * Math.sin(rotX) + p.z * Math.cos(rotX);
  const x2 = p.x * Math.cos(rotY) + z1 * Math.sin(rotY);
  const z2 = -p.x * Math.sin(rotY) + z1 * Math.cos(rotY);
  const perspective = 0.72 + (z2 + 1) * 0.18;
  const wave = 1 + Math.sin(t * 2.1 + p.seed * 9.7) * 0.022 + level * p.audio * 0.18 + pulse * p.audio * 0.15;
  const x = cx + x2 * radius * perspective * wave;
  const y = cy + y1 * radius * perspective * wave;
  const alpha = Math.max(0.12, Math.min(0.86, 0.20 + (z2 + 1) * 0.19 + level * 0.24 + pulse * 0.16));
  const size = (0.58 + p.size * 1.38 + level * 1.1 + pulse * 0.8) * perspective;
  ctx.beginPath();
  ctx.fillStyle = p.warm
    ? `rgba(255,121,198,${alpha})`
    : `rgba(${132 + Math.floor(p.seed * 70)},${178 + Math.floor(p.seed * 54)},255,${alpha})`;
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {number} value @returns {number} */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** @param {number} value @returns {number} */
function seededUnit(value) {
  const raw = Math.sin(value * 12.9898) * 43758.5453;
  return raw - Math.floor(raw);
}

/** @returns {SphereOrbPoint[]} */
function orbPoints() {
  /** @type {SphereOrbPoint[]} */
  const points = [];
  let seed = 8121;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 760; i += 1) {
    const u = random();
    const v = random();
    const theta = Math.PI * 2 * u;
    const phi = Math.acos(2 * v - 1);
    const shell = 0.70 + random() * 0.34;
    points.push({
      kind: "sphere",
      x: Math.sin(phi) * Math.cos(theta) * shell,
      y: Math.sin(phi) * Math.sin(theta) * shell,
      z: Math.cos(phi) * shell,
      seed: random(),
      size: random(),
      audio: 0.35 + random() * 0.9,
      warm: random() > 0.74,
    });
  }
  return points;
}
