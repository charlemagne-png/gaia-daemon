// Apple TTS for voice-control acks/questions: local macOS `/usr/bin/say`.
// No browser audio bytes: the daemon speaks on the Mac speaker, and the web
// client waits for this route so VAD can pause while the Mac is talking.

import { spawn } from "node:child_process";

const MAX_TEXT_CHARS = 500;
const MAX_VOICE_CHARS = 120;

let speakTail: Promise<void> = Promise.resolve();

export function sanitizeSayText(text: string): string {
  return String(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS)
    .trim();
}

export function sanitizeSayVoice(voice?: string): string | undefined {
  const clean = String(voice ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VOICE_CHARS)
    .trim();
  return clean || undefined;
}

function abortError(): Error {
  const error = new Error("Speech cancelled");
  error.name = "AbortError";
  return error;
}

/** Speak one short utterance through macOS say. Calls are serialized FIFO so
 * command acknowledgements never overlap. Abort before start skips the queued
 * utterance; abort while speaking kills the active say process. */
export function speak(text: string, voice?: string, signal?: AbortSignal): Promise<void> {
  const utterance = sanitizeSayText(text);
  const sayVoice = sanitizeSayVoice(voice);
  if (!utterance) return Promise.reject(new Error("No text to speak"));
  const run = speakTail.catch(() => undefined).then(() => runSay(utterance, sayVoice, signal));
  speakTail = run.catch(() => undefined);
  return run;
}

function runSay(text: string, voice: string | undefined, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const args = voice ? ["-v", voice, text] : [text];
    const child = spawn("/usr/bin/say", args, { stdio: ["ignore", "ignore", "pipe"] });
    const err: Buffer[] = [];
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stderr?.on("data", (chunk) => err.push(chunk));
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      signal?.removeEventListener("abort", onAbort);
      if (aborted || signal?.aborted) return reject(abortError());
      if (code === 0) return resolve();
      const detail = Buffer.concat(err).toString("utf8").trim().slice(0, 400);
      reject(new Error(`say failed (${code ?? closeSignal ?? "unknown"})${detail ? `: ${detail}` : ""}`));
    });
  });
}
