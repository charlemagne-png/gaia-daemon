# PLUGIN-WAVE-1

## /note extraction

- Owner → `plugins/defaults/note.mjs`
- State → `RoomState.pluginState.note.items`
- Legacy seed → first plugin touch reads `.gaia/rooms/<roomId>/state.json.notes` → copies into plugin bucket · does not mutate `RoomState.notes`
- UI → `web/src/panel.js` reads `snapshot.room.pluginPanels.note.items` first · legacy `snapshot.room.notes` fallback only before plugin touch
- Rollback → revert note commit · legacy `RoomState.notes` still present

## turn-completion sound extraction

- Owner → workspace observer hook
- Script → `scripts/turn-completion-sound-hook.mjs`
- Default sound → `/Users/charleshamilton/Downloads/denielcz-achievement-unlocked-463070.mp3`
- Default ledger → `~/.gaia/turn-completion-sound.jsonl`
- Config path → `<workspace>/.gaia/config.json`
- Config snippet:

```json
{
  "hooks": {
    "postTurn": [
      { "command": "bun scripts/turn-completion-sound-hook.mjs" }
    ],
    "error": [
      { "command": "bun scripts/turn-completion-sound-hook.mjs" }
    ]
  }
}
```

- Test override knobs → `GAIA_TURN_COMPLETION_SOUND_PLAYER` · `GAIA_TURN_COMPLETION_SOUND_PATH` · `GAIA_TURN_COMPLETION_SOUND_LEDGER`
- Rollback → remove hook config · revert sound commit
