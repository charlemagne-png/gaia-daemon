import { $, h } from "../dom.js";
import { registerRegion } from "../render.js";
import { closeStudioSurface, minimizeStudioSurface, openStudioPath, openStudioPopout, restoreStudioSurface, saveStudioFile, selectStudioView, sendStudioPrompt, updateStudioDraft, updateStudioPrompt } from "./actions.js";
import { selectedStudioView, studio, studioPreviewUrl } from "./state.js";

registerRegion("studio", renderStudioPanel);

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !studio.project) return;
  if (event.target instanceof HTMLElement && event.target.closest("iframe")) return;
  event.preventDefault();
  void closeStudioSurface();
});

export function renderStudioPanel() {
  const root = $(studio.popout ? "#app" : "#studio-root");
  if (!root) return;
  root.replaceChildren(studio.popout ? renderPopout() : renderPanel());
}

function renderPanel() {
  if (!studio.project) {
    return h("section", { class: "studio-panel studio-empty", "aria-label": "Design Studio" },
      h("div", { class: "studio-kicker", text: "Design Studio" }),
      h("h2", { text: "Open a design surface" }),
      h("p", { text: "Bind one HTML file or folder to a durable GAIA room, then iterate with preview, save, and prompt in one place." }),
      h("button", { class: "primary", type: "button", onclick: () => void openStudioPath(), text: studio.loading ? "Opening…" : "Open file or folder" }),
      studio.error ? h("p", { class: "studio-error", role: "alert", text: studio.error }) : null,
    );
  }
  if (studio.minimized) return renderMinimized(false);
  return h("section", { class: "studio-panel", "aria-label": "Design Studio" }, renderHeader(false), renderTabs(), renderWorkspace(), renderPrompt());
}

function renderPopout() {
  if (studio.minimized) return renderMinimized(true);
  return h("main", { class: "studio-popout", "aria-label": "Design Studio popout" }, renderHeader(true), h("div", { class: "studio-popout-preview" }, renderPreview()), renderPrompt());
}

/** @param {boolean} compact */
function renderMinimized(compact) {
  return h("section", { class: compact ? "studio-popout minimized" : "studio-panel minimized", "aria-label": "Design Studio minimized" },
    h("div", {}, h("strong", { text: studio.project?.relativePath || studio.project?.designPath || "Design Studio" }), h("small", { text: statusText() })),
    h("div", { class: "studio-actions" },
      h("button", { type: "button", onclick: () => restoreStudioSurface(), text: "Restore" }),
      h("button", { type: "button", onclick: () => void closeStudioSurface(), text: compact ? "Close window" : "Close Studio" }),
    ),
  );
}

/** @param {boolean} compact */
function renderHeader(compact) {
  const project = studio.project;
  return h("header", { class: compact ? "studio-head compact" : "studio-head" },
    h("div", {}, h("div", { class: "studio-kicker", text: "Design Studio" }), h("h2", { text: project?.relativePath || project?.designPath || "No project" }), h("p", { text: statusText() })),
    h("div", { class: "studio-actions" },
      compact ? null : h("button", { type: "button", onclick: () => void openStudioPath(), text: "Open" }),
      compact ? null : h("button", { type: "button", onclick: () => void openStudioPopout(), disabled: !studio.project, text: "Pop out" }),
      h("button", { type: "button", onclick: () => void minimizeStudioSurface(), text: "Minimize" }),
      h("button", { type: "button", onclick: () => void closeStudioSurface(), text: compact ? "Close window" : "Close Studio" }),
      h("button", { class: "primary", type: "button", onclick: () => void saveStudioFile(), disabled: !studio.editor.dirty || studio.saving, text: studio.saving ? "Saving…" : "Save" }),
    ),
    studio.stale ? h("p", { class: "studio-error", role: "alert", text: studio.stale }) : null,
  );
}

function renderTabs() {
  return h("div", { class: "studio-tabs", role: "tablist", "aria-label": "Studio views" }, studio.views.map((view) => h("button", { role: "tab", "aria-selected": view.id === studio.selectedViewId, class: view.id === studio.selectedViewId ? "active" : "", type: "button", onclick: () => void selectStudioView(view.id), text: view.title || view.path })));
}

function renderWorkspace() {
  return h("div", { class: "studio-workspace" },
    h("section", { class: "studio-preview-card", "aria-label": "Preview" }, renderPreview()),
    h("section", { class: "studio-editor", "aria-label": "Source editor" },
      h("div", { class: "studio-editor-bar" }, h("span", { text: studio.editor.path || selectedStudioView()?.path || "No file" }), h("span", { text: studio.editor.dirty ? "Unsaved" : "Saved" })),
      h("textarea", { value: studio.editor.content, oninput: (event) => updateStudioDraft(/** @type {HTMLTextAreaElement} */ (event.currentTarget).value), disabled: !studio.editor.loaded, "aria-label": "Design source" }),
    ),
  );
}

function renderPreview() {
  const src = studioPreviewUrl();
  if (!src) return h("div", { class: "studio-preview-empty", text: "No preview selected" });
  return h("iframe", { class: "studio-preview", title: "Studio preview", src, sandbox: "allow-scripts allow-forms allow-modals allow-pointer-lock", referrerpolicy: "no-referrer" });
}

function renderPrompt() {
  return h("form", { class: "studio-prompt", onsubmit: (event) => { event.preventDefault(); void sendStudioPrompt(); } },
    h("input", { value: studio.prompt, placeholder: "Ask @gaia to iterate on this view", oninput: (event) => updateStudioPrompt(/** @type {HTMLInputElement} */ (event.currentTarget).value), "aria-label": "Studio prompt" }),
    h("button", { class: "primary", type: "submit", disabled: studio.iterating || !studio.prompt.trim(), text: studio.iterating ? "Queueing…" : "Send" }),
  );
}

function statusText() {
  if (studio.loading) return "Loading project";
  if (studio.iterationStatus && studio.iterationStatus !== "idle") return `Iteration ${studio.iterationStatus}`;
  return studio.effectiveDesignPath || "Ready";
}
