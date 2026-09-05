# Child → parent delivery

## Funnel

`launch` → child contract persisted before execution
`turnSettled` / fresh completion / watchdog / boot → `settleChildTurn`
`settleChildTurn` → event-driven descendant + queue settlement
sealed delivery id → stable outcome observation
parent result event → deterministic `summon-result:<child>:<delivery>`
parent receipt + callback queue → one atomic state mutation
child contract → `delivered` only after parent acceptance
post-seal resume → successor delivery id → same funnel

## Contract

- every summon child → `state.summon`; awaited orchestration included
- status → `running` until parent receipt; then `delivered`
- execution identity → always `summon.agentId`; `activeAgent` cannot reroute lane
- `deliver:"note"` → result note + active-parent-agent wake
- `deliver:"turn"` → result note + caller wake; unavailable caller → active-agent fallback
- idempotency → parent receipt key; triggers never suppress work
- clear/rewind → receipts for removed result events retired
- quiescence → lifecycle events; no polling

## Detached completion marker

Location → `<workspace>/.gaia/completion-markers/<id>.json`
Writer rule → temporary file + atomic rename into location
Boot → validate → arm child contract → append child result → `settleChildTurn`
Removal → only after parent receipt + child `delivered`

```json
{
  "version": 1,
  "id": "deploy-20260905-1",
  "childRoomId": "worker-deploy-20260905",
  "parentRoomId": "default",
  "agentId": "gaia",
  "deliver": "note",
  "reply": "Deployment completed successfully.",
  "completedAt": "2026-09-05T15:21:08.000Z"
}
```

Optional → `callerAgentId` with `deliver:"turn"`
Limits → ids `[A-Za-z0-9_-]`; reply ≤100 KB; known agent required

## Runner ownership

- canonical daemon → default port + matching canonical pidfile
- only canonical owner runs orphan sweep
- probe/secondary daemon → sweep skipped; zero signals
