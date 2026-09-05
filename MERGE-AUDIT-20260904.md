# MERGE-AUDIT-20260904

## Stage 1 merge
- upstream → b72fea6 (`pascaldisse/gaia-daemon main`)
- merge commit → d2e63bc
- plugin infra → PRESENT intact
  - `src/services/plugin-host.ts`
  - `src/services/plugins.ts`
  - `src/services/room/commands-facade.ts`
  - `src/services/room/sanitize-facade.ts`
  - `plugins/defaults/dog-mode.mjs`
  - `docs/PLUGIN-RECON.md`
- resolution rule → Pascal seams kept; our features adapted onto room mixins/types/prompt seams

## Conflict resolutions
- `package.json` → union deps/scripts; upstream GraphQL/knip kept; our ACP dep kept
- `src/core/config.ts` → upstream web-fetch/GraphQL config kept; our title model `anthropic/haiku` kept
- `src/core/types.ts` → upstream barrel kept; our fields moved into split type files
- `src/core/types/{agents,events,harness,rooms,ui,workspace}.ts` → optional fields restored
- `src/domain/accounts.ts` → upstream canonical harness kept; our add/replace/workspace/providers helpers restored
- `src/domain/rooms.ts` → upstream shared-state locking kept; our queue/bookmark/note/mode fields restored
- `src/domain/workspace.ts` → upstream `RoomHandle.open` seed path kept; our parent/voice/predecessor seeds restored
- `src/harness/pi.ts` → upstream split Pi runtime kept
- `src/harness/{claude,codex}.ts` → our harness adapters retained; compat exports added
- `src/harness/{prompt,spec}.ts` → upstream diet/plugin prompt seams kept; our berserk/love/checkpoint overlays restored
- `src/services/room-service.ts` → upstream room mixin split kept; our command entries/options restored
- `src/services/room/*` → upstream facades kept; our command methods/turn hooks added through mixins
- `src/server/http.ts` + `src/server/routes/*` → upstream route split kept
- `web/src/*` → upstream UI kept; our action typings/voice options restored where needed
- tests → upstream test files kept; ours retained where still present

## Feature survival + upstream seam map
| Feature | Status | Current seam |
|---|---:|---|
| `/berserk` | PRESENT | `commands.ts` parse → `room-service.ts` registry → `RoomCommandsMixin.runBerserkCommand` → `AgentInput.berserk` → `prompt.ts` overlay |
| `/love` | PRESENT | `commands.ts` parse → `room-service.ts` registry → `RoomCommandsMixin.runLoveCommand` → `AgentInput.love` → `prompt.ts` overlay |
| `/love sanitize` | PRESENT | `RoomCommandsMixin.runLoveSanitize*` → upstream `sanitize-facade.ts` proposal/apply |
| `/love sanitize rebirth` | PRESENT | `RoomState.rebirth` → `RoomCommandsMixin.runLoveSanitizeRebirthCommand` |
| auto-compact | PRESENT | `RoomUiMixin.settleTask` → `maybeAutoCompact` → durable `/compact` queue |
| auto-heal | PRESENT | `RoomUiMixin.settleTask` → `maybeAutoHeal` → durable `/love sanitize auto|rebirth` queue |
| auto-wake + stuck-turn watchdog | PRESENT | upstream `daemon/wiring.ts` recovery + `RoomService.recoverStuckTurn` anchors |
| bookmarks/checkpoints | PRESENT | `RoomState.bookmarks`/`RoomBookmark` → `RoomHandle.setBookmark` → snapshot/summary → `AgentInput.checkpoints` → prompt block |
| `/queue` + pause | PRESENT | `commands.ts` parse → durable `QueuedMessage.paused` + `RoomService.drain` skip |
| `/note` | PRESENT | `commands.ts` parse → `RoomHandle.addNote` → snapshot room notes |
| home-workspace pin | RESTORED | `4054c2d` → fenced config + human source routing → daemon-owned name/id lookup, target-room create/reuse + forward → source-scoped redirect delivery |
| GaiaVoice/dictation | PRESENT | voice state/types + `web/src/voice-control.js` + STT commands/transcribe services |
| turn-completion sound | PRESENT | `RoomServiceOptions.turnSettled` → `RoomUiMixin.settleTask` → `daemon/wiring.ts` → `playTurnCompletionSound` |
| payload guard 1MB/24MB | PRESENT | `core/http.readRawBody(maxBytes)` + upload/transcribe caps |
| title-refine | PRESENT | `DEFAULTS.roomTitleModel=anthropic/haiku` + `RoomUiMixin.refineAutoTitle` |

## State-format audit
- upstream schema delta → `src/core/types.ts` split into `src/core/types/*`; barrel preserves import path
- `RoomState` upstream additions → optional only: `goal`, `pluginState`, `conversationEndedAgents`, `humans`, context/diet fields
- our restored `RoomState` additions → optional only: `refCode`, `berserk`, `love`, `teleport`, `rebirth`, `autoHeals`, `subroom`, `project`, `bookmarks`, `notes`, `voiceDispatch`, `voiceRotatedTo`, `predecessorRoomId`, `voiceSession`
- `QueuedMessage` upstream additions → optional only: `goalStartedAt`, `pluginMessageTurn`, `humanId`, `humanLabel`
- our restored `QueuedMessage` additions → optional only: `voice`, `paused`
- `SummonDelivery` upstream additions → optional only: `resumeStatus`, `resumeStartedAt`
- transcript event schema → additive: `renderCap`, `blocks`, `skill`, `summonResult`, `humanId/humanLabel`; legacy readers preserved
- accounts schema → additive optional `workspace`, `providers`; canonical harness normalization only
- migrations required → NONE found
- breaking/corrupting state change → NONE found
- verdict → SAFE-ADDITIVE; live rooms should reopen without state rewrite beyond normalizer preserving known optional fields

## Gate notes
- `bun install` run in worktree → hydrated upstream `graphql-yoga`/GraphQL deps
- `bun run check` before merge commit → TypeScript passed; `knip --no-exit-code` advisory findings only
