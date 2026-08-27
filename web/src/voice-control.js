// GaiaVoice: one mic stream, VAD-sliced utterance clips, local
// transcription endpoint, then room-command routing or normal message send.
import { addRoom, cancelActiveTask, closeRoomTab, createRoom, selectRoom, sendMessage } from "./actions.js";
import { api } from "./api.js";
import { h } from "./dom.js";
import { openEventChannel } from "./eventchannel.js";
import { markDirty, setError } from "./render.js";
import { state } from "./state.js";
import { createVoiceTranscriptMerger } from "./voice-merge.js";
import {
  appendVoiceReadoutDelta,
  createBargeWatchState,
  createVoiceStreamReadoutState,
  finalizeVoiceReadoutStream,
  observeBargeLevel,
  shouldReadVoiceRoomEvent,
  stopVoiceReadoutStream,
  voiceControlRoomTitle,
  voiceReadoutEventKey,
} from "./voice-control-readout.js";
export {
  appendVoiceReadoutDelta,
  chunkVoiceReplyText,
  createBargeWatchState,
  createVoiceStreamReadoutState,
  finalizeVoiceReadoutStream,
  observeBargeLevel,
  sanitizeVoiceReplyText,
  shouldReadVoiceRoomEvent,
  voiceControlRoomTitle,
  voiceReadoutEventKey,
} from "./voice-control-readout.js";

const SILENCE_MS = 1800;
const VOICE_REPLY_READOUT = false;
// ADAPTIVE gate: a fixed 0.025 RMS threshold never opened on quiet mics
// (proven live 08-26: orb "listening", zero transcribe calls). Speech =
// level clearly above a tracked noise floor, with a small absolute minimum.
// CALIBRATED gate, 08-26 v3. Two prior tunes failed on UNIT confusion:
// rmsLevel scales raw RMS ×4.8, so thresholds picked from raw-probe numbers
// sat BELOW scaled ambient (~0.024) — the gate read "speaking" forever, one
// endless segment, nothing ever transcribed. No absolute numbers anywhere
// now: the session measures ITS OWN ambient for the first ~0.6s, then speech
// / silence thresholds are ratios of that floor with hysteresis.
const CALIBRATION_FRAMES = 35;
const SPEAK_RATIO = 1.9;      // enter speech: clearly above ambient
const RELEASE_RATIO = 1.35;   // exit speech: back near ambient (hysteresis)
const SPEAK_MARGIN = 0.006;   // absolute margin in SCALED units, floors the ratios on dead-quiet rooms
const NOISE_FLOOR_EMA = 0.04;
const MAX_UTTERANCE_MS = 10_000; // hard cap — a segment can never run away again
const AMBIENT_BLOCK_FRAMES = 90;   // ~1.5s window for the ambient self-heal
const AMBIENT_RAISE_RATIO = 1.4;   // window min this far above floor = floor was calibrated too low
const MIN_UTTERANCE_MS = 260;
const MIN_VOICE_FRAMES = 3;
const MIN_CHUNK_BYTES = 900;
const TRANSCRIBE_TIMEOUT_MS = 180_000;
const HERMES_SPLAT_URL = "/img/hermes-splat-samples.json";

/** @typedef {{kind:"sphere", x:number, y:number, z:number, seed:number, size:number, audio:number, warm:boolean}} SphereOrbPoint */
/** @typedef {{kind:"hermes", nx:number, ny:number, r:number, g:number, b:number, aspect:number, seed:number, depth:number, size:number, audio:number}} HermesOrbPoint */
/** @typedef {SphereOrbPoint|HermesOrbPoint} VoiceOrbPoint */

/**
 * @typedef {Object} Segment
 * @property {MediaRecorder} recorder
 * @property {Blob[]} chunks
 * @property {number} startedAtMs
 * @property {number} lastSpeechAtMs
 * @property {number} peak
 * @property {number} voiceFrames
 * @property {boolean} discard
 * @property {boolean} continuation
 */

/**
 * @typedef {Object} VoiceControlSession
 * @property {MediaStream} stream
 * @property {AudioContext|null} audioCtx
 * @property {AnalyserNode|null} analyser
 * @property {Uint8Array<ArrayBuffer>|null} analyserData
 * @property {number} rafId
 * @property {Segment|null} segment
 * @property {boolean} segmentStopping
 * @property {boolean} stopping
 * @property {number} noiseFloor
 * @property {number} calibrationFrames
 * @property {number} blockMin
 * @property {number} blockFrames
 */

/** @type {VoiceControlSession|null} */
let session = null;
/** @type {Promise<void>} */
let transcriptionTail = Promise.resolve();
let activeTranscriptions = 0;
/** @type {Promise<void>} */
let speechTail = Promise.resolve();
/** @type {Set<AbortController>} */
const speechControllers = new Set();
let activeSpeechRequests = 0;
let speaking = false;
let speechSeq = 0;
let readoutHolds = 0;
/** @typedef {{ kind: "dispatcher" } | { kind: "current", workspaceId: string, roomId: string } | { kind: "new" }} VoiceStartTarget */

/** @type {{ workspaceId: string, roomId: string } | null} */
let voiceSessionTarget = null;
let voiceSessionStartedAtMs = 0;
let voiceSessionUsesDispatcher = false;
let voiceSessionFollowsCurrent = false;
const transcriptMerger = createVoiceTranscriptMerger({ dispatch: (text) => routeVoiceControlText(text) });
/** @type {Promise<VoiceStartTarget|null>|null} */
let voiceStartChoicePromise = null;
/** @type {Set<string>} */
const spokenVoiceEventKeys = new Set();
/** @type {Map<string, ReturnType<typeof createVoiceStreamReadoutState>>} */
const voiceReadoutStates = new Map();
let bargeWatch = createBargeWatchState();
let bargeInFlight = false;
/** @type {import("./eventchannel.js").EventChannel|null} */
let voiceSessionEventSource = null;

/** @returns {boolean} */
export function voiceControlEnabled() {
  return state.voiceControl.enabled;
}

export async function toggleVoiceControl() {
  if (state.voiceControl.enabled) {
    stopVoiceControl();
    return;
  }
  await startVoiceControl();
}

export async function startVoiceControl() {
  if (state.voiceControl.enabled) return;
  if (state.voice) {
    setError(new Error(`You're on a call with @${state.voice.agentId}. Hang up before GaiaVoice.`));
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setError(new Error("microphone needs HTTPS or localhost"));
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    setError(new Error("this browser can't record audio"));
    return;
  }

  const target = await resolveVoiceStartTarget();
  if (!target || state.voiceControl.enabled) return;

  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch {
    setError(new Error("microphone permission denied or unavailable"));
    return;
  }

  const room = target.kind === "current" ? null : target.kind === "dispatcher" ? await resolveCurrentVoiceRoom() : await createRoom({ title: voiceControlRoomTitle(), voiceSession: true });
  if (target.kind !== "current" && !room) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  voiceSessionTarget = target.kind === "current" ? { workspaceId: target.workspaceId, roomId: target.roomId } : room;
  voiceSessionStartedAtMs = Date.now();
  voiceSessionUsesDispatcher = target.kind === "dispatcher";
  voiceSessionFollowsCurrent = target.kind === "current";
  spokenVoiceEventKeys.clear();
  voiceReadoutStates.clear();
  bargeWatch = createBargeWatchState();

  const current = /** @type {VoiceControlSession} */ ({
    stream,
    audioCtx: null,
    analyser: null,
    analyserData: null,
    rafId: 0,
    segment: null,
    segmentStopping: false,
    stopping: false,
    noiseFloor: 0,
    calibrationFrames: 0,
    blockMin: Infinity,
    blockFrames: 0,
  });
  session = current;
  state.voiceControl.enabled = true;
  state.voiceControl.log = [];
  pendingConfirm = null;
  state.voiceControl.level = 0;
  state.voiceControl.pulse = 0;
  updateVoiceControlPhase();
  connectVoiceSessionEvents();
  startAnalyser(current);
}

/** @returns {Promise<VoiceStartTarget|null>} */
function resolveVoiceStartTarget() {
  if (!state.snapshot) return Promise.resolve(null);
  if (state.snapshot.room.voiceDispatcherAvailable !== false) return Promise.resolve({ kind: "dispatcher" });
  return chooseVoiceStartTarget();
}

/** @returns {Promise<VoiceStartTarget|null>} */
function chooseVoiceStartTarget() {
  if (voiceStartChoicePromise) return voiceStartChoicePromise;
  voiceStartChoicePromise = new Promise((resolve) => {
    let settled = false;
    /** @param {VoiceStartTarget|null} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      voiceStartChoicePromise = null;
      resolve(value);
    };

    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };
    window.addEventListener("keydown", onKey, true);

    const chooseCurrent = () => {
      const snapshot = state.snapshot;
      if (!snapshot) return finish(null);
      finish({ kind: "current", workspaceId: snapshot.workspace.id, roomId: snapshot.room.id });
    };

    const backdrop = h(
      "div",
      {
        class: "modal-backdrop",
        onmousedown: (/** @type {MouseEvent} */ event) => {
          if (event.target === backdrop) finish(null);
        },
      },
      h(
        "section",
        { class: "modal prompt-modal voice-start-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "voice-start-title", tabindex: "-1" },
        h("div", { class: "panel-head" },
          h("h2", { id: "voice-start-title", text: "Start GaiaVoice in…" }),
          h("button", { class: "prompt-btn", type: "button", "aria-label": "Dismiss", onclick: () => finish(null), text: "✕" }),
        ),
        h("p", { class: "prompt-detail", text: "Choose where GaiaVoice should send and read messages." }),
        h(
          "div",
          { class: "prompt-actions" },
          h("button", { class: "prompt-btn", type: "button", onclick: chooseCurrent, text: "This chat" }),
          h("button", { class: "prompt-btn", type: "button", onclick: () => finish({ kind: "new" }), text: "New chat" }),
        ),
      ),
    );
    document.body.append(backdrop);
    /** @type {HTMLElement|null} */ (backdrop.querySelector(".voice-start-dialog"))?.focus();
  });
  return voiceStartChoicePromise;
}

export function stopVoiceControl() {
  const current = session;
  session = null;
  state.voiceControl.enabled = false;
  state.voiceControl.level = 0;
  pendingConfirm = null;
  voiceSessionTarget = null;
  voiceSessionStartedAtMs = 0;
  voiceSessionFollowsCurrent = false;
  voiceSessionUsesDispatcher = false;
  transcriptMerger.cancel();
  closeVoiceSessionEvents();
  void cancelVoiceSpeechBackend();
  cancelSpeech();
  spokenVoiceEventKeys.clear();
  voiceReadoutStates.clear();
  if (current) {
    current.stopping = true;
    if (current.rafId) cancelAnimationFrame(current.rafId);
    finishSegment(current, true);
    for (const track of current.stream.getTracks()) track.stop();
    void current.audioCtx?.close().catch(() => {});
  }
  updateVoiceControlPhase();
}

/** @param {VoiceControlSession} current */
function startAnalyser(current) {
  try {
    const AudioCtor = /** @type {typeof AudioContext|undefined} */ (window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext);
    if (!AudioCtor) return;
    current.audioCtx = new AudioCtor();
    const source = current.audioCtx.createMediaStreamSource(current.stream);
    current.analyser = current.audioCtx.createAnalyser();
    current.analyser.fftSize = 1024;
    current.analyser.smoothingTimeConstant = 0.18;
    current.analyserData = new Uint8Array(new ArrayBuffer(current.analyser.fftSize));
    source.connect(current.analyser);
    tickAnalyser(current);
  } catch {
    // Recording still works in browsers that allow MediaRecorder but not the
    // analyser. Without VAD there is no safe utterance boundary, so stop loudly.
    setError(new Error("GaiaVoice needs microphone level analysis"));
    stopVoiceControl();
  }
}

/** @param {VoiceControlSession} current */
function tickAnalyser(current) {
  if (session !== current || current.stopping || !current.analyser || !current.analyserData) return;
  current.analyser.getByteTimeDomainData(current.analyserData);
  const level = rmsLevel(current.analyserData);
  state.voiceControl.level = level;

  const now = Date.now();
  const speakAt = Math.max(current.noiseFloor * SPEAK_RATIO, current.noiseFloor + SPEAK_MARGIN);
  if (speaking) {
    const barge = observeBargeLevel(bargeWatch, level, speakAt, now);
    if (barge.barging) void bargeIn(current, now);
    current.rafId = requestAnimationFrame(() => tickAnalyser(current));
    return;
  }
  bargeWatch = createBargeWatchState();
  // Ambient self-heal: the true floor is the minimum level of any recent
  // window — even mid-segment. If the mic's auto-gain ramped AFTER initial
  // calibration, the floor sits below real ambient, the gate never releases,
  // and every utterance rides to the 10s cap (huge latency + silence clips).
  // Adopting the window min repairs that within ~1.5s.
  current.blockFrames += 1;
  current.blockMin = Math.min(current.blockMin, level);
  if (current.blockFrames >= AMBIENT_BLOCK_FRAMES) {
    if (current.calibrationFrames >= CALIBRATION_FRAMES && current.blockMin > current.noiseFloor * AMBIENT_RAISE_RATIO) {
      current.noiseFloor = current.blockMin;
    }
    current.blockFrames = 0;
    current.blockMin = Infinity;
  }
  // Calibration: the first frames define this room's ambient floor. No
  // segments may start until the floor is real.
  if (current.calibrationFrames < CALIBRATION_FRAMES) {
    current.calibrationFrames += 1;
    current.noiseFloor = current.noiseFloor === 0 ? level : current.noiseFloor * 0.85 + level * 0.15;
    current.rafId = requestAnimationFrame(() => tickAnalyser(current));
    return;
  }
  const releaseAt = Math.max(current.noiseFloor * RELEASE_RATIO, current.noiseFloor + SPEAK_MARGIN * 0.5);
  const hearsSpeech = current.segment ? level >= releaseAt : level >= speakAt;
  if (!hearsSpeech && !current.segment) {
    // Only quiet frames outside segments feed the floor, so speech never
    // raises its own bar.
    current.noiseFloor = Math.max(0.001, current.noiseFloor * (1 - NOISE_FLOOR_EMA) + level * NOISE_FLOOR_EMA);
  }
  if (hearsSpeech) {
    if (!current.segment && !current.segmentStopping) startSegment(current, now);
    if (current.segment) {
      current.segment.lastSpeechAtMs = now;
      current.segment.peak = Math.max(current.segment.peak, level);
      current.segment.voiceFrames += 1;
    }
  } else if (current.segment && now - current.segment.lastSpeechAtMs >= SILENCE_MS) {
    finishSegment(current, false);
  }
  if (current.segment && now - current.segment.startedAtMs >= MAX_UTTERANCE_MS) {
    finishSegment(current, false, true);
  }

  current.rafId = requestAnimationFrame(() => tickAnalyser(current));
}

/** @param {Uint8Array} data */
function rmsLevel(data) {
  let sum = 0;
  for (const sample of data) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, data.length)) * 4.8);
}

/** @param {VoiceControlSession} current @param {number} now */
function startSegment(current, now) {
  if (current.segment || current.stopping) return;
  const mimeType = pickMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(current.stream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    setError(error);
    stopVoiceControl();
    return;
  }
  const segment = /** @type {Segment} */ ({
    recorder,
    chunks: [],
    startedAtMs: now,
    lastSpeechAtMs: now,
    peak: 0,
    voiceFrames: 0,
    discard: false,
    continuation: false,
  });
  transcriptMerger.segmentStarted();
  current.segment = segment;
  recorder.ondataavailable = (event) => {
    if (event.data?.size) segment.chunks.push(event.data);
  };
  recorder.onstop = () => {
    current.segmentStopping = false;
    void completeSegment(segment);
  };
  try {
    recorder.start(250);
  } catch (error) {
    current.segment = null;
    setError(error);
  }
}

/** @param {VoiceControlSession} current @param {boolean} discard @param {boolean} [continuation] */
function finishSegment(current, discard, continuation = false) {
  const segment = current.segment;
  if (!segment) return;
  current.segment = null;
  current.segmentStopping = true;
  segment.discard = discard;
  segment.continuation = continuation;
  try {
    if (segment.recorder.state !== "inactive") {
      segment.recorder.requestData();
      segment.recorder.stop();
    } else {
      current.segmentStopping = false;
    }
  } catch {
    segment.discard = true;
    current.segmentStopping = false;
  }
}

/** @param {Segment} segment */
async function completeSegment(segment) {
  const mimeType = segment.recorder.mimeType || segment.chunks[0]?.type || "audio/webm";
  const blob = segment.chunks.length ? new Blob(segment.chunks, { type: mimeType }) : null;
  const durationMs = Date.now() - segment.startedAtMs;
  if (
    segment.discard ||
    !blob ||
    blob.size < MIN_CHUNK_BYTES ||
    durationMs < MIN_UTTERANCE_MS ||
    segment.voiceFrames < MIN_VOICE_FRAMES
  ) {
    return;
  }
  enqueueTranscription(blob, segment.continuation);
}

/** @param {Blob} blob @param {boolean} continuation */
function enqueueTranscription(blob, continuation) {
  transcriptionTail = transcriptionTail.catch(() => undefined).then(() => transcribeAndRoute(blob, continuation));
}

/** @param {Blob} blob @param {boolean} continuation */
async function transcribeAndRoute(blob, continuation) {
  activeTranscriptions += 1;
  updateVoiceControlPhase();
  try {
    const text = await postTranscribe(blob);
    if (!text || !state.voiceControl.enabled) return;
    state.voiceControl.pulse = Date.now();
    markDirty("panel");
    await routeTranscribedVoiceText(text, continuation);
  } finally {
    activeTranscriptions = Math.max(0, activeTranscriptions - 1);
    updateVoiceControlPhase();
  }
}

/** @param {Blob} blob @returns {Promise<string>} */
async function postTranscribe(blob) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS) : 0;
  try {
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "content-type": blob.type || "application/octet-stream" },
      body: blob,
      signal: controller?.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(data.error ?? `GaiaVoice transcription failed: ${response.status}`);
      if (/no speech detected/i.test(message)) {
        // A silence-only segment is normal gate noise, not a failure worth a
        // spoken announcement — console row only.
        vcLog("heard", "(silence — nothing transcribed)");
        return "";
      }
      vcLog("error", message, true);
      maybeSpeakFailure();
      setError(new Error(message));
      return "";
    }
    return String(data.text ?? "").trim();
  } catch (error) {
    if (!isAbortError(error)) {
      vcLog("error", "transcription failed", true);
      maybeSpeakFailure();
      setError(error);
    }
    return "";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let lastFailureSpokenAt = 0;

/** Speak "transcription failed" at most once per 30s — a stuck gate can emit
 * failures back-to-back and the voice must not nag. */
function maybeSpeakFailure() {
  const now = Date.now();
  if (now - lastFailureSpokenAt < 30_000) return;
  lastFailureSpokenAt = now;
  void speak("transcription failed");
}

/** @param {unknown} error */
function isAbortError(error) {
  return !!error && typeof error === "object" && "name" in error && error.name === "AbortError";
}

function refreshSpeaking() {
  speaking = activeSpeechRequests > 0 || readoutHolds > 0;
}

function cancelSpeech() {
  speechSeq += 1;
  for (const controller of speechControllers) controller.abort();
  speechControllers.clear();
  activeSpeechRequests = 0;
  readoutHolds = 0;
  markQueuedReadoutsStopped();
  refreshSpeaking();
  speechTail = Promise.resolve();
  updateVoiceControlPhase();
}

async function cancelVoiceSpeechBackend() {
  try {
    await fetch("/api/voice/speak/cancel", { method: "POST", body: "{}" });
  } catch {
    // Local abort still protects the mic; backend cancel is best-effort.
  }
}

function markQueuedReadoutsStopped() {
  for (const [key, readout] of voiceReadoutStates) {
    stopVoiceReadoutStream(readout);
    spokenVoiceEventKeys.add(key);
  }
}

/** @param {VoiceControlSession} current @param {number} now */
async function bargeIn(current, now) {
  if (bargeInFlight || !state.voiceControl.enabled) return;
  bargeInFlight = true;
  vcLog("action", "barge-in — stopped readout", true);
  void cancelVoiceSpeechBackend();
  cancelSpeech();
  const startCapture = () => {
    if (session !== current || current.stopping || current.segment) return;
    current.segmentStopping = false;
    startSegment(current, Date.now());
  };
  startCapture();
  if (!current.segment) window.setTimeout(startCapture, Math.max(0, now + 50 - Date.now()));
  bargeWatch = createBargeWatchState();
  bargeInFlight = false;
}

/** @param {string} text @returns {Promise<void>} */
async function speak(text) {
  const utterance = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 500).trim();
  if (!utterance || !state.voiceControl.enabled) return;
  const seq = speechSeq;
  const task = speechTail.catch(() => undefined).then(async () => {
    if (seq !== speechSeq || !state.voiceControl.enabled) return;
    if (session?.segment) finishSegment(session, true);
    const controller = new AbortController();
    speechControllers.add(controller);
    activeSpeechRequests += 1;
    refreshSpeaking();
    updateVoiceControlPhase();
    try {
      const response = await fetch("/api/voice/speak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: utterance }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && state.voiceControl.enabled) setError(new Error(String(data.error ?? `voice speech failed: ${response.status}`)));
    } catch (error) {
      if (!isAbortError(error) && state.voiceControl.enabled) setError(error);
    } finally {
      speechControllers.delete(controller);
      activeSpeechRequests = Math.max(0, activeSpeechRequests - 1);
      refreshSpeaking();
      updateVoiceControlPhase();
    }
  });
  speechTail = task.catch(() => undefined);
  await task;
}

/** @param {string[]} chunks @returns {Promise<void>} */
async function speakVoiceReplyChunks(chunks) {
  if (!chunks.length || !state.voiceControl.enabled) return;
  const seq = speechSeq;
  readoutHolds += 1;
  refreshSpeaking();
  updateVoiceControlPhase();
  try {
    for (const chunk of chunks) {
      if (seq !== speechSeq || !state.voiceControl.enabled) return;
      await speak(chunk);
    }
  } finally {
    readoutHolds = Math.max(0, readoutHolds - 1);
    refreshSpeaking();
    updateVoiceControlPhase();
  }
}

/** @param {import("./types.js").Task} _task */
function rememberVoiceTask(_task) {
  // Readout is now session-room scoped, not voice-task scoped.
}

/** @param {{ workspaceId: string, roomId: string, taskId: string, eventId: string }} _scope */
export function noteVoiceLiveTurn(_scope) {
  // Live-turn ids are no longer enough: readout follows text deltas directly.
}

/** @param {{ workspaceId: string, roomId: string, eventId: string, agentId: string, delta: string }} payload */
export function noteVoiceTextDelta(payload) {
  if (!state.voiceControl.enabled || !voiceSessionTarget) return;
  if (payload.workspaceId !== voiceSessionTarget.workspaceId || payload.roomId !== voiceSessionTarget.roomId) return;
  if (!payload.eventId || payload.agentId === "user" || payload.agentId === "system") return;
  const key = voiceReadoutEventKey(payload.workspaceId, payload.roomId, payload.eventId);
  if (spokenVoiceEventKeys.has(key)) return;
  vcAppendReply(key, payload.agentId, payload.delta);
  const readout = voiceReadoutStates.get(key) ?? createVoiceStreamReadoutState();
  voiceReadoutStates.set(key, readout);
  const chunks = appendVoiceReadoutDelta(readout, payload.delta);
  if (VOICE_REPLY_READOUT && chunks.length) void speakVoiceReplyChunks(chunks);
}

/** @param {{ workspaceId: string, roomId: string, event: import("./types.js").RoomEvent }} payload */
export function noteVoiceRoomEvent(payload) {
  if (!shouldReadVoiceRoomEvent(payload, voiceSessionTarget, voiceSessionStartedAtMs, spokenVoiceEventKeys)) return;
  const key = voiceReadoutEventKey(payload.workspaceId, payload.roomId, payload.event.id);
  vcSetReply(key, payload.event.author, payload.event.text);
  const readout = voiceReadoutStates.get(key) ?? createVoiceStreamReadoutState();
  voiceReadoutStates.set(key, readout);
  if (!readout.pending && readout.spokenChars === 0) appendVoiceReadoutDelta(readout, payload.event.text);
  const chunks = finalizeVoiceReadoutStream(readout);
  spokenVoiceEventKeys.add(key);
  if (VOICE_REPLY_READOUT && chunks.length) void speakVoiceReplyChunks(chunks);
}

/** @param {import("./types.js").Snapshot} snapshot */
export function noteVoiceSnapshot(snapshot) {
  const workspaceId = snapshot.workspace.id;
  const roomId = snapshot.room.id;
  if (state.voiceControl.enabled && voiceSessionFollowsCurrent) voiceSessionTarget = { workspaceId, roomId };
  for (const event of snapshot.room.events) noteVoiceRoomEvent({ workspaceId, roomId, event });
}

function closeVoiceSessionEvents() {
  voiceSessionEventSource?.close();
  voiceSessionEventSource = null;
}

function connectVoiceSessionEvents() {
  closeVoiceSessionEvents();
  if (!voiceSessionTarget || voiceSessionFollowsCurrent) return;
  const params = new URLSearchParams({ workspaceId: voiceSessionTarget.workspaceId, roomId: voiceSessionTarget.roomId });
  const source = openEventChannel(`/api/events?${params}`);
  voiceSessionEventSource = source;
  source.addEventListener("text-delta", (event) => {
    if (!voiceSessionTarget) return;
    const payload = JSON.parse(event.data);
    noteVoiceTextDelta({
      workspaceId: voiceSessionTarget.workspaceId,
      roomId: String(payload.roomId ?? voiceSessionTarget.roomId),
      eventId: String(payload.eventId ?? ""),
      agentId: String(payload.agentId ?? ""),
      delta: String(payload.delta ?? ""),
    });
  });
  source.addEventListener("room-event", (event) => {
    if (!voiceSessionTarget) return;
    const payload = JSON.parse(event.data);
    noteVoiceRoomEvent({ workspaceId: voiceSessionTarget.workspaceId, roomId: String(payload.roomId ?? voiceSessionTarget.roomId), event: payload.event });
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("gaia:live-turn", (event) => noteVoiceLiveTurn(/** @type {CustomEvent} */ (event).detail));
  window.addEventListener("gaia:text-delta", (event) => noteVoiceTextDelta(/** @type {CustomEvent} */ (event).detail));
  window.addEventListener("gaia:room-event", (event) => noteVoiceRoomEvent(/** @type {CustomEvent} */ (event).detail));
  window.addEventListener("gaia:snapshot", (event) => noteVoiceSnapshot(/** @type {CustomEvent} */ (event).detail.snapshot));
}

/** @param {string} label @returns {string} */
function spokenAckForLabel(label) {
  const open = /^open ([a-z]\d{2,3})$/i.exec(label);
  if (open) return `opening ${open[1].toUpperCase()}`;
  const normalized = label.toLowerCase();
  if (normalized === "gaiavoice off") return "stopped";
  if (normalized.includes("new chat")) return "new chat";
  if (normalized.includes("cancel")) return "stopped";
  if (normalized.includes("close")) return "closed";
  return "";
}

// -- Voice console log ------------------------------------------------------
// Every utterance renders beneath the orb: what was HEARD, what was DONE, and
// text QUESTIONS the mode asks back (answered by voice). This is the
// correction surface — misheard text is visible before it does damage.

const VC_LOG_CAP = 32;

/** @param {"heard"|"action"|"ask"|"error"|"reply"} kind @param {string} text @param {boolean} [spoken] @param {{ key?: string, author?: string }} [meta] */
function vcLog(kind, text, spoken = false, meta = {}) {
  state.voiceControl.log.push({ kind, text, ts: Date.now(), ...(spoken ? { spoken: true } : {}), ...(meta.key ? { key: meta.key } : {}), ...(meta.author ? { author: meta.author } : {}) });
  trimVoiceLog();
  markDirty("panel");
}

function trimVoiceLog() {
  if (state.voiceControl.log.length > VC_LOG_CAP) state.voiceControl.log.splice(0, state.voiceControl.log.length - VC_LOG_CAP);
}

/** @param {string} key @param {string} author @param {string} delta */
function vcAppendReply(key, author, delta) {
  if (!delta) return;
  const existing = state.voiceControl.log.find((entry) => entry.kind === "reply" && entry.key === key);
  if (existing) {
    existing.text = `${existing.text}${delta}`.slice(-2400);
    existing.ts = Date.now();
    if (author) existing.author = author;
  } else {
    state.voiceControl.log.push({ kind: "reply", text: delta, ts: Date.now(), key, ...(author ? { author } : {}) });
  }
  trimVoiceLog();
  markDirty("panel");
}

/** @param {string} key @param {string} author @param {string} text */
function vcSetReply(key, author, text) {
  if (!text.trim()) return;
  const existing = state.voiceControl.log.find((entry) => entry.kind === "reply" && entry.key === key);
  if (existing) {
    existing.text = text;
    existing.ts = Date.now();
    if (author) existing.author = author;
  } else {
    state.voiceControl.log.push({ kind: "reply", text, ts: Date.now(), key, ...(author ? { author } : {}) });
  }
  trimVoiceLog();
  markDirty("panel");
}

/** @type {{ question: string, run: () => void | Promise<void> } | null} */
let pendingConfirm = null;

// -- Native command table ---------------------------------------------------
// Intermediary commands EXECUTE in the client directly — they never become a
// chat message. Matching is punctuation/case tolerant (Apple dictation adds
// trailing periods + capitalization). Commands with `confirm` ask a text
// question in the console first and wait for a spoken yes/no. Everything
// unmatched goes to the room.

/** @type {{ pattern: RegExp, label: (m: RegExpExecArray) => string, confirm?: boolean, run: (match: RegExpExecArray) => void | Promise<void> }[]} */
const NATIVE_COMMANDS = [
  { pattern: /^(gaiavoice (off|stop)|voice control off|stop listening)$/i, label: () => "GaiaVoice off", run: () => stopVoiceControl() },
  { pattern: /^open ([a-z])\s?(\d{2,3})$/i, label: (m) => `open ${m[1].toUpperCase()}${m[2]}`, run: (m) => routeRoomRef(`${m[1]}${m[2]}`) },
  { pattern: /^(new|create) (chat|room)$/i, label: () => "OPEN a new chat", confirm: true, run: async () => { await addRoom(); } },
  { pattern: /^(stop|cancel)( turn| that| the turn)?$/i, label: () => "CANCEL the running turn", confirm: true, run: () => cancelActiveTask() },
  {
    pattern: /^close (this )?(chat|room|tab)$/i,
    label: () => "CLOSE this chat",
    confirm: true,
    run: () => { const id = state.snapshot?.room?.id; if (id) return closeRoomTab(id); },
  },
];

const YES_RE = /^(yes|yeah|yep|do it|confirm|go ahead|sure)$/i;
const NO_RE = /^(no|nope|cancel|never mind|nevermind|stop)$/i;
const READOUT_STOP_RE = /^(stop|cancel)$/i;

/** @param {string} rawText @param {boolean} continuation */
async function routeTranscribedVoiceText(rawText, continuation) {
  const text = normalizedVoiceControlText(rawText);
  if (!text) {
    transcriptMerger.accept("", { mustMergeNext: continuation });
    return;
  }
  if (isInstantVoiceControlText(text)) {
    transcriptMerger.cancel();
    await routeVoiceControlText(rawText);
    return;
  }
  transcriptMerger.accept(rawText.trim(), { mustMergeNext: continuation });
}

/** @param {string} rawText @returns {string} */
function normalizedVoiceControlText(rawText) {
  return rawText.trim().replace(/[.,!?\u3002]+$/, "").trim();
}

/** @param {string} text @returns {boolean} */
function isInstantVoiceControlText(text) {
  if (READOUT_STOP_RE.test(text) && readoutHolds > 0) return true;
  if (pendingConfirm) return true;
  return NATIVE_COMMANDS.some((command) => command.pattern.test(text));
}

async function resolveCurrentVoiceRoom() {
  const workspaceId = state.snapshot?.workspace.id;
  if (!workspaceId) return null;
  const body = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/voice/room`);
  const roomId = String(body?.roomId ?? body?.room?.id ?? "");
  return roomId ? { workspaceId: String(body?.workspaceId ?? workspaceId), roomId } : null;
}

/** Background send into the invisible voice room — never selects/transports
 * the view. The server's voice seam may rotate the room mid-send (>20% ctx);
 * the response's roomId is the truth, so the session target and its event
 * channel follow it. @param {string} text @returns {Promise<boolean>} */
async function sendVoiceSessionMessage(text) {
  if (!voiceSessionTarget || !text.trim()) return false;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(voiceSessionTarget.workspaceId)}/rooms/${encodeURIComponent(voiceSessionTarget.roomId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, voice: true }),
    });
    if (body.task) rememberVoiceTask(body.task);
    const rotatedRoomId = String(body?.roomId ?? "");
    if (rotatedRoomId && rotatedRoomId !== voiceSessionTarget.roomId) {
      voiceSessionTarget = { workspaceId: voiceSessionTarget.workspaceId, roomId: rotatedRoomId };
      connectVoiceSessionEvents();
    }
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

/** @param {string} rawText */
async function routeVoiceControlText(rawText) {
  const text = normalizedVoiceControlText(rawText);
  if (!text) return;
  vcLog("heard", text);
  if (READOUT_STOP_RE.test(text) && readoutHolds > 0) {
    void cancelVoiceSpeechBackend();
    cancelSpeech();
    vcLog("action", "stopped readout", true);
    return;
  }
  if (pendingConfirm) {
    const pending = pendingConfirm;
    if (YES_RE.test(text)) {
      pendingConfirm = null;
      vcLog("action", `confirmed — ${pending.question}`, true);
      void speak(spokenAckForLabel(pending.question) || "confirmed");
      await pending.run();
      return;
    }
    if (NO_RE.test(text)) {
      pendingConfirm = null;
      vcLog("action", `dropped — ${pending.question}`, true);
      void speak("cancelled");
      return;
    }
    pendingConfirm = null;
    vcLog("action", `question dropped (no yes/no) — ${pending.question}`);
    // fall through: treat this utterance normally
  }
  for (const command of NATIVE_COMMANDS) {
    const match = command.pattern.exec(text);
    if (match) {
      const label = command.label(match);
      if (command.confirm) {
        pendingConfirm = { question: label, run: () => command.run(match) };
        const question = `should I ${label}? (yes/no)`;
        vcLog("ask", question, true);
        void speak(question);
        return;
      }
      const ack = spokenAckForLabel(label);
      vcLog("action", label, !!ack);
      if (ack && label === "GaiaVoice off") await speak(ack);
      else if (ack) void speak(ack);
      await command.run(match);
      return;
    }
  }
  vcLog("action", voiceSessionUsesDispatcher ? "→ voice dispatcher" : "→ @gaia");
  // Dispatcher sessions send plain speech; the server's voice-dispatch seam
  // resolves Hermes / aliases / stickiness. Missing-dispatcher fallback keeps
  // the pre-Hermes @gaia-addressed behavior.
  const outbound = voiceSessionUsesDispatcher ? rawText.trim() : `@gaia ${rawText.trim()}`;
  if (voiceSessionFollowsCurrent) await sendMessage(outbound, [], { voice: true, onTask: rememberVoiceTask });
  else await sendVoiceSessionMessage(outbound);
}

/** @param {string} ref */
async function routeRoomRef(ref) {
  const workspaceId = state.snapshot?.workspace.id;
  if (!workspaceId) return;
  try {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/rooms/resolve?ref=${encodeURIComponent(ref)}`);
    if (!response.ok) {
      vcLog("error", `unknown chat code ${ref.toUpperCase()}`, true);
      void speak("unknown chat code");
      setError("unknown chat code");
      return;
    }
    const data = await response.json().catch(() => ({}));
    const roomId = resolvedRoomId(data);
    const targetWorkspaceId = resolvedWorkspaceId(data) || workspaceId;
    if (!roomId) {
      vcLog("error", `unknown chat code ${ref.toUpperCase()}`, true);
      void speak("unknown chat code");
      setError("unknown chat code");
      return;
    }
    await selectRoom(targetWorkspaceId, roomId, { voiceNavigation: true });
    voiceSessionTarget = { workspaceId: targetWorkspaceId, roomId };
    voiceSessionFollowsCurrent = true;
    voiceSessionUsesDispatcher = false;
    closeVoiceSessionEvents();
  } catch {
    vcLog("error", `unknown chat code ${ref.toUpperCase()}`, true);
    void speak("unknown chat code");
    setError("unknown chat code");
  }
}

/** @param {any} data @returns {string} */
function resolvedRoomId(data) {
  return String(data?.roomId ?? data?.room?.id ?? data?.id ?? data?.snapshot?.room?.id ?? "");
}

/** @param {any} data @returns {string} */
function resolvedWorkspaceId(data) {
  return String(data?.workspaceId ?? data?.workspace?.id ?? data?.snapshot?.workspace?.id ?? "");
}

function updateVoiceControlPhase() {
  const next = state.voiceControl.enabled ? (activeTranscriptions > 0 || activeSpeechRequests > 0 ? "processing" : "listening") : "idle";
  const changed = state.voiceControl.phase !== next;
  state.voiceControl.phase = next;
  if (changed) markDirty("composer", "panel");
}

/** @returns {string} */
function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

/** @returns {HTMLElement|null} */
export function VoiceControlOrb() {
  if (!state.voiceControl.enabled) return null;
  const phase = state.voiceControl.phase;
  const canvas = /** @type {HTMLCanvasElement} */ (h("canvas", { class: "voice-control-orb-canvas", width: "320", height: "168" }));
  const node = h(
    "div",
    { class: `voice-control-orb ${phase}`, title: "GaiaVoice — audio reactive" },
    canvas,
    h("div", { class: "voice-control-orb-label" }, h("strong", { text: "GaiaVoice" }), h("span", { text: phase })),
  );
  queueMicrotask(() => startOrb(canvas));
  return node;
}

/** Compact GaiaVoice transcript under the splat: human commands + live agent replies, newest last. */
export function VoiceControlConsole() {
  if (!state.voiceControl.enabled) return null;
  const rows = state.voiceControl.log.slice(-14).map((entry) => {
    const author = entry.kind === "heard" ? "you" : entry.kind === "reply" ? `@${entry.author || "hermes"}` : entry.kind;
    return h("div", { class: `voice-console-row ${entry.kind}` },
      h("span", { class: "voice-console-kind", text: entry.spoken ? "🔊" : entry.kind === "heard" ? "you" : entry.kind === "reply" ? "↳" : entry.kind === "ask" ? "?" : entry.kind === "error" ? "⚠" : "→" }),
      h("span", { class: "voice-console-author", text: author }),
      h("span", { class: "voice-console-text", text: entry.text }),
    );
  });
  const node = h("div", { class: "voice-control-console" },
    h("div", { class: "voice-console-header" }, h("strong", { text: "Hermes" }), h("span", { text: " · GaiaVoice transcript" })),
    rows.length ? rows : [h("div", { class: "voice-console-row empty", text: "say something — Hermes will show what he hears" })],
  );
  queueMicrotask(() => { node.scrollTop = node.scrollHeight; });
  return node;
}

/** @param {HTMLCanvasElement} canvas */
function startOrb(canvas) {
  if (!canvas.isConnected) return;
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) return;
  const ctx = maybeCtx;
  /** @type {VoiceOrbPoint[]} */
  let points = [];
  const fallback = window.setTimeout(() => {
    if (!points.length) points = orbPoints();
  }, 1200);
  void hermesSplatPoints().then((loaded) => {
    window.clearTimeout(fallback);
    points = loaded;
  }).catch(() => {
    window.clearTimeout(fallback);
    points = orbPoints();
  });
  const startedAt = performance.now();

  /** @param {number} now */
  function draw(now) {
    if (!canvas.isConnected || !state.voiceControl.enabled) return;
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
    const level = state.voiceControl.level;
    const pulseAge = state.voiceControl.pulse ? Math.max(0, (now - state.voiceControl.pulse) / 1000) : 99;
    const pulse = Math.exp(-pulseAge * 5.2);
    ctx.clearRect(0, 0, w, hgt);
    const glow = ctx.createRadialGradient(w / 2, hgt / 2, 4, w / 2, hgt / 2, Math.max(w, hgt) * 0.48);
    glow.addColorStop(0, `rgba(224,198,114,${0.12 + level * 0.16 + pulse * 0.12})`);
    glow.addColorStop(0.46, `rgba(126,88,42,${0.06 + level * 0.10})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hgt);

    if (!points.length) {
      requestAnimationFrame(draw);
      return;
    }
    for (const p of points) {
      if (p.kind === "hermes") drawHermesPoint(ctx, p, w, hgt, t, level, pulse);
      else drawSpherePoint(ctx, p, w, hgt, t, level, pulse);
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
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

/** @param {CanvasRenderingContext2D} ctx @param {HermesOrbPoint} p @param {number} w @param {number} hgt @param {number} t @param {number} level @param {number} pulse */
function drawHermesPoint(ctx, p, w, hgt, t, level, pulse) {
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
  const size = (0.30 + p.size * 0.55 + level * 0.55 + pulse * 0.4) * (1 + depth * 0.55);
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

window.addEventListener("pagehide", () => stopVoiceControl());
