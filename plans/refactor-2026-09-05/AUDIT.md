# Refactor audit — 2026-09-05

## Scope
- Tree → `~/Documents/Codex/2026-07-31/i-wan/gaia-daemon-sep3`
- HEAD → `aeccde4`
- Mode → read-only source audit; plan docs only
- Laws → layering; harness abstraction; zero duplication; durability; structure

## Verdict
- HOLD → architecture holds in key WAL paths, but weak joints remain.
- P0 crack → auth/account path split + source-runtime law drift → Charles pain axis.
- P0 crack → parent callback can be skipped when parent has `pendingTurn` → dropped subroom result mechanism.
- P1 crack → layer boundaries porous; server/harness import upward; daemon/service cycle.
- P1 crack → god-files persist; local state shadows durable state.

## Evidence commands
- `git -C ... rev-parse --short HEAD` → `aeccde4`
- `grep -RInE "harness[[:space:]]*(===|!==|==|!=)|case ..." src test scripts web`
- `grep -RInE "from ['\"].*\.\./services|..." src/harness src/domain src/core`
- import-cycle script → `CYCLE 2 src/daemon -> src/services/studio-service`
- `find src -type f -name '*.ts' -exec wc -l {} + | sort -nr | head -30`

## Top 10 violations / cracks

### 1. P0 — dropped subroom callback seam
- Evidence → `src/services/room-service.ts:1446` returns when parent `state.pendingTurn` exists.
- Mechanism → child result note can commit; callback wake then returns; no durable queued pointer; if active turn cannot see appended note, caller never re-triages.
- Consequence → "dropped subroom results" under live parent turn / restart edge.
- Evidence gap → no crash/active-parent test proving result delivery always creates either steer or durable queue entry.
- Fix → delivery handshake service: append result note + durable callback intent in one room-state update; callback consumes intent only after steer accepted or queue entry persisted.

### 2. P0 — auth CLI bypasses account spec registry
- Evidence → `src/services/auth-cli.ts:33-71`, `src/services/auth-cli.ts:135-224` hardcode Anthropic/Pi OAuth, spawn `pi`, mutate `~/.gaia/accounts.json` directly.
- Mechanism → credential refresh path does not use `HarnessSpec.accounts.login/env/authStoragePath`; new harness/account shapes bypassed; writes non-atomic; staged auth dir hash derived from refresh token outside descriptor.
- Consequence → auth fixes land in one path while daemon runner uses another; account appears refreshed but runner still fails.
- Evidence gap → no test that `gaia auth refresh` updates same materialized credential store consumed by `RunnerHost`.
- Fix → move auth CLI behind `AccountLoginService` + `harnessSpecFor(...).accounts`; atomic domain account update; no provider literals in CLI.

### 3. P0 — mobile/start path reintroduces retired dev/npm
- Evidence → `scripts/gaia-mobile.mjs:100` spawns `bun src/cli.ts --dev`; `scripts/gaia-mobile.mjs:112`, `scripts/gaia-mobile.mjs:146` spawn `npm`.
- Mechanism → Pascal law says compiled bun app; dev mode deleted; npm retired. Mobile lane starts different daemon surface and different package manager.
- Consequence → source-vs-binary divergence; auth/reload/session bugs reproduce only on one launcher.
- Evidence gap → no gate grep for `npm|--dev` in scripts.
- Fix → mobile script uses compiled `gaia` or `bun src/cli.ts` without `--dev`; tauri via `bunx tauri`; add script-law grep gate.

### 4. P1 — harness layer imports services upward
- Evidence → `src/harness/tools-pi.ts:10-11` imports `../services/artifacts.js`, `../services/caryll.js`.
- Mechanism → harness tool factory reaches above harness into services; shared tool surface cannot remain harness-neutral; service implementations become Pi SDK load dependencies.
- Consequence → adding non-Pi harness tool parity risks copy/paste or hidden service coupling.
- Evidence gap → no import-direction gate.
- Fix → define `ToolDeps`/`GaiaToolHost` protocol in `harness/spec.ts` or `harness/protocol.ts`; services injected from `RoomService/Daemon`; harness consumes descriptor only.

### 5. P1 — daemon/service circular dependency
- Evidence → `src/daemon.ts:65` imports `StudioService`; `src/services/studio-service.ts:8` imports `WorkspaceRegistry` from `../daemon.js`; import-cycle script reports `src/daemon -> src/services/studio-service`.
- Mechanism → service depends on composition root type; composition root constructs service; any runtime import expansion can deadlock or blur ownership.
- Consequence → hard-to-split daemon; test stubbing requires daemon internals.
- Evidence gap → no cycle gate in check.
- Fix → move `WorkspaceRegistry` contract/type to `core`/`services/studio-types.ts`; studio depends on interface, not daemon.

### 6. P1 — server layer owns business/domain logic
- Evidence → `src/server/http.ts:21-30`, `src/server/http.ts:41-44` import domain/harness/services directly; `src/server/http.ts:1469-1516` resolves workspaces, checks room files, sends canvas prompts; `src/server/http.ts:1608-1769` implements harness tool routing.
- Mechanism → HTTP routes parse + decide + mutate; daemon public API bypassed.
- Consequence → CLI/HTTP/harness behavior diverges; auth/capability checks duplicated at route edge.
- Evidence gap → no route-thinness tests or import rule enforcing server→daemon only.
- Fix → route facade: server imports `Daemon` + core HTTP helpers only; move canvas/harness/account handlers into daemon/services.

### 7. P1 — core imports Pi SDK for image resizing
- Evidence → `src/core/attachments.ts:8` imports `resizeImage` from `@earendil-works/pi-coding-agent`.
- Mechanism → `core` now depends on harness package; core no longer zero-opinion; compiled binary pulls Pi SDK into base utilities.
- Consequence → future harness/runtime changes can break core attachment sanitation.
- Evidence gap → no "core imports only stdlib/core" gate.
- Fix → move image resizing into `harness/attachments.ts` or service adapter; core returns bytes/mime only.

### 8. P1 — durable queue mirrored in mutable in-memory task list
- Evidence → `src/services/room-service.ts:516`, `src/services/room-service.ts:687-709`, `src/services/room-service.ts:1000-1023`, `src/services/room-service.ts:1073-1074`, `src/services/room-service.ts:1614-1664`, `src/services/room-service.ts:4420`.
- Mechanism → `state.queue` is source of truth, but `queuedTasks` is independently mutated for UI/scheduling; race can show/drop/stale tasks when splice/update fails or concurrent drain runs.
- Consequence → apparent lost work or duplicated task chips; hard forensic trail.
- Evidence gap → no invariant test: snapshot tasks == normalized state.queue + active/recent across restart/cancel/pause.
- Fix → derive queued task chips from `RoomHandle.state().queue` on snapshot; keep only active/recent in memory.

### 9. P2 — god-files still concentrate mixed concerns
- Evidence → `src/services/room-service.ts` 5098 lines; `src/server/http.ts` 1972; `src/daemon.ts` 1782; harness runtimes `claude.ts` 1512, `codex.ts` 1262, `pi.ts` 1135; `src/core/types.ts` 1441.
- Mechanism → unrelated concerns share private state; small fixes require touching hot files; review misses cross-effect.
- Consequence → refactor blast radius remains high; Charles's "whole thing" pain persists.
- Evidence gap → no file-size/module-boundary budget.
- Fix → extract by seams: room queue/WAL, commands, snapshots, callbacks, context gate, voice; gate max file size after wave.

### 10. P2 — dead/stray module + historical Node docs remain in active tree
- Evidence → unreferenced scan includes `src/harness/antigravity.ts`, `src/harness/sandbox/cli.ts`, `src/harness/sandbox/none.ts`, `src/services/stt-apple.ts`, `src/services/memory-eval.ts`; `scripts/cf-worker/README.md:38-83` documents `npx`; `scripts/cf-worker/README.md:56` documents `exec node`.
- Mechanism → active tree contains unclear modules and retired invocation patterns; future edits copy dead paths.
- Consequence → regressions reintroduced from stale examples.
- Evidence gap → no dead-export/import inventory gate; no docs grep gate.
- Fix → classify each as registered entry vs dead; move historical docs to `docs/history` or update to bun-only.

## Harness abstraction grep verdict
- Direct `harness === "x"` in shared `src/` → none found.
- Data comparisons (`record.harness !== harnessId`) → acceptable validation if harness ids come from registry.
- Crack remains → auth CLI and Pi tool fallback hardcode provider/harness behavior outside spec-descriptor path.

## Durability verdict
- Strong evidence → `src/domain/rooms.ts:892-1056` implements durable queue, pending WAL, idempotent commit.
- Crack remains → callback delivery not wholly transactional across parent pending/live turn; queue UI mirror can drift; command replay is at-least-once (`src/services/room-service.ts:1093-1099`) not idempotence-proven.

## Layer map
- Intended → `server → daemon → services → harness → domain → core`.
- Actual exception → `harness/tools-pi.ts → services/*` upward.
- Actual exception → `services/studio-service.ts → daemon` upward/cycle.
- Actual exception → `server/http.ts → domain/harness/services` bypasses daemon facade.
- Actual exception → `core/attachments.ts → @earendil-works/pi-coding-agent` core opinion leak.
