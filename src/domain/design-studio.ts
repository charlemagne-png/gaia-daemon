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
  artifact?: { roomId: string; artifactId: string };
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
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !resolve(rel).startsWith("/.."));
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

export const STUDIO_EID_ATTR = "data-gaia-eid";
export const STUDIO_EID_ALGORITHM = "gaia-dom-path-sha256-v1: tag path with 1-based same-tag sibling indexes; eid = sha256(path).slice(0,12)";
export const STUDIO_BRIDGE_SCRIPT = "/src/design/studio-bridge.js";

const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

interface HtmlElementSpan {
  eid: string;
  tag: string;
  openStart: number;
  openEnd: number;
  contentStart: number;
  contentEnd: number;
}

function eidForPath(path: string): string {
  return sha256(path).slice(0, 12);
}

function htmlElementSpans(html: string): HtmlElementSpan[] {
  const spans: HtmlElementSpan[] = [];
  const stack: { tag: string; path: string; counts: Map<string, number>; span?: HtmlElementSpan }[] = [{ tag: "#document", path: "", counts: new Map() }];
  const token = /<!--[^]*?-->|<![^>]*>|<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    if (!match[1]) continue;
    const raw = match[0];
    const tag = match[1].toLowerCase();
    if (raw.startsWith("</")) {
      for (let index = stack.length - 1; index > 0; index -= 1) {
        const item = stack.pop()!;
        if (item.span) item.span.contentEnd = match.index;
        if (item.tag === tag) break;
      }
      continue;
    }
    const parent = stack[stack.length - 1]!;
    const nextIndex = (parent.counts.get(tag) ?? 0) + 1;
    parent.counts.set(tag, nextIndex);
    const path = `${parent.path}/${tag}[${nextIndex}]`;
    const span: HtmlElementSpan = { eid: eidForPath(path), tag, openStart: match.index, openEnd: token.lastIndex, contentStart: token.lastIndex, contentEnd: token.lastIndex };
    spans.push(span);
    const selfClosing = /\/>\s*$/.test(raw) || VOID_HTML_TAGS.has(tag);
    if (!selfClosing) stack.push({ tag, path, counts: new Map(), span });
  }
  for (let index = stack.length - 1; index > 0; index -= 1) {
    const item = stack[index]!;
    if (item.span) item.span.contentEnd = html.length;
  }
  return spans;
}

function upsertAttribute(openTag: string, name: string, value: string): string {
  const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const attr = `${name}="${escaped}"`;
  const re = new RegExp(`\\s${name}=("[^"]*"|'[^']*'|[^\\s>]+)`);
  if (re.test(openTag)) return openTag.replace(re, ` ${attr}`);
  return openTag.replace(/\s*\/?>$/, (end) => ` ${attr}${end}`);
}

export function instrumentStudioHtml(html: string): string {
  let output = html;
  for (const span of htmlElementSpans(html).reverse()) {
    const open = output.slice(span.openStart, span.openEnd);
    output = `${output.slice(0, span.openStart)}${upsertAttribute(open, STUDIO_EID_ATTR, span.eid)}${output.slice(span.openEnd)}`;
  }
  const scriptTag = `<script src='${STUDIO_BRIDGE_SCRIPT}'></script>`;
  if (!output.includes(STUDIO_BRIDGE_SCRIPT)) {
    const bodyClose = /<\/body\s*>/i.exec(output);
    output = bodyClose ? `${output.slice(0, bodyClose.index)}${scriptTag}${output.slice(bodyClose.index)}` : `${output}${scriptTag}`;
  }
  return output;
}

export interface StudioElementPatch {
  eid: string;
  css?: Record<string, string>;
  text?: string;
  attrs?: Record<string, string | null>;
}

function mergeStyle(existing: string, css: Record<string, string>): string {
  const entries = new Map<string, string>();
  for (const part of existing.split(";")) {
    const split = part.indexOf(":");
    if (split <= 0) continue;
    entries.set(part.slice(0, split).trim().toLowerCase(), part.slice(split + 1).trim());
  }
  for (const [key, value] of Object.entries(css)) {
    const name = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`).trim().toLowerCase();
    if (name && value.trim()) entries.set(name, value.trim());
  }
  return Array.from(entries, ([key, value]) => `${key}: ${value}`).join("; ");
}

function removeAttribute(openTag: string, name: string): string {
  return openTag.replace(new RegExp(`\\s${name}=("[^"]*"|'[^']*'|[^\\s>]+)`, "g"), "");
}

export function patchStudioHtml(html: string, patch: StudioElementPatch): { html: string; elementHtml: string } {
  const span = htmlElementSpans(html).find((item) => item.eid === patch.eid);
  if (!span) throw new Error("Studio element not found");
  let open = html.slice(span.openStart, span.openEnd);
  if (patch.css && Object.keys(patch.css).length > 0) {
    const current = /\sstyle=("([^"]*)"|'([^']*)'|([^\s>]+))/.exec(open);
    open = upsertAttribute(open, "style", mergeStyle(current?.[2] ?? current?.[3] ?? current?.[4] ?? "", patch.css));
  }
  if (patch.attrs) {
    for (const [name, value] of Object.entries(patch.attrs)) {
      if (!/^[A-Za-z_:][A-Za-z0-9_:.:-]*$/.test(name) || name === STUDIO_EID_ATTR) continue;
      open = value === null ? removeAttribute(open, name) : upsertAttribute(open, name, value);
    }
  }
  const before = html.slice(0, span.openStart);
  const afterOpen = html.slice(span.openEnd);
  let next = `${before}${open}${afterOpen}`;
  const delta = open.length - (span.openEnd - span.openStart);
  if (patch.text !== undefined) {
    const contentStart = span.contentStart + delta;
    const contentEnd = span.contentEnd + delta;
    next = `${next.slice(0, contentStart)}${patch.text}${next.slice(contentEnd)}`;
  }
  const elementEnd = (patch.text !== undefined ? span.contentStart + delta + patch.text.length : span.contentEnd + delta);
  return { html: next, elementHtml: next.slice(span.openStart, Math.min(next.length, elementEnd + 128)) };
}

export function studioElementHtml(html: string, eid: string): string | undefined {
  const span = htmlElementSpans(html).find((item) => item.eid === eid);
  return span ? html.slice(span.openStart, span.contentEnd) : undefined;
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
