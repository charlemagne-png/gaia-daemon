# Applications — architecture spec

Status → proposal · spec-only lane · 2026-09-05
Order → Applications section → create + launch Gaia-supported work surfaces
First apps → Design · Studio

## 0 · Laws

- harness abstraction absolute → app requirements = data · shared resolver only · zero `harness === ...`
- layering → `server → daemon → services → harness → domain → core` · wire contracts in `src/harness/protocol.ts` only when agent-runtime transport changes
- durability → definitions + instances + source + revisions on disk before success/event · browser memory never authority
- workspace scope → app definition + source
- room scope → open instances + selection + support-room binding
- arbitrary app code → sandboxed iframe only · never import workspace-authored JS into GAIA shell
- compiled Bun app → built-in shell modules shipped in snapshot · runtime-created apps need no daemon rebuild
- multi-human + multi-AI → optimistic concurrency · actor metadata · broadcast after commit
- trust → existing agent/sandbox resolution unchanged · app never weakens trust
- capabilities → requested tool ids intersect existing agent config + harness spec data · no app-granted privilege

## 1 · Existing proto-app map

### 1.1 Design / artifacts

Source:

- `web/src/design` → symlink to `design/web`
- `design/web/ARTIFACT-SPEC.md` → original room-local artifact drawer contract
- `design/web/artifacts.js` → module-local `artifacts/roomId/panelOpen/selectedId` · transcript fence detection · localStorage fallback · attempted room API hydration/save
- `design/web/artifact-panel.js` → `registerRegion("artifacts", ...)` · hard-coded `#overlay-artifacts` · prompt → composer send path
- `design/web/artifact-canvas.js` → design-payload editor inside artifact drawer
- `web/src/transcript.js` → detects artifact fences on rendered events
- `web/src/composer.js` → hard-coded `/design` + artifact prompt prefix
- `web/src/statusbar.js` → hard-coded Artifacts toggle segment
- `web/src/render.js` → hard-coded `artifacts` region + `#overlay-artifacts`
- `web/src/main.js` → side-effect import of artifact panel

Durable daemon seam:

- `src/domain/artifacts.ts` → manifest contract · kinds `html|json|design`
- `design/src/artifacts.ts` via `src/services/artifacts.ts` re-export → atomic payload + manifest ledger
- storage → `<workspace>/.gaia/rooms/<roomId>/artifacts/<artifactId>/{manifest.json,payload}`
- `src/daemon.ts` → room→workspace discovery · list/read/payload/patch/screenshot · artifact→Studio binding
- `src/server/http.ts` → `/api/rooms/:room/artifacts...`
- harness tool registry → `GaiaTool "artifact"` · one DATA entry in `src/harness/tools.ts` · existing per-harness support declared in harness specs

Fault line:

- browser artifact shape = `{id,kind,content,updated}`
- daemon shape = `ArtifactManifest` + separate payload · manifest key `artifactId`, ISO `updatedAt`
- browser POST save path still follows obsolete stub contract; server exposes no matching generic POST
- localStorage therefore remains a competing authority

### 1.2 Free design canvas

Source:

- `web/src/canvas.js` → second, separate canvas implementation · global mutable state · direct `document.body` mount · direct fetch
- `web/src/main.js` → unconditional `initCanvas()`
- `web/src/events.js` → hard-coded `canvas-command` switch
- `src/server/http.ts` → hard-coded `/api/canvas`, `/api/canvas/prompt`, `/api/canvas/save`
- `src/daemon.ts#getOrCreateCanvasPromptRoom` → design-name→room map in global `~/.gaia/app.json`
- autosave → `~/Designs/gaia-design/<slug>.json`
- support affinity → hard-coded `@dieter`

Fault line:

- not workspace-bound by default
- canvas state not loaded from authoritative save on boot
- prompt-room relation stored globally rather than in workspace/room app state
- event broadcast reaches all clients without app-instance routing
- duplicate canvas concept beside artifact design canvas

### 1.3 Studio

Browser:

- `web/src/studio/{state,actions,panel}.js` → separate global singleton · own API actions · `registerRegion("studio", ...)`
- `web/src/main.js` → hard-coded imports · `/studio` route parser · route-only boot fork
- `web/src/events.js` → four hard-coded Studio event handlers
- `web/src/native.js` → hard-coded `mode:"studio"`
- `web/src/studio/panel.js` → expects `#studio-root` for in-shell mode; current skeleton does not create it
- Studio selection only in `sessionStorage`; project/version durable server-side

Daemon:

- `src/domain/design-studio.ts` → project/version/path/view contracts · traversal guards · HTML instrumentation
- `src/services/studio-service.ts` → workspace registry · content-addressed revisions · optimistic `baseVersionId` save · preview/assets · support prompt through ordinary `RoomService.sendMessage`
- workspace registry → `<workspace>/.gaia/design-studio.json`
- revision ledger → `<workspace>/.gaia/rooms/<roomId>/studio/<projectId>/{head.json,versions/,blobs/}`
- source → workspace path; effective source may redirect to room `workDir`
- `src/daemon.ts` → singleton service wiring + artifact bridge
- `src/server/http.ts` → `/api/studio/projects...`
- `src/core/types.ts` → Studio-specific `UiEvent` variants

Strong seam worth retaining:

- app work → normal durable room turn
- app prompt → `RoomService.sendMessage`
- effective source follows room worktree
- save → optimistic revision id
- preview → isolated iframe/CSP

### 1.4 `panel.js` / `state.js` relation

- `web/src/panel.js` → room controls, agents, tasks only · no app host abstraction
- `web/src/state.js` → shell-wide singleton · no app catalog/instance state
- Design + Studio bypass right-panel composition → independent overlays/singletons/imports
- `web/src/render.js` region union/order + static mount slots = current de facto app registry

## 2 · Model

Terms:

- application definition → launchable capability + presentation metadata
- application package → workspace-authored files for one definition
- application instance → one app opened in one room · durable identity + app-owned state pointer
- surface → shell host slot rendering one instance
- support binding → agent affinity + room through which Gaia works on instance

Cardinality:

- workspace → many definitions
- room → many instances
- definition → many room instances
- instance → exactly one owner room + one support room; initially same room
- Studio project/artifact → app-owned resource referenced by instance; no duplicated payload

IDs:

- `appId` → stable definition slug · `[a-z][a-z0-9-]{1,47}`
- `instanceId` → generated opaque id
- `surfaceId` → generated per open surface; Wave 1 = one surface per instance
- never key identity by display name, source path, agent id, or harness id

## 3 · Manifest as DATA

Canonical domain type → `src/domain/applications.ts`

```ts
interface ApplicationManifestV1 {
  schema: 1;
  id: string;
  name: string;
  description?: string;
  icon: { kind: "symbol" | "asset"; value: string };
  panel: {
    kind: "native" | "studio";
    entry: string;
    defaultSize?: "drawer" | "workspace" | "full";
    popout?: boolean;
  };
  agent: {
    preferred?: string[];
    role?: string;
    fallback: "active" | "workspace-default";
    context?: string;
  };
  tools: string[];
  resources?: Array<"artifact" | "files" | "versions" | "preview">;
  source?: { root: string; entry: string };
  createdBy: { kind: "builtin" | "human" | "agent"; id?: string };
  createdAt: string;
  updatedAt: string;
}
```

Rules:

- `panel.entry` = logical renderer id for `native`; workspace-relative file for `studio`
- native renderer registry compiled into shell → `registerApplicationPanel(entry, lifecycle)`
- workspace manifest cannot declare `native`
- workspace-created app → `panel.kind:"studio"` only → sandboxed iframe via generalized Studio preview
- `preferred` = ordered agent ids, not authorization
- unknown preferred agent → fallback policy
- `tools` = requested existing GAIA/native tool vocabulary
- effective tools → `manifest.tools ∩ effectiveAgentTools ∩ selectedHarness.capabilities` through one shared resolver
- unknown tool → manifest validation error
- no secrets, tokens, shell commands, absolute paths, CSP exceptions, provider/model/harness ids
- manifest schema parsed/normalized in domain layer; browser consumes validated server DTO only

Built-in seed data:

```js
[
  {
    id: "design",
    name: "Design",
    icon: { kind: "symbol", value: "◇" },
    panel: { kind: "native", entry: "design", defaultSize: "workspace", popout: false },
    agent: { preferred: ["dieter"], fallback: "active", context: "visual artifact and canvas work" },
    tools: ["artifact"],
    resources: ["artifact", "versions", "preview"]
  },
  {
    id: "studio",
    name: "Studio",
    icon: { kind: "symbol", value: "▣" },
    panel: { kind: "native", entry: "studio", defaultSize: "workspace", popout: true },
    agent: { preferred: [], fallback: "active", context: "inspect, edit, preview, and iterate source" },
    tools: ["read", "write", "edit", "artifact"],
    resources: ["files", "versions", "preview"]
  }
]
```

Built-in manifest location → one shared data module; server canonical copy + browser DTO generated from API response · no duplicated hand-authored lists.

## 4 · Durable storage

### 4.1 Definition/package storage

Workspace-created package:

```text
<workspace>/apps/<appId>/
  app.gaia.json
  index.html
  app.js
  styles.css
  README.md
```

Why workspace-visible source:

- user-owned + git-diffable
- agent can edit through ordinary file tools
- Studio worktree redirection can resolve same workspace-relative root
- no executable source hidden under daemon state

Workspace registry/index:

```text
<workspace>/.gaia/applications.json
```

Content → schema + `appId → {manifestPath,relativeRoot,createdAt,updatedAt}`
Purpose → discovery/index only · manifest remains package authority
Write → atomic · paths relative to workspace · rebuildable by scan

Built-ins → compiled read-only definitions · no files copied into workspace until “Duplicate as app”.

### 4.2 Room instance storage

`RoomState.applications`:

```ts
interface RoomApplicationsStateV1 {
  schema: 1;
  activeInstanceId?: string;
  order: string[];
  instances: Record<string, {
    instanceId: string;
    appId: string;
    supportRoomId: string;
    resource: { kind: "artifacts" | "studio-project" | "workspace-app"; id?: string };
    view?: string;
    createdAt: string;
    updatedAt: string;
  }>;
}
```

- mutate only through `RoomHandle.updateState`
- normalize in `domain/rooms.ts`; unknown app fields dropped
- snapshot includes validated room application state + workspace catalog summaries
- UI selection restored from snapshot, not local/session storage
- transient only → loading/error/focus/drag geometry/unsaved editor draft
- unsaved source draft → explicit dirty UI; never claim durable until save response

App-owned durable state:

```text
<workspace>/.gaia/rooms/<roomId>/applications/<instanceId>/state.json
<workspace>/.gaia/rooms/<roomId>/applications/<instanceId>/events.jsonl   # optional later
```

- generic host state only; large payloads remain in existing artifact/Studio ledgers
- state write → atomic + version counter
- no duplicate blobs under applications

### 4.3 Commit protocol

Create definition:

1. validate id + relative destination + manifest request
2. stage complete scaffold under sibling temporary directory
3. atomic rename stage→`apps/<appId>`
4. atomic update `.gaia/applications.json`
5. response + `application-catalog-changed` event
6. startup reconciliation → package exists/registry missing ⇒ index; registry entry/package missing ⇒ disabled diagnostic

Create instance:

1. resolve validated definition
2. create/reuse app resource through owning service
3. `RoomHandle.updateState` adds instance + active selection
4. snapshot/broadcast only after state commit
5. retry key `requestId` → same instance; no duplicate resource

Cross-file tear risk → explicit reconciliation; no distributed rollback fiction.

## 5 · Service + API seams

### 5.1 Layers

`src/core`

- ids + paths only
- add application paths; no app policy

`src/domain/applications.ts`

- manifest/registry/instance types
- parsers + validation + relative-path invariants
- no server/harness imports

`src/services/application-service.ts`

- catalog merge → built-ins + workspace packages
- scaffold + registry reconciliation
- launch/close/select via injected room access
- adapter dispatch by manifest/resource kind as DATA
- support-context assembly
- effective agent/tool resolution from injected generic contracts
- owns event emission after commit

`src/daemon.ts`

- construct service + inject registry, `serviceFor`, room handle lookup, broadcast
- thin methods only

`src/server/http.ts`

- parse/auth/status mapping only
- no scaffold filesystem logic · no agent choice · no app-id branches

`src/harness`

- Wave 1 → no protocol changes
- app work enters existing `RoomService.sendMessage`
- if future app-native tool added → one `GaiaToolSpec` + capability declared as data by every harness registration; shared code still app/harness-id blind

### 5.2 HTTP

```text
GET    /api/workspaces/:workspaceId/applications
POST   /api/workspaces/:workspaceId/applications
GET    /api/workspaces/:workspaceId/applications/:appId
PATCH  /api/workspaces/:workspaceId/applications/:appId
POST   /api/workspaces/:workspaceId/rooms/:roomId/application-instances
PATCH  /api/workspaces/:workspaceId/rooms/:roomId/application-instances/:instanceId
DELETE /api/workspaces/:workspaceId/rooms/:roomId/application-instances/:instanceId
POST   /api/workspaces/:workspaceId/rooms/:roomId/application-instances/:instanceId/prompt
```

Create definition body:

```json
{
  "requestId": "client-generated",
  "id": "campaign-planner",
  "name": "Campaign Planner",
  "icon": "◎",
  "description": "Plan campaign briefs and milestones",
  "agent": { "preferred": ["gaia"], "fallback": "active" },
  "tools": ["read", "write", "edit"]
}
```

Create definition result → validated manifest + source paths + launchable false/true + diagnostics.

Create instance body → `{requestId,appId,resource?,view?}`
Prompt body → `{text,baseVersion?,view?,selection?}`
Prompt result → existing durable `Task` identity + support room id.

API constraints:

- workspace id + room id checked together; no global room scan for scoped routes
- package path fixed from app id; no client absolute path
- body limits + known fields only
- update requires `baseUpdatedAt` or revision token → 409 on stale manifest/state
- iframe assets served from instance-bound route; canonicalize + containment check every path
- CSP + sandbox at least Studio strength; no `allow-same-origin` with scripts

Events:

```ts
{ type:"application-catalog-changed", workspaceId, revision }
{ type:"application-instance-changed", workspaceId, roomId, instance, revision }
{ type:"application-resource-changed", workspaceId, roomId, instanceId, resourceVersion }
```

- generic event names only
- app host filters by workspace/room/instance
- artifact/Studio legacy events retained during migration; adapters translate to generic events once

## 6 · Applications UI

Placement → primary sidebar section below rooms or dedicated sidebar destination; label `Applications`.

Launcher:

- header → `Applications` + `＋ Create app`
- grid/list → icon · name · open-instance indicator · support agent
- built-ins first → Design · Studio
- workspace-created apps after built-ins
- click → activate existing room instance or create one
- context actions → Open · Duplicate · Edit manifest · Archive; no destructive delete in first wave
- room instance tabs inside application workspace; multiple apps remain addressable

Host:

```text
#application-shell
  launcher | active surface
  common chrome → back · app identity · agent chip · save state · popout(if allowed) · close
  #application-surface
```

- one generic `applications` render region
- one static mount slot
- `ApplicationPanelRegistry` maps native logical entry→lifecycle
- lifecycle → `{mount, update, unmount, beforeClose?}`
- host owns selection/chrome/popout; app owns inner surface
- iframe app receives narrow `postMessage` bridge → instance identity + theme + save/prompt intents; origin/source/schema validation required
- iframe never receives bearer token, raw room state, filesystem path, agent credentials, or direct daemon mutation authority
- UI bridge converts allowed intents to scoped API calls

State module:

- `state.applications.catalog`
- `state.applications.instances`
- `state.applications.activeInstanceId`
- `state.applications.transientByInstance`
- server snapshot replaces durable slices
- no one singleton per app

`main.js` after migration:

- imports Applications host + built-in panel registration modules
- no route parser by app id
- generic `/applications/:instanceId` route/popout
- no unconditional free-canvas body mount

`panel.js` after migration:

- remains Room/Agents/Tasks only
- optional compact “open applications” summary generated from snapshot
- never imports Design/Studio

## 7 · Create-app flow

### 7.1 Human

1. Applications → Create app
2. fields → name · id preview · icon · purpose · preferred support agent · requested tools
3. permission summary → “requests X; effective tools depend on selected agent”
4. POST create with request id
5. daemon scaffolds package + indexes definition
6. daemon creates current-room instance
7. host opens generated `index.html` through sandboxed Studio-backed surface
8. common prompt → support agent iteration in instance support room
9. edits + preview + versions use generalized Studio resource

Default scaffold:

- useful empty state, not blank page
- host bridge client with save/prompt protocol
- manifest + README in telegraphic context notation
- zero external dependencies
- relative assets only
- no build step

### 7.2 Gaia / agent

Agent entry points:

- same HTTP service through future `gaia app create|list|open|prompt` tool/CLI descriptor
- first implementation may create through user message→existing file tools only after service tool lands; do not invent shell-side direct registry writes
- tool operation invokes `ApplicationService`; never edits `.gaia/applications.json` directly
- caller identity from harness bearer claims; body cannot spoof actor/workspace/room
- requested app tools do not change caller grants

Support prompt assembly:

```text
§ GAIA Application
app → <appId> · <name>
instance → <instanceId>
room → <supportRoomId>
source root → <effective worktree-relative absolute path>
entry → <entry>
resource head → <revision>
view/selection → <validated compact context>
instruction → <human text>
write boundary → <source root>
finish → edit · inspect preview · report changed paths
```

- assembled once in `ApplicationService`
- target resolution → preferred available agent → fallback policy
- send → generic `RoomService.sendMessage`; normal queue/WAL/event reservation applies
- no `@dieter` literal in transport code
- affinity changes target only; trust/sandbox/tools stay standard

## 8 · Design + Studio migration

### Design adapter

Definition → built-in `design`.

Resource modes:

- room artifact collection → existing artifact ledger
- design artifact → existing `ArtifactCanvas`
- free canvas document → migrate to durable `design` artifact payload or Studio project; one canonical document format selected before deleting legacy canvas save

Migration steps:

1. register native Design panel under logical entry `design`
2. launcher opens room instance bound to room artifact collection
3. adapt browser DTO to daemon `ArtifactManifest` + payload endpoint; remove obsolete POST stub
4. snapshot instance selection replaces localStorage authority
5. move statusbar `/design` entry to generic application launch/prompt intent; compatibility alias retained
6. route canvas commands by `instanceId`; eliminate global broadcast switch
7. import legacy `~/Designs/gaia-design/*.json` explicitly, never silently
8. remove unconditional `initCanvas()` only after import + parity gate

### Studio adapter

Definition → built-in `studio`.

Migration steps:

1. register native Studio panel under logical entry `studio`
2. add Studio project reference as application instance resource
3. generic host supplies real mount point; remove missing `#studio-root` assumption
4. active instance/project from RoomState snapshot; sessionStorage only transient view fallback during migration
5. generic popout route/window intent carries `instanceId`; compatibility `/studio?project=` translates once
6. generic resource events wrap Studio events; old listeners retained until all clients migrated
7. keep `StudioService` revision/blob/path implementation intact behind adapter
8. later rename API/storage only with explicit schema migration; not required for Applications v1

Compatibility:

- existing artifacts remain readable at unchanged paths
- existing `.gaia/design-studio.json` + version ledgers remain authority
- old URLs redirect/translate, never copy resources
- room deletion still moves whole room directory → app instance data follows existing reversible delete

## 9 · Build waves — independently shippable

### Wave 0 · Contracts + read-only catalog

Ship:

- domain manifest parser + built-in catalog data
- `GET .../applications`
- snapshot catalog summary
- Applications launcher read-only; Design/Studio cards may call legacy open actions

Gate:

- malformed manifests rejected
- zero harness changes
- current Design/Studio paths unchanged
- `bun run check` + focused domain/service/API tests + running-app launcher proof via headless throwaway port/artifact tab

### Wave 1 · Generic shell + built-in adapters

Ship:

- one Applications render region + host slot
- native panel lifecycle registry
- durable RoomState instances/active selection
- Design + Studio adapters behind cards
- generic app-instance events

Gate:

- reload restores active instance
- room switch isolates instances
- simultaneous clients converge from snapshot/event
- legacy direct launch still works

### Wave 2 · Create app scaffold

Ship:

- validated workspace package scaffold
- atomic workspace registry + reconciliation
- declarative create UI
- generated app opens as sandboxed Studio-backed iframe
- duplicate built-in→workspace app option

Gate:

- traversal/symlink/collision/body-size tests
- crash points around rename/index reconciled
- created app survives reload + daemon re-exec
- workspace-created code cannot execute in shell origin

### Wave 3 · Gaia support bridge

Ship:

- generic instance prompt endpoint
- affinity resolver + effective-tool display
- support context + ordinary RoomService turn
- `gaia app` registry entry/tool available uniformly where harness capability data allows

Gate:

- real cheap `gaia summon`/turn through daemon → edits app → preview refresh
- each harness uses same app operation contract
- untrusted agent remains forced sandboxed
- prompt/tool request cannot escalate grants

### Wave 4 · Design durability convergence

Ship:

- artifact DTO/API authority in browser
- free canvas→artifact/Studio import
- instance-scoped canvas events + support binding
- localStorage only one-time migration marker/transient preference

Gate:

- existing room artifacts unchanged
- legacy canvas import checksum + explicit confirmation
- no global `canvas-command` cross-room mutation

### Wave 5 · Route/event cleanup

Ship:

- generic popout route/window mode
- remove legacy singleton boot forks, mount slots, event switches, `/api/canvas*` after compatibility telemetry/tests
- optional app archive lifecycle

Gate:

- old Studio links translate
- no Design/Studio id branches in host/service
- source grep + architecture test enforces adapter registration as data

## 10 · Test contract per wave

Domain:

- manifest parse/normalize round trip
- unknown fields/tool ids/panel kinds rejected
- relative path + symlink containment
- RoomState normalization preserves valid instances, drops corrupt entries

Service:

- catalog merge precedence → built-in id cannot be shadowed
- idempotent create request
- scaffold/index interruption reconciliation
- instance resource commit before RoomState pointer
- affinity unavailable→declared fallback
- effective tools = intersection, never union
- optimistic revision conflict

HTTP:

- workspace/room association
- status mapping 400/404/409/413/415
- no absolute path accepted
- actor identity cannot be spoofed

Web:

- launcher/card/open/close/restore
- switching rooms cannot leak selected resource
- iframe bridge rejects wrong source/schema/instance
- dirty draft survives render, warns on close
- generic host works with test app id unknown to shell

Required live proof:

- running app driven through `~/.gaia/skills/app-tools`
- no app restart/quit
- artifact tab default; headless throwaway port for isolated audit
- console exceptions read + visual screenshot when UI changed
- daemon changes → `bun run check` + directly touched `bun test test/<file>.test.ts`
- agent/support changes → real cheap summon/turn output

## 11 · DO NOT CHANGE

- do not restart LIVE daemon
- do not add dev/watch/auto-refresh mode
- do not execute workspace app JS as shell module
- do not let manifests grant tools, trust, accounts, credentials, provider, model, sandbox exceptions, or CSP exceptions
- do not branch shared code on harness id, app id, Design, or Studio
- do not add one API/service/render region/event switch per app
- do not bypass `RoomHandle.updateState` for room instance writes
- do not make browser localStorage/sessionStorage authoritative for app state
- do not move/copy existing artifact or Studio payloads during initial migration
- do not change artifact ledger paths/schema in Applications Waves 0–3
- do not change Studio version/blob semantics, optimistic concurrency, effective worktree resolution, or preview isolation in Applications Waves 0–3
- do not collapse app support rooms into hidden in-memory sessions
- do not hard-code `@dieter`, `@gaia`, or any preferred agent in transport logic
- do not use global `~/.gaia` for workspace application definitions/source
- do not permit absolute package paths or source roots from clients
- do not delete legacy canvas data automatically
- do not use npm/node/npx

## 12 · Decision log

- framework center → application definition + room instance; not panel module
- user-created execution → Studio-backed sandboxed iframe; not dynamic shell import
- source → visible `<workspace>/apps`; operational index/state → workspace/room `.gaia`
- existing Artifact + Studio ledgers → referenced resources; no v1 unification rewrite
- support → ordinary durable room turn; no separate agent runtime
- capabilities → manifest request + existing uniform intersection; never grant

## 13 · Riskiest seam

Room instance ↔ Studio project ↔ effective worktree source identity.

Current Studio mixes workspace-global path index, room binding, support room, source root, artifact exceptions, and room-worktree redirection. Applications adds many instances per room and retries across several atomic files. A naive adapter can bind an instance to the root checkout while its agent edits the room worktree, or leave a committed Studio project unreachable after RoomState write failure.

Containment → resource-first idempotent create · relative source identity · support-room-owned effective path resolution · RoomHandle-only instance commit · startup reconciliation · no early Studio schema/path rewrite.
