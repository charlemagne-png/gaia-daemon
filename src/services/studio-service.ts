import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { newId } from "../core/ids.js";
import { workspacePaths } from "../core/paths.js";
import { readJson, writeBytesAtomic, writeJsonAtomic, writeTextAtomic } from "../core/store.js";
import type { Task, UiEvent } from "../core/types.js";
import type { WorkspaceRegistry } from "../daemon.js";
import type { RoomService } from "./room-service.js";
import { updateArtifact } from "./artifacts.js";
import {
  discoverEntryViews,
  emptyStudioRegistry,
  indexProjectFiles,
  isEditableTextPath,
  mediaTypeFor,
  parseStudioRegistry,
  pathInside,
  relativePathUnder,
  sha256,
  validateRelativePath,
  type StudioEntryView,
  type StudioProject,
  type StudioRegistry,
  type StudioVersion,
} from "../domain/design-studio.js";

export class StudioConflictError extends Error {
  constructor(public readonly currentHead: string | null) {
    super("Stale base version");
  }
}

export class StudioNotFoundError extends Error {}

export interface StudioServiceOptions {
  registry: WorkspaceRegistry;
  serviceFor(workspaceId: string, roomId: string): Promise<RoomService>;
  broadcast(event: UiEvent): void;
  baseUrl(): string;
}

export interface StudioOpenResult {
  project: StudioProject;
  effectiveDesignPath: string;
  version: StudioVersion | null;
  previewUrl: string;
  eventsUrl: string;
}

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => { release = resolveLock; });
  locks.set(key, prior.then(() => current));
  await prior.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

export class StudioService {
  constructor(private readonly options: StudioServiceOptions) {}

  async open(input: { workspaceId: string; path: string; entryView?: StudioEntryView; roomId?: string; artifact?: { roomId: string; artifactId: string } }): Promise<StudioOpenResult & { created: boolean }> {
    const workspace = await this.workspace(input.workspaceId);
    const target = await realpath(resolve(input.path));
    if (!pathInside(target, workspace.path)) throw new Error("Design path must stay inside workspace");
    const stat = await lstat(target);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error("Design path must be file or folder");
    return withLock(workspace.path, async () => {
      const registry = await this.readRegistry(workspace.path);
      const existingId = registry.byPath[target];
      if (existingId && registry.projects[existingId]) {
        const project = await this.recoverMissingRoom(workspace.path, registry, registry.projects[existingId]);
        const version = await this.headVersion(workspace.path, project);
        return { ...(await this.result(workspace.path, project, version)), created: false };
      }
      const roomId = input.roomId ?? newId("studio_room");
      const existingRoomProjectId = registry.byRoom[roomId];
      if (existingRoomProjectId && existingRoomProjectId !== existingId) throw new Error("Room is already bound to another Studio project");
      const pathKind = stat.isFile() ? "file" : "folder";
      const entryViews = await discoverEntryViews(target, pathKind, input.entryView);
      const now = new Date().toISOString();
      const project: StudioProject = {
        schema: 1,
        projectId: newId("studio"),
        workspaceId: input.workspaceId,
        roomId,
        designPath: target,
        relativePath: relativePathUnder(workspace.path, target),
        pathKind,
        entryViews,
        defaultViewId: entryViews[0]?.id ?? "index",
        headVersionId: null,
        createdAt: now,
        updatedAt: now,
        ...(input.artifact ? { artifact: input.artifact } : {}),
      };
      await this.options.serviceFor(input.workspaceId, roomId);
      registry.projects[project.projectId] = project;
      registry.byPath[target] = project.projectId;
      registry.byRoom[roomId] = project.projectId;
      await this.writeRegistry(workspace.path, registry);
      const version = await this.snapshot(workspace.path, project, { kind: "human" }, "initial snapshot", null);
      project.headVersionId = version.versionId;
      project.updatedAt = version.createdAt;
      registry.projects[project.projectId] = project;
      await this.writeRegistry(workspace.path, registry);
      this.emitProject(project);
      return { ...(await this.result(workspace.path, project, version)), created: true };
    });
  }

  async list(workspaceId: string): Promise<{ projects: StudioProject[] }> {
    const workspace = await this.workspace(workspaceId);
    const registry = await this.readRegistry(workspace.path);
    return { projects: Object.values(registry.projects) };
  }

  async get(projectId: string): Promise<StudioOpenResult & { currentHashes: Record<string, string>; views: StudioEntryView[]; activeIteration: null }> {
    const { workspacePath, project } = await this.findProject(projectId);
    const version = await this.headVersion(workspacePath, project);
    const effective = await this.effectiveDesignPath(workspacePath, project);
    const files = await indexProjectFiles(effective).catch(() => ({}));
    const currentHashes = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, sha256(file.bytes)]));
    return { ...(await this.result(workspacePath, project, version)), currentHashes, views: project.entryViews, activeIteration: null };
  }

  async patch(projectId: string, body: { defaultViewId?: string; entryViews?: StudioEntryView[] }): Promise<{ project: StudioProject }> {
    const { workspacePath, registry, project } = await this.findProject(projectId);
    if (body.entryViews) project.entryViews = body.entryViews.map((view) => ({ ...view, path: validateRelativePath(view.path) }));
    if (body.defaultViewId) {
      if (!project.entryViews.some((view) => view.id === body.defaultViewId)) throw new Error("Unknown default view");
      project.defaultViewId = body.defaultViewId;
    }
    project.updatedAt = new Date().toISOString();
    registry.projects[project.projectId] = project;
    await this.writeRegistry(workspacePath, registry);
    this.emitProject(project);
    return { project };
  }

  async readFile(projectId: string, rel: string): Promise<{ path: string; content: string; sha256: string; headVersionId: string | null; mediaType: string }> {
    const { workspacePath, project } = await this.findProject(projectId);
    const clean = validateRelativePath(rel);
    if (!project.artifact && !isEditableTextPath(clean)) throw new Error("Unsupported editor file type");
    const base = await this.effectiveRoot(workspacePath, project);
    const abs = resolve(base, project.pathKind === "file" ? basename(project.designPath) : clean);
    if (!pathInside(abs, base)) throw new Error("Path escapes project");
    const content = await readFile(abs, "utf8");
    return { path: clean, content, sha256: sha256(content), headVersionId: project.headVersionId, mediaType: mediaTypeFor(clean) };
  }

  async save(projectId: string, body: { baseVersionId?: string | null; files: { path: string; content: string; encoding?: string }[]; note?: string }): Promise<{ project: StudioProject; version: StudioVersion; changedPaths: string[] }> {
    const { workspacePath, registry, project } = await this.findProject(projectId);
    if ((body.baseVersionId ?? null) !== (project.headVersionId ?? null)) throw new StudioConflictError(project.headVersionId);
    if (!Array.isArray(body.files) || body.files.length < 1) throw new Error("Missing files");
    if (body.files.length > 1) throw new Error("P1 save accepts one file");
    const root = await this.effectiveRoot(workspacePath, project);
    const changedPaths: string[] = [];
    for (const file of body.files) {
      if (file.encoding && file.encoding !== "utf8") throw new Error("Unsupported encoding");
      const clean = validateRelativePath(file.path);
      if (!project.artifact && !isEditableTextPath(clean)) throw new Error("Unsupported editor file type");
      const abs = resolve(root, project.pathKind === "file" ? basename(project.designPath) : clean);
      if (!pathInside(abs, root)) throw new Error("Path escapes project");
      await mkdir(dirname(abs), { recursive: true });
      if (project.artifact) {
        await updateArtifact({ rootDir: workspacePath, roomId: project.artifact.roomId }, project.artifact.artifactId, { payload: file.content });
      } else {
        await writeTextAtomic(abs, file.content);
      }
      changedPaths.push(clean);
    }
    const version = await this.snapshot(workspacePath, project, { kind: "human" }, body.note, project.headVersionId);
    project.headVersionId = version.versionId;
    project.updatedAt = version.createdAt;
    registry.projects[project.projectId] = project;
    await this.writeRegistry(workspacePath, registry);
    this.options.broadcast({ type: "studio-files-changed", workspaceId: project.workspaceId, roomId: project.roomId, projectId, paths: changedPaths, source: "human", observedAt: new Date().toISOString() } as UiEvent);
    this.options.broadcast({ type: "studio-version-saved", workspaceId: project.workspaceId, roomId: project.roomId, projectId, version } as UiEvent);
    return { project, version, changedPaths };
  }

  async versions(projectId: string, limit = 50): Promise<{ versions: StudioVersion[] }> {
    const { workspacePath, project } = await this.findProject(projectId);
    const dir = this.versionsDir(workspacePath, project);
    const versions: StudioVersion[] = [];
    for (const name of await import("node:fs/promises").then((fs) => fs.readdir(dir).catch(() => []))) {
      if (!name.endsWith(".json")) continue;
      const raw = await readJson(join(dir, name));
      if (raw && typeof raw === "object") versions.push(raw as StudioVersion);
    }
    versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { versions: versions.slice(0, Math.max(1, Math.min(200, limit))) };
  }

  async iterate(projectId: string, body: { text?: string; viewId?: string; baseVersionId?: string | null }): Promise<{ task: Task; roomId: string; projectId: string }> {
    const { workspacePath, project } = await this.findProject(projectId);
    if ((body.baseVersionId ?? project.headVersionId ?? null) !== (project.headVersionId ?? null)) throw new StudioConflictError(project.headVersionId);
    const view = project.entryViews.find((item) => item.id === (body.viewId ?? project.defaultViewId)) ?? project.entryViews[0];
    const effective = await this.effectiveDesignPath(workspacePath, project);
    const preview = `${this.options.baseUrl()}/api/studio/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(view?.id ?? project.defaultViewId)}`;
    const preamble = [`§ GAIA Design Studio`, `project → ${project.projectId}`, `room → ${project.roomId}`, `head → ${project.headVersionId ?? "null"}`, `source → ${effective}`, `view → ${view?.id ?? project.defaultViewId} · ${view?.path ?? "index.html"}`, `preview → ${preview}`, `write boundary → ${effective}`, `finish → edit files · inspect preview · report changed paths`, ``, `@gaia ${body.text ?? ""}`].join("\n");
    const service = await this.options.serviceFor(project.workspaceId, project.roomId);
    const task = await service.sendMessage(preamble, { recordUserMessage: true });
    this.options.broadcast({ type: "studio-iteration", workspaceId: project.workspaceId, roomId: project.roomId, projectId, taskId: task.id, status: "queued" } as UiEvent);
    return { task, roomId: project.roomId, projectId };
  }

  async preview(projectId: string, viewId: string): Promise<string> {
    const { project } = await this.findProject(projectId);
    const view = project.entryViews.find((item) => item.id === viewId) ?? project.entryViews[0];
    if (!view) throw new StudioNotFoundError("View not found");
    const src = `/api/studio/projects/${encodeURIComponent(projectId)}/assets/${encodeURI(view.path)}?v=${encodeURIComponent(project.headVersionId ?? "live")}`;
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${src}; style-src 'unsafe-inline'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:white}</style><iframe sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" src="${src.replace(/"/g, "&quot;")}"></iframe>`;
  }

  async asset(projectId: string, rel: string): Promise<{ path: string; bytes: Uint8Array; mediaType: string; etag: string }> {
    const { workspacePath, project } = await this.findProject(projectId);
    const clean = validateRelativePath(rel);
    const root = await this.effectiveRoot(workspacePath, project);
    const abs = resolve(root, project.pathKind === "file" ? basename(project.designPath) : clean);
    if (!pathInside(abs, root)) throw new Error("Path escapes project");
    const bytes = await readFile(abs);
    return { path: clean, bytes, mediaType: mediaTypeFor(clean), etag: sha256(bytes) };
  }

  private async snapshot(workspacePath: string, project: StudioProject, actor: StudioVersion["actor"], note: string | undefined, parentVersionId: string | null): Promise<StudioVersion> {
    const effective = await this.effectiveDesignPath(workspacePath, project);
    const root = project.pathKind === "file" ? effective : effective;
    const indexed = await indexProjectFiles(root);
    const files: StudioVersion["files"] = {};
    for (const [rel, file] of Object.entries(indexed)) {
      const hash = sha256(file.bytes);
      await writeBytesAtomic(join(this.blobsDir(workspacePath, project), hash), file.bytes);
      files[rel] = { sha256: hash, bytes: file.bytes.byteLength, mediaType: file.mediaType };
    }
    const version: StudioVersion = { schema: 1, versionId: newId("studio_version"), projectId: project.projectId, parentVersionId, createdAt: new Date().toISOString(), actor, ...(note ? { note } : {}), files, views: project.entryViews };
    await writeJsonAtomic(join(this.versionsDir(workspacePath, project), `${version.versionId}.json`), version);
    await writeJsonAtomic(this.headPath(workspacePath, project), { versionId: version.versionId });
    return version;
  }

  private async result(workspacePath: string, project: StudioProject, version: StudioVersion | null): Promise<StudioOpenResult> {
    return { project, effectiveDesignPath: await this.effectiveDesignPath(workspacePath, project), version, previewUrl: `/api/studio/projects/${encodeURIComponent(project.projectId)}/preview/${encodeURIComponent(project.defaultViewId)}`, eventsUrl: `/api/events?workspaceId=${encodeURIComponent(project.workspaceId)}&roomId=${encodeURIComponent(project.roomId)}` };
  }

  private async recoverMissingRoom(workspacePath: string, registry: StudioRegistry, project: StudioProject): Promise<StudioProject> {
    if (existsSync(workspacePaths.roomDir(workspacePath, project.roomId))) return project;
    project.status = "missing-room";
    registry.projects[project.projectId] = project;
    await this.writeRegistry(workspacePath, registry);
    return project;
  }

  private async effectiveRoot(workspacePath: string, project: StudioProject): Promise<string> {
    const effective = await this.effectiveDesignPath(workspacePath, project);
    return project.pathKind === "file" ? dirname(effective) : effective;
  }

  async effectiveDesignPath(workspacePath: string, project: StudioProject): Promise<string> {
    if (project.artifact) return project.designPath;
    const state = (await readJson(workspacePaths.roomState(workspacePath, project.roomId))) as { workDir?: string } | undefined;
    if (state?.workDir && existsSync(state.workDir)) return resolve(state.workDir, project.relativePath);
    return project.designPath;
  }

  private async headVersion(workspacePath: string, project: StudioProject): Promise<StudioVersion | null> {
    const id = project.headVersionId;
    if (!id) return null;
    const raw = await readJson(join(this.versionsDir(workspacePath, project), `${id}.json`));
    return raw && typeof raw === "object" ? (raw as StudioVersion) : null;
  }

  private async findProject(projectId: string): Promise<{ workspacePath: string; registry: StudioRegistry; project: StudioProject }> {
    for (const workspace of await this.options.registry.list()) {
      const registry = await this.readRegistry(workspace.path);
      const project = registry.projects[projectId];
      if (project) return { workspacePath: workspace.path, registry, project };
    }
    throw new StudioNotFoundError("Studio project not found");
  }

  private async workspace(workspaceId: string): Promise<{ id: string; path: string }> {
    const workspace = await this.options.registry.find(workspaceId);
    if (!workspace) throw new StudioNotFoundError("Unknown workspace");
    return { id: workspace.id, path: await realpath(workspace.path) };
  }

  private registryPath(workspacePath: string): string { return join(workspacePath, ".gaia", "design-studio.json"); }
  private readRegistry(workspacePath: string): Promise<StudioRegistry> { return readJson(this.registryPath(workspacePath)).then(parseStudioRegistry); }
  private writeRegistry(workspacePath: string, registry: StudioRegistry): Promise<void> { return writeJsonAtomic(this.registryPath(workspacePath), registry); }
  private studioDir(workspacePath: string, project: StudioProject): string { return join(workspacePaths.roomDir(workspacePath, project.roomId), "studio", project.projectId); }
  private blobsDir(workspacePath: string, project: StudioProject): string { return join(this.studioDir(workspacePath, project), "blobs"); }
  private versionsDir(workspacePath: string, project: StudioProject): string { return join(this.studioDir(workspacePath, project), "versions"); }
  private headPath(workspacePath: string, project: StudioProject): string { return join(this.studioDir(workspacePath, project), "head.json"); }
  private emitProject(project: StudioProject): void { this.options.broadcast({ type: "studio-project", workspaceId: project.workspaceId, roomId: project.roomId, project } as UiEvent); }
}
