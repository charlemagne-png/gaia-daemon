import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { newId } from "../core/ids.js";
import { workspacePaths } from "../core/paths.js";
import { readJson, writeBytesAtomic, writeJsonAtomic, writeTextAtomic } from "../core/store.js";
import type { Task, UiEvent } from "../core/types.js";
import type { WorkspaceRegistry } from "../daemon.js";
import type { RoomService } from "./room-service.js";
import { readArtifact, updateArtifact } from "./artifacts.js";
import {
  discoverEntryViews,
  emptyStudioRegistry,
  indexProjectFiles,
  isEditableTextPath,
  instrumentStudioHtml,
  mediaTypeFor,
  parseStudioRegistry,
  patchStudioHtml,
  pathInside,
  relativePathUnder,
  sha256,
  studioElementHtml,
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
      try {
        // Warm the room service; binding must not die on harness init (registry write is the durable contract).
        await this.options.serviceFor(input.workspaceId, roomId);
      } catch {
        // Lazy warm-up: sendMessage() resolves the service when a prompt actually needs it.
      }
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
    if (project.artifact) {
      const refreshed = await readArtifact({ rootDir: workspacePath, roomId: project.artifact.roomId }, project.artifact.artifactId);
      this.options.broadcast({ type: "artifact-updated", workspaceId: project.workspaceId, roomId: project.artifact.roomId, artifactId: project.artifact.artifactId, projectId, version, manifest: refreshed.manifest } as UiEvent);
    }
    return { project, version, changedPaths };
  }

  async patchArtifact(roomId: string, artifactId: string, body: { eid?: string; css?: Record<string, string>; text?: string; attrs?: Record<string, string | null>; baseVersion?: string | null }): Promise<{ project: StudioProject; version: StudioVersion; artifactId: string; inPlace: true; elementHtml: string }> {
    const { workspacePath, registry, project } = await this.findArtifactProject(roomId, artifactId);
    if ((body.baseVersion ?? null) !== (project.headVersionId ?? null)) throw new StudioConflictError(project.headVersionId);
    if (!body.eid) throw new Error("Missing eid");
    const root = await this.effectiveRoot(workspacePath, project);
    const rel = project.entryViews[0]?.path ?? basename(project.designPath);
    const abs = resolve(root, project.pathKind === "file" ? basename(project.designPath) : rel);
    if (!pathInside(abs, root)) throw new Error("Path escapes project");
    const source = await readFile(abs, "utf8");
    const patched = patchStudioHtml(source, { eid: body.eid, css: body.css, text: body.text, attrs: body.attrs });
    await updateArtifact({ rootDir: workspacePath, roomId }, artifactId, { payload: patched.html });
    const version = await this.snapshot(workspacePath, project, { kind: "human" }, `patch ${body.eid}`, project.headVersionId);
    project.headVersionId = version.versionId;
    project.updatedAt = version.createdAt;
    registry.projects[project.projectId] = project;
    await this.writeRegistry(workspacePath, registry);
    const refreshed = await readArtifact({ rootDir: workspacePath, roomId }, artifactId);
    this.options.broadcast({ type: "artifact-updated", workspaceId: project.workspaceId, roomId, artifactId, projectId: project.projectId, version, manifest: refreshed.manifest, inPlace: true } as UiEvent);
    return { project, version, artifactId, inPlace: true, elementHtml: patched.elementHtml };
  }

  async saveArtifactScreenshot(roomId: string, artifactId: string, body: { dataUrl?: string }): Promise<{ path: string; version: string | null }> {
    const { workspacePath, project } = await this.findArtifactProject(roomId, artifactId);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl ?? "");
    if (!match) throw new Error("Missing PNG dataUrl");
    const bytes = Buffer.from(match[1], "base64");
    const version = project.headVersionId ?? "live";
    const file = join(this.versionsDir(workspacePath, project), `${version}.screenshot.png`);
    await writeFile(file, bytes);
    await writeJsonAtomic(join(this.versionsDir(workspacePath, project), "latest-screenshot.json"), { path: file, version: project.headVersionId, savedAt: new Date().toISOString() });
    return { path: file, version: project.headVersionId };
  }

  async latestArtifactScreenshot(roomId: string, artifactId: string): Promise<{ path: string; version: string | null } | null> {
    const { workspacePath, project } = await this.findArtifactProject(roomId, artifactId);
    const raw = await readJson(join(this.versionsDir(workspacePath, project), "latest-screenshot.json"));
    if (!raw || typeof raw !== "object" || typeof (raw as { path?: unknown }).path !== "string") return null;
    return { path: (raw as { path: string }).path, version: typeof (raw as { version?: unknown }).version === "string" ? (raw as { version: string }).version : null };
  }

  async instrumentArtifactPayload(roomId: string, artifactId: string, versionId?: string): Promise<{ bytes: Uint8Array; mediaType: string; etag: string }> {
    const payload = versionId ? await this.artifactVersionPayload(roomId, artifactId, versionId) : await this.currentArtifactPayload(roomId, artifactId);
    if (!payload.mediaType.startsWith("text/html")) return payload;
    const html = instrumentStudioHtml(Buffer.from(payload.bytes).toString("utf8"));
    return { bytes: Buffer.from(html, "utf8"), mediaType: payload.mediaType, etag: sha256(html) };
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

  async iterate(projectId: string, body: { text?: string; viewId?: string; baseVersionId?: string | null; eid?: string; elementHtml?: string; snippet?: string }): Promise<{ task: Task; roomId: string; projectId: string }> {
    const { workspacePath, project } = await this.findProject(projectId);
    if ((body.baseVersionId ?? project.headVersionId ?? null) !== (project.headVersionId ?? null)) throw new StudioConflictError(project.headVersionId);
    const view = project.entryViews.find((item) => item.id === (body.viewId ?? project.defaultViewId)) ?? project.entryViews[0];
    const effective = await this.effectiveDesignPath(workspacePath, project);
    const preview = `${this.options.baseUrl()}/api/studio/projects/${encodeURIComponent(projectId)}/preview/${encodeURIComponent(view?.id ?? project.defaultViewId)}`;
    const screenshot = project.artifact ? await this.latestArtifactScreenshot(project.artifact.roomId, project.artifact.artifactId) : null;
    const rel = view?.path ?? project.entryViews[0]?.path ?? basename(project.designPath);
    let selectedHtml = body.elementHtml ?? body.snippet;
    if (!selectedHtml && body.eid) {
      const root = await this.effectiveRoot(workspacePath, project);
      const abs = resolve(root, project.pathKind === "file" ? basename(project.designPath) : rel);
      selectedHtml = studioElementHtml(await readFile(abs, "utf8"), body.eid);
    }
    const preamble = [`§ GAIA Design Studio`, `project → ${project.projectId}`, `room → ${project.roomId}`, `head → ${project.headVersionId ?? "null"}`, `artifact source path → ${effective}`, `source → ${effective}`, `view → ${view?.id ?? project.defaultViewId} · ${rel}`, `preview → ${preview}`, `selected eid → ${body.eid ?? "none"}`, `selected element html → ${selectedHtml ?? "none"}`, `latest screenshot path → ${screenshot?.path ?? "none"}`, `instruction → change exactly what is on the screen`, `write boundary → ${effective}`, `finish → edit files · inspect preview · report changed paths`, ``, `@gaia ${body.text ?? ""}`].join("\n");
    const service = await this.options.serviceFor(project.workspaceId, project.roomId);
    const task = await service.sendMessage(preamble, { recordUserMessage: true });
    this.options.broadcast({ type: "studio-iteration", workspaceId: project.workspaceId, roomId: project.roomId, projectId, taskId: task.id, status: "queued" } as UiEvent);
    return { task, roomId: project.roomId, projectId };
  }

  async artifactVersionPayload(roomId: string, artifactId: string, versionId: string): Promise<{ bytes: Uint8Array; mediaType: string; etag: string }> {
    for (const workspace of await this.options.registry.list()) {
      const registry = await this.readRegistry(workspace.path);
      const project = Object.values(registry.projects).find((candidate) => candidate.artifact?.roomId === roomId && candidate.artifact.artifactId === artifactId);
      if (!project) continue;
      const versionRaw = await readJson(join(this.versionsDir(workspace.path, project), `${validateRelativePath(versionId)}.json`));
      if (!versionRaw || typeof versionRaw !== "object") throw new StudioNotFoundError("Studio version not found");
      const version = versionRaw as StudioVersion;
      const filePath = project.entryViews[0]?.path ?? basename(project.designPath);
      const file = version.files[filePath] ?? version.files[basename(project.designPath)];
      if (!file) throw new StudioNotFoundError("Artifact payload not found in Studio version");
      return { bytes: await readFile(join(this.blobsDir(workspace.path, project), file.sha256)), mediaType: file.mediaType, etag: file.sha256 };
    }
    throw new StudioNotFoundError("Artifact Studio project not found");
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

  private async currentArtifactPayload(roomId: string, artifactId: string): Promise<{ bytes: Uint8Array; mediaType: string; etag: string }> {
    const { workspacePath } = await this.findArtifactProject(roomId, artifactId);
    const artifact = await readArtifact({ rootDir: workspacePath, roomId }, artifactId);
    return { bytes: artifact.payload, mediaType: artifact.manifest.mediaType, etag: artifact.manifest.sha256 };
  }

  private async findArtifactProject(roomId: string, artifactId: string): Promise<{ workspacePath: string; registry: StudioRegistry; project: StudioProject }> {
    for (const workspace of await this.options.registry.list()) {
      const registry = await this.readRegistry(workspace.path);
      const project = Object.values(registry.projects).find((candidate) => candidate.artifact?.roomId === roomId && candidate.artifact.artifactId === artifactId);
      if (project) return { workspacePath: workspace.path, registry, project };
    }
    throw new StudioNotFoundError("Artifact Studio project not found");
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
