// Daemon reload/rebuild machinery: rebuild from source + re-exec + orphan detection.
// Extracted from http.ts 2026-08-07 — consolidates 4 emergency patches:
// - df409b7 + 9616842: ppid===1 stay-up guard + GAIA_PARENT_PID strip
// - 0899cdc: shell-side daemon.pid watchdog + webview compositor nudge
// - 7a37cf5: port-scoped pidfile + retire-when-not-serving guard

import { existsSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEFAULTS, gaiaCodesignIdentity } from "../core/config.js";
import { gaiaHome } from "../core/paths.js";

// Constants from http.ts
const RELOAD_DELAY_MS = 250;
const RELOAD_CLOSE_TIMEOUT_MS = 1_000;
const ORPHAN_CHECK_INTERVAL_MS = 2_000;
const PORT_OWNERSHIP_CHECK_INTERVAL_MS = 5_000;

interface ReloadPlan {
  script: string;
  out: string;
  bun: string;
  fromSource: boolean;
}

interface OrphanWatchdogOptions {
  pidfile: string;
  isServing: () => boolean;
  onSuperseded?: () => void;
}

/** Port-scoped pidfile path: only the daemon on the DEFAULT app port owns
 * `daemon.pid` (the file the Tauri shell watches/kills). A daemon on any
 * other port (GAIA_PORT diag instance, second checkout) writes
 * `daemon-<port>.pid` — it must NEVER stomp the app's pidfile (observed
 * 2026-08-07: a second instance on :8797 rewrote daemon.pid → shell fired
 * spurious mid-boot reloads + the real daemon's orphan-retire saw a foreign
 * pid and exited). */
export function pidfilePath(port?: number): string {
  if (port === undefined || port === DEFAULTS.port) return join(gaiaHome(), "daemon.pid");
  return join(gaiaHome(), `daemon-${port}.pid`);
}

/** Write <gaia home>/daemon[-<port>].pid after a successful bind — the
 * authority the Tauri shell (and `kill -TERM`) uses to find and terminate the
 * daemon. Best-effort: a pidfile write failure must not stop the daemon
 * serving. */
export async function writePidfile(port?: number): Promise<void> {
  try {
    await mkdir(gaiaHome(), { recursive: true });
    await writeFile(pidfilePath(port), `${process.pid}\n`, "utf8");
  } catch (error) {
    console.error(`gaia: failed to write pidfile: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Delete the pidfile on graceful shutdown. The /reload re-exec child
 * rewrites it on its own boot (writePidfile runs on every listen()), so
 * deleting here — before the new process comes up — is correct: there is
 * a brief window with no pidfile, never a stale one pointing at a dead pid. */
export async function removePidfile(port?: number): Promise<void> {
  try {
    await unlink(pidfilePath(port));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`gaia: failed to remove pidfile: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** A daemon spawned by the Tauri shell with GAIA_PARENT_PID must never outlive
 * that shell: poll every 2s and exit as soon as the parent is gone (a signal-0
 * kill throws once the pid no longer exists). No-op when the env var is
 * absent or not a positive integer — e.g. a daemon started standalone.
 * 
 * ORPHAN FIX (2026-08-07): After a re-exec'd daemon stays up (ppid=1) and a
 * new shell launches its OWN daemon, the old one would linger forever (ppid=1,
 * lost :8787) — wastes resources. Now: a stayed-up daemon that detects it no
 * longer owns its port (periodic self-check) exits cleanly. */
export function installParentWatchdog(options: OrphanWatchdogOptions): void {
  const { pidfile, isServing, onSuperseded } = options;
  const parentPid = Number.parseInt(process.env.GAIA_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  // Flips from "is my parent alive?" to "am I still the app's daemon?" once we
  // decide to keep serving as a detached re-exec'd survivor, so we retire the
  // instant a newer daemon supersedes us instead of lingering forever (that
  // leak stacked orphan daemons racing on state.json across a night of
  // rebuilds, 2026-08-07).
  let orphaned = false;

  const timer = setInterval(() => {
    if (orphaned) {
      // Detached survivor: exit as soon as another daemon owns the app. Every
      // daemon rewrites the pidfile on boot (writePidfile), so a value that is
      // not our pid means a fresh daemon took over :8787.
      // While we still HOLD the listen socket no other daemon can serve the
      // app port — a foreign pid in the pidfile then means someone ELSE
      // (second instance, manual write) stomped the file, not a takeover.
      // Exiting on that killed the live daemon (2026-08-07). Only retire
      // once we no longer serve AND another pid claims the file.
      if (isServing()) return;

      try {
        const owner = Number.parseInt(readFileSync(pidfile, "utf8").trim(), 10);
        if (Number.isInteger(owner) && owner !== process.pid) {
          console.error(`[daemon] superseded by daemon pid ${owner} — exiting orphaned re-exec'd daemon (pid ${process.pid})`);
          if (onSuperseded) onSuperseded();
          process.exit(0);
        }
      } catch {
        // No/unreadable pidfile — we're still the daemon; keep serving.
      }
      return;
    }

    try {
      process.kill(parentPid, 0);
    } catch {
      // The shell we were told to shadow is gone. A FIRST-GENERATION daemon
      // spawned directly by the shell (its immediate parent is the shell / its
      // bun launcher, so process.ppid !== 1) must die with it — that is how a
      // quit avoids leaking a daemon. But a daemon produced by a /reload
      // re-exec is spawned detached and reparented to launchd (process.ppid ===
      // 1), and across a /rebuild the shell ITSELF is torn down and relaunched
      // — so the pre-rebuild GAIA_PARENT_PID we inherited is stale. Suiciding
      // there frees :8787 with NO daemon behind it; the reloading webview then
      // hits ERR_CONNECTION_REFUSED and parks on a blank screen the user can
      // only escape by force-quitting (observed 2026-08-06: every rebuild
      // logged "parent shell gone — exiting", pid chain 53572→55224→57563→…).
      // Keep serving instead — but as an orphan that RETIRES when superseded
      // (the branch above) so rebuilds never stack daemons on one state.json.
      if (process.ppid === 1) {
        console.error(`[daemon] parent GAIA shell (pid ${parentPid}) is gone, but this is a re-exec'd/detached daemon (ppid=1) — staying up until superseded so the reloaded webview / next shell can use :8787`);
        orphaned = true;
        return;
      }
      console.error(`[daemon] parent GAIA shell (pid ${parentPid}) is gone — exiting`);
      process.exit(0);
    }
  }, ORPHAN_CHECK_INTERVAL_MS);

  timer.unref();
}

/** ORPHAN FIX (2026-08-07): A re-exec'd daemon that stayed up (ppid=1) should
 * exit cleanly when it detects it no longer owns its port. This is a fallback
 * for cases where the parent watchdog's pidfile check doesn't catch it (e.g.,
 * if the new daemon is on a different port or the pidfile is missing). */
export function installPortOwnershipCheck(boundPort: number, isServing: () => boolean): void {
  // Only install this for stayed-up orphans (ppid=1) that have GAIA_PARENT_PID
  // set (meaning they were originally launched by a shell but got reparented).
  const parentPid = Number.parseInt(process.env.GAIA_PARENT_PID ?? "", 10);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;
  if (process.ppid !== 1) return;

  const timer = setInterval(() => {
    // If we're no longer serving, check if we should exit
    if (!isServing()) {
      console.error(`[daemon] port ownership lost (ppid=1, was parent ${parentPid}) — exiting orphaned daemon (pid ${process.pid})`);
      process.exit(0);
    }
  }, PORT_OWNERSHIP_CHECK_INTERVAL_MS);

  timer.unref();
}

/** Walk up from a path to the nearest ancestor directory named "*.app" (a macOS bundle root), if any. */
function findAppBundleRoot(path: string): string | undefined {
  let dir = path;
  while (true) {
    if (dir.endsWith(".app")) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Discover the rebuild plan: where to find the build script and where to
 * output the compiled daemon. Two ways: running from source (this file's own
 * repo has scripts/build-daemon.mjs), or running a compiled binary that was
 * built alongside a gaia-source.json pointing back at the source repo. */
function discoverReloadPlan(): ReloadPlan | undefined {
  const repoRootFromSource = fileURLToPath(new URL("../..", import.meta.url));
  const fromSourceScript = join(repoRootFromSource, "scripts/build-daemon.mjs");

  if (existsSync(fromSourceScript)) {
    // process.execPath, not the bare "bun" name: this process IS bun
    // running src/cli.ts (package.json's "start": "bun src/cli.ts"), so
    // its own execPath is a guaranteed-correct absolute path. A bare
    // "bun" instead depends on PATH containing bun's install dir, which
    // a GUI-launched app's stripped LaunchServices PATH does not always
    // have — silent, output-less spawnSync failure observed live 2026-07-11.
    return {
      script: fromSourceScript,
      out: join(repoRootFromSource, "dist"),
      bun: process.execPath,
      fromSource: true,
    };
  }

  const sourceJsonPath = join(dirname(process.execPath), "gaia-source.json");
  if (existsSync(sourceJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(sourceJsonPath, "utf8")) as { root: string; bun: string };
      const script = join(parsed.root, "scripts/build-daemon.mjs");
      if (existsSync(script)) {
        return {
          script,
          out: dirname(process.execPath),
          bun: parsed.bun,
          fromSource: false,
        };
      }
    } catch (error) {
      console.error(`gaia: failed to read gaia-source.json: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return undefined;
}

/** Build the daemon into a staging directory, atomically swap the artifacts
 * into place, and optionally re-sign the bundle (macOS packaged builds). */
async function rebuildDaemon(plan: ReloadPlan, reloadLog: number): Promise<boolean> {
  const stagingDir = `${plan.out}.staging-${Date.now()}`;

  try {
    // Build into a staging directory, OUTSIDE the .app bundle (if bundled).
    // This keeps the app's code signature intact during the build.
    await mkdir(stagingDir, { recursive: true });
    const build = spawnSync(plan.bun, [plan.script, "--out", stagingDir], {
      stdio: ["ignore", reloadLog, reloadLog],
      timeout: 120_000,
    });

    if (build.status !== 0) {
      writeSync(reloadLog, "[gaia] reload rebuild FAILED — relaunching previous build\n");
      return false;
    }

    // Build succeeded. Atomically swap web/ and setups/ from staging
    // into plan.out. This is atomic from TCC's perspective — it never
    // sees the bundle in an inconsistent state.
    //
    // A packaged (!fromSource) install ALSO swaps the compiled
    // `gaia-daemon` binary + `gaia-source.json` — otherwise the app
    // rebuilds a fresh binary into staging on every /rebuild and then
    // discards it, re-execing the SAME OLD BINARY forever (daemon
    // code changes never take effect on a compiled install). Renaming
    // the running binary aside then moving the new one into its path
    // is a plain POSIX rename — never a write into the open inode —
    // so it never hits ETXTBSY, and the process currently executing
    // out of the old (now unlinked-from-the-directory) inode keeps
    // running fine until it re-execs below. The from-source (tsx) dev
    // flow is untouched: only web/setups swap, exactly as before.
    const names = plan.fromSource ? ["web", "setups"] : ["web", "setups", "gaia-daemon", "gaia-source.json"];
    // plan.out may not exist yet: a from-source checkout that has never run
    // `bun run build` has no dist/ — rename(2) needs the destination's parent
    // dir, so the swap ENOENT'd and killed the whole reload (observed live
    // 2026-08-07, daemon running from a fresh worktree). Create it first.
    await mkdir(plan.out, { recursive: true });
    for (const name of names) {
      const src = join(stagingDir, name);
      const dst = join(plan.out, name);
      const tmp = `${dst}.old-${Date.now()}`;

      try {
        // Move current (if exists) to .old, then move staging into place.
        // This is as atomic as POSIX rename gets.
        if (existsSync(dst)) await rename(dst, tmp);
        await rename(src, dst);
      } catch (error) {
        writeSync(reloadLog, `[gaia] reload: atomic swap FAILED for ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
        throw error;
      }

      // Clean up the .old backup, best-effort. `gaia-daemon.old-*`
      // may still be the inode THIS process is executing out of —
      // some filesystems refuse to unlink an in-use executable.
      // That must never fail the reload; the swap itself (the
      // renames above) already succeeded.
      if (existsSync(tmp)) {
        try {
          rmSync(tmp, { recursive: true, force: true });
        } catch (error) {
          writeSync(reloadLog, `[gaia] reload: cleanup of stale ${tmp} failed (tolerated): ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }

    return true;
  } finally {
    // Clean up staging directory.
    if (existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
  }
}

/** Re-sign a macOS .app bundle after rebuild. Ad-hoc signature ("-") changes
 * the cdhash on every rebuild, orphaning TCC grants. A named identity keys
 * grants to the certificate leaf instead, stable across rebuilds. */
async function resignBundle(plan: ReloadPlan, reloadLog: number): Promise<void> {
  if (plan.fromSource || process.platform !== "darwin") return;

  const appRoot = findAppBundleRoot(plan.out);
  if (!appRoot) {
    writeSync(reloadLog, `[gaia] reload: installed binary not inside a .app bundle — skipping re-sign\n`);
    return;
  }

  const parsed = (() => {
    try {
      return JSON.parse(readFileSync(join(dirname(process.execPath), "gaia-source.json"), "utf8")) as { root: string };
    } catch {
      return undefined;
    }
  })();

  const entitlements = parsed ? join(parsed.root, "src-tauri/Entitlements.plist") : undefined;

  // Prefer a stable named identity over ad-hoc ("-") signing: ad-hoc
  // keys the TCC designated requirement to the binary's cdhash, which
  // changes on every rebuild and orphans every mic/camera grant. A
  // named identity keys it to the certificate leaf instead, which
  // stays stable across rebuilds. Fall back to ad-hoc only when the
  // configured identity isn't actually present in the keychain.
  const wantIdentity = gaiaCodesignIdentity();
  const probe = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  const identity = probe.status === 0 && probe.stdout.includes(`"${wantIdentity}"`) ? wantIdentity : "-";

  if (identity === "-" && wantIdentity !== "-") {
    writeSync(reloadLog, `[gaia] reload: codesign identity "${wantIdentity}" not found in keychain — falling back to ad-hoc (TCC grants will be orphaned)\n`);
  }

  const codesignArgs = ["--force", "--deep", "--sign", identity];
  if (entitlements && existsSync(entitlements)) codesignArgs.push("--entitlements", entitlements);
  codesignArgs.push(appRoot);

  const sign = spawnSync("codesign", codesignArgs, { stdio: ["ignore", reloadLog, reloadLog] });
  if (sign.status === 0) {
    writeSync(reloadLog, `[gaia] reload: re-signed ${appRoot} after rebuild\n`);
  } else {
    writeSync(reloadLog, `[gaia] reload: codesign FAILED (status ${sign.status}) — mic/camera permission will likely break until fixed\n`);
  }
}

/** Prepare child environment for re-exec: strip ANTHROPIC_BASE_URL and
 * GAIA_PARENT_PID. gaia never sets ANTHROPIC_BASE_URL on its OWN process env —
 * the only writer is the per-turn thinking-proxy shim, which sets it on a
 * spawned CHILD's env object, not here. Any value present in process.env at
 * rebuild time is therefore foreign pollution inherited from whatever launched
 * the app (a stale `launchctl setenv`, a dead local proxy from an old terminal
 * session, ...) — self-contained means /rebuild must not carry it forward
 * forever. Strip it; a user who genuinely wants a custom gateway sets it fresh
 * at launch, not implicitly via reload.
 *
 * Also drop GAIA_PARENT_PID: it names the shell that spawned the CURRENT
 * daemon, but the re-exec'd child is detached and reparented to launchd, and
 * across a /rebuild the shell itself is torn down/relaunched — so that pid is
 * stale the instant the child starts. Carrying it forward makes
 * installParentWatchdog shadow a doomed pid and exit(0) when it dies, freeing
 * :8787 with no daemon behind it → the reloading app window hits a refused
 * port and blanks (see installParentWatchdog + df409b7). Absent, the child
 * installs no watchdog at all (no-op when the var is missing); the shell
 * reclaims :8787 on its next launch. Kills the stale-pid trap at the source;
 * the ppid===1 guard in installParentWatchdog stays as a backstop for any
 * transitional re-exec that still inherited it. */
export function prepareChildEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_BASE_URL: _droppedGateway, GAIA_PARENT_PID: _droppedParentPid, ...childEnv } = process.env;
  return childEnv;
}

/** Filter process.argv for re-exec: drop --dev, bun's internal /$bunfs/...
 * entry script, and other noise that shouldn't propagate to the child. */
export function prepareChildArgs(includeScript: boolean): string[] {
  const slice = includeScript ? 1 : 2;
  return process.argv
    .slice(slice)
    .filter((arg) => arg !== "--dev" && !arg.startsWith("/$bunfs") && !arg.includes("~BUN"));
}

export interface ReloadOptions {
  closeServer: () => Promise<void>;
}

/** Execute the reload: rebuild (if plan available), re-sign (macOS packaged),
 * re-exec into the new binary. Bounded graceful close — a hung or failed
 * dispose must never block the re-exec. process.exit(0) below frees the port
 * either way, and the next boot's orphan sweep reaps any runner subprocess a
 * skipped dispose left behind. */
export async function executeReload(options: ReloadOptions): Promise<void> {
  const { closeServer } = options;

  try {
    // Bounded graceful close (see RELOAD_CLOSE_TIMEOUT_MS): a hung or failed
    // dispose must never block the re-exec. process.exit(0) below frees the
    // port either way, and the next boot's orphan sweep (daemon.serviceFor
    // invariant) reaps any runner subprocess a skipped dispose left behind.
    const closed = closeServer().then(
      () => "closed" as const,
      (error) => {
        console.error(`[gaia] reload: graceful close failed: ${error instanceof Error ? error.message : String(error)} — proceeding with re-exec`);
        return "failed" as const;
      },
    );
    const deadline = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), RELOAD_CLOSE_TIMEOUT_MS).unref());
    if ((await Promise.race([closed, deadline])) === "timeout") {
      console.error(`[gaia] reload: graceful close still pending after ${RELOAD_CLOSE_TIMEOUT_MS}ms — proceeding with re-exec (pid ${process.pid})`);
    }

    const reloadLog = openSync(join(gaiaHome(), "reload.log"), "a");
    const plan = discoverReloadPlan();

    let rebuildOk = false;
    if (plan) {
      rebuildOk = await rebuildDaemon(plan, reloadLog);
      if (rebuildOk) await resignBundle(plan, reloadLog);
    }

    // Re-exec. tsx's --require/--import live in process.execArgv, NOT
    // process.argv — without them a source re-exec is plain `node
    // src/cli.ts`, which dies instantly and leaves the port dead (the
    // exact "/reload froze the app" failure). And never stdio:"ignore"
    // here: a crashing reload child must leave a corpse we can read.
    // In a compiled bun binary argv[1] is the virtual "/$bunfs/..." entry
    // script (verified 2026-07-11) — it must never be passed to the child,
    // where the CLI would parse it as a command.
    const args = prepareChildArgs(true);
    // When the child is the COMPILED binary, argv[1] of a source run
    // ("src/cli.ts") must be dropped too — the binary would parse the
    // script path as a CLI command and print --help instead of booting
    // (observed live 2026-07-11 14:01: reload went dark). Flags only.
    const flagsOnly = prepareChildArgs(false);
    const compiledBinary = plan ? join(plan.out, "gaia-daemon") : undefined;

    // Not gated on `fromSource`: a packaged (!fromSource) install now
    // installs its freshly-built binary into plan.out above, so
    // compiledBinary IS the new build there too — re-exec it the same way
    // a source checkout re-execs onto a pre-existing dist/gaia-daemon.
    // From-source dev behavior is unchanged: it only ever finds a compiled
    // binary here if one was separately built into dist/ (e.g. `bun run
    // build`), exactly as before.
    const migrateToCompiled = rebuildOk && compiledBinary !== undefined && existsSync(compiledBinary);
    const childEnv = prepareChildEnv();

    const child = migrateToCompiled
      ? spawn(compiledBinary, flagsOnly, {
          detached: true,
          stdio: ["ignore", reloadLog, reloadLog],
          cwd: process.cwd(),
          env: childEnv,
        })
      : spawn(process.execPath, [...process.execArgv, ...args], {
          detached: true,
          stdio: ["ignore", reloadLog, reloadLog],
          cwd: process.cwd(),
          env: childEnv,
        });

    console.log(`[gaia] reload exec: ${migrateToCompiled ? compiledBinary : process.execPath}`);
    child.unref();
    process.exit(0);
  } catch (error) {
    console.error(`gaia: reload failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** Request a reload after a delay, with provenance logging. This is the entry
 * point called by the room service's `/reload` command handler. */
export function requestReload(reloadStarted: { current: boolean }, closeServer: () => Promise<void>): void {
  if (reloadStarted.current) return;
  reloadStarted.current = true;

  // Restart provenance (standing rule: ONLY /reload — the user — restarts the
  // daemon; nothing self-triggers). Every re-exec logs a timestamped line so
  // any boot in reload.log without a matching "reload requested" line above
  // it is immediately visible as an external kill/spawn, not ours.
  console.log(`[gaia] ${new Date().toISOString()} reload requested via /reload — re-exec in ${RELOAD_DELAY_MS}ms (pid ${process.pid})`);

  setTimeout(() => {
    void executeReload({ closeServer });
  }, RELOAD_DELAY_MS);
}
