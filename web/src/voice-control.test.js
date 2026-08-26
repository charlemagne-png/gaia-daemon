// @ts-nocheck — pure helpers + source seam assertions for browser GaiaVoice.
import { expect, test } from "bun:test";
import {
  appendVoiceReadoutDelta,
  chunkVoiceReplyText,
  createBargeWatchState,
  createVoiceStreamReadoutState,
  finalizeVoiceReadoutStream,
  observeBargeLevel,
  sanitizeVoiceReplyText,
  shouldReadVoiceRoomEvent,
  voiceControlRoomTitle,
} from "./voice-control-readout.js";

const voiceSource = await Bun.file(new URL("./voice-control.js", import.meta.url)).text();
const eventsSource = await Bun.file(new URL("./events.js", import.meta.url)).text();
const actionsSource = await Bun.file(new URL("./actions.js", import.meta.url)).text();

test("sanitizeVoiceReplyText strips markdown, code fences, links, and emoji", () => {
  const sample = `# Hello **Charles** 🚀\n\nSee [the plan](https://example.com/path) and https://noise.test.\n\n\`inline\` stays readable.\n\n\`\`\`js\nconsole.log("skip me")\n\`\`\``;
  expect(sanitizeVoiceReplyText(sample)).toBe("Hello Charles See the plan and inline stays readable.");
});

test("chunkVoiceReplyText chunks 1400 chars into <=449 pieces with truncation notice", () => {
  const chunks = chunkVoiceReplyText(`${"word ".repeat(280)}tail`);
  expect(chunks.at(-1)).toBe("…more in the chat");
  expect(chunks.every((chunk) => chunk.length <= 449)).toBe(true);
  expect(chunks.slice(0, -1).join(" ").length).toBeLessThanOrEqual(1210);
});

test("GaiaVoice toggle-on seam enters hidden dispatcher session without start dialog", () => {
  expect(voiceSource).toContain("const target = await resolveVoiceStartTarget();");
  expect(voiceSource.indexOf("const target = await resolveVoiceStartTarget();")).toBeLessThan(voiceSource.indexOf("navigator.mediaDevices.getUserMedia"));
  expect(voiceSource).toContain('state.snapshot.room.voiceDispatcherAvailable !== false');
  expect(voiceSource).toContain('return Promise.resolve({ kind: "dispatcher" });');
  expect(voiceSource).toContain('await createRoom({ title: voiceControlRoomTitle(), voiceSession: true })');
  expect(voiceSource).toContain('voiceSessionUsesDispatcher = target.kind === "dispatcher";');
  expect(voiceSource).toContain('const outbound = voiceSessionUsesDispatcher ? rawText.trim() : `@gaia ${rawText.trim()}`;');
});

test("GaiaVoice missing-dispatcher fallback keeps the in-app start dialog before mic access", () => {
  expect(voiceSource).toContain("return chooseVoiceStartTarget();");
  expect(voiceSource.indexOf("const target = await resolveVoiceStartTarget();")).toBeLessThan(voiceSource.indexOf("navigator.mediaDevices.getUserMedia"));
  expect(voiceSource).toContain('class: "modal prompt-modal voice-start-dialog"');
  expect(voiceSource).toContain('role: "dialog", "aria-modal": "true"');
  expect(voiceSource).toContain('text: "Start GaiaVoice in…"');
  expect(voiceSource).toContain('if (event.key === "Escape")');
  expect(voiceSource).not.toContain('if (event.key === "Enter")');
  expect(voiceSource).toContain('onclick: () => finish(null), text: "✕"');
  expect(voiceSource).toContain('backdrop.querySelector(".voice-start-dialog")');
});

test("GaiaVoice fallback start choice: this chat targets current room and creates no room", () => {
  expect(voiceSource).toContain('finish({ kind: "current", workspaceId: snapshot.workspace.id, roomId: snapshot.room.id })');
  expect(voiceSource).toContain('const room = target.kind === "current" ? null : target.kind === "dispatcher" ? await resolveCurrentVoiceRoom() : await createRoom({ title: voiceControlRoomTitle(), voiceSession: true });');
  expect(voiceSource).toContain('voiceSessionTarget = target.kind === "current" ? { workspaceId: target.workspaceId, roomId: target.roomId } : room;');
  expect(voiceSource).toContain('voiceSessionFollowsCurrent = target.kind === "current";');
});

test("GaiaVoice fallback start choice: new chat creates a hidden titled session", () => {
  expect(voiceControlRoomTitle(new Date(2026, 7, 26, 8, 50))).toBe("gaiavoice — 08/26 08:50");
  expect(voiceSource).toContain('onclick: () => finish({ kind: "new" }), text: "New chat"');
  expect(voiceSource).toContain('await createRoom({ title: voiceControlRoomTitle(), voiceSession: true })');
  expect(actionsSource).toContain('/rooms/${encodeURIComponent(roomId)}/create');
  expect(actionsSource).toContain('...(opts.voiceSession ? { voiceSession: true } : {})');
  expect(actionsSource).toContain("applyRoomsPayload(snapshot.workspace.id, created.rooms)");
  expect(actionsSource).toContain("applyRoomsPayload(snapshot.workspace.id, titled.rooms)");
  expect(actionsSource).toContain('Create a room without selecting/opening it');
  expect(voiceSource).toContain("if (state.voiceControl.enabled && voiceSessionFollowsCurrent) voiceSessionTarget = { workspaceId, roomId }");
});

test("GaiaVoice fallback start dismiss keeps session off with no room or mic", () => {
  expect(voiceSource).toContain("const target = await resolveVoiceStartTarget();\n  if (!target || state.voiceControl.enabled) return;");
  expect(voiceSource.indexOf("if (!target || state.voiceControl.enabled) return;")).toBeLessThan(voiceSource.indexOf("navigator.mediaDevices.getUserMedia"));
  expect(voiceSource.indexOf("if (!target || state.voiceControl.enabled) return;")).toBeLessThan(voiceSource.indexOf("await createRoom({ title: voiceControlRoomTitle()"));
  expect(voiceSource).toContain("state.voiceControl.enabled = true;");
  expect(voiceSource.indexOf("if (!target || state.voiceControl.enabled) return;")).toBeLessThan(voiceSource.indexOf("state.voiceControl.enabled = true;"));
});

test("GaiaVoice stop command seams remain unchanged", () => {
  expect(voiceSource).toContain("gaiavoice (off|stop)|voice control off|stop listening");
  expect(voiceSource).toContain('label: () => "GaiaVoice off"');
});

test("summon-return/session-room agent completions speak; session-off, other-room, old, and duplicate completions do not", () => {
  const spoken = new Set();
  const target = { workspaceId: "w1", roomId: "voice-room" };
  const event = { id: "evt1", timestamp: "2026-08-26T07:10:00.000Z", author: "gaia", text: "Done.", details: { summonResult: { childRoomId: "worker", failed: false } } };
  expect(shouldReadVoiceRoomEvent({ workspaceId: "w1", roomId: "voice-room", event }, target, Date.parse("2026-08-26T07:09:00.000Z"), spoken)).toBe(true);
  expect(shouldReadVoiceRoomEvent({ workspaceId: "w1", roomId: "other", event }, target, Date.parse("2026-08-26T07:09:00.000Z"), spoken)).toBe(false);
  expect(shouldReadVoiceRoomEvent({ workspaceId: "w1", roomId: "voice-room", event }, null, Date.parse("2026-08-26T07:09:00.000Z"), spoken)).toBe(false);
  expect(shouldReadVoiceRoomEvent({ workspaceId: "w1", roomId: "voice-room", event: { ...event, id: "old", timestamp: "2026-08-26T07:08:59.999Z" } }, target, Date.parse("2026-08-26T07:09:00.000Z"), spoken)).toBe(false);
  spoken.add("w1:voice-room:evt1");
  expect(shouldReadVoiceRoomEvent({ workspaceId: "w1", roomId: "voice-room", event }, target, Date.parse("2026-08-26T07:09:00.000Z"), spoken)).toBe(false);
});

test("incremental readout emits completed sentences once, skips code fences split across chunks, then speaks remainder", () => {
  const readout = createVoiceStreamReadoutState();
  const spoken = [];
  spoken.push(...appendVoiceReadoutDelta(readout, "First sen"));
  spoken.push(...appendVoiceReadoutDelta(readout, "tence. Sec"));
  spoken.push(...appendVoiceReadoutDelta(readout, "ond sentence! ```js\nconsole.log('no"));
  spoken.push(...appendVoiceReadoutDelta(readout, "pe.');\n``` Third"));
  spoken.push(...appendVoiceReadoutDelta(readout, " line\nTail with no"));
  spoken.push(...finalizeVoiceReadoutStream(readout));
  spoken.push(...finalizeVoiceReadoutStream(readout));
  expect(spoken).toEqual(["First sentence.", "Second sentence!", "Third line", "Tail with no"]);
});

test("streaming readout emits more notice once when total spoken cap is exceeded before completion", () => {
  const readout = createVoiceStreamReadoutState();
  const spoken = [];
  for (let i = 0; i < 14; i += 1) spoken.push(...appendVoiceReadoutDelta(readout, `${"word ".repeat(20)}.`));
  spoken.push(...finalizeVoiceReadoutStream(readout));
  expect(spoken.at(-1)).toBe("…more in the chat");
  expect(spoken.filter((chunk) => chunk === "…more in the chat")).toHaveLength(1);
});

test("streaming readout seams consume text deltas and finalize on room-event", () => {
  expect(eventsSource).toContain('dispatchClientEvent("gaia:text-delta"');
  expect(voiceSource).toContain('window.addEventListener("gaia:text-delta"');
  expect(voiceSource).toContain("finalizeVoiceReadoutStream(readout)");
  expect(voiceSource).toContain("const VOICE_REPLY_READOUT = false;");
  expect(voiceSource).toContain("if (VOICE_REPLY_READOUT && chunks.length) void speakVoiceReplyChunks(chunks);");
  expect(voiceSource).toContain("const SILENCE_MS = 1800;");
  expect(voiceSource).toContain("vcAppendReply(key, payload.agentId, payload.delta)");
  expect(voiceSource).toContain("vcSetReply(key, payload.event.author, payload.event.text)");
  expect(voiceSource).toContain("if (state.voiceControl.enabled && voiceSessionFollowsCurrent) voiceSessionTarget");
  expect(voiceSource).toContain("sendVoiceSessionMessage(outbound)");
  expect(voiceSource).toContain("spokenVoiceEventKeys.add(key)");
});

test("Hermes embodiment uses the copied splat asset and keeps sphere as fallback only", () => {
  expect(voiceSource).toContain('const HERMES_SPLAT_URL = "/img/hermes-splat-samples.json";');
  expect(voiceSource).toContain("data?.hermes");
  expect(voiceSource).toContain('kind: "hermes"');
  expect(voiceSource).toContain("drawHermesPoint(ctx, p, w, hgt, t, level, pulse)");
  expect(voiceSource).toContain("points = orbPoints();");
});

test("GaiaVoice transcript renders under the splat and autoscrolls newest visible", () => {
  expect(voiceSource).toContain("GaiaVoice transcript");
  expect(voiceSource).toContain('entry.kind === "reply"');
  expect(voiceSource).toContain("node.scrollTop = node.scrollHeight");
});

test("barge threshold ignores Zoe echo frames and trips on sustained louder voice frames", () => {
  const watch = createBargeWatchState();
  const speakAt = 0.04;
  for (let t = 0; t <= 500; t += 50) {
    const result = observeBargeLevel(watch, 0.05, speakAt, t);
    expect(result.barging).toBe(false);
    expect(result.threshold).toBeGreaterThan(0.07);
  }
  expect(observeBargeLevel(watch, 0.14, speakAt, 550).barging).toBe(false);
  expect(observeBargeLevel(watch, 0.14, speakAt, 650).barging).toBe(false);
  expect(observeBargeLevel(watch, 0.14, speakAt, 710).barging).toBe(true);
});

test("barge-in source keeps analyser ticking, cancels backend TTS, and starts capture", () => {
  expect(voiceSource).toContain("observeBargeLevel(bargeWatch, level, speakAt, now)");
  expect(voiceSource).toContain('fetch("/api/voice/speak/cancel"');
  expect(voiceSource).toContain("startSegment(current, Date.now())");
});
