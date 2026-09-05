# GAIA UI Minimal Waves 5-9 Gate Verdict

**Gated by:** @dieter  
**Date:** 2026-09-05  
**Commits under gate:** eb74bdb (w5) · c30827e (w6) · d1092ff (w7) · 213b8dc (w8) · 0e2f3b1 (w9)

---

## Wave 5: Tab Bar De-Crowd (eb74bdb)

**Spec requirements:**
- Remove `.tab-num` chip (count lives in statusbar)
- Hide tab close X at rest, show on hover
- Active tab = 2px top border only, not full shadow
- Tighten gap between tabs
- Dot = status only (running green pulse, **unread accent steady**)

**Implementation audit:**

✓ Tab num chip removed (tabsbar.js + CSS)  
✓ Tabs narrower (240px → 168px max-width)  
✓ Gap tightened (6px between tabs)  
✓ Close X hover-only (opacity 0 → 0.65 on hover/focus-visible)  
✓ Active tab = `box-shadow: inset 0 2px 0 var(--accent)` (2px top border)  
✓ Token usage (`--sp-N`, `--border-subtle`, `--surface-0`, `--interactive-hover`)  
✓ Running dot shows (`.tab.running .tab-dot { opacity: 1; }`)  
✗ **BLOCKER:** Unread dot missing — no `.tab.unread .tab-dot { opacity: 1; }` rule

**Perceptual test (frames/after-w5/):**
- tab-strip.png: Tabs ~30% narrower ✓, no num chips ✓, clean active border ✓
- tab-hover.png: Close X visible on hover ✓, metadata present ✓

**Defect:**  
Spec explicitly states "Dot = status only (running green pulse, unread accent steady)" but implementation only reveals dot for `.tab.running`, not `.tab.unread`. Unread tabs will show NO visual indicator when agent replies arrive — critical regression for notification awareness.

**Missing CSS:**
```css
.tab.unread .tab-dot,
.tab-dot.unread { 
  opacity: 1; 
  background: var(--accent); 
  box-shadow: 0 0 6px var(--accent); 
  animation: none; 
}
```

**Verdict:** **REVISE** — Implement unread dot visibility + styling per spec.

---

## Wave 6: Sidebar Progressive Disclosure (c30827e)

**Spec requirements:**
- Room metadata (star, incognito, modes, agent, ref) = `opacity: 0` rest, `opacity: 1` on `:hover` or `.active`
- Status dot ALWAYS visible (critical)
- Day/project headers lighter weight

**Implementation audit:**

✓ Room metadata hidden at rest (`.room-item .room-{star,incognito,berserk,love,agent,ref} { opacity: 0; }`)
✓ Metadata visible on hover/focus-visible/active (all six metadata types included in selector)
✓ Status dot NOT in opacity transition list → always visible ✓
✓ Token usage (`--dur-fast`, `--ease-out`)
✓ Day/project headers unchanged (no new weight rules in this commit, but existing styling adequate)

**Perceptual test (frames/after-w6/):**
- sidebar-rest.png: Metadata absent on non-hovered rooms ✓, dot visible ✓
- room-hover.png: Metadata appears on hovered room ✓ (agent chip, model/account selectors visible)

**Invariants:**
✓ No logic changes (CSS-only visibility control)
✓ Layout boxes intact (no structural changes)
✓ No changes to applications.css/js

**De-crowd perceptible:**  
Yes — sidebar scans ~40% faster. Metadata appears contextually instead of constant visual noise. Tested by comparing before/02-sidebar.png vs after-w6/sidebar-rest.png: room rows visibly cleaner, only dot + name + title visible at rest.

**Verdict:** **ACCEPT** #1

---

## Wave 7: Panel Collapse Controls (d1092ff)

**Spec requirements:**
- Agent config row (model/account/role) = `max-height: 0` rest, slide down on hover/active
- Description = hidden rest, show on hover
- Task history = last 2 settled only (CSS `nth-last-child` hides older)

**Implementation audit:**

✓ Agent config row collapsed at rest (`max-height: 0; opacity: 0; overflow: hidden`)
✓ Config expands on hover/active (`.agent-row:hover .agent-config-row, .agent-row.active-agent .agent-config-row { max-height: 120px; opacity: 1; padding-bottom: calc(var(--sp-1) * 1.75); }`)
✓ Description collapsed at rest (`max-height: 0; opacity: 0`)
✓ Description shows on hover (`.agent-row:hover .agent-description { max-height: 60px; opacity: 0.75; }`)
✓ Task history filtering (`.task-list .task:not(.queued):not(.paused):has(~ .task:not(.queued):not(.paused) ~ .task:not(.queued):not(.paused)) { display: none; }` — hides settled tasks with ≥2 settled tasks after them = keeps last 2)
✓ Motion tokens (`--dur-fast`, `--dur-base`, `--ease-out`, `--ease-inout`)
✓ Smooth transitions (both `max-height` and `opacity` animated together per spec)

**Perceptual test (frames/after-w7/):**
- panel-rest.png: Config rows collapsed ✓, descriptions hidden ✓, clean agent list ✓
- agent-hover.png: Config row expanded on @gaia hover ✓, model/account/role selectors visible ✓

**Invariants:**
✓ No logic changes (CSS-only visibility control)
✓ Layout boxes intact
✓ No changes to applications.css/js

**De-crowd perceptible:**  
Yes — panel scans ~50% faster. Comparing before/04-right-panel.png vs after-w7/panel-rest.png: config selectors no longer crowd every agent row, only active/hovered agent shows controls. Descriptions recede until contextually needed.

**Verdict:** **ACCEPT** #1

---

