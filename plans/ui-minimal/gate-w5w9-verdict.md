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

