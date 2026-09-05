// Local command-plugin loader. A plugin is a single .mjs file dropped in
// ~/.gaia/plugins/ that owns one slash-command name — no repo change needed to
// add, remove, or edit one. Kept generic on purpose: nothing here knows about
// any specific plugin's behavior (see room-service.ts for the two call sites
// that consult the loaded map).

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface PluginAgent {
  id: string;
  displayName: string;
  icon: string;
}

export interface PluginPanelField {
  name: string;
  label: string;
  type: "text" | "select" | "textarea";
  value?: string;
  options?: Array<{ value: string; label: string }>;
}

export type PluginPanelPlacement = "overlay" | "corner";
export type PluginPanelCorner = "br" | "bl" | "tr" | "tl";

/** Declarative, data-only plugin panel. The web client renders this generic
 * shape as a transient, themed overlay dialog by default, or as an optional
 * corner dock when the plugin declares placement: "corner". No iframe/embed:
 * forms/items are the only surface. */
export interface PluginPanel {
  title: string;
  description?: string;
  placement?: PluginPanelPlacement;
  corner?: PluginPanelCorner;
  forms?: Array<{ action: string; label: string; fields: PluginPanelField[] }>;
  items?: Array<{ title: string; detail?: string; actions?: Array<{ action: string; label: string; args?: string[]; danger?: boolean }> }>;
}

const panelPlacements = new Set(["overlay", "corner"]);
const panelCorners = new Set(["br", "bl", "tr", "tl"]);

/** @param panel plugin-supplied panel; output is the snapshot-safe panel shape. */
export function sanitizePluginPanel(panel: PluginPanel | undefined): PluginPanel | undefined {
  if (!panel) return undefined;
  const title = cleanString(panel.title, 160);
  if (!title) return undefined;
  const out: PluginPanel = { title };
  const description = cleanString(panel.description, 800);
  if (description) out.description = description;
  if (panelPlacements.has(String(panel.placement))) out.placement = panel.placement;
  if (panelCorners.has(String(panel.corner))) out.corner = panel.corner;
  const forms = sanitizeForms(panel.forms);
  if (forms.length) out.forms = forms;
  const items = sanitizeItems(panel.items);
  if (items.length) out.items = items;
  return out.forms?.length || out.items?.length ? out : undefined;
}

function cleanString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeForms(forms: PluginPanel["forms"]): NonNullable<PluginPanel["forms"]> {
  return (Array.isArray(forms) ? forms : []).slice(0, 12).flatMap((form) => {
    const action = cleanString(form?.action, 120);
    const label = cleanString(form?.label, 160);
    const fields = sanitizeFields(form?.fields);
    return action && label && fields.length ? [{ action, label, fields }] : [];
  });
}

function sanitizeFields(fields: PluginPanelField[] | undefined): PluginPanelField[] {
  return (Array.isArray(fields) ? fields : []).slice(0, 16).flatMap((field) => {
    const name = cleanString(field?.name, 120);
    const label = cleanString(field?.label, 160);
    const type = field?.type === "select" ? "select" : field?.type === "textarea" ? "textarea" : field?.type === "text" ? "text" : undefined;
    if (!name || !label || !type) return [];
    const out: PluginPanelField = { name, label, type };
    const value = cleanString(field?.value, 400);
    if (value) out.value = value;
    if (type === "select") {
      const options = sanitizeOptions(field?.options);
      if (options.length) out.options = options;
    }
    return [out];
  });
}

function sanitizeOptions(options: PluginPanelField["options"]): NonNullable<PluginPanelField["options"]> {
  return (Array.isArray(options) ? options : []).slice(0, 64).flatMap((option) => {
    const value = cleanString(option?.value, 400);
    const label = cleanString(option?.label, 400);
    return value && label ? [{ value, label }] : [];
  });
}

function sanitizeItems(items: PluginPanel["items"]): NonNullable<PluginPanel["items"]> {
  return (Array.isArray(items) ? items : []).slice(0, 64).flatMap((item) => {
    const title = cleanString(item?.title, 160);
    if (!title) return [];
    const out: NonNullable<PluginPanel["items"]>[number] = { title };
    const detail = cleanString(item?.detail, 800);
    if (detail) out.detail = detail;
    const actions = sanitizeActions(item?.actions);
    if (actions.length) out.actions = actions;
    return [out];
  });
}

function sanitizeActions(actions: NonNullable<NonNullable<PluginPanel["items"]>[number]["actions"]> | undefined): NonNullable<NonNullable<PluginPanel["items"]>[number]["actions"]> {
  return (Array.isArray(actions) ? actions : []).slice(0, 16).flatMap((action) => {
    const name = cleanString(action?.action, 120);
    const label = cleanString(action?.label, 160);
    if (!name || !label) return [];
    const args = (Array.isArray(action?.args) ? action.args : []).slice(0, 16).map((arg) => cleanString(arg, 400)).filter(Boolean);
    return [{ action: name, label, ...(args.length ? { args } : {}), ...(action?.danger === true ? { danger: true } : {}) }];
  });
}

export interface PluginContext {
  homedir: string;
  roomId: string;
  workspaceRoot: string;
  state?: Record<string, unknown>;
  agents: PluginAgent[];
}

export interface PluginResult {
  steer?: string;
  reply?: string;
  /** Request a known workspace agent as the room's subsequent chat target. */
  activeAgent?: string;
  /** Opaque JSON object durably owned by this plugin under RoomState.pluginState. */
  state?: Record<string, unknown>;
}

export interface CommandPlugin {
  command: string;
  description?: string;
  run(args: string[], ctx: PluginContext): PluginResult | Promise<PluginResult>;
  /** Optional room-local declarative panel, projected through snapshots. */
  panel?(ctx: PluginContext): PluginPanel | Promise<PluginPanel | undefined>;
  /** Optional per-turn context. Called uniformly for every harness and agent. */
  prompt?(ctx: PluginContext & { agentId: string }): string | Promise<string | undefined>;
}

/** Scans ~/.gaia/plugins/*.mjs and dynamic-imports each one's default export as
 * a CommandPlugin, keyed by its .command name. Never throws: a missing plugins
 * dir yields an empty map, and a bad/duplicate module is skipped with a
 * console.warn rather than taking the whole load down. */
export async function loadCommandPlugins(): Promise<Map<string, CommandPlugin>> {
  const plugins = new Map<string, CommandPlugin>();
  const dir = join(homedir(), ".gaia", "plugins");
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((file) => file.endsWith(".mjs"))
      .sort();
  } catch {
    return plugins; // no ~/.gaia/plugins dir — nothing to load
  }
  for (const file of files) {
    const path = join(dir, file);
    try {
      const mod = await import(pathToFileURL(path).href);
      const candidate = mod?.default;
      if (!candidate || typeof candidate.command !== "string" || typeof candidate.run !== "function") {
        console.warn(`[plugins] skipped ${file}: invalid plugin (needs a default export with string .command and function .run)`);
        continue;
      }
      const plugin = candidate as CommandPlugin;
      if (plugins.has(plugin.command)) {
        console.warn(`[plugins] skipped ${file}: duplicate command "${plugin.command}"`);
        continue;
      }
      plugins.set(plugin.command, plugin);
    } catch (error) {
      console.warn(`[plugins] skipped ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plugins;
}
