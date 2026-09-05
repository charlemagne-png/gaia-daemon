# WEB-PARITY-20260905

Scope → `git diff pre-upstream-merge-20260904 main -- web/src` read per file.
Baseline → `main` at `dd005678`; lane restore commits after baseline noted.
Fence → web layer only; no `src/services/room/*` edits.

## Restored in this lane

| Item | Root cause | Fix | Commit |
|---|---|---|---|
| Sidebar grouping | `RoomTree()` rendered `visible.map(RoomNode)`; pre-merge `GroupedRooms()` day→project path dropped. | Reinsert `dayLabel()` + `GroupedRooms()`; add `room-day-head`/`room-project-*` CSS. | `bdc4d3d` |
| Composer mic | `VoiceButtons()` returned `[]` when `!state.snapshot`; mic class existed but render gated out before workspace snapshot. | Drop snapshot gate; mic renders consistently off-call. | `844c04f` |
| Sidebar subroom actions | Context menu lost `Open subroom` + inline summon picker; actions lost `openSubroom()`/`summonAgentInRoom()` wiring. | Restore web actions + context menu; pass `parentRoomId` through `selectRoom()`/`createRoom()`. | `1107820` |

## Full delta enumeration

| Path | Diff signal | Our feature risk | Status |
|---|---:|---|---|
| `web/src/actions.js` | 315 lines | subroom/summon UI actions, parentRoomId pass-through; notes/bookmarks/project actions absent | subroom/summon RESTORED; notes/bookmarks/project OPEN (server route absent/current lane web-only) |
| `web/src/api.js` | 16 lines | base URL / native bridge routing | REVIEWED; no missing UI found |
| `web/src/archtree/index.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/layout.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/model.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/params.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/port.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/renderer.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/archtree/theme.js` | added | upstream archtree feature | upstream/new; keep |
| `web/src/attachments.js` | 3 lines | attachment API/url seam | REVIEWED; no missing UI found |
| `web/src/composer-drafts.js` | added | upstream durable composer drafts | upstream/new; keep |
| `web/src/composer-drafts.test.js` | added | upstream test | upstream/new; keep |
| `web/src/composer.js` | 188 lines | mic/dictation, voice controls, glyph changes | mic RESTORED; other voice bits already restored by `dd00567` |
| `web/src/contextgate.js` | 3 lines | context gate API url seam | REVIEWED; no missing UI found |
| `web/src/css/composer.css` | added | upstream CSS split; composer sizing/voice button styling changed | REVIEWED; mic render fix in JS; no small missing CSS found |
| `web/src/css/native.css` | added | upstream native-shell CSS split | upstream/new; keep |
| `web/src/css/room.css` | added | room/process CSS split; sidebar group heads absent | group CSS RESTORED |
| `web/src/css/settings.css` | added | settings CSS split | REVIEWED; account-login UI still absent/open via settings.js |
| `web/src/css/trace.css` | added | trace/rich rendering CSS split | upstream/new + v2 parity; keep |
| `web/src/dario.js` | 3 lines | API url seam | REVIEWED; no missing UI found |
| `web/src/dictation-timeout.js` | added | upstream dictation timeout helper | upstream/new; keep |
| `web/src/dictation.js` | 76 lines | dictation origin, recovery, timeout behavior | REVIEWED; no missing UI found |
| `web/src/eventchannel.js` | 35 lines | upstream event transport helper | upstream/new; keep |
| `web/src/events.js` | 4 lines | event transport wiring | REVIEWED; no missing UI found |
| `web/src/gaia-think.test.js` | 2 lines | test fixture drift | REVIEWED; no UI feature |
| `web/src/glyphs.js` | added | upstream glyph constants | upstream/new; dd00567 consumes; keep |
| `web/src/links.js` | 90 lines | native/browser link opening parity | REVIEWED; no missing UI found |
| `web/src/links.test.js` | 133 lines | link tests rewritten | REVIEWED; no UI feature |
| `web/src/main.js` | 3 lines | mac titlebar install | upstream/new; keep |
| `web/src/native.js` | 38 lines | mac native titlebar inset | upstream/new; keep |
| `web/src/panel.js` | 490 lines | room ref in panel, checkpoints list, notes delete, queue pause/delete, account catalog/login richness | OPEN: checkpoints/notes/queue/account richness; larger panel reconciliation |
| `web/src/press-drag.js` | added | shared touch/drag reorder helper | upstream/new; keep |
| `web/src/readaloud.js` | 18 lines | absolute API URL + AudioContext error surfacing | upstream/new; keep |
| `web/src/render.js` | 11 lines | native drag region, resizer hit geometry | upstream/new; keep |
| `web/src/rich.js` | added | v2 rich payload/diff renderer | upstream/new + parity; keep |
| `web/src/settings.js` | 490 lines | theme-in-settings present; account login variants removed | OPEN: in-app account login variants/workspace grouping need separate settings lane |
| `web/src/sidebar.js` | 558 lines | grouping, subroom actions, project setter, workspace drag/collapse | grouping RESTORED; subroom/summon RESTORED; project setter OPEN (server route absent/current lane web-only); upstream drag/collapse kept |
| `web/src/state.js` | 36 lines | roomsShown cap, collapsed state, dictation origin | REVIEWED; no missing UI found |
| `web/src/statusbar.js` | 227 lines | room header redesign, theme palette, usage/account display | REVIEWED; no small missing UI found |
| `web/src/styles.css` | 2586 lines | upstream CSS split + palette rewrite; many old selectors removed | REVIEWED; no safe blanket restore; CSS-specific defects need live repro |
| `web/src/tabsbar.js` | 102 lines | chrome buttons removed, theme button, dictation chip, touch drag | REVIEWED; no small missing UI found |
| `web/src/themes.js` | 57 lines | default theme + persisted/preview theme model | upstream/new + parity; keep |
| `web/src/transcript.js` | 427 lines | avatars/glyphs/rich tool rendering/time separators; bookmarks removed | avatars/STT already restored by `dd00567`; bookmarks OPEN (server route/action absent) |
| `web/src/types.js` | 2 lines | theme payload typedef | REVIEWED; no UI feature |
| `web/src/voice.js` | 4 lines | absolute API URL for native voice stop | REVIEWED; no missing UI found |

## Open rows requiring non-small or non-web-only reconciliation

| Feature | Breaking mechanism | Bounded next fix |
|---|---|---|
| Room bookmarks/checkpoints | UI imports/buttons removed; current server routes/actions not present in this branch. | Dedicated bookmark route/action/transcript/panel restore; includes service route ownership check. |
| Notes delete / queued pause | Panel/actions lost controls; server route coverage incomplete vs pre-merge. | Reconcile actions + routes + panel in one lane; not safe as blind web graft. |
| Room project setter | Group display restored, but setter endpoint absent from current `src/server/routes/rooms.ts`; web-only button would 404. | Dario/server lane or separate full-stack lane restores `/project`, then add context menu button. |
| Settings account login variants | Current settings simplified accounts; pre-merge login variants/workspace account grouping gone. | Separate settings/account parity lane; preserve upstream settings split. |
