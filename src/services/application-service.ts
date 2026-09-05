import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { workspacePaths } from "../core/paths.js";
import {
  BUILTIN_APPLICATION_MANIFESTS,
  parseApplicationManifest,
  validateApplicationRelativePath,
  type ApplicationCatalog,
  type ApplicationCatalogDiagnostic,
  type ApplicationCatalogEntry,
  type ApplicationManifestV1,
} from "../domain/applications.js";
import type { RoomApplicationInstance, RoomApplicationsStateV1 } from "../core/types.js";
import type { RoomHandle } from "../domain/rooms.js";

export class ApplicationWorkspaceNotFoundError extends Error {}

export interface ApplicationServiceOptions {
  workspaceFor(workspaceId: string): Promise<{ path: string; isInitialized?: boolean } | undefined>;
}

export interface CreateApplicationInstanceInput {
  requestId: string;
  appId: string;
  resource: { kind: "artifacts" | "studio-project" | "workspace-app"; id?: string };
  view?: string;
}

export interface UpdateApplicationInstanceInput {
  active?: boolean;
  resource?: { kind: "artifacts" | "studio-project" | "workspace-app"; id?: string };
  view?: string;
  baseUpdatedAt?: string;
}

export class ApplicationInstanceNotFoundError extends Error {}
export class ApplicationInstanceConflictError extends Error {}

function pathInside(child: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

async function containedRealPath(path: string, root: string, label: string): Promise<string> {
  const resolved = await realpath(path).catch(() => {
    throw new Error(`${label} does not exist`);
  });
  if (!pathInside(resolved, root)) throw new Error(`${label} escapes its workspace package through a symlink`);
  return resolved;
}

async function validateWorkspaceFiles(manifest: ApplicationManifestV1, packageRoot: string, workspaceRoot: string): Promise<void> {
  const panelEntry = await containedRealPath(join(packageRoot, manifest.panel.entry), packageRoot, "manifest.panel.entry");
  if (!(await lstat(panelEntry)).isFile()) throw new Error("manifest.panel.entry must name a file");

  if (manifest.icon.kind === "asset") {
    const icon = await containedRealPath(join(packageRoot, manifest.icon.value), packageRoot, "manifest.icon.value");
    if (!(await lstat(icon)).isFile()) throw new Error("manifest.icon.value must name a file");
  }

  if (manifest.source) {
    const sourceRoot = await containedRealPath(join(packageRoot, manifest.source.root), workspaceRoot, "manifest.source.root");
    const sourceEntry = await containedRealPath(join(sourceRoot, manifest.source.entry), sourceRoot, "manifest.source.entry");
    if (!(await lstat(sourceEntry)).isFile()) throw new Error("manifest.source.entry must name a file");
  }
}

export class ApplicationService {
  constructor(private readonly options: ApplicationServiceOptions) {}

  async catalog(workspaceId: string): Promise<ApplicationCatalog> {
    const workspace = await this.options.workspaceFor(workspaceId);
    if (!workspace?.isInitialized) throw new ApplicationWorkspaceNotFoundError(`Unknown workspace: ${workspaceId}`);
    const workspaceRoot = await realpath(workspace.path);
    const applications: ApplicationCatalogEntry[] = BUILTIN_APPLICATION_MANIFESTS.map((manifest) => ({
      manifest,
      source: "builtin",
      launchable: true,
    }));
    const diagnostics: ApplicationCatalogDiagnostic[] = [];
    const builtinIds = new Set(BUILTIN_APPLICATION_MANIFESTS.map((manifest) => manifest.id));
    const appsRoot = workspacePaths.applicationsDir(workspace.path);
    if (!existsSync(appsRoot)) return { schema: 1, applications, diagnostics };

    const entries = await readdir(appsRoot, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const relativeRoot = `apps/${entry.name}`;
      const manifestPath = `${relativeRoot}/app.gaia.json`;
      try {
        validateApplicationRelativePath(entry.name, "application package id");
        const packageRoot = await containedRealPath(join(appsRoot, entry.name), workspaceRoot, "application package");
        if (!(await lstat(packageRoot)).isDirectory()) throw new Error("application package must be a directory");
        const manifestFile = await containedRealPath(join(packageRoot, "app.gaia.json"), packageRoot, "app.gaia.json");
        let manifest: ApplicationManifestV1;
        try {
          manifest = parseApplicationManifest(JSON.parse(await readFile(manifestFile, "utf8")) as unknown, { origin: "workspace" });
        } catch (error) {
          diagnostics.push({ relativeRoot, manifestPath, code: "invalid-manifest", message: error instanceof Error ? error.message : String(error) });
          continue;
        }
        if (manifest.id !== entry.name) throw new Error(`manifest.id '${manifest.id}' must match package directory '${entry.name}'`);
        if (builtinIds.has(manifest.id)) {
          diagnostics.push({ relativeRoot, manifestPath, code: "builtin-shadowed", message: `Built-in application '${manifest.id}' cannot be shadowed` });
          continue;
        }
        await validateWorkspaceFiles(manifest, packageRoot, workspaceRoot);
        applications.push({ manifest, source: "workspace", launchable: true, relativeRoot, manifestPath });
      } catch (error) {
        diagnostics.push({ relativeRoot, manifestPath, code: "invalid-package", message: error instanceof Error ? error.message : String(error) });
      }
    }

    return { schema: 1, applications, diagnostics };
  }

  async createInstance(workspaceId: string, roomId: string, room: RoomHandle, input: CreateApplicationInstanceInput): Promise<{ instance: RoomApplicationInstance; state: RoomApplicationsStateV1 }> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId)) throw new Error("requestId must be 8-128 letters, numbers, '_' or '-'");
    const definition = (await this.catalog(workspaceId)).applications.find((entry) => entry.manifest.id === input.appId && entry.launchable);
    if (!definition) throw new ApplicationInstanceNotFoundError(`Unknown application: ${input.appId}`);
    const resource = applicationResource(input.resource);
    const view = optionalView(input.view);
    const instanceId = `app_${createHash("sha256").update(`${workspaceId}\0${roomId}\0${input.appId}\0${input.requestId}`).digest("hex").slice(0, 20)}`;
    const now = new Date().toISOString();
    let instance: RoomApplicationInstance | undefined;
    let applications: RoomApplicationsStateV1 | undefined;
    await room.updateState((roomState) => {
      const current = roomState.applications ?? { schema: 1, order: [], instances: {} };
      instance = current.instances[instanceId] ?? {
        instanceId,
        appId: input.appId,
        supportRoomId: roomId,
        resource,
        ...(view ? { view } : {}),
        createdAt: now,
        updatedAt: now,
      };
      current.instances[instanceId] = instance;
      if (!current.order.includes(instanceId)) current.order.push(instanceId);
      current.activeInstanceId = instanceId;
      roomState.applications = current;
      applications = current;
    });
    return { instance: instance!, state: applications! };
  }

  async updateInstance(room: RoomHandle, instanceId: string, input: UpdateApplicationInstanceInput): Promise<{ instance: RoomApplicationInstance; state: RoomApplicationsStateV1 }> {
    let instance: RoomApplicationInstance | undefined;
    let applications: RoomApplicationsStateV1 | undefined;
    await room.updateState((roomState) => {
      const current = roomState.applications;
      const existing = current?.instances[instanceId];
      if (!current || !existing) throw new ApplicationInstanceNotFoundError(`Unknown application instance: ${instanceId}`);
      if (input.baseUpdatedAt && input.baseUpdatedAt !== existing.updatedAt) throw new ApplicationInstanceConflictError("Application instance changed elsewhere");
      const changed = input.resource !== undefined || input.view !== undefined;
      instance = changed
        ? {
            ...existing,
            ...(input.resource ? { resource: applicationResource(input.resource) } : {}),
            ...(input.view === undefined ? {} : optionalView(input.view) ? { view: optionalView(input.view) } : { view: undefined }),
            updatedAt: new Date().toISOString(),
          }
        : existing;
      current.instances[instanceId] = instance;
      if (input.active === true) current.activeInstanceId = instanceId;
      applications = current;
    });
    return { instance: instance!, state: applications! };
  }

  async closeInstance(room: RoomHandle, instanceId: string): Promise<{ instance: RoomApplicationInstance; state: RoomApplicationsStateV1 }> {
    let removed: RoomApplicationInstance | undefined;
    let applications: RoomApplicationsStateV1 | undefined;
    await room.updateState((roomState) => {
      const current = roomState.applications;
      removed = current?.instances[instanceId];
      if (!current || !removed) throw new ApplicationInstanceNotFoundError(`Unknown application instance: ${instanceId}`);
      delete current.instances[instanceId];
      current.order = current.order.filter((id) => id !== instanceId);
      if (current.activeInstanceId === instanceId) current.activeInstanceId = current.order.at(-1);
      roomState.applications = current;
      applications = current;
    });
    return { instance: removed!, state: applications! };
  }
}

function applicationResource(value: unknown): RoomApplicationInstance["resource"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("resource must be an object");
  const resource = value as Record<string, unknown>;
  if (resource.kind !== "artifacts" && resource.kind !== "studio-project" && resource.kind !== "workspace-app") throw new Error("resource.kind is invalid");
  if (resource.id !== undefined && (typeof resource.id !== "string" || !resource.id.trim() || resource.id.length > 256)) throw new Error("resource.id is invalid");
  return { kind: resource.kind, ...(typeof resource.id === "string" ? { id: resource.id } : {}) };
}

function optionalView(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 512) throw new Error("view is invalid");
  return value;
}
