// Apple TTS for voice-control acks/questions: local macOS `/usr/bin/say`.
// No browser audio bytes: the daemon speaks on the Mac speaker, and the web
// client waits for this route so VAD can pause while the Mac is talking.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

const MAX_TEXT_CHARS = 500;
const MAX_VOICE_CHARS = 120;

type SaySpawn = typeof nodeSpawn;

let speakTail: Promise<void> = Promise.resolve();
let speakGeneration = 0;
let currentSayChild: ChildProcess | null = null;
let spawnSay: SaySpawn = nodeSpawn;

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

/** Clamp a words-per-minute rate to say's sane range; undefined = say default (~175). */
export function sanitizeSayRate(rate?: number): number | undefined {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(400, Math.max(90, Math.round(n)));
}

function abortError(): Error {
  const error = new Error("Speech cancelled");
  error.name = "AbortError";
  return error;
}

/** Speak one short utterance through macOS say. Calls are serialized FIFO so
 * command acknowledgements never overlap. Abort before start skips the queued
 * utterance; abort while speaking kills the active say process. */
export function speak(text: string, voice?: string, signal?: AbortSignal, rate?: number): Promise<void> {
  const utterance = sanitizeSayText(text);
  const sayVoice = sanitizeSayVoice(voice);
  const sayRate = sanitizeSayRate(rate);
  if (!utterance) return Promise.reject(new Error("No text to speak"));
  const generation = speakGeneration;
  const run = speakTail.catch(() => undefined).then(() => {
    if (generation !== speakGeneration) return Promise.reject(abortError());
    return runSay(utterance, sayVoice, sayRate, signal, generation);
  });
  speakTail = run.catch(() => undefined);
  return run;
}

export function cancelSpeechQueue(): void {
  speakGeneration += 1;
  const child = currentSayChild;
  if (child && !child.killed) child.kill("SIGTERM");
  speakTail = Promise.resolve();
}

/** Test-only seam: replace `/usr/bin/say` spawn without touching callers. */
export function setSaySpawnForTest(spawnImpl: SaySpawn): () => void {
  const previous = spawnSay;
  spawnSay = spawnImpl;
  return () => { spawnSay = previous; };
}

function runSay(text: string, voice: string | undefined, rate: number | undefined, signal: AbortSignal | undefined, generation: number): Promise<void> {
  if (signal?.aborted || generation !== speakGeneration) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const args = [...(voice ? ["-v", voice] : []), ...(rate ? ["-r", String(rate)] : []), text];
    const child = spawnSay("/usr/bin/say", args, { stdio: ["ignore", "ignore", "pipe"] });
    currentSayChild = child;
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
      if (currentSayChild === child) currentSayChild = null;
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      signal?.removeEventListener("abort", onAbort);
      if (currentSayChild === child) currentSayChild = null;
      if (aborted || signal?.aborted || generation !== speakGeneration) return reject(abortError());
      if (code === 0) return resolve();
      const detail = Buffer.concat(err).toString("utf8").trim().slice(0, 400);
      reject(new Error(`say failed (${code ?? closeSignal ?? "unknown"})${detail ? `: ${detail}` : ""}`));
    });
  });
}
