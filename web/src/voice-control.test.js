// @ts-nocheck — pure helpers + source seam assertions for browser voice-control.
import { expect, test } from "bun:test";
import { chunkVoiceReplyText, sanitizeVoiceReplyText, voiceControlRoomTitle } from "./voice-control-readout.js";

const voiceSource = await Bun.file(new URL("./voice-control.js", import.meta.url)).text();
const actionsSource = await Bun.file(new URL("./actions.js", import.meta.url)).text();

test("sanitizeVoiceReplyText strips markdown, code fences, links, and emoji", () => {
  const sample = `# Hello **Charles** 🚀\n\nSee [the plan](https://example.com/path) and https://noise.test.\n\n\`inline\` stays readable.\n\n\`\`\`js\nconsole.log("skip me")\n\`\`\``;
  expect(sanitizeVoiceReplyText(sample)).toBe("Hello Charles See the plan and inline stays readable.");
});

test("chunkVoiceReplyText chunks 1400 chars into <=450 pieces with truncation notice", () => {
  const chunks = chunkVoiceReplyText(`${"word ".repeat(280)}tail`);
  expect(chunks.at(-1)).toBe("…more in the chat");
  expect(chunks.every((chunk) => chunk.length <= 450)).toBe(true);
  expect(chunks.slice(0, -1).join(" ").length).toBeLessThanOrEqual(1210);
});

test("voice-control toggle-on seam creates/selects a fresh titled room", () => {
  expect(voiceControlRoomTitle(new Date(2026, 7, 26, 8, 50))).toBe("voice control — 08/26 08:50");
  expect(voiceSource).toContain("await addRoom({ title: voiceControlRoomTitle() })");
  expect(voiceSource).toContain("voiceSessionTarget = room");
  expect(actionsSource).toContain("await selectRoom(snapshot.workspace.id, roomId, { incognito })");
  expect(actionsSource).toContain("/rooms/${encodeURIComponent(roomId)}/title");
  expect(actionsSource).toContain('body: JSON.stringify({ title, source: "auto" })');
  expect(actionsSource).toContain("state.snapshot.room).title = title");
});
