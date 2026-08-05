// Design canvas for GAIA — Dieter's workspace
// Embedded Figma-killer: vector editing, real-time agent manipulation

import { $ } from "./dom.js";

/**
 * Design canvas state
 * @typedef {{
 *   elements: DesignElement[],
 *   selectedId: string|null,
 *   zoom: number,
 *   pan: {x: number, y: number},
 *   visible: boolean,
 *   activeTool: 'select'|'rectangle'|'ellipse'|'text'|'hand',
 *   window: {x: number, y: number, width: number, height: number, minimized: boolean},
 *   dragState: {tool: string, startX: number, startY: number, currentX: number, currentY: number}|null,
 *   promptText: string,
 *   promptPending: boolean,
 *   promptError: string,
 *   designName: string
 * }} CanvasState
 */

/**
 * Design element (frame, shape, text, etc.)
 * @typedef {{
 *   id: string,
 *   type: string,
 *   name: string,
 *   x: number,
 *   y: number,
 *   width: number,
 *   height: number,
 *   fill: string,
 *   stroke: {color: string, width: number},
 *   children: DesignElement[]
 * }} DesignElement
 */

/** @type {CanvasState} */
const canvasState = {
  elements: [],
  selectedId: null,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  visible: false,
  activeTool: 'select',
  window: {
    x: Math.max(20, Math.round((window.innerWidth - 900) / 2)),
    y: Math.max(20, Math.round((window.innerHeight - 700) / 2)),
    width: 900,
    height: 700,
    minimized: false
  },
  dragState: null,
  promptText: '',
  promptPending: false,
  promptError: '',
  designName: `Design ${new Date().toISOString().slice(0, 10)}`
};

// ---- Autosave: debounced write of design JSON to ~/Designs/gaia-design/ ----
/** @type {ReturnType<typeof setTimeout> | null} */
let gAutosaveTimer = null;
function scheduleAutosave() {
  if (gAutosaveTimer) clearTimeout(gAutosaveTimer);
  gAutosaveTimer = setTimeout(() => {
    gAutosaveTimer = null;
    void fetch('/api/canvas/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design: canvasState.designName, data: exportCanvas() })
    }).catch(() => {});
  }, 1500);
}

/**
 * Toggle canvas visibility
 */
export function toggleCanvas() {
  canvasState.visible = !canvasState.visible;
  renderCanvas();
}

/**
 * Show canvas
 */
export function showCanvas() {
  canvasState.visible = true;
  renderCanvas();
}

/**
 * Hide canvas
 */
export function hideCanvas() {
  console.warn('[canvas] hideCanvas called', new Error().stack);
  canvasState.visible = false;
  renderCanvas();
}

/**
 * Create new design element
 * @param {string} type - Element type
 * @param {Partial<DesignElement>} props - Element properties
 * @returns {string} Element ID
 */
export function createElement(type, props = {}) {
  const id = `el-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Claude aesthetic defaults
  /** @type {Record<string, {fill: string, stroke: {color: string, width: number}}>} */
  const defaults = {
    frame: { fill: "none", stroke: { color: "#D1D1D1", width: 2 } },
    rectangle: { fill: "#F97316", stroke: { color: "#EA580C", width: 1 } },
    circle: { fill: "#F97316", stroke: { color: "#EA580C", width: 1 } },
    ellipse: { fill: "#F97316", stroke: { color: "#EA580C", width: 1 } },
    text: { fill: "#1A1A1A", stroke: { color: "transparent", width: 0 } }
  };
  
  const typeDefaults = defaults[type] || { fill: "#F5F5F5", stroke: { color: "#D1D1D1", width: 1 } };
  
  /** @type {DesignElement} */
  const element = {
    id,
    type,
    name: props.name || `${type.charAt(0).toUpperCase() + type.slice(1)} ${canvasState.elements.length + 1}`,
    x: props.x !== undefined ? props.x : 100,
    y: props.y !== undefined ? props.y : 100,
    width: props.width !== undefined ? props.width : 200,
    height: props.height !== undefined ? props.height : 200,
    fill: props.fill || typeDefaults.fill,
    stroke: props.stroke || typeDefaults.stroke,
    children: []
  };
  
  canvasState.elements.push(element);
  canvasState.selectedId = id; // Auto-select created element
  renderCanvas();
  scheduleAutosave();
  
  return id;
}

/**
 * Update element properties
 * @param {string} id - Element ID
 * @param {Partial<DesignElement>} props - Properties to update
 */
export function updateElement(id, props) {
  const element = canvasState.elements.find(el => el.id === id);
  if (!element) return;
  
  Object.assign(element, props);
  renderCanvas();
  scheduleAutosave();
}

/**
 * Delete element
 * @param {string} id - Element ID
 */
export function deleteElement(id) {
  canvasState.elements = canvasState.elements.filter(el => el.id !== id);
  if (canvasState.selectedId === id) {
    canvasState.selectedId = null;
  }
  renderCanvas();
  scheduleAutosave();
}

/**
 * Select element
 * @param {string} id - Element ID
 */
export function selectElement(id) {
  canvasState.selectedId = id;
  renderCanvas();
}

/**
 * Get all elements
 * @returns {DesignElement[]}
 */
export function getElements() {
  return canvasState.elements;
}

/**
 * Clear canvas
 */
export function clearCanvas() {
  canvasState.elements = [];
  canvasState.selectedId = null;
  renderCanvas();
  scheduleAutosave();
}

/**
 * Export canvas as JSON
 * @returns {object}
 */
export function exportCanvas() {
  return {
    version: "1.0",
    elements: canvasState.elements,
    zoom: canvasState.zoom,
    pan: canvasState.pan
  };
}

/**
 * Import canvas from JSON
 * @param {{elements?: DesignElement[], zoom?: number, pan?: {x: number, y: number}}} data - Canvas data
 */
export function importCanvas(data) {
  canvasState.elements = data.elements || [];
  canvasState.zoom = data.zoom || 1.0;
  canvasState.pan = data.pan || { x: 0, y: 0};
  canvasState.selectedId = null;
  renderCanvas();
  scheduleAutosave();
}

/**
 * Set active tool
 * @param {'select'|'rectangle'|'ellipse'|'text'|'hand'} tool - Tool name
 */
function setActiveTool(tool) {
  canvasState.activeTool = tool;
  renderCanvas();
}

/**
 * Render SVG element
 * @param {DesignElement} el - Element to render
 * @returns {string} SVG markup
 */
function renderElement(el) {
  switch (el.type) {
    case 'rectangle':
      return `<rect 
        id="${el.id}"
        x="${el.x}" 
        y="${el.y}" 
        width="${el.width}" 
        height="${el.height}" 
        fill="${el.fill}" 
        stroke="${el.stroke.color}" 
        stroke-width="${el.stroke.width}"
        class="canvas-element"
        data-id="${el.id}"
      />`;
      
    case 'circle':
    case 'ellipse':
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rx = el.width / 2;
      const ry = el.height / 2;
      return `<ellipse 
        id="${el.id}"
        cx="${cx}" 
        cy="${cy}" 
        rx="${rx}"
        ry="${ry}"
        fill="${el.fill}" 
        stroke="${el.stroke.color}" 
        stroke-width="${el.stroke.width}"
        class="canvas-element"
        data-id="${el.id}"
      />`;
      
    case 'text':
      return `<text 
        id="${el.id}"
        x="${el.x}" 
        y="${el.y + 20}" 
        fill="${el.fill}" 
        font-size="16"
        font-family="-apple-system, BlinkMacSystemFont, sans-serif"
        font-weight="400"
        class="canvas-element"
        data-id="${el.id}"
      >${el.name}</text>`;
      
    case 'frame':
      return `<g id="${el.id}" class="canvas-element" data-id="${el.id}">
        <rect 
          x="${el.x}" 
          y="${el.y}" 
          width="${el.width}" 
          height="${el.height}" 
          fill="none" 
          stroke="#D1D1D1" 
          stroke-width="1.5"
          stroke-dasharray="8,4"
          rx="4"
        />
        <text 
          x="${el.x}" 
          y="${el.y - 8}" 
          fill="#6B6B6B" 
          font-size="13"
          font-weight="500"
          font-family="-apple-system, BlinkMacSystemFont, sans-serif"
        >${el.name}</text>
        ${el.children.map(renderElement).join('')}
      </g>`;
      
    default:
      return '';
  }
}

/**
 * Render selection overlay with handles
 * @param {DesignElement} el - Selected element
 * @returns {string} SVG markup
 */
function renderSelectionOverlay(el) {
  if (!el) return '';
  
  // Calculate bounds
  let x = el.x;
  let y = el.y;
  let width = el.width;
  let height = el.height;
  
  // Render selection rectangle and handles
  const handles = [
    { x: x, y: y, cursor: 'nw-resize' }, // top-left
    { x: x + width / 2, y: y, cursor: 'n-resize' }, // top-center
    { x: x + width, y: y, cursor: 'ne-resize' }, // top-right
    { x: x + width, y: y + height / 2, cursor: 'e-resize' }, // right-center
    { x: x + width, y: y + height, cursor: 'se-resize' }, // bottom-right
    { x: x + width / 2, y: y + height, cursor: 's-resize' }, // bottom-center
    { x: x, y: y + height, cursor: 'sw-resize' }, // bottom-left
    { x: x, y: y + height / 2, cursor: 'w-resize' }, // left-center
  ];
  
  return `
    <rect 
      class="selection-outline"
      x="${x}" 
      y="${y}" 
      width="${width}" 
      height="${height}" 
      fill="none" 
      stroke="#F97316" 
      stroke-width="2"
      pointer-events="none"
    />
    ${handles.map((h, i) => `
      <rect 
        class="selection-handle"
        data-handle="${i}"
        x="${h.x - 4}" 
        y="${h.y - 4}" 
        width="8" 
        height="8" 
        fill="white" 
        stroke="#F97316"
        stroke-width="1.5"
        cursor="${h.cursor}"
      />
    `).join('')}
  `;
}

/**
 * Render drag preview
 * @returns {string} SVG markup
 */
function renderDragPreview() {
  if (!canvasState.dragState) return '';
  
  const { tool, startX, startY, currentX, currentY } = canvasState.dragState;
  
  if (tool === 'rectangle') {
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    return `<rect 
      class="drag-preview"
      x="${x}" 
      y="${y}" 
      width="${width}" 
      height="${height}" 
      fill="none" 
      stroke="#3b82f6" 
      stroke-width="1"
      stroke-dasharray="4,4"
      pointer-events="none"
    />`;
  }
  
  if (tool === 'ellipse') {
    const cx = (startX + currentX) / 2;
    const cy = (startY + currentY) / 2;
    const rx = Math.abs(currentX - startX) / 2;
    const ry = Math.abs(currentY - startY) / 2;
    
    return `<ellipse 
      class="drag-preview"
      cx="${cx}" 
      cy="${cy}" 
      rx="${rx}"
      ry="${ry}"
      fill="none" 
      stroke="#3b82f6" 
      stroke-width="1"
      stroke-dasharray="4,4"
      pointer-events="none"
    />`;
  }
  
  return '';
}

/**
 * Convert mouse event to SVG coordinates
 * @param {MouseEvent} e - Mouse event
 * @param {SVGSVGElement} svg - SVG element
 * @returns {{x: number, y: number}} SVG coordinates
 */
function getSVGCoords(e, svg) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: e.clientX, y: e.clientY };
  const svgP = pt.matrixTransform(ctm.inverse());
  return { x: svgP.x, y: svgP.y };
}

// ---- Gesture state: module scope so re-renders mid-drag don't kill the gesture ----
let gWinDragActive = false;
let gWinDragOffsetX = 0;
let gWinDragOffsetY = 0;
/** @type {string | null} */
let gDragElementId = null;
let gDragStartX = 0;
let gDragStartY = 0;
let gElementStartX = 0;
let gElementStartY = 0;
/** @type {number | null} */
let gResizeHandle = null;
let gResizeStartWidth = 0;
let gResizeStartHeight = 0;
let gDocHandlersAttached = false;

function currentSvg() {
  return /** @type {SVGSVGElement | null} */ (/** @type {unknown} */ (document.querySelector("#design-canvas-svg")));
}

function currentSelected() {
  return canvasState.elements.find(el => el.id === canvasState.selectedId) ?? null;
}

/** @param {MouseEvent} e */
function onCanvasDocMouseMove(e) {
  // Window drag
  if (gWinDragActive) {
    canvasState.window.x = e.clientX - gWinDragOffsetX;
    canvasState.window.y = e.clientY - gWinDragOffsetY;
    renderCanvas();
    return;
  }
  if (gResizeHandle === null && !gDragElementId && !canvasState.dragState) return;
  const svg = currentSvg();
  if (!svg) return;
  const coords = getSVGCoords(e, svg);
  const sel = currentSelected();

  // Resize via handles
  if (gResizeHandle !== null && sel) {
    const dx = coords.x - gDragStartX;
    const dy = coords.y - gDragStartY;
    let newX = gElementStartX;
    let newY = gElementStartY;
    let newWidth = gResizeStartWidth;
    let newHeight = gResizeStartHeight;
    switch (gResizeHandle) {
      case 0: newX = gElementStartX + dx; newY = gElementStartY + dy; newWidth = gResizeStartWidth - dx; newHeight = gResizeStartHeight - dy; break;
      case 1: newY = gElementStartY + dy; newHeight = gResizeStartHeight - dy; break;
      case 2: newY = gElementStartY + dy; newWidth = gResizeStartWidth + dx; newHeight = gResizeStartHeight - dy; break;
      case 3: newWidth = gResizeStartWidth + dx; break;
      case 4: newWidth = gResizeStartWidth + dx; newHeight = gResizeStartHeight + dy; break;
      case 5: newHeight = gResizeStartHeight + dy; break;
      case 6: newX = gElementStartX + dx; newWidth = gResizeStartWidth - dx; newHeight = gResizeStartHeight + dy; break;
      case 7: newX = gElementStartX + dx; newWidth = gResizeStartWidth - dx; break;
    }
    if (newWidth < 10) {
      newWidth = 10;
      if (gResizeHandle === 0 || gResizeHandle === 6 || gResizeHandle === 7) newX = gElementStartX + gResizeStartWidth - 10;
    }
    if (newHeight < 10) {
      newHeight = 10;
      if (gResizeHandle === 0 || gResizeHandle === 1 || gResizeHandle === 2) newY = gElementStartY + gResizeStartHeight - 10;
    }
    updateElement(sel.id, { x: newX, y: newY, width: newWidth, height: newHeight });
    return;
  }

  // Move element
  if (gDragElementId) {
    const dx = coords.x - gDragStartX;
    const dy = coords.y - gDragStartY;
    updateElement(gDragElementId, { x: gElementStartX + dx, y: gElementStartY + dy });
    return;
  }

  // Creation drag preview
  if (canvasState.dragState) {
    canvasState.dragState.currentX = coords.x;
    canvasState.dragState.currentY = coords.y;
    renderCanvas();
  }
}

function onCanvasDocMouseUp() {
  if (gWinDragActive) {
    gWinDragActive = false;
    return;
  }
  if (gResizeHandle !== null) {
    gResizeHandle = null;
    return;
  }
  if (gDragElementId) {
    gDragElementId = null;
    return;
  }
  if (canvasState.dragState) {
    const { tool, startX, startY, currentX, currentY } = canvasState.dragState;
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    if (width > 5 && height > 5) {
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      createElement(tool, { x, y, width, height });
      setActiveTool('select'); // Auto-return to select tool
    }
    canvasState.dragState = null;
    renderCanvas();
  }
}

function ensureDocHandlers() {
  if (gDocHandlersAttached) return;
  gDocHandlersAttached = true;
  document.addEventListener('mousemove', onCanvasDocMouseMove);
  document.addEventListener('mouseup', onCanvasDocMouseUp);
  document.addEventListener('keydown', onCanvasKeyDown);
}

/**
 * Render canvas UI
 */
function renderCanvas() {
  const container = $("#design-canvas-container");
  if (!container) return;
  
  if (!canvasState.visible) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  
  // Apply window geometry
  const { x, y, width, height, minimized } = canvasState.window;
  
  const layersList = canvasState.elements.map(el => {
    const selectedClass = el.id === canvasState.selectedId ? 'selected' : '';
    return `
      <div 
        class="layer-item ${selectedClass}"
        data-layer-id="${el.id}"
      >
        <span class="layer-type">${el.type}</span>
        <span class="layer-name">${el.name}</span>
      </div>
    `;
  }).join('');
  
  const selectedElement = canvasState.elements.find(el => el.id === canvasState.selectedId);
  
  container.innerHTML = `
    <div class="design-canvas-root" style="
      left: ${x}px;
      top: ${y}px;
      width: ${width}px;
      height: ${height}px;
      ${minimized ? 'height: auto;' : ''}
    ">
      <div class="design-canvas-panel">
        <div class="design-canvas-header">
          <div class="design-canvas-title">
            <span>GAIA Design</span>
            <input id="canvas-design-name" class="design-name-input" value="${canvasState.designName.replace(/"/g, '&quot;')}" title="Design name — sets the Dieter chat + save file" />
            <span class="canvas-element-count">${canvasState.elements.length} ${canvasState.elements.length === 1 ? 'element' : 'elements'}</span>
          </div>
          <div class="design-canvas-controls">
            <button id="canvas-minimize" title="Minimize">−</button>
            <button id="canvas-maximize" title="Maximize">□</button>
            <button id="canvas-close" title="Close">✕</button>
          </div>
        </div>
        
        <div class="design-canvas-toolbar">
          <div class="toolbar-section tool-buttons">
            <button 
              class="tool-button ${canvasState.activeTool === 'select' ? 'active' : ''}" 
              data-tool="select" 
              title="Select (V)"
            >↖</button>
            <button 
              class="tool-button ${canvasState.activeTool === 'rectangle' ? 'active' : ''}" 
              data-tool="rectangle" 
              title="Rectangle (R)"
            >▭</button>
            <button 
              class="tool-button ${canvasState.activeTool === 'ellipse' ? 'active' : ''}" 
              data-tool="ellipse" 
              title="Ellipse (O)"
            >○</button>
            <button 
              class="tool-button ${canvasState.activeTool === 'text' ? 'active' : ''}" 
              data-tool="text" 
              title="Text (T)"
            >A</button>
            <button 
              class="tool-button ${canvasState.activeTool === 'hand' ? 'active' : ''}" 
              data-tool="hand" 
              title="Hand (H)"
            >✋</button>
          </div>
          <div class="toolbar-section">
            <button id="canvas-zoom-out" title="Zoom out">−</button>
            <span class="zoom-level">${Math.round(canvasState.zoom * 100)}%</span>
            <button id="canvas-zoom-in" title="Zoom in">+</button>
          </div>
          <div class="toolbar-section">
            <button id="canvas-clear" title="Clear canvas">Clear</button>
          </div>
        </div>
        
        ${!minimized ? `
        <div class="design-canvas-viewport">
          <svg 
            id="design-canvas-svg"
            class="design-canvas-svg"
            width="100%" 
            height="100%"
            viewBox="0 0 1440 900"
          >
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#E8E8E8" stroke-width="0.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#FEFEFE" />
            <rect width="100%" height="100%" fill="url(#grid)" />
            ${canvasState.elements.map(renderElement).join('')}
            ${selectedElement ? renderSelectionOverlay(selectedElement) : ''}
            ${renderDragPreview()}
          </svg>
        </div>
        
        <div class="design-canvas-prompt">
          <div class="prompt-shell">
            <input 
              type="text" 
              id="canvas-prompt-input"
              class="prompt-input" 
              placeholder="Describe what to design..."
              value="${canvasState.promptText}"
              ${canvasState.promptPending ? 'disabled' : ''}
            />
            <button 
              id="canvas-prompt-send"
              class="prompt-send"
              ${canvasState.promptPending ? 'disabled' : ''}
            >${canvasState.promptPending ? '⋯' : '→'}</button>
          </div>
          ${canvasState.promptError ? `<div class="prompt-error">${canvasState.promptError}</div>` : ''}
        </div>
        
        <div class="design-canvas-layers">
          <div class="layers-title">Layers</div>
          <div class="layers-list">
            ${layersList}
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;
  
  // Attach event handlers
  const zoomIn = $("#canvas-zoom-in", container);
  const zoomOut = $("#canvas-zoom-out", container);
  const clear = $("#canvas-clear", container);
  const close = $("#canvas-close", container);
  const minimize = $("#canvas-minimize", container);
  const maximize = $("#canvas-maximize", container);
  const header = $(".design-canvas-header", container);
  const root = $(".design-canvas-root", container);
  const svg = $("#design-canvas-svg", container);
  
  if (zoomIn) zoomIn.onclick = () => {
    canvasState.zoom = Math.min(canvasState.zoom * 1.2, 5);
    renderCanvas();
  };
  
  if (zoomOut) zoomOut.onclick = () => {
    canvasState.zoom = Math.max(canvasState.zoom / 1.2, 0.1);
    renderCanvas();
  };
  
  if (clear) clear.onclick = () => {
    if (confirm('Clear entire canvas?')) {
      clearCanvas();
    }
  };
  
  if (close) close.onclick = () => {
    hideCanvas();
  };
  
  if (minimize) minimize.onclick = () => {
    canvasState.window.minimized = true;
    renderCanvas();
  };
  
  if (maximize) maximize.onclick = () => {
    canvasState.window.minimized = false;
    renderCanvas();
  };
  
  // Tool button handlers
  const toolButtons = container.querySelectorAll('.tool-button');
  toolButtons.forEach(btn => {
    const htmlBtn = /** @type {HTMLElement} */ (btn);
    htmlBtn.onclick = () => {
      const tool = btn.getAttribute('data-tool');
      if (tool) setActiveTool(/** @type {any} */ (tool));
    };
  });
  
  // Attach layer click handlers
  const layerItems = container.querySelectorAll('.layer-item');
  layerItems.forEach(item => {
    const htmlItem = /** @type {HTMLElement} */ (item);
    htmlItem.onclick = () => {
      const id = item.getAttribute('data-layer-id');
      if (id) selectElement(id);
    };
  });
  
  // Prompt input handlers
  const promptInput = /** @type {HTMLInputElement | null} */ ($("#canvas-prompt-input", container));
  const promptSend = $("#canvas-prompt-send", container);
  
  const designNameInput = /** @type {HTMLInputElement | null} */ ($("#canvas-design-name", container));
  if (designNameInput) {
    designNameInput.oninput = () => {
      canvasState.designName = designNameInput.value;
    };
    designNameInput.onchange = () => { scheduleAutosave(); };
  }
  
  if (promptInput) {
    promptInput.oninput = () => {
      canvasState.promptText = promptInput.value;
    };
    
    promptInput.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !canvasState.promptPending) {
        e.preventDefault();
        sendPrompt();
      }
    };
  }
  
  if (promptSend) {
    promptSend.onclick = () => {
      if (!canvasState.promptPending) {
        sendPrompt();
      }
    };
  }
  
  // Make window draggable (state module-scoped; doc handlers registered once)
  if (header && root) {
    header.onmousedown = (e) => {
      const tag = /** @type {HTMLElement} */ (e.target).tagName;
      if (tag === 'BUTTON' || tag === 'INPUT') return;
      gWinDragActive = true;
      gWinDragOffsetX = e.clientX - canvasState.window.x;
      gWinDragOffsetY = e.clientY - canvasState.window.y;
      e.preventDefault();
      header.style.cursor = 'grabbing';
    };
  }
  
  // Canvas interaction handlers
  if (svg) {
    ensureDocHandlers();
    
    svg.onmousedown = (e) => {
      const target = /** @type {Element} */ (e.target);
      const coords = getSVGCoords(e, /** @type {SVGSVGElement} */ (/** @type {unknown} */ (svg)));
      const sel = currentSelected();
      
      // Handle resize
      if (target.classList.contains('selection-handle')) {
        const handleIndex = target.getAttribute('data-handle');
        if (handleIndex !== null && sel) {
          gResizeHandle = parseInt(handleIndex);
          gDragStartX = coords.x;
          gDragStartY = coords.y;
          gElementStartX = sel.x;
          gElementStartY = sel.y;
          gResizeStartWidth = sel.width;
          gResizeStartHeight = sel.height;
          e.preventDefault();
          return;
        }
      }
      
      // Handle element selection and drag
      if (target.classList.contains('canvas-element')) {
        const id = target.getAttribute('data-id');
        if (id) {
          const el = canvasState.elements.find(el => el.id === id);
          if (el && canvasState.activeTool === 'select') {
            gDragElementId = id;
            gDragStartX = coords.x;
            gDragStartY = coords.y;
            gElementStartX = el.x;
            gElementStartY = el.y;
          }
          selectElement(id);
        }
        e.preventDefault();
        return;
      }
      
      // Handle creation tools
      if (canvasState.activeTool === 'rectangle' || canvasState.activeTool === 'ellipse') {
        canvasState.dragState = {
          tool: canvasState.activeTool,
          startX: coords.x,
          startY: coords.y,
          currentX: coords.x,
          currentY: coords.y
        };
        renderCanvas();
        e.preventDefault();
        return;
      }
      
      // Deselect on empty canvas click
      if (canvasState.activeTool === 'select') {
        canvasState.selectedId = null;
        renderCanvas();
      }
    };
  }
  
}

// Keyboard shortcuts — registered ONCE; only act when canvas visible and focus is not in an input
/** @param {KeyboardEvent} e */
function onCanvasKeyDown(e) {
  if (!canvasState.visible) return;
  const t = /** @type {HTMLElement | null} */ (document.activeElement);
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  {
    // Tool shortcuts
    if (e.key === 'v' || e.key === 'V') {
      setActiveTool('select');
      e.preventDefault();
    } else if (e.key === 'r' || e.key === 'R') {
      setActiveTool('rectangle');
      e.preventDefault();
    } else if (e.key === 'o' || e.key === 'O') {
      setActiveTool('ellipse');
      e.preventDefault();
    } else if (e.key === 't' || e.key === 'T') {
      setActiveTool('text');
      e.preventDefault();
    } else if (e.key === 'h' || e.key === 'H') {
      setActiveTool('hand');
      e.preventDefault();
    }
    
    // Delete selected element
    if ((e.key === 'Delete' || e.key === 'Backspace') && canvasState.selectedId) {
      deleteElement(canvasState.selectedId);
      e.preventDefault();
    }
    
    // Escape cancels drag or deselects
    if (e.key === 'Escape') {
      if (canvasState.dragState) {
        canvasState.dragState = null;
        renderCanvas();
      } else if (canvasState.selectedId) {
        canvasState.selectedId = null;
        renderCanvas();
      }
      e.preventDefault();
    }
  }
}

/**
 * Send prompt to canvas API
 */
async function sendPrompt() {
  const text = canvasState.promptText.trim();
  if (!text) return;
  
  canvasState.promptPending = true;
  canvasState.promptError = '';
  renderCanvas();
  
  try {
    const response = await fetch('/api/canvas/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, design: canvasState.designName })
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        canvasState.promptError = 'Canvas prompt endpoint not ready yet';
      } else {
        const errorText = await response.text().catch(() => 'Request failed');
        canvasState.promptError = errorText || 'Request failed';
      }
    } else {
      const data = await response.json();
      if (data.ok) {
        canvasState.promptText = '';
        canvasState.promptError = '';
      } else {
        canvasState.promptError = data.error || 'Prompt failed';
      }
    }
  } catch (err) {
    const error = /** @type {Error} */ (err);
    canvasState.promptError = error.message || 'Network error';
  } finally {
    canvasState.promptPending = false;
    renderCanvas();
  }
}

// Initialize canvas container
export function initCanvas() {
  const existing = $("#design-canvas-container");
  if (existing) return;
  
  const container = document.createElement("div");
  container.id = "design-canvas-container";
  document.body.appendChild(container);
  
  // Apply initial hidden state
  renderCanvas();
}

// Export canvas API
export const canvas = {
  show: showCanvas,
  hide: hideCanvas,
  toggle: toggleCanvas,
  createElement,
  updateElement,
  deleteElement,
  selectElement,
  getElements,
  clear: clearCanvas,
  export: exportCanvas,
  import: importCanvas
};
