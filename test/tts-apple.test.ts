import { describe, expect, test } from "bun:test";
import { sanitizeSayText, sanitizeSayVoice } from "../src/services/tts-apple.js";

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
});
