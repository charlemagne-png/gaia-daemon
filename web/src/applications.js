// Generic Applications launcher + host. App identity is registry data; this
// module never branches on an app id or harness id.
import { api } from "./api.js";
import { $, h } from "./dom.js";
import { markDirty, registerRegion, setError } from "./render.js";
import { state } from "./state.js";

/** @typedef {{mount(root: HTMLElement, context: ApplicationPanelContext): void, update?(context: ApplicationPanelContext): void, unmount?(): void, popout?(context: ApplicationPanelContext): void}} ApplicationPanelLifecycle */
/** @typedef {{instance: any, manifest: any}} ApplicationPanelContext */

/** @type {Map<string, {lifecycle: ApplicationPanelLifecycle, initialResource: {kind: "artifacts"|"studio-project"|"workspace-app"}}>} */
const panels = new Map();
/** @type {{entry: string, instanceId: string, lifecycle: ApplicationPanelLifecycle}|null} */
let mounted = null;
let fallbackRequested = false;
let shellHidden = false;
let observedRoomKey = "";
let shellOpenRoomKey = "";

/** Native adapters register logical renderer wiring as data.
 * @param {string} entry
 * @param {ApplicationPanelLifecycle} lifecycle
 * @param {{initialResource: {kind: "artifacts"|"studio-project"|"workspace-app"}}} options */
export function registerApplicationPanel(entry, lifecycle, options) {
  if (!entry || panels.has(entry)) throw new Error(`Application panel already registered: ${entry}`);
  panels.set(entry, { lifecycle, initialResource: options.initialResource });
}

/** Replace browser mirrors only from authoritative snapshot/catalog DTOs. */
export function syncApplications() {
  const snapshot = /** @type {any} */ (state.snapshot);
  const roomKey = applicationRoomKey(snapshot);
  if (roomKey && observedRoomKey && roomKey !== observedRoomKey) {
    shellOpenRoomKey = "";
    shellHidden = false;
    state.applications.launcherOpen = false;
  }
  if (roomKey) observedRoomKey = roomKey;
  const durable = snapshot?.room?.applications;
  state.applications.catalog = Array.isArray(snapshot?.applications?.applications) ? snapshot.applications.applications : state.applications.catalog;
  state.applications.instances = durable?.instances && typeof durable.instances === "object" ? durable.instances : {};
  state.applications.order = Array.isArray(durable?.order) ? durable.order : [];
  state.applications.activeInstanceId = typeof durable?.activeInstanceId === "string" ? durable.activeInstanceId : "";
  if (!state.applications.catalog.length && snapshot?.workspace?.id) void loadCatalog(snapshot.workspace.id);
}

/** @param {string} workspaceId */
async function loadCatalog(workspaceId) {
  if (fallbackRequested) return;
  fallbackRequested = true;
  try {
    const catalog = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/applications`);
    if (state.snapshot?.workspace.id === workspaceId && Array.isArray(catalog.applications)) state.applications.catalog = catalog.applications;
  } catch {
    // A live daemon compiled before Wave 0 can still serve the new web snapshot.
    // This checked-in file is generated from BUILTIN_APPLICATION_MANIFESTS.
    try {
      const response = await fetch("/src/applications-catalog.json");
      const catalog = await response.json();
      if (state.snapshot?.workspace.id === workspaceId && Array.isArray(catalog.applications)) state.applications.catalog = catalog.applications;
    } catch {
      state.applications.error = "Application catalog unavailable";
    }
  } finally {
    markDirty("sidebar", "applications");
  }
}

export function openApplicationLauncher() {
  syncApplications();
  shellOpenRoomKey = applicationRoomKey(state.snapshot);
  shellHidden = false;
  state.applications.launcherOpen = true;
  markDirty("applications", "sidebar");
}

export function hideApplicationShell() {
  shellOpenRoomKey = "";
  shellHidden = true;
  state.applications.launcherOpen = false;
  markDirty("applications", "sidebar");
}

export function isApplicationShellVisible() {
  syncApplications();
  return shellOpenRoomKey === applicationRoomKey(state.snapshot)
    && !shellHidden
    && (state.applications.launcherOpen || Boolean(activeInstance()));
}

/** @param {any} entry */
export async function openApplication(entry) {
  const snapshot = state.snapshot;
  if (!snapshot || state.applications.loading) return;
  syncApplications();
  const existing = Object.values(state.applications.instances).find((instance) => instance.appId === entry.manifest.id);
  const adapter = panels.get(entry.manifest.panel.entry);
  if (!adapter) return setError(`No renderer registered for ${entry.manifest.name}`);
  state.applications.loading = true;
  shellOpenRoomKey = applicationRoomKey(snapshot);
  shellHidden = false;
  state.applications.launcherOpen = false;
  markDirty("applications", "sidebar");
  try {
    const base = `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/application-instances`;
    const body = existing
      ? await api(`${base}/${encodeURIComponent(existing.instanceId)}`, { method: "PATCH", body: JSON.stringify({ active: true }) })
      : await api(base, {
          method: "POST",
          body: JSON.stringify({ requestId: requestId(), appId: entry.manifest.id, resource: adapter.initialResource }),
        });
    adoptApplications(body.snapshot);
  } catch (error) {
    setError(error);
  } finally {
    state.applications.loading = false;
    markDirty("applications", "sidebar");
  }
}

/** Update an app-owned resource pointer without touching its payload ledger.
 * @param {{kind: "artifacts"|"studio-project"|"workspace-app", id?: string}} resource
 * @param {string} [view] */
export async function updateActiveApplicationResource(resource, view) {
  const snapshot = state.snapshot;
  const instance = activeInstance();
  if (!snapshot || !instance) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/application-instances/${encodeURIComponent(instance.instanceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ resource, ...(view === undefined ? {} : { view }), baseUpdatedAt: instance.updatedAt }),
    });
    adoptApplications(body.snapshot);
    markDirty("applications", "sidebar");
  } catch (error) {
    setError(error);
  }
}

export async function closeActiveApplication() {
  const snapshot = state.snapshot;
  const instance = activeInstance();
  if (!snapshot || !instance) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/application-instances/${encodeURIComponent(instance.instanceId)}`, { method: "DELETE" });
    adoptApplications(body.snapshot);
    shellOpenRoomKey = "";
    shellHidden = true;
    state.applications.launcherOpen = false;
    markDirty("applications", "sidebar");
  } catch (error) {
    setError(error);
  }
}

/** @param {any} snapshot */
function adoptApplications(snapshot) {
  if (!state.snapshot || !snapshot || state.snapshot.workspace.id !== snapshot.workspace.id || state.snapshot.room.id !== snapshot.room.id) return;
  state.snapshot.room.applications = snapshot.room.applications;
  /** @type {any} */ (state.snapshot).applications = snapshot.applications;
  syncApplications();
}

function activeInstance() {
  syncApplications();
  return state.applications.instances[state.applications.activeInstanceId] ?? null;
}

/** Sidebar section; definitions remain catalog-driven. */
export function ApplicationsLauncher({ compact = true } = {}) {
  syncApplications();
  const cards = state.applications.catalog.map((entry) => {
    const open = Object.values(state.applications.instances).some((instance) => instance.appId === entry.manifest.id);
    const preferred = entry.manifest.agent?.preferred?.[0];
    return h("button", {
      class: `application-card ${open ? "open" : ""}`,
      type: "button",
      disabled: state.applications.loading || !entry.launchable,
      title: entry.manifest.description || entry.manifest.name,
      onclick: () => void openApplication(entry),
    },
    h("span", { class: "application-icon", text: entry.manifest.icon?.value || "□" }),
    h("span", { class: "application-card-copy" }, h("strong", { text: entry.manifest.name }), compact ? null : h("small", { text: entry.manifest.description || "Built-in work surface" })),
    h("span", { class: "application-card-meta", text: open ? "open" : preferred ? `@${preferred}` : "active" }));
  });
  return h("div", { class: compact ? "applications-launcher compact" : "applications-launcher" },
    cards.length ? cards : h("span", { class: "empty", text: state.applications.error || "Loading applications…" }));
}

function renderApplications() {
  syncApplications();
  const root = $("#application-shell");
  if (!root) return;
  const instance = activeInstance();
  const show = shellOpenRoomKey === applicationRoomKey(state.snapshot)
    && !shellHidden
    && (state.applications.launcherOpen || Boolean(instance));
  root.hidden = !show;
  root.closest(".main")?.classList.toggle("applications-open", show);
  if (!show) return unmountPanel();
  if (state.applications.launcherOpen || !instance) {
    unmountPanel();
    root.replaceChildren(h("section", { class: "application-home", "aria-label": "Applications" },
      h("header", { class: "application-home-head" },
        h("div", {}, h("span", { class: "application-kicker", text: "Work surfaces" }), h("h2", { text: "Applications" })),
        h("div", { class: "application-home-actions" },
          h("button", { type: "button", disabled: true, text: "＋ Create app" }),
          h("button", { type: "button", title: "close applications", onclick: () => hideApplicationShell(), text: "×" }))),
      ApplicationsLauncher({ compact: false })));
    return;
  }
  const entry = state.applications.catalog.find((candidate) => candidate.manifest.id === instance.appId);
  const registration = entry ? panels.get(entry.manifest.panel.entry) : undefined;
  if (!entry || !registration) {
    unmountPanel();
    root.replaceChildren(h("div", { class: "application-empty", text: "Application renderer unavailable." }));
    return;
  }
  const context = { instance, manifest: entry.manifest };
  if (mounted && mounted.instanceId === instance.instanceId && mounted.entry === entry.manifest.panel.entry) {
    registration.lifecycle.update?.(context);
    return;
  }
  unmountPanel();
  const surface = h("section", { class: "application-surface", id: `application-surface-${instance.instanceId}` });
  root.replaceChildren(h("header", { class: "application-chrome" },
    h("button", { type: "button", title: "all applications", onclick: () => openApplicationLauncher(), text: "←" }),
    h("span", { class: "application-chrome-icon", text: entry.manifest.icon.value }),
    h("div", { class: "application-identity" }, h("strong", { text: entry.manifest.name }), h("small", { text: `@${entry.manifest.agent?.preferred?.[0] || state.snapshot?.room.activeAgent || "active"}` })),
    h("span", { class: "application-save-state", text: "saved" }),
    entry.manifest.panel.popout && registration.lifecycle.popout ? h("button", { type: "button", onclick: () => registration.lifecycle.popout?.(context), text: "pop out" }) : null,
    h("button", { type: "button", title: "close application", onclick: () => void closeActiveApplication(), text: "×" })), surface);
  mounted = { entry: entry.manifest.panel.entry, instanceId: instance.instanceId, lifecycle: registration.lifecycle };
  registration.lifecycle.mount(surface, context);
}

function unmountPanel() {
  mounted?.lifecycle.unmount?.();
  mounted = null;
}

/** @param {any} snapshot */
function applicationRoomKey(snapshot) {
  return snapshot?.workspace?.id && snapshot?.room?.id
    ? `${snapshot.workspace.id}:${snapshot.room.id}`
    : "";
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

registerRegion("applications", renderApplications);
