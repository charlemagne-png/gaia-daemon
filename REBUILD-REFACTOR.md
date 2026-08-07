# /rebuild Refactor — 2026-08-07

Extracted reload/rebuild/re-exec machinery from `src/server/http.ts` (600+ lines) into clean, testable module `src/server/reload.ts`.

## What moved where

| Original (http.ts)               | New location (reload.ts)                  | Notes                                    |
|----------------------------------|-------------------------------------------|------------------------------------------|
| `pidfilePath()`                  | `pidfilePath()` (exported)                | Port-scoped pidfile path logic           |
| `installParentWatchdog()`        | `installParentWatchdog()` (exported)      | Parent shell watchdog + orphan retire    |
| `writePidfile()`                 | `writePidfile()` (exported)               | Atomic pidfile write                     |
| `removePidfile()`                | `removePidfile()` (exported)              | Graceful pidfile cleanup                 |
| `requestReload()`                | `requestReload()` (exported)              | Entry point: delay + provenance log      |
| `reloadNow()` (private)          | `executeReload()` (exported)              | Rebuild + re-sign + re-exec orchestrator |
| `findAppBundleRoot()`            | `findAppBundleRoot()` (internal)          | macOS .app bundle locator                |
| N/A (inline)                     | `discoverReloadPlan()` (internal)         | Find build script + output dir           |
| N/A (inline)                     | `rebuildDaemon()` (internal)              | Build + atomic swap                      |
| N/A (inline)                     | `resignBundle()` (internal)               | macOS codesign after rebuild             |
| N/A (inline)                     | `prepareChildEnv()` (exported)            | Strip ANTHROPIC_BASE_URL + GAIA_PARENT_PID |
| N/A (inline)                     | `prepareChildArgs()` (exported)           | Filter --dev, /$bunfs/, ~BUN             |
| Constants (RELOAD_DELAY_MS, etc) | Constants (reload.ts)                     | Kept same values, centralized            |
| N/A                              | `installPortOwnershipCheck()` (exported)  | NEW: orphan fix (see below)              |

## Invariants table — hard-won patches preserved

| Patch / commit | Invariant                                                                 | Where preserved                                      |
|----------------|---------------------------------------------------------------------------|------------------------------------------------------|
| df409b7        | ppid===1 stay-up guard (detached re-exec'd daemon survives parent death) | `installParentWatchdog()` — ppid===1 branch          |
| 9616842        | Strip GAIA_PARENT_PID from re-exec childEnv (stale pid trap)             | `prepareChildEnv()` — destructured out               |
| 9616842        | Strip ANTHROPIC_BASE_URL from re-exec childEnv (foreign pollution)       | `prepareChildEnv()` — destructured out               |
| 0899cdc        | Shell-side daemon.pid watchdog + webview reload (not touched)            | No daemon changes — shell-side patch intact          |
| 7a37cf5        | Port-scoped pidfile (daemon-<port>.pid for non-default ports)            | `pidfilePath()` — port check preserved               |
| 7a37cf5        | Retire only when NOT holding listen socket (foreign pidfile write safe)  | `installParentWatchdog()` — isServing() gate         |
| 2026-08-07     | Reload rebuild FAILED log message (external tooling greps this)          | `rebuildDaemon()` — exact string preserved           |
| 2026-08-07     | "staying up" log message (external tooling greps this)                   | `installParentWatchdog()` — exact string preserved   |

## Orphan-fix design

**Problem**: After a re-exec'd daemon stays up (ppid=1) and a new shell launches its OWN daemon, the old one lingers (ppid=1, lost :8787) — wastes resources, races on state.json.

**Solution**: New `installPortOwnershipCheck()` periodic self-check (every 5s):
- Only installed for stayed-up orphans (ppid=1 + GAIA_PARENT_PID set).
- If `isServing()` returns false (lost the listen socket), exits cleanly with provenance log.
- Complements `installParentWatchdog()`'s pidfile check (catches cases where pidfile check misses).

**Where installed**: `GaiaWebServer.listen()` in http.ts, right after `installParentWatchdog()`.

## Test coverage

New: `test/reload.test.ts` (13 tests, all green):
- `pidfilePath()`: default port, undefined port, non-default ports
- `prepareChildEnv()`: strips ANTHROPIC_BASE_URL, strips GAIA_PARENT_PID, preserves other vars
- `prepareChildArgs()`: filters --dev, /$bunfs/, ~BUN; includeScript flag behavior

**Not tested** (require live daemon):
- `installParentWatchdog()` timer behavior (mocking process.kill, timers fragile)
- `installPortOwnershipCheck()` timer behavior (same)
- `rebuildDaemon()`, `resignBundle()`, `executeReload()` (full rebuild path — integration test territory)
- `discoverReloadPlan()` (depends on filesystem layout, import.meta.url, process.execPath)

Pure logic extracted and tested; side-effectful orchestration remains integration-only.

## Verification status

- ✅ `bun run check` — green (ignoring pre-existing artifacts.ts issue)
- ✅ `bun test test/reload.test.ts` — 13/13 pass
- ⚠️ UNVERIFIED: actual `/reload` command in live app

  **Why**: The live `/reload` path requires:
  1. Running daemon (bun src/cli.ts or compiled binary)
  2. `/reload` command from room service
  3. Observing graceful close, rebuild, re-exec, shell reload, webview refresh

  This is an end-to-end integration test best driven by the app itself (curl + CDP verification per AGENTS.md § Testing). The refactor preserves all call sites and signatures; static verification (types + unit tests) gates correctness of extracted logic, but the full orchestration path remains UNVERIFIED until next live `/reload`.

## Breaking changes

None. All exports are new (no renames); http.ts private methods replaced with reload.ts calls, but no external callers exist. Module-internal refactor only.

## Next steps (optional)

1. **Test live `/rebuild`** via the running app (curl :8787/api/... + CDP app-screenshot) to confirm end-to-end path.
2. **Add integration test** for `discoverReloadPlan()` (mock filesystem + process.execPath).
3. **Metrics**: Instrument orphan self-exit events (count how often the fix triggers in production).
4. **Cleanup**: Consider extracting macOS-specific codesign logic into src/core/codesign.ts if it grows.
