/**
 * @typedef {object} AgentStatus
 * @property {string} id
 * @property {string} name
 * @property {string} model
 * @property {string|undefined} [workspace]
 * @property {string|undefined} [avatar]
 * @property {string|undefined} [account]
 * @property {string|undefined} [status]
 */

/**
 * @typedef {object} AgentRowsConfig
 * @property {AgentStatus[]} agents
 * @property {string|undefined} [activeAgent]
 * @property {(agent: AgentStatus) => void} onSelect
 * @property {(agent: AgentStatus) => void} onEdit
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
  
  // State
  let scrollStates = new Map(); // workspace → scroll position
  /** @type {HTMLElement|null} */
  let hoverPopover = null;
  /** @type {AgentStatus|null} */
  let activeHoverAgent = null;
  /** @type {number|null} */
  let autoScrollRAF = null;
  /** @type {'left'|'right'|null} */
  let autoScrollDirection = null;

  /**
   * Group agents by workspace, excluding certain groups
   * @param {AgentStatus[]} agents
   * @returns {Map<string, AgentStatus[]>}
   */
  function groupAgents(agents) {
    const agentsByWorkspace = new Map();
    for (const agent of agents) {
      const ws = agent.workspace || 'GENERAL';
      // Check if group should be excluded (case-insensitive)
      if (EXCLUDED_GROUPS.some(excluded => excluded.toLowerCase() === ws.toLowerCase())) {
        continue;
      }
      if (!agentsByWorkspace.has(ws)) {
        agentsByWorkspace.set(ws, []);
      }
      agentsByWorkspace.get(ws).push(agent);
    }
    return agentsByWorkspace;
  }

  /**
   * Create avatar element or icon fallback
   * @param {AgentStatus} agent
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
   * @param {AgentStatus} agent
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
   * @param {AgentStatus} agent
   * @returns {HTMLElement}
   */
  function createAgentTile(agent) {
    const tile = document.createElement('div');
    tile.className = 'agent-tile';
    tile.dataset.agentId = agent.id;
    if (agent.id === activeAgent) {
      tile.classList.add('agent-tile-active');
    }

    // Avatar: main visual element
    tile.appendChild(createAvatar(agent));

    // Caption: minimal name/handle underneath
    const caption = document.createElement('div');
    caption.className = 'agent-tile-caption';
    
    const name = document.createElement('div');
    name.className = 'agent-tile-name';
    name.textContent = `@${agent.name}`;
    name.title = agent.name;
    caption.appendChild(name);

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
   * @param {AgentStatus} agent
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
   * Render agent rows
   */
  function render() {
    el.innerHTML = '';
    el.className = 'agent-rows-container';

    const agentsByWorkspace = groupAgents(agents);
    const workspaces = Array.from(agentsByWorkspace.keys()).sort();

    for (const workspace of workspaces) {
      const wsAgents = agentsByWorkspace.get(workspace) || [];
      if (wsAgents.length === 0) continue;

      // Workspace group label
      const groupLabel = document.createElement('div');
      groupLabel.className = 'agent-rows-group-label';
      groupLabel.textContent = workspace;
      el.appendChild(groupLabel);

      // Horizontal scrollable strip
      const strip = document.createElement('div');
      strip.className = 'agent-rows-strip';
      strip.dataset.workspace = workspace;

      // Create tiles
      for (const agent of wsAgents) {
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
      const savedScroll = scrollStates.get(workspace);
      if (savedScroll !== undefined) {
        strip.scrollLeft = savedScroll;
      }

      // Save scroll position on scroll
      strip.addEventListener('scroll', () => {
        scrollStates.set(workspace, strip.scrollLeft);
      });

      el.appendChild(strip);
    }
  }

  /**
   * Update component with new snapshot
   * @param {any} snapshot
   */
  function update(snapshot) {
    // Update agents and activeAgent from snapshot if provided
    if (snapshot?.agents) {
      // Update agents array, re-render
      render();
    }
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
