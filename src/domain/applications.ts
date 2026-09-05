import { isAbsolute } from "node:path";
import type { RoomApplicationInstance, RoomApplicationsStateV1 } from "../core/types.js";

export const APPLICATION_SCHEMA = 1 as const;
export const APPLICATION_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
export const APPLICATION_TOOL_IDS = [
  "read",
  "write",
  "edit",
  "bash",
  "web",
  "memory",
  "recall",
  "artifact",
  "summon",
  "resume",
  "gaia",
] as const;

export type ApplicationToolId = (typeof APPLICATION_TOOL_IDS)[number];
export type ApplicationResource = "artifact" | "files" | "versions" | "preview";

export interface ApplicationManifestV1 {
  schema: 1;
  id: string;
  name: string;
  description?: string;
  icon: { kind: "symbol" | "asset"; value: string };
  panel: {
    kind: "native" | "studio";
    entry: string;
    defaultSize?: "drawer" | "workspace" | "full";
    popout?: boolean;
  };
  agent: {
    preferred?: string[];
    role?: string;
    fallback: "active" | "workspace-default";
    context?: string;
  };
  tools: string[];
  resources?: ApplicationResource[];
  source?: { root: string; entry: string };
  createdBy: { kind: "builtin" | "human" | "agent"; id?: string };
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationCatalogEntry {
  manifest: ApplicationManifestV1;
  source: "builtin" | "workspace";
  launchable: boolean;
  relativeRoot?: string;
  manifestPath?: string;
}

export interface ApplicationCatalogDiagnostic {
  relativeRoot: string;
  manifestPath?: string;
  code: "invalid-package" | "invalid-manifest" | "builtin-shadowed";
  message: string;
}

export interface ApplicationCatalog {
  schema: 1;
  applications: ApplicationCatalogEntry[];
  diagnostics: ApplicationCatalogDiagnostic[];
}

export interface ParseApplicationManifestOptions {
  origin?: "builtin" | "workspace";
  knownTools?: readonly string[];
}

const BUILTIN_TIMESTAMP = "2026-09-05T00:00:00.000Z";

export const BUILTIN_APPLICATION_MANIFESTS: readonly ApplicationManifestV1[] = Object.freeze([
  {
    schema: 1,
    id: "design",
    name: "Design",
    icon: { kind: "symbol", value: "◇" },
    panel: { kind: "native", entry: "design", defaultSize: "workspace", popout: false },
    agent: { preferred: ["dieter"], fallback: "active", context: "visual artifact and canvas work" },
    tools: ["artifact"],
    resources: ["artifact", "versions", "preview"],
    createdBy: { kind: "builtin" },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    schema: 1,
    id: "studio",
    name: "Studio",
    icon: { kind: "symbol", value: "▣" },
    panel: { kind: "native", entry: "studio", defaultSize: "workspace", popout: true },
    agent: { preferred: [], fallback: "active", context: "inspect, edit, preview, and iterate source" },
    tools: ["read", "write", "edit", "artifact"],
    resources: ["files", "versions", "preview"],
    createdBy: { kind: "builtin" },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
].map((manifest) => parseApplicationManifest(manifest, { origin: "builtin" })));

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length) throw new Error(`${path} has unknown field '${unknown[0]}'`);
  const missing = required.find((key) => !(key in value));
  if (missing) throw new Error(`${path} is missing '${missing}'`);
}

function stringValue(value: unknown, path: string, max = 512): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${path} must not be empty`);
  if (normalized.length > max) throw new Error(`${path} is too long`);
  return normalized;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${path} must be one of: ${values.join(", ")}`);
  return value as T;
}

function optionalString(value: unknown, path: string, max = 512): string | undefined {
  return value === undefined ? undefined : stringValue(value, path, max);
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const result = value.map((item, index) => stringValue(item, `${path}[${index}]`, 128));
  if (new Set(result).size !== result.length) throw new Error(`${path} must not contain duplicates`);
  return result;
}

function timestamp(value: unknown, path: string): string {
  const parsed = stringValue(value, path, 64);
  const time = Date.parse(parsed);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== parsed) throw new Error(`${path} must be an ISO timestamp`);
  return parsed;
}

export function validateApplicationId(value: unknown): string {
  const id = stringValue(value, "manifest.id", 48);
  if (!APPLICATION_ID_PATTERN.test(id)) throw new Error("manifest.id must match [a-z][a-z0-9-]{1,47}");
  return id;
}

/** Strict workspace-relative path. `.` is accepted only for package/source roots. */
export function validateApplicationRelativePath(value: unknown, path: string, allowRoot = false): string {
  const input = stringValue(value, path, 512);
  if (input.includes("\\") || input.includes("\0") || isAbsolute(input)) throw new Error(`${path} must be workspace-relative`);
  if (allowRoot && input === ".") return input;
  const parts = input.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`${path} must be a normalized relative path`);
  return parts.join("/");
}

export function parseApplicationManifest(raw: unknown, options: ParseApplicationManifestOptions = {}): ApplicationManifestV1 {
  const manifest = record(raw, "manifest");
  exactKeys(manifest, ["schema", "id", "name", "description", "icon", "panel", "agent", "tools", "resources", "source", "createdBy", "createdAt", "updatedAt"], ["schema", "id", "name", "icon", "panel", "agent", "tools", "createdBy", "createdAt", "updatedAt"], "manifest");
  if (manifest.schema !== APPLICATION_SCHEMA) throw new Error("manifest.schema must be 1");

  const icon = record(manifest.icon, "manifest.icon");
  exactKeys(icon, ["kind", "value"], ["kind", "value"], "manifest.icon");
  const iconKind = enumValue(icon.kind, ["symbol", "asset"] as const, "manifest.icon.kind");
  const iconValue = iconKind === "asset"
    ? validateApplicationRelativePath(icon.value, "manifest.icon.value")
    : stringValue(icon.value, "manifest.icon.value", 16);

  const panel = record(manifest.panel, "manifest.panel");
  exactKeys(panel, ["kind", "entry", "defaultSize", "popout"], ["kind", "entry"], "manifest.panel");
  const panelKind = enumValue(panel.kind, ["native", "studio"] as const, "manifest.panel.kind");
  if (options.origin === "workspace" && panelKind !== "studio") throw new Error("workspace manifest.panel.kind must be 'studio'");
  const panelEntry = panelKind === "native"
    ? validateApplicationIdLike(panel.entry, "manifest.panel.entry")
    : validateApplicationRelativePath(panel.entry, "manifest.panel.entry");
  if (panel.popout !== undefined && typeof panel.popout !== "boolean") throw new Error("manifest.panel.popout must be boolean");

  const agent = record(manifest.agent, "manifest.agent");
  exactKeys(agent, ["preferred", "role", "fallback", "context"], ["fallback"], "manifest.agent");
  const preferred = agent.preferred === undefined ? undefined : stringList(agent.preferred, "manifest.agent.preferred");

  const tools = stringList(manifest.tools, "manifest.tools");
  const knownTools = new Set(options.knownTools ?? APPLICATION_TOOL_IDS);
  const unknownTool = tools.find((tool) => !knownTools.has(tool));
  if (unknownTool) throw new Error(`manifest.tools contains unknown tool '${unknownTool}'`);

  let resources: ApplicationResource[] | undefined;
  if (manifest.resources !== undefined) {
    if (!Array.isArray(manifest.resources)) throw new Error("manifest.resources must be an array");
    resources = manifest.resources.map((item, index) => enumValue(item, ["artifact", "files", "versions", "preview"] as const, `manifest.resources[${index}]`));
    if (new Set(resources).size !== resources.length) throw new Error("manifest.resources must not contain duplicates");
  }

  let source: ApplicationManifestV1["source"];
  if (manifest.source !== undefined) {
    const sourceValue = record(manifest.source, "manifest.source");
    exactKeys(sourceValue, ["root", "entry"], ["root", "entry"], "manifest.source");
    source = {
      root: validateApplicationRelativePath(sourceValue.root, "manifest.source.root", true),
      entry: validateApplicationRelativePath(sourceValue.entry, "manifest.source.entry"),
    };
  }

  const createdBy = record(manifest.createdBy, "manifest.createdBy");
  exactKeys(createdBy, ["kind", "id"], ["kind"], "manifest.createdBy");
  const createdByKind = enumValue(createdBy.kind, ["builtin", "human", "agent"] as const, "manifest.createdBy.kind");
  if (options.origin && createdByKind !== options.origin && !(options.origin === "workspace" && createdByKind !== "builtin")) {
    throw new Error(`manifest.createdBy.kind is invalid for ${options.origin} manifest`);
  }

  const createdAt = timestamp(manifest.createdAt, "manifest.createdAt");
  const updatedAt = timestamp(manifest.updatedAt, "manifest.updatedAt");
  if (updatedAt < createdAt) throw new Error("manifest.updatedAt must not precede manifest.createdAt");
  const description = optionalString(manifest.description, "manifest.description", 1024);
  const role = optionalString(agent.role, "manifest.agent.role", 128);
  const context = optionalString(agent.context, "manifest.agent.context", 2048);
  const creatorId = optionalString(createdBy.id, "manifest.createdBy.id", 128);

  return {
    schema: 1,
    id: validateApplicationId(manifest.id),
    name: stringValue(manifest.name, "manifest.name", 128),
    ...(description ? { description } : {}),
    icon: { kind: iconKind, value: iconValue },
    panel: {
      kind: panelKind,
      entry: panelEntry,
      ...(panel.defaultSize === undefined ? {} : { defaultSize: enumValue(panel.defaultSize, ["drawer", "workspace", "full"] as const, "manifest.panel.defaultSize") }),
      ...(panel.popout === undefined ? {} : { popout: panel.popout }),
    },
    agent: {
      ...(preferred === undefined ? {} : { preferred }),
      ...(role ? { role } : {}),
      fallback: enumValue(agent.fallback, ["active", "workspace-default"] as const, "manifest.agent.fallback"),
      ...(context ? { context } : {}),
    },
    tools,
    ...(resources === undefined ? {} : { resources }),
    ...(source ? { source } : {}),
    createdBy: {
      kind: createdByKind,
      ...(creatorId ? { id: creatorId } : {}),
    },
    createdAt,
    updatedAt,
  };
}

function validateApplicationIdLike(value: unknown, path: string): string {
  const id = stringValue(value, path, 48);
  if (!APPLICATION_ID_PATTERN.test(id)) throw new Error(`${path} must match [a-z][a-z0-9-]{1,47}`);
  return id;
}

function applicationInstanceFrom(value: unknown, key: string): RoomApplicationInstance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.instanceId !== "string" || raw.instanceId !== key || !/^app_[a-f0-9]{20}$/.test(raw.instanceId)) return undefined;
  if (typeof raw.appId !== "string" || !APPLICATION_ID_PATTERN.test(raw.appId)) return undefined;
  if (typeof raw.supportRoomId !== "string" || !raw.supportRoomId.trim()) return undefined;
  if (!raw.resource || typeof raw.resource !== "object" || Array.isArray(raw.resource)) return undefined;
  const resource = raw.resource as Record<string, unknown>;
  if (resource.kind !== "artifacts" && resource.kind !== "studio-project" && resource.kind !== "workspace-app") return undefined;
  if (resource.id !== undefined && (typeof resource.id !== "string" || !resource.id.trim())) return undefined;
  if (typeof raw.createdAt !== "string" || !Number.isFinite(Date.parse(raw.createdAt))) return undefined;
  if (typeof raw.updatedAt !== "string" || !Number.isFinite(Date.parse(raw.updatedAt))) return undefined;
  return {
    instanceId: raw.instanceId,
    appId: raw.appId,
    supportRoomId: raw.supportRoomId,
    resource: { kind: resource.kind, ...(typeof resource.id === "string" ? { id: resource.id } : {}) },
    ...(typeof raw.view === "string" && raw.view.trim() ? { view: raw.view.slice(0, 512) } : {}),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/** Invalid persisted entries degrade to absent; order/selection cannot point at dropped instances. */
export function normalizeRoomApplications(value: unknown): RoomApplicationsStateV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== 1 || !raw.instances || typeof raw.instances !== "object" || Array.isArray(raw.instances)) return undefined;
  const instances = Object.fromEntries(
    Object.entries(raw.instances as Record<string, unknown>)
      .map(([key, candidate]) => [key, applicationInstanceFrom(candidate, key)] as const)
      .filter((entry): entry is [string, RoomApplicationInstance] => Boolean(entry[1])),
  );
  const order = Array.isArray(raw.order)
    ? [...new Set(raw.order.filter((id): id is string => typeof id === "string" && Boolean(instances[id])))]
    : [];
  for (const id of Object.keys(instances)) if (!order.includes(id)) order.push(id);
  const activeInstanceId = typeof raw.activeInstanceId === "string" && instances[raw.activeInstanceId] ? raw.activeInstanceId : undefined;
  return { schema: 1, ...(activeInstanceId ? { activeInstanceId } : {}), order, instances };
}
