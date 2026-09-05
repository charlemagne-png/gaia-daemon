# Fenced fork series

## Contract

- purpose → Pascal merge survival; fork-only core orchestration grouped behind narrow hooks
- behavior → unchanged; compatibility surfaces preserve established imports
- rollback → reverse one feature row only; restore inline body named by module header
- harness abstraction → untouched; no harness-id branching

## Survival map

| feature | owning commits | fenced module(s) | shared call-site hook(s) | unchanged coverage |
|---|---|---|---|---|
| love + sanitize + rebirth | `b77c298` · `95335b0` · `63c1624` · `5861688` | `src/services/fenced/love-sanitize-rebirth.ts` | `src/services/sanitize.ts` → compatibility re-export; existing room hooks → `src/services/room/sanitize-facade.ts`, `src/services/room/commands-facade.ts` | `test/sanitize.test.ts` · `test/room-service.test.ts` · `test/commands.test.ts` |
| auto-heal | `773caa6` | `src/services/fenced/auto-heal.ts` | `src/services/room/ui.ts::maybeAutoHeal` → one delegation | `test/room-service.test.ts` sanitize + settle paths |
| auto-wake + stuck-turn watchdog | `dcb7c2b` · `8350bb2` · `0c93466` | `src/services/fenced/auto-wake-watchdog.ts` | `src/daemon/wiring.ts::recoverPendingTurns` → one delegation; `src/services/room-service.ts::maybeRequeueStall` → one delegation | `test/room-service.test.ts` durable custody + stall retry · `test/rooms.test.ts` pending/queue normalization |
| home-workspace pin | `0dafdde` · `4054c2d` | `src/domain/fenced/home-workspace-pin.ts` | `src/domain/agents.ts` → config hooks; `src/services/room-service.ts` → one source delegation; `src/daemon/wiring.ts` → one target delegation; `src/server/http.ts` → redirect delivery scope | `test/room-service.test.ts` → foreign-home redirect + target-room reuse/forwarding |
| GaiaVoice | `002b6d7` · `3710c50` · `3a81214` · `392edab` | `src/services/fenced/gaia-voice.ts` | `src/services/voice.ts` → compatibility re-export; established daemon/server/room imports unchanged | `test/voice.test.ts` · `test/voice-merge.test.ts` · `test/http-voice-speak-cancel.test.ts` · `test/voice-stt-bridge.test.ts` · `test/voice-tts-bridge.test.ts` |

## Baseline caveat

- `ccd88e2` baseline → config type + domain parse only; prior upstream merge removed cross-workspace redirect seam
- `4054c2d` restoration → human message source hook → home lookup by name/id → existing/new agent room → target-service forward → source-scoped navigation event
- internal producers → no redirect; harness path → unchanged

## Review commands

- behavior diff → `git diff main...HEAD -- test web/src/'*.test.js'` → empty
- static gate → `bun run check`
- tests → one file per `bun test test/<file>.test.ts`; never batched
