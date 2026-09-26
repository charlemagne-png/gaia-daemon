// Bridge between the in-app GaiaVoice panel and the torn-off full-screen voice
// window (voice.html). The main window OWNS the mic; it publishes the live orb
// inputs (level/pulse/phase), the current draft, and the session room over one
// BroadcastChannel so the separate window can animate Hermes in sync, mirror
// the pending draft, and follow room rotation. The window posts commands back
// (send / clear) on the same channel — the main window is the only place the
// mic + transcript merger live, so every action routes home.
import { isNative, openWebWindow } from "./native.js";

export const VOICE_TELEMETRY_CHANNEL = "gaia-voice-telemetry";

/** @typedef {{ workspaceId: string, roomId: string } | null} VoiceTarget */
/** @typedef {{ active: boolean, level: number, pulse: number, phase: string, draft: string, target: VoiceTarget }} VoiceTelemetry */
/** @typedef {"send"|"clear"} VoiceCommand */

/** @type {BroadcastChannel|null} */
let channel = null;
let channelFailed = false;

/** @returns {BroadcastChannel|null} */
function bus() {
  if (channel || channelFailed) return channel;
  if (typeof BroadcastChannel === "undefined") {
    channelFailed = true;
    return null;
  }
  try {
    channel = new BroadcastChannel(VOICE_TELEMETRY_CHANNEL);
  } catch {
    channelFailed = true;
  }
  return channel;
}

/** Push the current orb inputs + draft + target to any listening voice window.
 * Cheap + lossy by design. @param {VoiceTelemetry} telemetry */
export function broadcastVoiceTelemetry(telemetry) {
  const ch = bus();
  if (!ch) return;
  try {
    ch.postMessage({ type: "telemetry", ...telemetry });
  } catch {
    // A closed channel (window torn down) is not worth surfacing.
  }
}

/** @param {(telemetry: VoiceTelemetry) => void} handler @returns {() => void} */
export function subscribeVoiceTelemetry(handler) {
  const ch = bus();
  if (!ch) return () => {};
  /** @param {MessageEvent} event */
  const listener = (event) => {
    const data = /** @type {any} */ (event.data);
    if (data && data.type === "telemetry") handler(data);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}

/** The torn-off window asks the main window to act on the current draft.
 * @param {VoiceCommand} command */
export function sendVoiceCommand(command) {
  const ch = bus();
  if (!ch) return;
  try {
    ch.postMessage({ type: "command", command });
  } catch {
    // No listener (main window gone) — nothing to do.
  }
}

/** @param {(command: VoiceCommand) => void} handler @returns {() => void} */
export function subscribeVoiceCommands(handler) {
  const ch = bus();
  if (!ch) return () => {};
  /** @param {MessageEvent} event */
  const listener = (event) => {
    const data = /** @type {any} */ (event.data);
    if (data && data.type === "command" && (data.command === "send" || data.command === "clear")) handler(data.command);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}

/** Open the full-screen Hermes voice window for the given session room. Uses a
 * native OS window under the GAIA shell, a browser popup otherwise. The window
 * reads ws/room from the query string. @param {VoiceTarget} target */
export function openVoiceWindow(target) {
  const query = target ? `?ws=${encodeURIComponent(target.workspaceId)}&room=${encodeURIComponent(target.roomId)}` : "";
  const url = `/voice.html${query}`;
  if (isNative()) {
    void openWebWindow(new URL(url, location.origin).href);
    return;
  }
  window.open(url, "gaia-voice", "width=1180,height=760");
}
