/**
 * @typedef {object} AgentTile
 * @property {string} id
 * @property {string} name - display name (primary caption line)
 * @property {string} [handle] - the at-handle (secondary caption line); falls back to id
 * @property {string} model
 * @property {string|undefined} [workspace]
 * @property {string|undefined} [avatar]
 * @property {string|undefined} [account]
 * @property {string|undefined} [status]
 */

/**
 * @typedef {object} AgentRowsConfig
 * @property {AgentTile[]} agents
 * @property {string|undefined} [activeAgent]
 * @property {(agent: AgentTile) => void} onSelect
 * @property {(agent: AgentTile) => void} onEdit
 */

/**
 * @typedef {object} AgentRowsHandle
 * @property {(snapshot: any) => void} update
 * @property {() => void} destroy
 */

// Excluded workspace groups (case-insensitive)
const EXCLUDED_GROUPS = ['FENYX', 'WORK', 'gaia-daemon'];

/**
 * Mount agent group rows component
 * @param {HTMLElement} el
 * @param {AgentRowsConfig} config
 * @returns {AgentRowsHandle}
 */
export function mountAgentRows(el, config) {
  const { agents, activeAgent, onSelect, onEdit } = config;
  // Live data — refreshed by update(); render() always reads these, never the
  // construction-time closure (the panel re-renders on every snapshot).
  /** @type {AgentTile[]} */
  let currentAgents = agents;
  /** @type {string|undefined} */
  let currentActive = activeAgent;
  
  // State
  let scrollStates = new Map(); // workspace → scroll position
  /** @type {HTMLElement|null} */
  let hoverPopover = null;
  /** @type {AgentTile|null} */
  let activeHoverAgent = null;
  /** @type {number|null} */
  let autoScrollRAF = null;
  /** @type {'left'|'right'|null} */
  let autoScrollDirection = null;
  /** @type {'GENERAL'|'PERSONAL'} */
  let selectedTab = 'GENERAL'; // persisted across renders

  /**
   * Get agents for GENERAL and PERSONAL tabs
   * @param {AgentTile[]} agents
   * @returns {Map<'GENERAL'|'PERSONAL', AgentTile[]>}
   */
  function getTabAgents(agents) {
    const tabs = new Map();
    tabs.set('GENERAL', []);
    tabs.set('PERSONAL', []);
    
    for (const agent of agents) {
      const ws = agent.workspace || 'GENERAL';
      // Excluded workspaces (those normally hidden) → skip
      if (EXCLUDED_GROUPS.some(excluded => excluded.toLowerCase() === ws.toLowerCase())) {
        continue;
      }
      // PERSONAL tab gets agents with explicit workspace (non-GENERAL)
      // GENERAL tab gets all others
      if (ws === 'GENERAL') {
        tabs.get('GENERAL').push(agent);
      } else {
        tabs.get('PERSONAL').push(agent);
      }
    }
    return tabs;
  }

  /**
   * Create avatar element or icon fallback
   * @param {AgentTile} agent
   * @returns {HTMLElement}
   */
  function createAvatar(agent) {
    const avatar = document.createElement('div');
    avatar.className = 'agent-tile-avatar';
    
    if (agent.avatar) {
      const img = document.createElement('img');
      img.src = agent.avatar;
      img.alt = agent.name;
      img.title = agent.name;
      avatar.appendChild(img);
    } else {
      const icon = document.createElement('div');
      icon.className = 'agent-tile-icon-fallback';
      icon.textContent = agent.name.charAt(0).toUpperCase();
      icon.title = agent.name;
      avatar.appendChild(icon);
    }
    
    return avatar;
  }

  /**
   * Create model chip
   * @param {AgentTile} agent
   * @returns {HTMLElement}
   */
  function createModelChip(agent) {
    const chip = document.createElement('span');
    chip.className = 'agent-tile-model-chip';
    chip.textContent = agent.model;
    chip.title = agent.model;
    return chip;
  }

  /**
   * Create agent tile: dominant avatar + minimal caption
   * @param {AgentTile} agent
   * @returns {HTMLElement}
   */
  function createAgentTile(agent) {
    const tile = document.createElement('div');
    tile.className = 'agent-tile';
    tile.dataset.agentId = agent.id;
    if (agent.id === currentActive) {
      tile.classList.add('agent-tile-active');
    }

    // Avatar: main visual element
    tile.appendChild(createAvatar(agent));

    // Caption underneath. A distinct display name reads as the strong primary
    // line with the @handle beneath it; when the name only echoes the id (the
    // common case), the @handle IS the primary line — no redundant second line.
    const caption = document.createElement('div');
    caption.className = 'agent-tile-caption';

    const handleText = `@${agent.handle || agent.id}`;
    const hasName = Boolean(agent.name) && agent.name.toLowerCase() !== (agent.handle || agent.id).toLowerCase();

    if (hasName) {
      const name = document.createElement('div');
      name.className = 'agent-tile-name';
      name.textContent = agent.name;
      name.title = agent.name;
      caption.appendChild(name);

      const handle = document.createElement('div');
      handle.className = 'agent-tile-handle';
      handle.textContent = handleText;
      handle.title = handleText;
      caption.appendChild(handle);
    } else {
      const primary = document.createElement('div');
      primary.className = 'agent-tile-name';
      primary.textContent = handleText;
      primary.title = handleText;
      caption.appendChild(primary);
    }

    tile.appendChild(caption);

    // Events
    tile.addEventListener('click', () => {
      onSelect(agent);
    });

    tile.addEventListener('dblclick', () => {
      onEdit(agent);
    });

    tile.addEventListener('mouseenter', () => {
      showHoverPopover(agent, tile);
    });

    tile.addEventListener('mouseleave', () => {
      hideHoverPopover();
    });

    return tile;
  }

  /**
   * Show hover popover
   * @param {AgentTile} agent
   * @param {HTMLElement} tile
   */
  function showHoverPopover(agent, tile) {
    activeHoverAgent = agent;
    
    if (hoverPopover) {
      hoverPopover.remove();
    }

    hoverPopover = document.createElement('div');
    hoverPopover.className = 'agent-rows-popover';

    const content = document.createElement('div');
    content.className = 'agent-rows-popover-content';

    const infoRows = [
      ['Name', agent.name],
      ['Model', agent.model],
      ['Account', agent.account || '—'],
      ['Status', agent.status || '—'],
    ];

    for (const [label, value] of infoRows) {
      const row = document.createElement('div');
      row.className = 'agent-rows-popover-row';
      
      const labelEl = document.createElement('span');
      labelEl.className = 'agent-rows-popover-label';
      labelEl.textContent = label;
      
      const valueEl = document.createElement('span');
      valueEl.className = 'agent-rows-popover-value';
      valueEl.textContent = value;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      content.appendChild(row);
    }

    hoverPopover.appendChild(content);
    document.body.appendChild(hoverPopover);

    // Position near right edge of tile, safe from viewport edges
    const tileRect = tile.getBoundingClientRect();
    let left = tileRect.right + 12;
    let top = tileRect.top;

    // Viewport safety
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left + 200 > viewportWidth) {
      left = tileRect.left - 212; // popover width ~200 + gap
    }
    if (top + 150 > viewportHeight) {
      top = Math.max(0, viewportHeight - 150);
    }

    hoverPopover.style.left = `${left}px`;
    hoverPopover.style.top = `${top}px`;
  }

  /**
   * Hide hover popover
   */
  function hideHoverPopover() {
    activeHoverAgent = null;
    if (hoverPopover) {
      hoverPopover.remove();
      hoverPopover = null;
    }
  }

  /**
   * Start edge auto-scroll
   * @param {HTMLElement} strip
   * @param {'left'|'right'} direction
   */
  function startAutoScroll(strip, direction) {
    autoScrollDirection = direction;
    
    const scroll = () => {
      if (!autoScrollDirection || document.hidden) {
        autoScrollRAF = null;
        return;
      }

      const step = 4; // pixels per frame
      if (autoScrollDirection === 'left') {
        strip.scrollLeft = Math.max(0, strip.scrollLeft - step);
      } else if (autoScrollDirection === 'right') {
        strip.scrollLeft = Math.min(strip.scrollLeft + step, strip.scrollWidth - strip.clientWidth);
      }

      autoScrollRAF = requestAnimationFrame(scroll);
    };

    if (autoScrollRAF) cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = requestAnimationFrame(scroll);
  }

  /**
   * Stop auto-scroll
   */
  function stopAutoScroll() {
    autoScrollDirection = null;
    if (autoScrollRAF) {
      cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
    }
  }

  /**
   * Handle strip edge hover
   * @param {HTMLElement} strip
   * @param {MouseEvent} event
   */
  function handleStripMouseMove(strip, event) {
    const rect = strip.getBoundingClientRect();
    const leftEdge = event.clientX - rect.left;
    const rightEdge = rect.right - event.clientX;

    const edgeThreshold = 48; // pixels

    if (leftEdge < edgeThreshold && strip.scrollLeft > 0) {
      startAutoScroll(strip, 'left');
    } else if (rightEdge < edgeThreshold && strip.scrollLeft < strip.scrollWidth - strip.clientWidth) {
      startAutoScroll(strip, 'right');
    } else {
      stopAutoScroll();
    }
  }

  /**
   * Render agent rows with tabs
   */
  function render() {
    el.innerHTML = '';
    el.className = 'agent-rows-container';

    const tabAgents = getTabAgents(currentAgents);
    /** @type {Array<'GENERAL'|'PERSONAL'>} */
    const tabs = ['GENERAL', 'PERSONAL'];

    // Render tab pills
    const tabBar = document.createElement('div');
    tabBar.className = 'agent-rows-tab-bar';

    for (const tab of tabs) {
      /** @type {'GENERAL'|'PERSONAL'} */
      const typedTab = tab;
      const tabAgentCount = (tabAgents.get(typedTab) || []).length;
      if (tabAgentCount === 0) continue; // Hide tabs with no agents

      const tabPill = document.createElement('button');
      tabPill.className = 'agent-rows-tab-pill';
      if (typedTab === selectedTab) {
        tabPill.classList.add('agent-rows-tab-active');
      }
      tabPill.textContent = typedTab.charAt(0).toUpperCase() + typedTab.slice(1).toLowerCase();
      tabPill.dataset.tab = typedTab;

      tabPill.addEventListener('click', () => {
        selectedTab = typedTab;
        render(); // re-render to switch tabs
      });

      tabBar.appendChild(tabPill);
    }

    el.appendChild(tabBar);

    // Render active tab's strip
    const stripAgents = tabAgents.get(selectedTab) || [];
    if (stripAgents.length > 0) {
      const strip = document.createElement('div');
      strip.className = 'agent-rows-strip';
      strip.dataset.tab = selectedTab;

      // Create tiles
      for (const agent of stripAgents) {
        const tile = createAgentTile(agent);
        strip.appendChild(tile);
      }

      // Edge auto-scroll listeners
      strip.addEventListener('mousemove', (event) => {
        handleStripMouseMove(strip, event);
      });

      strip.addEventListener('mouseleave', () => {
        stopAutoScroll();
      });

      // Restore scroll position if saved
      const savedScroll = scrollStates.get(selectedTab);
      if (savedScroll !== undefined) {
        strip.scrollLeft = savedScroll;
      }

      // Save scroll position on scroll
      strip.addEventListener('scroll', () => {
        const tabKey = selectedTab;
        scrollStates.set(tabKey, strip.scrollLeft);
      });

      el.appendChild(strip);
    }
  }

  /**
   * Update component with new snapshot
   * @param {any} snapshot
   */
  function update(snapshot) {
    if (!snapshot) return;
    if (snapshot.agents) currentAgents = snapshot.agents;
    if ('activeAgent' in snapshot) currentActive = snapshot.activeAgent;
    render();
  }

  /**
   * Destroy component
   */
  function destroy() {
    hideHoverPopover();
    stopAutoScroll();
    el.innerHTML = '';
  }

  // Initial render
  render();

  return { update, destroy };
}
