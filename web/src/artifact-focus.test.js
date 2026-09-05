// @ts-nocheck — headless source/logic guard for artifact-return focus law.
import { expect, test } from "bun:test";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) { return store.get(key) ?? null; },
    setItem(key, value) { store.set(key, String(value)); },
  },
  sessionStorage: {
    getItem(key) { return store.get(`session:${key}`) ?? null; },
    setItem(key, value) { store.set(`session:${key}`, String(value)); },
  },
};
globalThis.navigator = { platform: "MacIntel", userAgent: "Headless" };

const eventsSource = await Bun.file(new URL("./events.js", import.meta.url)).text();
const transcriptSource = await Bun.file(new URL("./transcript.js", import.meta.url)).text();
const keysSource = await Bun.file(new URL("./keys.js", import.meta.url)).text();
const { state } = await import("./state.js");
const { openTab } = await import("./tabs.js");

test("background tab adoption never changes active room", () => {
  state.openTabs = ["chat-active"];
  state.snapshot = { workspace: { id: "ws" }, room: { id: "chat-active" }, rooms: [] };

  expect(openTab("dieter-result-room", "ws")).toBe(true);
  expect(state.snapshot.room.id).toBe("chat-active");
  expect(state.openTabs).toEqual(["chat-active", "dieter-result-room"]);
  expect(openTab("dieter-result-room", "ws")).toBe(false);
});

test("summon artifact notes open their child room tab without popping the current artifact surface", () => {
  expect(transcriptSource).toContain("openTab(summon.childRoomId, state.snapshot.workspace.id)");
  expect(transcriptSource).toContain('if (isAgent && !summon) detectArtifacts(view.text, view.details);');
});

test("server-pushed room redirects stage background tabs except explicit voice navigation", () => {
  expect(eventsSource).toContain('if (payload.scope === "workspace")');
  expect(eventsSource).toContain("selectRoom(payload.workspaceId, payload.roomId)");
  expect(eventsSource).toContain("openTab(payload.roomId, payload.workspaceId)");
  expect(eventsSource.indexOf("openTab(payload.roomId, payload.workspaceId)")).toBeGreaterThan(eventsSource.indexOf('if (payload.scope === "workspace")'));
});

test("escape closes the artifact drawer before chat stop/delete handlers", () => {
  expect(keysSource).toContain('if (event.key === "Escape" && artifactPanelOpen())');
  expect(keysSource).toContain('setArtifactPanelOpen(false);');
  expect(keysSource.indexOf('if (event.key === "Escape" && artifactPanelOpen())')).toBeLessThan(keysSource.indexOf("if (isDeleteChord(event)"));
});
