# Refactor waves — 2026-09-05

## Plan principle
- No whole rewrite.
- Each wave → scoped, gateable, independently landable.
- Order → top pain first: auth + dropped subroom results.
- Style → reduce blast radius before broad cleanup.

## Wave 1 — auth-adjacent stability + subroom-result custody
- Risk → P0.
- Scope → account refresh/materialization; summon callback durability; stale launcher law.
- Files likely → `src/services/auth-cli.ts`, `src/services/account-login.ts`, `src/domain/accounts.ts`, `src/harness/spec.ts`, `src/harness/host.ts`, `src/services/summons.ts`, `src/services/room-service.ts`, `scripts/gaia-mobile.mjs`, tests.
- Fixes →
  - `gaia auth` routes through `HarnessSpec.accounts` descriptors.
  - Accounts writes atomic via domain helper; no direct `writeFileSync(ACCOUNTS_PATH)`.
  - Refresh updates same auth store consumed by `RunnerHost`.
  - Summon result delivery persists parent callback intent before/with result note.
  - Parent callback intent consumed only after successful steer or queued callback entry.
  - Mobile launcher removes `--dev` and `npm`.
- Gates →
  - `bun run check`.
  - touched tests only: `bun test test/account-login.test.ts test/runner-host-proxy.test.ts test/room-service.test.ts` plus new summon-delivery crash test.
  - grep gate: no `spawn('npm'|"npm")`, no `--dev` in active scripts except deprecation filter/comments.
  - real cheap `gaia summon` through daemon; output pasted by implementer.
- Acceptance →
  - Broken account refresh cannot update only one credential path.
  - Child room finishing while parent has `pendingTurn` always leaves durable parent work.

## Wave 2 — layer firewall + cycle kill
- Risk → P1.
- Scope → import direction; daemon/service cycle; core Pi SDK leak; harness→services leak.
- Files likely → `src/services/studio-service.ts`, `src/daemon.ts`, `src/core/attachments.ts`, `src/harness/tools-pi.ts`, `src/harness/spec.ts`, `src/services/*`, tests.
- Fixes →
  - Move `WorkspaceRegistry` interface/type out of `daemon.ts`.
  - Inject artifact/caryll tool deps into harness through neutral protocol.
  - Move image resize adapter out of `core`.
  - Add import-direction test/script.
- Gates →
  - `bun run check`.
  - cycle detector returns empty.
  - import gate: `core` no project-up imports; `harness` no `../services`; `services` no `../daemon`; `server` imports only `../daemon` + core HTTP/types.
- Acceptance →
  - No upward imports under intended layer graph.
  - No `src/daemon -> src/services/studio-service` cycle.

## Wave 3 — server-thin facade
- Risk → P1.
- Scope → HTTP route logic extraction; harness/canvas/account endpoint handlers behind daemon/service APIs.
- Files likely → `src/server/http.ts`, `src/daemon.ts`, `src/services/harness-api.ts`, `src/services/canvas.ts`, `src/services/settings.ts`, tests.
- Fixes →
  - Server owns parse/respond only.
  - Harness token/capability routing moves to service.
  - Canvas prompt room resolution moves to daemon/service.
  - Account/model validation single helper shared by UI + CLI.
- Gates →
  - Existing HTTP tests touched route groups.
  - import gate from Wave 2 remains green.
  - route branch count/LOC budget: `server/http.ts` under agreed ceiling.
- Acceptance →
  - CLI/HTTP/harness routes use same service functions for memory/recall/summon/resume/account validation.

## Wave 4 — RoomService split: queue/WAL/snapshot/callback
- Risk → P1.
- Scope → shrink `room-service.ts`; remove `queuedTasks` mirror drift.
- Files likely → new `src/services/room-queue.ts`, `room-wal.ts`, `room-snapshot.ts`, `room-callbacks.ts`; `room-service.ts`; tests.
- Fixes →
  - Snapshot queued tasks derived from `state.queue`.
  - Active/recent task state isolated.
  - Queue pause/drop/drain owns one module.
  - WAL resume/commit wrapper owns pending-turn transitions.
  - Callback delivery intent module shared by summons + agent dialogue.
- Gates →
  - Crash-simulation tests: enqueue→restart; pendingTurn→restart; callback→restart; pause/drop during drain.
  - `room-service.ts` reduced below agreed ceiling without behavior change.
- Acceptance →
  - State invariant test: durable queue == visible queued task chips after every operation/restart.

## Wave 5 — command/service decomposition
- Risk → P2.
- Scope → slash command execution; context gate; sanitize/love/berserk; ambient watchdog.
- Files likely → `src/services/commands.ts`, `src/services/room-service.ts`, new command modules.
- Fixes →
  - Command registry maps to command handlers with explicit deps.
  - Durable vs synchronous command semantics declared per command.
  - At-least-once replay commands audited for idempotence or marked safe.
- Gates →
  - Per-command tests for `/queue`, `/note`, `/cancel`, `/summon`, `/rebuild`, `/love sanitize`, context gate.
  - command handler LOC budgets.
- Acceptance →
  - Adding command touches registry + handler only; no room-service monolith edit for simple command.

## Wave 6 — harness runtime convergence
- Risk → P2/P1 depending surface.
- Scope → session/tool/proxy/common runtime code across pi/claude/codex/antigravity.
- Files likely → `src/harness/{pi,claude,codex,antigravity}.ts`, `sessions.ts`, `host.ts`, `bridge-deps.ts`, tests.
- Fixes →
  - Keep irreducible protocol adapters per harness.
  - Extract common tool-building, attachment translation, session-store wiring where duplicated.
  - All harness capabilities declared as data on spec.
- Gates →
  - Runtime fixture tests per harness touched only.
  - grep: no shared `harness ===` branches.
  - new harness stub can register without shared-code edit except import/registration list.
- Acceptance →
  - Harness-specific code only adapter + `registerHarness({...})` data.

## Wave 7 — repo hygiene + dead/stray classification
- Risk → P2.
- Scope → unreferenced modules; historical docs; npm/node references; package-lock.
- Files likely → `src/harness/antigravity.ts`, `src/harness/sandbox/*`, `src/services/stt-apple.ts`, `src/services/memory-eval.ts`, `scripts/cf-worker/README.md`, root docs.
- Fixes →
  - Mark registered entrypoints explicitly or delete/move dead code.
  - Update scripts/docs to bun-only active commands.
  - Move historical plans to `docs/history` if still useful.
- Gates →
  - dead-export scan produces allowlisted entries only.
  - grep gate for active docs/scripts: no `npm/npx/node` invocation except explanatory retired-history docs and Node stdlib imports.
- Acceptance →
  - New contributor cannot copy retired launcher path from active docs.

## Wave 8 — type/domain budget cleanup
- Risk → P2.
- Scope → `src/core/types.ts` split; file-size budgets.
- Files likely → `src/core/types.ts`, related imports.
- Fixes →
  - Split transport/event/task/config/domain types by bounded modules.
  - Keep core dependency-free.
  - Add LOC budget report to check or CI script.
- Gates →
  - `bun run check`.
  - no runtime import cycles.
  - type-only imports preserved where possible.
- Acceptance →
  - No single type module becomes universal choke point.

## Proposed order
1. Wave 1 — auth/subroom custody.
2. Wave 2 — layer firewall/cycle kill.
3. Wave 3 — server-thin facade.
4. Wave 4 — RoomService queue/WAL/snapshot split.
5. Wave 5 — command decomposition.
6. Wave 6 — harness runtime convergence.
7. Wave 7 — repo hygiene.
8. Wave 8 — type/domain budget cleanup.

## Non-goals
- No live daemon restart in audit lane.
- No all-at-once rewrite.
- No human approval gates for summons.
- No harness-id branch exceptions in shared code.
