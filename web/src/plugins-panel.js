// Renders room-local plugin panels. Default placement stays the existing
// transient overlay popup; placement:"corner" uses the same declarative
// forms/items data in a minimizable corner dock. No iframe/embed surface.
import { runPluginAction } from "./actions.js";
import { $, h } from "./dom.js";
import { registerRegion } from "./render.js";
import { state } from "./state.js";

/** @typedef {import("./types.js").PluginPanel} PluginPanel */
/** @typedef {import("./types.js").PluginPanelField} PluginPanelField */
/** @typedef {[string, PluginPanel]} PanelEntry */

/** @param {string} command @param {string[]} args */
function submit(command, args) {
  void runPluginAction(command, args);
}

/** @param {PluginPanel} panel @returns {"overlay"|"corner"} */
export function pluginPanelPlacement(panel) {
  return panel.placement === "corner" ? "corner" : "overlay";
}

/** @param {PluginPanel} panel @returns {"br"|"bl"|"tr"|"tl"} */
export function pluginPanelCorner(panel) {
  switch (panel.corner) {
    case "bl":
    case "tr":
    case "tl":
      return panel.corner;
    default:
      return "br";
  }
}

/**
 * @param {PluginPanelField} field
 * @param {Record<string, HTMLInputElement|HTMLSelectElement>} refs
 */
function Field(field, refs) {
  const control = field.type === "select"
    ? h(
        "select",
        { class: "prompt-input" },
        (field.options ?? []).map((opt) => h("option", { value: opt.value, text: opt.label, selected: opt.value === field.value })),
      )
    : h("input", { type: "text", class: "prompt-input", ...(field.value ? { value: field.value } : {}) });
  refs[field.name] = /** @type {HTMLInputElement|HTMLSelectElement} */ (control);
  return h("label", { class: "plugin-field" }, h("span", { class: "plugin-field-label", text: field.label }), control);
}

/** @param {string} command @param {{action:string,label:string,fields:PluginPanelField[]}} form */
function Form(command, form) {
  /** @type {Record<string, HTMLInputElement|HTMLSelectElement>} */
  const refs = {};
  const run = () => submit(command, [form.action, ...form.fields.map((field) => refs[field.name]?.value ?? "")]);
  return h(
    "form",
    { class: "plugin-form", onsubmit: (/** @type {SubmitEvent} */ event) => { event.preventDefault(); run(); } },
    h("div", { class: "plugin-form-label", text: form.label }),
    form.fields.map((field) => Field(field, refs)),
    h("button", { class: "prompt-btn primary", type: "submit", text: form.label }),
  );
}

/** @param {string} command @param {{title:string,detail?:string,actions?:Array<{action:string,label:string,args?:string[],danger?:boolean}>}} item */
function Item(command, item) {
  return h(
    "div",
    { class: "plugin-item" },
    h("strong", { text: item.title }),
    item.detail ? h("p", { class: "prompt-detail", text: item.detail }) : null,
    item.actions?.length
      ? h(
          "div",
          { class: "plugin-item-actions" },
          item.actions.map((action) =>
            h("button", {
              class: `prompt-btn ${action.danger ? "danger" : ""}`,
              onclick: () => submit(command, [action.action, ...(action.args ?? [])]),
              text: action.label,
            }),
          ),
        )
      : null,
  );
}

/** @param {string} command @param {PluginPanel} panel */
function PluginModal(command, panel) {
  const close = () => submit(command, ["close"]);
  const backdrop = h(
    "div",
    {
      class: "modal-backdrop",
      onmousedown: (/** @type {MouseEvent} */ event) => { if (event.target === backdrop) close(); },
    },
    h(
      "section",
      { class: "modal prompt-modal plugin-dialog" },
      h("div", { class: "panel-head" }, h("h2", { text: panel.title })),
      panel.description ? h("p", { class: "prompt-detail", text: panel.description }) : null,
      (panel.forms ?? []).map((form) => Form(command, form)),
      (panel.items ?? []).map((item) => Item(command, item)),
      h("div", { class: "prompt-actions" }, h("button", { class: "prompt-btn", onclick: close, text: "Close" })),
    ),
  );
  return backdrop;
}

/** @param {string} command @param {PluginPanel} panel @param {number} stack */
function PluginCorner(command, panel, stack) {
  const corner = pluginPanelCorner(panel);
  const expanded = cornerExpanded(command);
  const style = `--plugin-corner-offset:${stack * 12}px;`;
  return h(
    "aside",
    {
      class: `plugin-corner plugin-corner--${corner} ${expanded ? "plugin-corner--expanded" : "plugin-corner--collapsed"}`,
      style,
      "data-plugin-command": command,
      "aria-label": `${panel.title} plugin panel`,
    },
    expanded ? CornerPanel(command, panel) : CornerFab(command, panel),
  );
}

/** @param {string} command @param {PluginPanel} panel */
function CornerFab(command, panel) {
  return h(
    "button",
    {
      class: "plugin-corner-fab",
      type: "button",
      title: `Open ${panel.title}`,
      "aria-label": `Open ${panel.title}`,
      "aria-expanded": "false",
      onclick: () => setCornerExpanded(command, true),
    },
    h("span", { class: "plugin-corner-fab-mark", text: panel.title.trim().slice(0, 1).toUpperCase() || "•" }),
  );
}

/** @param {string} command @param {PluginPanel} panel */
function CornerPanel(command, panel) {
  const close = () => submit(command, ["close"]);
  return h(
    "section",
    { class: "plugin-corner-panel", "aria-label": panel.title, "aria-expanded": "true" },
    h(
      "header",
      { class: "plugin-corner-head" },
      h("div", { class: "plugin-corner-title" }, h("h2", { text: panel.title }), panel.description ? h("p", { text: panel.description }) : null),
      h(
        "div",
        { class: "plugin-corner-controls" },
        h("button", { class: "plugin-corner-minimize", type: "button", title: "Minimize", "aria-label": "Minimize", onclick: () => setCornerExpanded(command, false), text: "–" }),
        h("button", { class: "plugin-corner-close", type: "button", title: "Close", "aria-label": "Close", onclick: close, text: "×" }),
      ),
    ),
    h(
      "div",
      { class: "plugin-corner-body" },
      (panel.forms ?? []).map((form) => Form(command, form)),
      (panel.items ?? []).map((item) => Item(command, item)),
    ),
  );
}

/** @param {KeyboardEvent} event */
function onEscape(event) {
  if (event.key !== "Escape") return;
  const panels = openPanels();
  const expandedCorner = [...panels].reverse().find(([command, panel]) => pluginPanelPlacement(panel) === "corner" && cornerExpanded(command));
  if (expandedCorner) {
    event.preventDefault();
    setCornerExpanded(expandedCorner[0], false);
    return;
  }
  const overlayPanels = panels.filter(([, panel]) => pluginPanelPlacement(panel) === "overlay");
  if (overlayPanels.length === 0) return;
  event.preventDefault();
  const [command] = overlayPanels[overlayPanels.length - 1];
  submit(command, ["close"]);
}

/** @returns {PanelEntry[]} */
function openPanels() {
  return /** @type {PanelEntry[]} */ (Object.entries(state.snapshot?.room.pluginPanels ?? {})).filter(([, panel]) => (panel.forms?.length ?? 0) > 0 || (panel.items?.length ?? 0) > 0);
}

/** @param {string} command */
function cornerExpanded(command) {
  try {
    const value = localStorage.getItem(cornerStorageKey(command));
    return value === null ? true : value === "true";
  } catch {
    return true;
  }
}

/** @param {string} command @param {boolean} expanded */
function setCornerExpanded(command, expanded) {
  try {
    localStorage.setItem(cornerStorageKey(command), String(expanded));
  } catch {
    // Session-only when localStorage is unavailable.
  }
  renderPluginPanels();
}

/** @param {string} command */
function cornerStorageKey(command) {
  return `gaia.pluginPanel.${command}.expanded`;
}

/** @param {PanelEntry[]} panels */
function cornerStackIndexes(panels) {
  /** @type {Record<string, number>} */
  const counts = {};
  return panels.map(([command, panel]) => {
    const corner = pluginPanelCorner(panel);
    const index = counts[corner] ?? 0;
    counts[corner] = index + 1;
    return /** @type {[string, PluginPanel, number]} */ ([command, panel, index]);
  });
}

let escBound = false;

function renderPluginPanels() {
  const slot = $("#overlay-plugins");
  if (!slot) return;
  const panels = openPanels();
  if (panels.length === 0) {
    slot.replaceChildren();
    if (escBound) { window.removeEventListener("keydown", onEscape, true); escBound = false; }
    return;
  }
  if (!escBound) { window.addEventListener("keydown", onEscape, true); escBound = true; }
  const overlayPanels = panels.filter(([, panel]) => pluginPanelPlacement(panel) === "overlay");
  const cornerPanels = panels.filter(([, panel]) => pluginPanelPlacement(panel) === "corner");
  slot.replaceChildren(
    ...overlayPanels.map(([command, panel]) => PluginModal(command, panel)),
    ...cornerStackIndexes(cornerPanels).map(([command, panel, stack]) => PluginCorner(command, panel, stack)),
  );
}

registerRegion("plugins", renderPluginPanels);
