import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";
import { cancelSpeechQueue, sanitizeSayText, sanitizeSayVoice, setSaySpawnForTest, speak } from "../src/services/tts-apple.js";

class FakeSayChild extends EventEmitter {
  stderr = new EventEmitter();
  killed = false;
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, signal ?? "SIGTERM"));
    return true;
  }
}

describe("apple tts", () => {
  test("sanitizes utterances for argv-based say", () => {
    const raw = ` hello\u0000\n${"x".repeat(600)} `;
    const text = sanitizeSayText(raw);
    expect(text.includes("\u0000")).toBe(false);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.startsWith("hello x")).toBe(true);
  });

  test("blank voice resolves to system default", () => {
    expect(sanitizeSayVoice("  \n\u0000  ")).toBeUndefined();
    expect(sanitizeSayVoice("Samantha")).toBe("Samantha");
  });

  test("cancelSpeechQueue kills active say child and drains queued utterances", async () => {
    const children: FakeSayChild[] = [];
    const restore = setSaySpawnForTest((() => {
      const child = new FakeSayChild();
      children.push(child);
      return child;
    }) as never);
    try {
      const active = speak("first");
      await Promise.resolve();
      await Promise.resolve();
      const queued = speak("second");
      expect(children).toHaveLength(1);
      cancelSpeechQueue();
      expect(children[0]?.killed).toBe(true);
      await expect(active).rejects.toMatchObject({ name: "AbortError" });
      await expect(queued).rejects.toMatchObject({ name: "AbortError" });
      expect(children).toHaveLength(1);
    } finally {
      restore();
      cancelSpeechQueue();
    }
  });
});
