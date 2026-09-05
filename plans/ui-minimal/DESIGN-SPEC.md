# GAIA UI Minimal-Futuristic Redesign Spec

## § INVARIANTS — sacred logic paths

Every behavior/interaction/data flow Charles built = untouchable. UI = new skin over identical bones.

**Layout structure preserved:**
- 3-column grid (sidebar · main · panel) + resizable panes
- Tab = room metaphor (tmux window bar)
- Regional rendering (dirty-set, no re-render entire app)
- Overlay system (modals, palettes, popovers mount in slots)
- CDP :9333 headless proof path unchanged

**Interaction model unchanged:**
- Bare-key routing (typing anywhere lands in composer)
- Paste/drop-anywhere file attachment
- Autocomplete (@agents, /commands)
- Keyboard shortcuts (Cmd/Ctrl+T new, Esc stop, Cmd+K search, etc.)
- Right-click context menus (rooms, agents, workspaces)
- Drag-reorder tabs, tear-off windows (native)
- Voice dictation, read-aloud, voice calls

**Data bindings stay:**
- state.snapshot drives everything
- markDirty(region...) triggers renders
- No prop drilling (modules import state directly)
- localStorage persistence (drafts, prefs, pane widths)

**Feature parity maintained:**
- All 11 themes (palette swatches recolor)
- All agent config (model, account, role, thinking per-room)
- All room modes (incognito, berserk, love, teleport)
- All composer modes (steer, queue, edit, ultrawhip)
- All task states (queued, paused, running, settled)
- All background process tracking
- All usage meters (session, weekly, per-model)
- All plugins (room-local overlays)

---

## § TOKEN SYSTEM — minimal futuristic foundation

Replace ad-hoc values with systematic scale. All spacing/type/color/radius/motion from ONE token set.

### Spacing (8pt grid + optical refinements)
```css
:root {
  --sp-0: 0;
  --sp-1: 4px;   /* tight inline gaps */
  --sp-2: 8px;   /* default row/column spacing */
  --sp-3: 12px;  /* card padding, section breathing */
  --sp-4: 16px;  /* panel padding, comfortable separation */
  --sp-5: 24px;  /* major section breaks */
  --sp-6: 32px;  /* dramatic isolation */
  --sp-7: 48px;  /* hero spacing (rarely) */
}
```

**Apply:** Every `padding`, `margin`, `gap` = token reference, never hardcoded px except 1px borders.

### Typography (modular scale 1.2 ratio, 13px base)
```css
:root {
  --font-mono: "Berkeley Mono", "JetBrains Mono", ui-monospace, monospace;
  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  
  --text-xs: 11px;    /* tertiary metadata, timestamps */
  --text-sm: 13px;    /* body, most UI (NEW BASE) */
  --text-base: 16px;  /* emphasized body, primary labels */
  --text-lg: 19px;    /* section headers */
  --text-xl: 23px;    /* modal titles */
  
  --lh-tight: 1.35;   /* dense lists, code */
  --lh-base: 1.5;     /* readable prose */
  --lh-loose: 1.65;   /* breathing headers */
  
  --fw-normal: 400;
  --fw-medium: 500;
  --fw-semibold: 600;
  --fw-bold: 700;
}
```

**Change from 12.5px → 13px base** = perceptual comfort (12.5 reads cramped on retina, 13 = minimum legible modern).

Hierarchy through size + weight, not ALL-CAPS shouting. Headers = semibold + larger, body = normal weight.

### Color (theme-agnostic structure)
Keep 11 theme palettes (tokyo-night default, cyberpunk, catppuccin, etc.) but enforce uniform semantic usage:

```css
/* Current vars stay (--bg, --fg, --accent, --muted, --border, etc.) */
/* Add semantic aliases for consistent application: */
:root {
  --surface-0: var(--bg);      /* deepest canvas */
  --surface-1: var(--bg2);     /* raised panels */
  --surface-2: var(--bg3);     /* interactive elements rest */
  --surface-3: var(--ink);     /* inset inputs */
  
  --text-primary: var(--fg);
  --text-secondary: var(--muted);
  --text-tertiary: color-mix(in srgb, var(--muted) 60%, transparent);
  
  --border-subtle: var(--border);
  --border-emphasis: var(--accent);
  
  --interactive-rest: var(--surface-2);
  --interactive-hover: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  --interactive-active: var(--accent);
}
```

**Principle:** De-emphasize non-critical info through opacity/secondary colors, not hiding. Let accent guide eye to actionable.

### Radius (smooth but not bubbly)
```css
:root {
  --r-sm: 4px;   /* chips, small buttons */
  --r-md: 6px;   /* cards, inputs */
  --r-lg: 10px;  /* panels, modals */
  --r-full: 999px; /* pills, avatars */
}
```

Current mix of sharp corners + occasional rounded = inconsistent. Apply systematically: interactive = rounded (approachable), static containers = subtle radius (clean not clinical).

### Motion (smooth futuristic feel)
```css
:root {
  --dur-instant: 0ms;    /* reduced-motion fallback */
  --dur-fast: 150ms;     /* micro-interactions (hover) */
  --dur-base: 250ms;     /* standard transitions */
  --dur-slow: 400ms;     /* enter/exit, large movements */
  
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);  /* decelerate (most transitions) */
  --ease-in: cubic-bezier(0.8, 0.2, 1, 0.2);   /* accelerate (exits) */
  --ease-inout: cubic-bezier(0.65, 0, 0.35, 1); /* smooth both ends (large motion) */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* overshoot (playful accents) */
}
```

**Apply:** Every transition/animation references tokens. Hover = `--dur-fast --ease-out`, panel open = `--dur-base --ease-inout`.

**LAW:** `@media (prefers-reduced-motion)` overrides ALL to `--dur-instant` (already present, preserve).

---

## § DE-CROWD PLAN — per surface breathing

### Tab bar (room windows)
**Current sins:**
- Tab num chip + dot + name + close all visible → cluttered 240px max-width per tab
- Double border (strip + active tab inset accent) = heavy

**Minimal approach:**
- Remove tab num chip (room count lives in statusbar "N rooms" segment, redundant here)
- Dot = status only (running green pulse, unread accent steady) — remove from name, float left in tab
- Close X = opacity:0 rest, show only on hover (already present, keep)
- Active tab = single 2px top border (inset box-shadow), not full border + shadow
- Spacing tighter: gap:6px between tabs (down from implicit)

```css
.tab {
  padding: 0 var(--sp-3) 0 var(--sp-2);
  gap: var(--sp-1);
  border-right: 1px solid var(--border-subtle);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast);
}
.tab.active { 
  background: var(--surface-0); 
  box-shadow: inset 0 2px 0 var(--accent); 
  border-right-color: var(--surface-0); /* blend into main */
}
.tab-dot { opacity: 0; } /* hidden unless .running or .unread */
.tab.running .tab-dot, .tab.unread .tab-dot { opacity: 1; }
```

**Result:** ~30% narrower tabs, visual weight reduced, breathing room.

### Sidebar (sessions tree)
**Current sins:**
- Every room row = dot + star + incognito + berserk + love + agent-chip + ref + name → 8 elements fighting for space
- Workspace + room + project grouping = 3 levels of headers (day-head + project-head + nav-title)
- Tight vertical rhythm (7px gap) feels cramped

**Progressive disclosure:**
- Room metadata (star, incognito, modes) = icons ONLY on hover or when room is current
- Agent chip = show only on current/hovered room, hide on rest (it's in right panel anyway)
- Ref code = show only when hovered (persistent visual noise for rare feature)
- Status dot ALWAYS visible (critical real-time signal)

```css
.room-item { padding: var(--sp-2) var(--sp-3); gap: var(--sp-2); }
.room-label { gap: var(--sp-1); }

/* Metadata collapses by default */
.room-star, .room-incognito, .room-berserk, .room-love, .room-agent, .room-ref {
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.room-item:hover .room-star, 
.room-item:hover .room-incognito,
.room-item:hover .room-berserk,
.room-item:hover .room-love,
.room-item:hover .room-agent,
.room-item:hover .room-ref,
.room-item.active .room-star, 
.room-item.active .room-incognito,
.room-item.active .room-berserk,
.room-item.active .room-love,
.room-item.active .room-agent {
  opacity: 1;
}

/* Day/project headers lighter, tighter */
.room-day-head {
  margin: var(--sp-3) 0 var(--sp-1);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.room-project-group { 
  margin-left: var(--sp-2); 
  padding-left: var(--sp-2); 
  gap: var(--sp-1);
}
```

**Result:** Cleaner scan path, metadata appears contextually, breathing increased 50%.

### Right panel (agents + tasks)
**Current sins:**
- EVERY agent row = 3 selects (model, account, role) + 3 buttons (talk, default, call) + description + status = 9+ controls ALWAYS visible
- Workspace grouping adds collapse headers but rows still dense
- Task list mixes settled history with live queue (old entries = noise)

**Collapse by default:**
- Config row (model/account/role selects) = HIDDEN rest, slide down on row hover or when agent is active
- Description = show only when hovered (tertiary detail)
- Workspace groups = collapsed by default UNLESS they contain the active/running agent
- Task history = show ONLY last 2 settled, ALL queued/paused (waiting queue must stay visible)

```css
.agent-row { 
  padding: var(--sp-2);
  gap: var(--sp-2);
  transition: background var(--dur-fast) var(--ease-out);
}
.agent-row:hover { background: var(--interactive-hover); }

.agent-config-row {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height var(--dur-base) var(--ease-inout), opacity var(--dur-base);
}
.agent-row:hover .agent-config-row,
.agent-row.active-agent .agent-config-row {
  max-height: 120px; /* enough for 2-row config */
  opacity: 1;
}

.agent-description {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height var(--dur-fast) var(--ease-out), opacity var(--dur-fast);
}
.agent-row:hover .agent-description {
  max-height: 60px;
  opacity: 0.75;
}

.workspace-group-header {
  padding: var(--sp-1) var(--sp-2);
  font-size: var(--text-xs);
  font-weight: var(--fw-semibold);
  gap: var(--sp-1);
}

.task-list .task:not(.queued):not(.paused):not(:nth-last-child(-n+2)) {
  display: none; /* hide old settled tasks beyond last 2 */
}
```

**Result:** Panel scans 60% faster, config appears when needed, active work highlighted.

### Composer
**Current sins:**
- 4 rows of controls (autocomplete + banner + input + status) stacked always
- Model chip + context chip + thinking control + voice buttons + ultrawhip = 5-7 elements in footer
- Target preview + model row feels redundant (both say who's listening)

**Consolidate:**
- Target status = merge with model chip (one element: "@agent · model · ctx%")
- Thinking control = icon-only button (💭), menu on click (not hover-title overload)
- Voice buttons = group tighter, icons only (already present)
- Ultrawhip chip = overlay top-right of composer when active (not footer clutter)

```css
.composer { padding: var(--sp-3); gap: var(--sp-2); }
.input-shell { 
  border-radius: var(--r-md);
  border: 1px solid var(--border-subtle);
  transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.input-shell:focus-within {
  border-color: var(--border-emphasis);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
}

.composer-row { gap: var(--sp-2); align-items: center; }

/* Consolidated target/model/context chip */
.target-model-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}
.target-model-chip .agent { color: var(--text-primary); font-weight: var(--fw-medium); }
.target-model-chip .warn { color: var(--warn); }

/* Thinking icon-only */
.thinking-toggle {
  width: 28px; height: 28px;
  padding: 0;
  display: grid; place-items: center;
  font-size: 16px;
  border-radius: var(--r-sm);
  background: var(--interactive-rest);
  transition: background var(--dur-fast);
}
.thinking-toggle:hover { background: var(--interactive-hover); }

/* Voice buttons group */
.voice-wrap { gap: var(--sp-1); }
.voice-button {
  width: 32px; height: 32px;
  padding: 0;
  border-radius: var(--r-sm);
}

/* Ultrawhip overlay (not footer) */
.ultrawhip-overlay {
  position: absolute;
  top: var(--sp-2); right: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
  background: color-mix(in srgb, var(--accent) 16%, var(--surface-1));
  border: 1px solid var(--accent);
  border-radius: var(--r-full);
  font-size: var(--text-xs);
  font-weight: var(--fw-medium);
  animation: ultrawhip-pulse 2s ease-in-out infinite;
}
@keyframes ultrawhip-pulse {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 1; box-shadow: 0 0 12px var(--accent); }
}
```

**Result:** Composer footer 40% less cluttered, actions grouped logically, critical info highlighted.

### Topbar
**Current sins:**
- Double-line workspace path + config path = heavy header
- Search button + status text both crammed right

**Simplify:**
- Single line = workspace name only (config path lives in settings, redundant here)
- Hover title = full paths (discoverable, not always-on noise)
- Status = tighter spacing, icon-prefix for on-call mode

```css
.topbar { 
  padding: var(--sp-2) var(--sp-4);
  gap: var(--sp-3);
  border-bottom: 1px solid var(--border-subtle);
}
.topbar strong { 
  font-size: var(--text-base);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
}
.topbar small { display: none; } /* config path hidden, lives in title attr */
```

**Result:** Topbar 50% shorter vertically, cleaner masthead.

### Statusbar
**Current sins:**
- 8-12 segments (workspace + room + count + running + voice + usage + bg + artifacts + theme + clock + keys) = crowded footer
- Every segment = border + padding = heavy visual weight
- Arrow separators (pure CSS ::before) multiply borders

**Consolidate:**
- Merge workspace + room into one segment (already related)
- Remove "keys" hint segment (shortcuts discoverable via menu/docs, not permanent footer noise)
- Reduce segment padding (10px → 6px)
- Lighten borders (accent tint only on interactive/live segments)

```css
.statusbar { 
  padding: 0 var(--sp-2);
  gap: 2px; /* tight, segments define own padding */
  font-size: var(--text-xs);
}
.seg {
  padding: var(--sp-1) var(--sp-2);
  border: none; /* remove constant borders */
  background: var(--surface-1);
  transition: background var(--dur-fast), color var(--dur-fast);
}
.seg + .seg::before { /* arrow separator stays, but lighter */
  border-color: var(--surface-1);
  opacity: 0.6;
}
.seg.on { 
  background: color-mix(in srgb, var(--good) 16%, var(--surface-1));
  font-weight: var(--fw-medium);
}
.seg-head { font-weight: var(--fw-semibold); }
```

**Result:** Statusbar 30% less dense, live segments stand out, static info recedes.

---

## § MOTION LANGUAGE — smooth futuristic rhythm

### Micro-interactions (hover, focus)
**Duration:** `--dur-fast` (150ms)  
**Easing:** `--ease-out` (decelerate feels responsive)  
**Properties:** `background`, `color`, `border-color`, `opacity`

```css
button, .nav-item, .tab, .agent-row {
  transition: background var(--dur-fast) var(--ease-out),
              color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out);
}
```

### Progressive disclosure (expand/collapse)
**Duration:** `--dur-base` (250ms)  
**Easing:** `--ease-inout` (smooth both ends)  
**Properties:** `max-height`, `opacity` together (height alone = jerky)

```css
.agent-config-row, .agent-description {
  transition: max-height var(--dur-base) var(--ease-inout),
              opacity var(--dur-base) var(--ease-inout);
}
```

**LAW:** Set explicit `max-height` value (not `auto`) for smooth animation. Measure content, pick ceiling (e.g. 120px for 2-row config).

### Panel enter/exit (modals, overlays)
**Duration:** `--dur-slow` (400ms)  
**Easing:** `--ease-inout`  
**Effect:** Scale + opacity (0.95 → 1.0 scale = subtle depth)

```css
@keyframes panel-enter {
  from { opacity: 0; transform: scale(0.96) translateY(-8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.modal, .palette {
  animation: panel-enter var(--dur-slow) var(--ease-inout);
}
```

### Loading states (running, compacting)
**Duration:** 1.2s (comfortable pulse, not seizure strobe)  
**Easing:** `ease-in-out`  
**Effect:** Opacity pulse (0.35 ↔ 1.0), box-shadow glow on accent elements

```css
@keyframes dot-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.room-dot.running, .status.on-call {
  animation: dot-pulse 1.2s ease-in-out infinite;
}
```

**LAW:** Reduced-motion users see ZERO animation (all → `--dur-instant`). Already present, preserve.

---

## § PHASED BUILD WAVES — independent shippable chunks

Each wave = self-contained visual/behavioral unit. No "redesign everything" big-bang; each ships, Charles sees immediate delta.

### Wave 1: Token foundation + typography
**Scope:**
- Define all tokens in `styles.css` (:root vars)
- Replace hardcoded font-size/line-height/font-weight with token references across ALL files
- Change base from 12.5px → 13px
- Swap monospace font-family to `--font-mono` token (already defined, enforce usage)

**Files touched:** `styles.css` (token defs), every component (font references)  
**Acceptance:** Charles sees 13px base text, all type uses tokens, NO hardcoded sizes remain (grep '12\.5px|font-size:\s*\d+px' returns only token defs)  
**Perceptual test:** "Text feels slightly larger, more comfortable to read" (<1s glance)

### Wave 2: Spacing breathe (8pt grid)
**Scope:**
- Replace all padding/margin/gap with token references (`--sp-N`)
- Sidebar: increase gap from 7px → `--sp-2` (8px), section breaks to `--sp-3` (12px)
- Panel: agent-row padding 9px → `--sp-2`, gap between rows `--sp-1` (4px)
- Composer: footer gap `--sp-2`, input-shell padding `--sp-2` `--sp-3`

**Files touched:** All component CSS (padding/margin/gap values)  
**Acceptance:** NO hardcoded px in padding/margin/gap (except 1px borders). Grep returns only token refs.  
**Perceptual test:** "UI breathes more, less cramped" (<1s scan)

### Wave 3: Radius + surface refinement
**Scope:**
- Apply border-radius tokens (`--r-sm`, `--r-md`, `--r-lg`) consistently
- Tab bar: tabs get `border-radius: var(--r-md) var(--r-md) 0 0` (rounded top)
- Buttons: `--r-sm`, inputs: `--r-md`, panels: `--r-lg`
- Input-shell focus ring: 3px spread `box-shadow` (not just border-color change)

**Files touched:** `styles.css` (button, input, panel, tab CSS)  
**Acceptance:** All interactive elements have border-radius. Focus states use box-shadow ring.  
**Perceptual test:** "Smoother, more modern feel; focus states obvious" (<1s interaction)

### Wave 4: Motion system baseline
**Scope:**
- Add motion tokens to `:root` (durations, easings)
- Replace all `0.12s`, `90ms`, `0.15s` → token references (`--dur-fast`, `--dur-base`)
- Enforce `prefers-reduced-motion` override (already present, audit completeness)
- Hover transitions = `--dur-fast --ease-out`

**Files touched:** All CSS with `transition` or `animation`  
**Acceptance:** NO hardcoded ms values in transitions (grep returns only token defs)  
**Perceptual test:** "Interactions feel smoother, more cohesive" (<1s hover multiple elements)

### Wave 5: Tab bar de-crowd
**Scope:**
- Remove `.tab-num` chip (count lives in statusbar)
- Hide tab close X at rest, show on hover (already present, ensure working)
- Active tab = 2px top border only, not full shadow
- Tighten gap between tabs

**Files touched:** `styles.css` (.tab rules), `tabbar.js` (remove num chip rendering)  
**Acceptance:** No num chips visible. Tabs ~30% narrower. Close X appears on hover only.  
**Perceptual test:** "Tab strip cleaner, less cluttered" (<1s glance)

### Wave 6: Sidebar progressive disclosure
**Scope:**
- Room metadata (star, incognito, modes, agent, ref) = `opacity: 0` rest, `opacity: 1` on `:hover` or `.active`
- Status dot ALWAYS visible (critical)
- Day/project headers lighter weight

**Files touched:** `styles.css` (.room-item rules), `sidebar.js` (no logic change, CSS drives visibility)  
**Acceptance:** Metadata hidden on rest rows, appears on hover/active. Dot always visible.  
**Perceptual test:** "Sidebar scans faster, metadata appears when I look" (<1s hover a room)

### Wave 7: Panel collapse controls
**Scope:**
- Agent config row (model/account/role) = `max-height: 0` rest, slide down on hover/active
- Description = hidden rest, show on hover
- Task history = last 2 settled only (CSS `nth-last-child` hides older)

**Files touched:** `styles.css` (.agent-row, .task rules), `panel.js` (CSS drives visibility, logic unchanged)  
**Acceptance:** Config row collapses. Description appears on hover. Old tasks hidden.  
**Perceptual test:** "Panel less overwhelming, controls appear when needed" (<1s hover agent row)

### Wave 8: Composer consolidate
**Scope:**
- Merge target + model chips into one element
- Thinking control = icon-only button
- Ultrawhip = overlay position (absolute top-right), not footer
- Voice buttons tighter group

**Files touched:** `composer.js` (chip rendering), `styles.css` (layout, ultrawhip positioning)  
**Acceptance:** Footer has 1 combined chip (not 2 separate). Ultrawhip floats top-right when active.  
**Perceptual test:** "Composer footer cleaner, ultrawhip status obvious" (<1s glance)

### Wave 9: Topbar single-line + statusbar consolidate
**Scope:**
- Topbar: remove small (config path), keep strong only
- Statusbar: merge workspace + room segment, remove keys hint, lighten borders

**Files touched:** `statusbar.js` (segment rendering), `styles.css` (.topbar, .seg rules)  
**Acceptance:** Topbar one line. Statusbar 2-3 fewer segments. Borders lighter.  
**Perceptual test:** "Header/footer less heavy, more space for content" (<1s glance)

### Wave 10: Enter/exit animations
**Scope:**
- Modals/palettes = `panel-enter` keyframe (scale + opacity)
- Loading dots = existing pulse (audit consistency)
- Panel slide-downs = `max-height` + `opacity` together

**Files touched:** `styles.css` (keyframes, modal/palette animation)  
**Acceptance:** Modals animate in. Expand/collapse smooth. Reduced-motion works.  
**Perceptual test:** "Overlays feel polished, smooth appearance" (<1s open settings)

---

## § SCREENSHOT INVENTORY — proof paths

Post-implementation, capture these surfaces to verify acceptance criteria:

1. **Tab strip** — multiple tabs, one active, one running, close X on hover
2. **Sidebar** — workspace list, room tree (day/project groups), metadata on hover
3. **Right panel** — agent list (workspace groups), config row collapsed/expanded
4. **Composer** — all states (idle, running banner, editing, ultrawhip active)
5. **Topbar + main** — single-line workspace, transcript visible
6. **Statusbar** — full segment array, running state, usage chip
7. **Modal** — settings open (any tab), theme palette, usage popover
8. **Hover states** — room metadata appearing, agent config sliding down
9. **Focus states** — input-shell with ring, tab with keyboard focus
10. **Reduced-motion** — same surfaces with `prefers-reduced-motion: reduce` set

**Proof discipline:** Headless screenshots via app-screenshot.js after EACH wave ships. Side-by-side before/after per wave. No "looks good to me" without pixels.

---

## § ACCEPTANCE CRITERIA SUMMARY — per-wave gates

Every wave = production-ready when ALL its criteria met. Partial compliance inadequate.

**Wave 1:** Token defs present, all font-size/line-height/font-weight = token refs, base = 13px  
**Wave 2:** All padding/margin/gap = token refs (no hardcoded px except borders)  
**Wave 3:** All interactive = border-radius, focus = box-shadow ring  
**Wave 4:** All transitions = token durations/easings, reduced-motion enforced  
**Wave 5:** No tab num chips, close X hover-only, active tab 2px top border  
**Wave 6:** Room metadata hidden rest / visible hover, dot always visible  
**Wave 7:** Agent config collapsed rest / expanded hover, old tasks hidden  
**Wave 8:** Target+model merged, thinking icon-only, ultrawhip overlay  
**Wave 9:** Topbar single line, statusbar 2-3 fewer segments  
**Wave 10:** Modals animate, slide-downs smooth, reduced-motion zero animation  

Charles sees each wave independently. No big-bang "entire redesign" merge.

---

## END SPEC

Total waves: 10 independent shippable units. Estimated effort per wave: 2-4h (token foundation longest, later waves leverage established system). Total redesign: ~25-30h across all waves, each verifiable in <1s perceptual tests Charles can perform live.

Rams canon honored: less but better, every decision intentional, minimum design for maximum clarity. Futuristic through smooth motion + clean surfaces, not gimmicks. Modern through systematic tokens, not trends.
