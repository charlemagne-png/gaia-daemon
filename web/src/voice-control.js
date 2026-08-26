// Continuous voice control: one mic stream, VAD-sliced utterance clips, local
// transcription endpoint, then room-command routing or normal message send.
import { addRoom, cancelActiveTask, closeRoomTab, selectRoom, sendMessage } from "./actions.js";
import { h } from "./dom.js";
import { markDirty, setError } from "./render.js";
import { state } from "./state.js";
import { chunkVoiceReplyText, voiceControlRoomTitle } from "./voice-control-readout.js";
export { chunkVoiceReplyText, sanitizeVoiceReplyText, voiceControlRoomTitle } from "./voice-control-readout.js";

const SILENCE_MS = 800;
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

/**
 * @typedef {Object} Segment
 * @property {MediaRecorder} recorder
 * @property {Blob[]} chunks
 * @property {number} startedAtMs
 * @property {number} lastSpeechAtMs
 * @property {number} peak
 * @property {number} voiceFrames
 * @property {boolean} discard
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
/** @type {{ workspaceId: string, roomId: string } | null} */
let voiceSessionTarget = null;
/** @type {Map<string, { workspaceId: string, roomId: string, eventId?: string }>} */
const pendingVoiceReplies = new Map();

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
    setError(new Error(`You're on a call with @${state.voice.agentId}. Hang up before voice control mode.`));
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

  const room = await addRoom({ title: voiceControlRoomTitle() });
  if (!room) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  voiceSessionTarget = room;

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
  startAnalyser(current);
}

export function stopVoiceControl() {
  const current = session;
  session = null;
  state.voiceControl.enabled = false;
  state.voiceControl.level = 0;
  pendingConfirm = null;
  voiceSessionTarget = null;
  pendingVoiceReplies.clear();
  cancelSpeech();
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
    setError(new Error("voice control needs microphone level analysis"));
    stopVoiceControl();
  }
}

/** @param {VoiceControlSession} current */
function tickAnalyser(current) {
  if (session !== current || current.stopping || !current.analyser || !current.analyserData) return;
  if (speaking) {
    state.voiceControl.level = 0;
    current.rafId = requestAnimationFrame(() => tickAnalyser(current));
    return;
  }
  current.analyser.getByteTimeDomainData(current.analyserData);
  const level = rmsLevel(current.analyserData);
  state.voiceControl.level = level;

  const now = Date.now();
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
  const speakAt = Math.max(current.noiseFloor * SPEAK_RATIO, current.noiseFloor + SPEAK_MARGIN);
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
    finishSegment(current, false);
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
  });
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

/** @param {VoiceControlSession} current @param {boolean} discard */
function finishSegment(current, discard) {
  const segment = current.segment;
  if (!segment) return;
  current.segment = null;
  current.segmentStopping = true;
  segment.discard = discard;
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
  enqueueTranscription(blob);
}

/** @param {Blob} blob */
function enqueueTranscription(blob) {
  transcriptionTail = transcriptionTail.catch(() => undefined).then(() => transcribeAndRoute(blob));
}

/** @param {Blob} blob */
async function transcribeAndRoute(blob) {
  activeTranscriptions += 1;
  updateVoiceControlPhase();
  try {
    const text = await postTranscribe(blob);
    if (!text || !state.voiceControl.enabled) return;
    state.voiceControl.pulse = Date.now();
    markDirty("panel");
    await routeVoiceControlText(text);
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
      const message = String(data.error ?? `voice control transcription failed: ${response.status}`);
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
  refreshSpeaking();
  speechTail = Promise.resolve();
  updateVoiceControlPhase();
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

/** @param {string} text @returns {Promise<void>} */
async function speakVoiceReply(text) {
  const chunks = chunkVoiceReplyText(text);
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

/** @param {import("./types.js").Task} task */
function rememberVoiceTask(task) {
  const snapshot = state.snapshot;
  if (!snapshot || !task?.id) return;
  pendingVoiceReplies.set(task.id, { workspaceId: snapshot.workspace.id, roomId: snapshot.room.id });
}

/** @param {{ workspaceId: string, roomId: string, taskId: string, eventId: string }} scope */
export function noteVoiceLiveTurn(scope) {
  const pending = pendingVoiceReplies.get(scope.taskId);
  if (!pending || pending.workspaceId !== scope.workspaceId || pending.roomId !== scope.roomId) return;
  pending.eventId = scope.eventId;
}

/** @param {{ workspaceId: string, roomId: string, event: import("./types.js").RoomEvent }} payload */
export function noteVoiceRoomEvent(payload) {
  for (const [taskId, pending] of pendingVoiceReplies) {
    if (pending.workspaceId !== payload.workspaceId || pending.roomId !== payload.roomId || pending.eventId !== payload.event.id) continue;
    pendingVoiceReplies.delete(taskId);
    if (payload.event.author !== "user" && payload.event.author !== "system") void speakVoiceReply(payload.event.text);
    return;
  }
}

/** @param {import("./types.js").Snapshot} snapshot */
export function noteVoiceSnapshot(snapshot) {
  const workspaceId = snapshot.workspace.id;
  const roomId = snapshot.room.id;
  if (snapshot.room.liveTurn) {
    noteVoiceLiveTurn({ workspaceId, roomId, taskId: snapshot.room.liveTurn.taskId, eventId: snapshot.room.liveTurn.eventId });
  }
  for (const event of snapshot.room.events) noteVoiceRoomEvent({ workspaceId, roomId, event });
}

if (typeof window !== "undefined") {
  window.addEventListener("gaia:live-turn", (event) => noteVoiceLiveTurn(/** @type {CustomEvent} */ (event).detail));
  window.addEventListener("gaia:room-event", (event) => noteVoiceRoomEvent(/** @type {CustomEvent} */ (event).detail));
  window.addEventListener("gaia:snapshot", (event) => noteVoiceSnapshot(/** @type {CustomEvent} */ (event).detail.snapshot));
}

/** @param {string} label @returns {string} */
function spokenAckForLabel(label) {
  const open = /^open ([a-z]\d{2,3})$/i.exec(label);
  if (open) return `opening ${open[1].toUpperCase()}`;
  const normalized = label.toLowerCase();
  if (normalized === "voice control off") return "stopped";
  if (normalized.includes("new chat")) return "new chat";
  if (normalized.includes("cancel")) return "stopped";
  if (normalized.includes("close")) return "closed";
  return "";
}

// -- Voice console log ------------------------------------------------------
// Every utterance renders beneath the orb: what was HEARD, what was DONE, and
// text QUESTIONS the mode asks back (answered by voice). This is the
// correction surface — misheard text is visible before it does damage.

const VC_LOG_CAP = 24;

/** @param {"heard"|"action"|"ask"|"error"} kind @param {string} text @param {boolean} [spoken] */
function vcLog(kind, text, spoken = false) {
  state.voiceControl.log.push({ kind, text, ts: Date.now(), ...(spoken ? { spoken: true } : {}) });
  if (state.voiceControl.log.length > VC_LOG_CAP) state.voiceControl.log.splice(0, state.voiceControl.log.length - VC_LOG_CAP);
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
  { pattern: /^(voice control off|stop listening)$/i, label: () => "voice control off", run: () => stopVoiceControl() },
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

async function ensureVoiceSessionRoom() {
  if (!voiceSessionTarget || state.snapshot?.room.id === voiceSessionTarget.roomId) return;
  await selectRoom(voiceSessionTarget.workspaceId, voiceSessionTarget.roomId);
}

/** @param {string} rawText */
async function routeVoiceControlText(rawText) {
  const text = rawText.trim().replace(/[.,!?\u3002]+$/, "").trim();
  if (!text) return;
  vcLog("heard", text);
  if (READOUT_STOP_RE.test(text) && readoutHolds > 0) {
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
      if (ack && label === "voice control off") await speak(ack);
      else if (ack) void speak(ack);
      await command.run(match);
      return;
    }
  }
  vcLog("action", "→ @gaia");
  // Gaia is the agent under the voice chat: plain speech is addressed to her
  // in the session room; her reply lands in the transcript as usual.
  await ensureVoiceSessionRoom();
  await sendMessage(`@gaia ${rawText.trim()}`, [], { voice: true, onTask: rememberVoiceTask });
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
    await selectRoom(targetWorkspaceId, roomId);
    voiceSessionTarget = { workspaceId: targetWorkspaceId, roomId };
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
    { class: `voice-control-orb ${phase}`, title: "voice control mode — audio reactive" },
    canvas,
    h("div", { class: "voice-control-orb-label" }, h("strong", { text: "voice control" }), h("span", { text: phase })),
  );
  queueMicrotask(() => startOrb(canvas));
  return node;
}

/** Text console under the orb: heard/done/asked rows, newest last. */
export function VoiceControlConsole() {
  if (!state.voiceControl.enabled) return null;
  const rows = state.voiceControl.log.slice(-8).map((entry) =>
    h("div", { class: `voice-console-row ${entry.kind}` },
      h("span", { class: "voice-console-kind", text: entry.spoken ? "🔊" : entry.kind === "heard" ? "●" : entry.kind === "ask" ? "?" : entry.kind === "error" ? "⚠" : "→" }),
      h("span", { class: "voice-console-text", text: entry.text }),
    ),
  );
  return h("div", { class: "voice-control-console" },
    h("div", { class: "voice-console-header" }, h("strong", { text: "@gaia" }), h("span", { text: " · voice chat" })),
    rows.length ? rows : [h("div", { class: "voice-console-row empty", text: "say something — I'll show what I hear" })],
  );
}

/** @param {HTMLCanvasElement} canvas */
function startOrb(canvas) {
  if (!canvas.isConnected) return;
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) return;
  const ctx = maybeCtx;
  const points = orbPoints();
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
    glow.addColorStop(0, `rgba(122,162,247,${0.20 + level * 0.22 + pulse * 0.18})`);
    glow.addColorStop(0.42, `rgba(187,154,247,${0.10 + level * 0.16})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, hgt);

    const radius = Math.min(w, hgt) * (0.30 + 0.018 * Math.sin(t * 1.6) + level * 0.07 + pulse * 0.05);
    const cx = w / 2;
    const cy = hgt * 0.52;
    const rotY = t * 0.34;
    const rotX = Math.sin(t * 0.27) * 0.34;
    for (const p of points) {
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
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

/** @returns {{x:number,y:number,z:number,seed:number,size:number,audio:number,warm:boolean}[]} */
function orbPoints() {
  /** @type {{x:number,y:number,z:number,seed:number,size:number,audio:number,warm:boolean}[]} */
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
