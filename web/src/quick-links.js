// QUICK-LINKS ROW — horizontally scrollable project/repo chips.
// Data-driven from web/quick-links.json (Charles-editable, no code change needed).
// Chips open URLs in system browser (external navigation, never in-app).

import { isNative, openWebWindow } from "./native.js";

/**
 * @typedef {Object} QuickLink
 * @property {string} id       - Unique identifier
 * @property {string} label    - Display text
 * @property {string} url      - Target URL (opens in system browser)
 * @property {string} [icon]   - Optional icon URL
 */

/**
 * @typedef {Object} QuickLinksHandle
 * @property {() => void} destroy - Cleanup function
 */

/**
 * @typedef {Object} QuickLinksOptions
 * @property {string} [dataUrl] - URL to fetch quick-links JSON (default: /web/quick-links.json)
 */

/**
 * Mount a quick-links row into the given element.
 * @param {HTMLElement} el - Container element
 * @param {QuickLinksOptions} [opts] - Options
 * @returns {Promise<QuickLinksHandle>} Handle with destroy method
 */
export async function mountQuickLinks(el, opts = {}) {
  // web/ is the static root, so the file at web/quick-links.json is served at
  // /quick-links.json (not /web/quick-links.json).
  const dataUrl = opts.dataUrl ?? "/quick-links.json";
  
  /** @type {QuickLink[]} */
  let links = [];
  
  try {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`Failed to fetch quick-links: ${res.status}`);
    links = await res.json();
  } catch (e) {
    console.error("Failed to load quick-links data:", e);
    // Render empty on failure
  }
  
  const container = document.createElement("div");
  container.className = "quick-links-container";
  
  for (const link of links) {
    const tile = document.createElement("button");
    tile.className = "quick-links-tile";
    tile.type = "button";
    tile.setAttribute("data-link-id", link.id);
    tile.title = link.url;
    
    // Avatar square: monogram (first letter) or custom icon if provided
    const avatar = document.createElement("div");
    avatar.className = "quick-links-avatar";
    if (link.icon) {
      // Custom icon (future: support image URLs)
      avatar.textContent = link.label[0].toUpperCase();
    } else {
      // Monogram: first letter
      avatar.textContent = link.label[0].toUpperCase();
    }
    
    const label = document.createElement("div");
    label.className = "quick-links-label";
    label.textContent = link.label;
    
    tile.appendChild(avatar);
    tile.appendChild(label);
    
    // Click handler: open in system browser via native shell if available
    tile.addEventListener("click", async () => {
      if (isNative()) {
        await openWebWindow(link.url);
      } else {
        // Fallback for browser mode
        window.open(link.url, "_blank", "noopener,noreferrer");
      }
    });
    
    container.appendChild(tile);
  }
  
  el.replaceChildren(container);
  
  return {
    destroy() {
      container.remove();
    }
  };
}
