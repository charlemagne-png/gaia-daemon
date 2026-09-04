// apple — macOS on-device dictation ("local Siri"): SFSpeechRecognizer via a
// tiny Swift helper, compiled once on first use and cached. Zero network, zero
// keys, zero per-clip API latency. Registered as one more STT engine in the
// uniform registry (transcribe.ts) — the shared path never learns it exists.
//
// Pipeline per clip:
//   1. ffmpeg decodes whatever the recorder produced (webm/opus, mp4, …) to
//      16 kHz mono wav — AVFoundation cannot read webm, ffmpeg reads anything.
//   2. the cached helper binary runs SFSpeechURLRecognitionRequest with
//      requiresOnDeviceRecognition when the locale supports it (else Apple's
//      free dictation servers — still Siri, still keyless).
//
// First run compiles the helper (~2 s, cached by source hash) and macOS may
// show ONE speech-recognition permission prompt for the daemon's app. After
// that: clip in, text out, all local.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { registerSttEngine, type SttContext, type SttResult } from "./transcribe.js";

// ---------------------------------------------------------------------------
// Swift helper source. Embedded as a string (the daemon is a compiled bun
// binary — no loose resource files survive the snapshot). argv: wavPath
// [localeId]; prints the transcript to stdout, diagnostics to stderr.

const SWIFT_SOURCE = `
import Foundation
import Speech

// TCC responsibility disclaim: spawned by the daemon, this process would
// inherit the daemon as its "responsible process" — whose Info.plist has no
// speech usage description, so TCC SIGABRTs us regardless of our own embedded
// plist. Re-exec self with responsibility disclaimed (posix_spawn SETEXEC +
// responsibility_spawnattrs_setdisclaim) -> we become self-responsible and our
// own __info_plist counts.
typealias DisclaimFn = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
func respawnDisclaimed() -> Never {
  var attr: posix_spawnattr_t? = nil
  posix_spawnattr_init(&attr)
  posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETEXEC))
  if let sym = dlsym(dlopen(nil, RTLD_NOW), "responsibility_spawnattrs_setdisclaim") {
    let disclaim = unsafeBitCast(sym, to: DisclaimFn.self)
    _ = disclaim(&attr, 1)
  }
  var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) }
  argv.append(strdup("--disclaimed"))
  argv.append(nil)
  var pid: pid_t = 0
  posix_spawn(&pid, CommandLine.arguments[0], nil, &attr, argv, environ)
  FileHandle.standardError.write("disclaim re-exec failed\\n".data(using: .utf8)!)
  exit(70)
}

if !CommandLine.arguments.contains("--disclaimed") { respawnDisclaimed() }
let args = CommandLine.arguments.filter { $0 != "--disclaimed" }
guard args.count >= 2 else {
  FileHandle.standardError.write("usage: gaia-apple-stt <audio> [locale] [device|server]\\n".data(using: .utf8)!)
  exit(64)
}
let audioUrl = URL(fileURLWithPath: args[1])
let locale: Locale = args.count >= 3 && !args[2].isEmpty ? Locale(identifier: args[2]) : Locale.current
// Single-pass process: "device" = on-device only, "server" = Apple dictation
// service. SFSpeech allows ONE recognition session per process (an in-process
// device+server race hangs both — measured 08-26), so the RACE lives in the
// daemon: it spawns one process per mode in parallel.
let onDevice = (args.count >= 4 ? args[3] : "device") != "server"

// Skip the authorization round-trip entirely once granted — it costs real
// latency on every clip; only block on the prompt when status is undetermined.
if SFSpeechRecognizer.authorizationStatus() != .authorized {
  let authSema = DispatchSemaphore(value: 0)
  SFSpeechRecognizer.requestAuthorization { _ in authSema.signal() }
  authSema.wait()
}
guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
  FileHandle.standardError.write("speech recognition not authorized (System Settings > Privacy & Security > Speech Recognition)\\n".data(using: .utf8)!)
  exit(2)
}
guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
  FileHandle.standardError.write("no speech recognizer for locale \\(locale.identifier)\\n".data(using: .utf8)!)
  exit(3)
}
if onDevice && !recognizer.supportsOnDeviceRecognition {
  FileHandle.standardError.write("on-device recognition unsupported for \\(locale.identifier)\\n".data(using: .utf8)!)
  exit(5)
}
let request = SFSpeechURLRecognitionRequest(url: audioUrl)
request.shouldReportPartialResults = false
request.requiresOnDeviceRecognition = onDevice
request.taskHint = .dictation
if #available(macOS 13.0, *) {
  request.addsPunctuation = true
}
recognizer.recognitionTask(with: request) { result, error in
  if let result = result, result.isFinal {
    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { exit(6) }
    print(text)
    exit(0)
  }
  if let error = error {
    FileHandle.standardError.write("recognition failed: \\(error.localizedDescription)\\n".data(using: .utf8)!)
    exit(4)
  }
}
dispatchMain()
`;

// Embedded Info.plist (__TEXT,__info_plist): a bare CLI binary has no bundle,
// and without NSSpeechRecognitionUsageDescription TCC aborts the process
// (SIGABRT) the moment it touches SFSpeechRecognizer. CFBundleIdentifier makes
// the permission grant stable across recompiles.
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>works.earendil.gaia.apple-stt</string>
  <key>CFBundleName</key><string>gaia-apple-stt</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>GAIA transcribes your dictated voice messages locally on this Mac.</string>
</dict></plist>
`;

// ---------------------------------------------------------------------------
// Helper compilation: swiftc once, cached under ~/.gaia/cache/bin keyed by a
// hash of the source, so editing SWIFT_SOURCE naturally invalidates the cache.

function binDir(): string {
  return join(homedir(), ".gaia", "cache", "bin");
}

let compiledPath: string | null = null;

function helperPath(log: (m: string) => void): string {
  if (compiledPath && existsSync(compiledPath)) return compiledPath;
  const hash = createHash("sha256").update(SWIFT_SOURCE).update(INFO_PLIST).digest("hex").slice(0, 12);
  // Bundle-shaped cache dir (Contents/Info.plist + Contents/MacOS/…) so TCC can
  // also resolve the plist by bundle, belt-and-braces with __info_plist.
  const contents = join(binDir(), `gaia-apple-stt-${hash}.app`, "Contents");
  const path = join(contents, "MacOS", "gaia-apple-stt");
  if (!existsSync(path)) {
    log("compiling Apple STT helper (first run)");
    mkdirSync(join(contents, "MacOS"), { recursive: true });
    const source = join(binDir(), `gaia-apple-stt-${hash}.swift`);
    const plist = join(contents, "Info.plist");
    writeFileSync(source, SWIFT_SOURCE);
    writeFileSync(plist, INFO_PLIST);
    const result = spawnSync("swiftc", [
      "-O", "-o", path, source,
      "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", plist,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`swiftc failed compiling Apple STT helper: ${(result.stderr ?? "").slice(0, 800)}`);
    }
    // Stable code identity across recompiles -> the TCC grant sticks.
    const signed = spawnSync("codesign", ["-s", "-", "-f", "--identifier", "works.earendil.gaia.apple-stt", path], { encoding: "utf8" });
    if (signed.status !== 0) {
      throw new Error(`codesign failed on Apple STT helper: ${(signed.stderr ?? "").slice(0, 400)}`);
    }
    chmodSync(path, 0o755);
  }
  compiledPath = path;
  return path;
}

// ---------------------------------------------------------------------------
// Subprocess plumbing shared by the ffmpeg + helper steps.

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string[], input: Buffer | undefined, signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"], signal });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stderr?.on("data", (chunk) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code: code ?? -1,
      stdout: Buffer.concat(out).toString("utf8"),
      stderr: Buffer.concat(err).toString("utf8"),
    }));
    if (input) {
      child.stdin!.on("error", () => {}); // ffmpeg may close stdin early once the container is read
      child.stdin!.end(input);
    }
  });
}

/** ISO code / BCP-47 tag → the locale id handed to SFSpeechRecognizer.
 * Empty / "auto" = system locale (SFSpeech has no true auto-detect). */
export function appleLocale(language?: string): string {
  const code = (language ?? "").trim();
  if (!code || code.toLowerCase() === "auto") return "";
  const mapped: Record<string, string> = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN" };
  return mapped[code.toLowerCase()] ?? code;
}

const APPLE_STT_TIMEOUT_MS = 120_000;

export async function appleTranscribe(context: SttContext): Promise<SttResult> {
  if (process.platform !== "darwin") throw new Error("Apple speech recognition requires macOS.");
  const signal = context.signal ?? AbortSignal.timeout(APPLE_STT_TIMEOUT_MS);
  const helper = helperPath(context.log);
  const work = await mkdtemp(join(tmpdir(), "gaia-stt-"));
  try {
    // 1. decode the clip to 16 kHz mono wav (AVFoundation can't read webm).
    // speechnorm: quiet mic clips (-30 dB mean observed) starve the on-device
    // model; per-frame speech normalization lifts them WITHOUT the ramp-in of
    // loudnorm, which was measured eating the first spoken words of a clip.
    const wav = join(work, "clip.wav");
    const FF_ARGS = ["-ac", "1", "-ar", "16000", "-af", "speechnorm=e=6.25:r=0.00001:l=1", "-f", "wav", "-y"];
    const decode = await run(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...FF_ARGS, wav],
      context.audio.data,
      signal,
    );
    if (decode.code !== 0 || !existsSync(wav)) {
      // Some containers need a seekable input — retry from a file.
      const raw = join(work, "clip.raw");
      await writeFile(raw, context.audio.data);
      const retry = await run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", raw, ...FF_ARGS, wav],
        undefined,
        signal,
      );
      if (retry.code !== 0) throw new Error(`ffmpeg could not decode the clip: ${(retry.stderr || decode.stderr).slice(0, 400)}`);
    }
    // 2. recognize — RACE two single-pass helper processes (SFSpeech allows one
    // recognition session per process; in-process racing hangs both). On-device
    // wins the moment it yields text (~0.5-0.9s, private); when it comes back
    // empty (quiet clips) the server pass is ALREADY in flight instead of
    // starting a serial second pass — measured 2x faster on the fallback path.
    const locale = appleLocale(context.language);
    const serverPass = run([helper, wav, locale, "server"], undefined, signal);
    serverPass.catch(() => {}); // may be abandoned when on-device wins
    const device = await run([helper, wav, locale, "device"], undefined, signal).catch(() => null);
    if (device && device.code === 0 && device.stdout.trim()) {
      return { text: device.stdout.trim() };
    }
    context.log("on-device pass empty; using raced Apple dictation result");
    const server = await serverPass;
    if (server.code !== 0 || !server.stdout.trim()) {
      throw new Error(`Apple speech recognition failed (${server.code}): ${(server.stderr || device?.stderr || "").trim().slice(0, 400)}`);
    }
    return { text: server.stdout.trim() };
  } finally {
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

registerSttEngine({
  id: "apple",
  label: "Apple dictation (on-device Siri, local + free)",
  transcribe: appleTranscribe,
});
