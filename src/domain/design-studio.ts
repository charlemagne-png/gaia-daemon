import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

export interface StudioEntryView {
  id: string;
  path: string;
  title: string;
}

export interface StudioProject {
  schema: 1;
  projectId: string;
  workspaceId: string;
  roomId: string;
  designPath: string;
  relativePath: string;
  pathKind: "file" | "folder";
  entryViews: StudioEntryView[];
  defaultViewId: string;
  headVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  status?: "missing-room";
}

export interface StudioRegistry {
  schema: 1;
  projects: Record<string, StudioProject>;
  byPath: Record<string, string>;
  byRoom: Record<string, string>;
}

export interface StudioVersionFile {
  sha256: string;
  bytes: number;
  mediaType: string;
}

export interface StudioVersion {
  schema: 1;
  versionId: string;
  projectId: string;
  parentVersionId: string | null;
  createdAt: string;
  actor: { kind: "human" | "agent"; id?: string; taskId?: string; eventId?: string };
  note?: string;
  files: Record<string, StudioVersionFile>;
  views: StudioEntryView[];
}

export function emptyStudioRegistry(): StudioRegistry {
  return { schema: 1, projects: {}, byPath: {}, byRoom: {} };
}

export function parseStudioRegistry(raw: unknown): StudioRegistry {
  if (!raw || typeof raw !== "object") return emptyStudioRegistry();
  const value = raw as Partial<StudioRegistry>;
  return {
    schema: 1,
    projects: value.projects && typeof value.projects === "object" ? value.projects : {},
    byPath: value.byPath && typeof value.byPath === "object" ? value.byPath : {},
    byRoom: value.byRoom && typeof value.byRoom === "object" ? value.byRoom : {},
  };
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function pathInside(child: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !resolve(rel).startsWith(resolve(child)));
}

export function relativePathUnder(root: string, target: string): string {
  const rel = relative(resolve(root), resolve(target)).split(sep).join("/");
  if (!rel || rel.startsWith("..") || rel.includes("/../")) throw new Error("Path must stay inside workspace");
  return rel;
}

export function validateRelativePath(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid relative path");
  return clean;
}

export function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return "application/octet-stream";
  }
}

export function isEditableTextPath(path: string): boolean {
  return [".html", ".css", ".js", ".json", ".txt", ".md", ".svg"].includes(extname(path).toLowerCase());
}

export async function discoverEntryViews(designPath: string, pathKind: "file" | "folder", entryView?: StudioEntryView): Promise<StudioEntryView[]> {
  if (entryView) return [{ ...entryView, path: validateRelativePath(entryView.path) }];
  if (pathKind === "file") return [{ id: "main", path: basename(designPath), title: basename(designPath) }];
  const views: StudioEntryView[] = [];
  try {
    await lstat(resolve(designPath, "index.html"));
    views.push({ id: "index", path: "index.html", title: "index.html" });
  } catch {}
  for (const dirent of await readdir(designPath, { withFileTypes: true }).catch(() => [])) {
    if (!dirent.isFile() || !dirent.name.endsWith(".html") || dirent.name === "index.html") continue;
    const id = dirent.name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || sha256(dirent.name).slice(0, 8);
    views.push({ id, path: dirent.name, title: dirent.name });
  }
  return views.length ? views : [{ id: "index", path: "index.html", title: "index.html" }];
}

export async function indexProjectFiles(root: string): Promise<Record<string, { bytes: Uint8Array; mediaType: string }>> {
  const out: Record<string, { bytes: Uint8Array; mediaType: string }> = {};
  async function walk(dir: string): Promise<void> {
    for (const dirent of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (dirent.name === ".gaia" || dirent.name === ".git") continue;
      const abs = resolve(dir, dirent.name);
      const rel = relative(root, abs).split(sep).join("/");
      if (dirent.isDirectory()) await walk(abs);
      else if (dirent.isFile()) {
        const bytes = await readFile(abs);
        out[rel] = { bytes, mediaType: mediaTypeFor(rel) };
      }
    }
  }
  const st = await lstat(root);
  if (st.isFile()) out[basename(root)] = { bytes: await readFile(root), mediaType: mediaTypeFor(root) };
  else await walk(root);
  return out;
}
