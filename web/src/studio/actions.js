import { api } from "../api.js";
import { promptText } from "../prompt.js";
import { markDirty, setError } from "../render.js";
import { state } from "../state.js";
import { openWindow } from "../native.js";
import { applyStudioProject, studio, selectedStudioView } from "./state.js";

/** @param {string} projectId */
export async function loadStudioProject(projectId) {
  studio.loading = true;
  markDirty("studio");
  try {
    const body = await api(`/api/studio/projects/${encodeURIComponent(projectId)}`);
    applyStudioProject(body);
    const view = selectedStudioView();
    if (view) await loadStudioFile(view.path);
  } catch (error) {
    studio.error = error instanceof Error ? error.message : String(error ?? "");
    setError(error);
  } finally {
    studio.loading = false;
    markDirty("studio");
  }
}

export async function openStudioPath() {
  if (!state.snapshot) return;
  let path = "";
  try {
    const picked = await api("/api/pick-directory", { method: "POST", body: "{}" });
    path = typeof picked?.path === "string" ? picked.path : "";
  } catch {
    path = await promptText("Design file or folder path", { placeholder: "/path/to/design-or-folder" }) ?? "";
  }
  if (!path) return;
  studio.loading = true;
  markDirty("studio");
  try {
    const body = await api("/api/studio/projects/open", { method: "POST", body: JSON.stringify({ workspaceId: state.snapshot.workspace.id, path }) });
    applyStudioProject(body);
    const view = selectedStudioView();
    if (view) await loadStudioFile(view.path);
  } catch (error) {
    studio.error = error instanceof Error ? error.message : String(error ?? "");
    setError(error);
  } finally {
    studio.loading = false;
    markDirty("studio");
  }
}

/** @param {string} viewId */
export async function selectStudioView(viewId) {
  studio.selectedViewId = viewId;
  sessionStorage.setItem("gaia.studio.view", viewId);
  studio.previewNonce++;
  const view = selectedStudioView();
  if (view) await loadStudioFile(view.path);
  markDirty("studio");
}

/** @param {string} path */
export async function loadStudioFile(path) {
  if (!studio.project) return;
  try {
    const file = await api(`/api/studio/projects/${encodeURIComponent(studio.project.projectId)}/files?path=${encodeURIComponent(path)}`);
    studio.editor = { path, content: String(file.content ?? ""), baseVersionId: String(file.headVersionId ?? studio.project.headVersionId ?? ""), sha256: String(file.sha256 ?? ""), dirty: false, loaded: true };
    studio.stale = "";
  } catch (error) {
    studio.editor = { ...studio.editor, path, loaded: false };
    studio.error = error instanceof Error ? error.message : String(error ?? "");
  }
}

/** @param {string} content */
export function updateStudioDraft(content) {
  studio.editor.content = content;
  studio.editor.dirty = true;
  markDirty("studio");
}

export async function saveStudioFile() {
  if (!studio.project || !studio.editor.loaded) return;
  studio.saving = true;
  studio.stale = "";
  markDirty("studio");
  try {
    const body = await api(`/api/studio/projects/${encodeURIComponent(studio.project.projectId)}/save`, { method: "PUT", body: JSON.stringify({ baseVersionId: studio.editor.baseVersionId, files: [{ path: studio.editor.path, content: studio.editor.content }], note: "Studio save" }) });
    applyStudioProject(body);
    studio.editor.baseVersionId = String(body.version?.versionId ?? studio.project.headVersionId ?? "");
    studio.editor.dirty = false;
    studio.previewNonce++;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("409")) studio.stale = "This file changed elsewhere. Reload before saving again.";
    else setError(error);
  } finally {
    studio.saving = false;
    markDirty("studio");
  }
}

/** @param {string} text */
export function updateStudioPrompt(text) {
  studio.prompt = text;
  markDirty("studio");
}

export async function sendStudioPrompt() {
  if (!studio.project || !studio.prompt.trim()) return;
  studio.iterating = true;
  studio.iterationStatus = "queued";
  markDirty("studio");
  try {
    await api(`/api/studio/projects/${encodeURIComponent(studio.project.projectId)}/iterate`, { method: "POST", body: JSON.stringify({ text: studio.prompt.trim(), viewId: studio.selectedViewId, baseVersionId: studio.editor.baseVersionId || studio.project.headVersionId }) });
    studio.prompt = "";
  } catch (error) {
    studio.iterationStatus = "error";
    setError(error);
  } finally {
    studio.iterating = false;
    markDirty("studio");
  }
}

/** @param {{ id?: string, projectId?: string }} [artifact] */
export async function openStudioPopout(artifact) {
  if (!studio.project) return;
  const artifactId = artifact?.id ?? "";
  const projectId = artifact?.projectId ?? studio.project.projectId;
  const url = `/studio?project=${encodeURIComponent(projectId)}&view=${encodeURIComponent(studio.selectedViewId)}&mode=popout${artifactId ? `&artifact=${encodeURIComponent(artifactId)}` : ""}`;
  const opened = await openWindow({ mode: "studio", projectId, viewId: studio.selectedViewId, artifactId });
  if (!opened) window.open(url, "_blank", "noopener");
}

export function refreshStudioPreview() {
  studio.previewNonce++;
  markDirty("studio");
}
