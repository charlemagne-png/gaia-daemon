# HN Widget Native Shell Fix — Root Cause & Solution

## LIVE DEFECT
Links in HN widget entries were not opening in the real app, despite click-through verification passing.

## ROOT CAUSE ANALYSIS

**The Problem:**
- GAIA app shell is a native Tauri app, not a web browser
- Tauri webview doesn't handle `target="_blank"` on bare `<a>` elements
- Silent failure: clicks work, but no new window opens
- Bare `window.open()` calls are also ignored in native shell

**Evidence:**
- Anchor attributes present and correct: `href`, `target="_blank"`, `rel="noopener"`
- Click path verified via `document.elementFromPoint()` — nothing blocks clicks
- But no actual browser window opens in native app
- Native shell (Tauri) requires explicit IPC call `open_web_window` command

**Cross-reference:**
- `links.js` solved this pattern correctly:
  ```javascript
  async function openWebTarget(target) {
    const url = normalizeWebTarget(target);
    if (isNative()) {
      await openWebWindow(url);  // ← Tauri IPC
      return;
    }
    window.open(url, "_blank", "popup,noopener,noreferrer");  // ← Browser fallback
  }
  ```
- HN widget was using only `window.open()` (browser-only pattern)

## SOLUTION IMPLEMENTED

**Commit:** `4c34abc` — fix: HN widget native shell external link handling

**Changes:**
1. Import `isNative`, `openWebWindow` from native.js (line 31)
2. Store URL in `renderHNStory()` before creating tile
3. Add onclick handler to anchor:
   ```javascript
   onclick: async (event) => {
     if (isNative()) {
       event.preventDefault();
       event.stopPropagation();
       await openWebWindow(url);
     }
   }
   ```
4. Browser mode: default anchor behavior (window.open fallback)
5. Native mode: explicit Tauri IPC call

**Proof (via CDP :9333):**
- Click dispatched on HN tile href="https://swarmtraces.org/"
- Environment: native (Tauri: true) ✓
- Tauri IPC ready to invoke open_web_window after app rebuild

## DEPLOYMENT NOTES

- **Current state:** Code committed, app must rebuild to pick up changes
- **App rebuild:** Use `/rebuild` command or Cmd-R (no auto-reload in compiled mode)
- **Browser fallback:** Code still works in pure web browsers (window.open path)
- **Test:** Click on HN tile after rebuild → opens URL in system browser

## RELATED

### quick-links.js — Identical Bug Flagged

**Issue:** quick-links.js uses same broken pattern:
```javascript
tile.addEventListener("click", () => {
  window.open(link.url, "_blank", "noopener,noreferrer");
});
```

**Status:** NOT FIXED (per instructions: flag, don't fix foreign files)
**Solution:** Apply same pattern as HN widget — import and use `openWebWindow()` in native mode

---

**Root Cause:** Native shell (Tauri) IPC pattern required
**Impact:** All external-link widgets need this pattern
**Pattern Source:** links.js (proven working reference)
**Commits:** a0f17a7, 7a30744, 4c34abc
