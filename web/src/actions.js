// Every server mutation goes through these small action functions: they call
// the API, update state, and mark the affected regions. Views never mutate
// state directly.
import { api } from "./api.js";
import { connectEvents, seedLiveTurn } from "./events.js";
import { confirmDialog, promptText } from "./prompt.js";
import { markDirty, setError } from "./render.js";
import { activeTask, markRoomRead, rememberLocation, runningSummonRooms, state, syncReadMarks } from "./state.js";
import { closeTab, openTab, restoreTabs } from "./tabs.js";
import { syncDarioFromSnapshot } from "./dario.js";
import { pinTranscriptToBottom } from "./transcript.js";

/** @typedef {import("./types.js").AppPayload} AppPayload */
/** @typedef {import("./types.js").SnapshotPayload} SnapshotPayload */

/** @param {AppPayload} body */
async function applyAppPayload(body) {
  state.workspaces = body.workspaces ?? [];
  // Seed the cross-workspace activity cache BEFORE syncReadMarks so every
  // workspace's rooms get a first-sight baseline (nothing retroactively unread).
  state.workspaceRooms = body.workspaceRooms ?? {};
  state.snapshot = body.snapshot ?? null;
  state.streams.clear();
  seedLiveTurn();
  const current = state.snapshot?.rooms.find((room) => room.id === state.snapshot?.room.id);
  if (state.snapshot && current) markRoomRead(state.snapshot.workspace.id, current.id, current.lastActivity ?? 0);
  syncReadMarks();
  syncDarioFromSnapshot(); // surface a pending Dario proposal on initial load
  state.older = { roomId: state.snapshot?.room.id ?? "", events: [], loading: false, lastTotal: state.snapshot?.room.eventTotal ?? 0 };
  state.voice = body.voice ?? null;
  // Settings modal catalogs — file LISTS ride along on the payloads that already
  // fetch everything else; only individual file content is a separate call
  // (loadSettingsFile below), made on demand as the modal selects a file.
  state.settingsWorkspaceFiles = body.workspaceFiles ?? [];
  state.settingsGlobalFiles = body.globalFiles ?? state.settingsGlobalFiles;
  state.keepAwake = body.keepAwake ?? state.keepAwake;
  state.userName = body.userName ?? state.userName;
  if (state.snapshot) {
    restoreTabs(state.snapshot.workspace.id);
    openTab(state.snapshot.room.id, state.snapshot.workspace.id);
  }
  rememberLocation(state.snapshot);
  connectEvents();
  state.error = "";
  markDirty();
}

/**
 * @param {string} [currentWorkspaceId] Preferred workspace to open (e.g. the one
 *   the user last had open). Ignored if it no longer exists, so a removed
 *   workspace never surfaces as an error on boot.
 * @returns {Promise<boolean>} true once the daemon answered and the app loaded;
 *   false if the daemon was unreachable (e.g. mid /rebuild re-exec) — the caller
 *   retries rather than dead-ending on a blank error screen.
 */
export async function loadApp(currentWorkspaceId) {
  try {
    /** @type {AppPayload} */
    const body = await api("/api/app");
    await applyAppPayload(body);
    const known = (body.workspaces ?? []).some((workspace) => workspace.id === currentWorkspaceId);
    if (currentWorkspaceId && known && body.currentWorkspaceId !== currentWorkspaceId) await loadWorkspace(currentWorkspaceId);
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

/** @param {SnapshotPayload} body */
function applySnapshotPayload(body) {
  state.snapshot = body.snapshot;
  state.streams.clear();
  seedLiveTurn();
  const current = body.snapshot.rooms.find((room) => room.id === body.snapshot.room.id);
  markRoomRead(body.snapshot.workspace.id, body.snapshot.room.id, current?.lastActivity ?? 0);
  syncReadMarks();
  syncDarioFromSnapshot(); // surface a pending Dario proposal when switching into a room
  // Workspace/room switch: paged-in older history belongs to the old room.
  state.older = { roomId: body.snapshot.room.id, events: [], loading: false, lastTotal: body.snapshot.room.eventTotal };
  state.settingsWorkspaceFiles = body.workspaceFiles ?? [];
  state.voice = body.voice ?? null;
  rememberLocation(state.snapshot);
}

/** @param {string} workspaceId */
export async function loadWorkspace(workspaceId) {
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/snapshot`);
    applySnapshotPayload(body);
    if (state.snapshot) {
      restoreTabs(state.snapshot.workspace.id);
      openTab(state.snapshot.room.id, state.snapshot.workspace.id);
    }
    connectEvents();
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

export async function addWorkspace() {
  /** @type {string|null|undefined} */
  let path;
  let pickerUnavailable = false;
  try {
    const pick = await api("/api/pick-directory", { method: "POST", body: "{}" });
    path = pick.path;
  } catch {
    pickerUnavailable = true;
  }
  if (!path && pickerUnavailable) path = await promptText("Workspace path", { placeholder: "/path/to/workspace" });
  if (!path) return;
  try {
    await applyAppPayload(await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path }) }));
  } catch (error) {
    setError(error);
  }
}

/**
 * @param {string} workspaceId
 * @param {string} roomId
 * @param {{ incognito?: boolean, parentRoomId?: string }} [opts] `incognito` and
 *   `parentRoomId` (user-opened subroom) only take effect when this call creates
 *   the room (no-ops when selecting one that already exists).
 */
export async function selectRoom(workspaceId, roomId, opts = {}) {
  try {
    // Read-aloud deliberately keeps playing across a room switch — it only
    // stops when you play another message (or hit stop from the status-bar
    // now-playing chip). So no stopReadAloud() here.
    const body = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/rooms/${encodeURIComponent(roomId)}/select`, {
      method: "POST",
      body: JSON.stringify({
        ...(opts.incognito ? { incognito: true } : {}),
        ...(opts.parentRoomId ? { parentRoomId: opts.parentRoomId } : {}),
      }),
    });
    applySnapshotPayload(body);
    if (state.snapshot) openTab(state.snapshot.room.id, state.snapshot.workspace.id);
    connectEvents();
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** @param {string} agentId */
/** @param {string} agentId */
export async function setActiveAgent(agentId) {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.room.activeAgent === agentId) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/active-agent`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
    if (body.redirect) {
      await selectRoom(body.redirect.workspaceId, body.redirect.roomId);
      return;
    }
    applySnapshotPayload(body);
    connectEvents();
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** @param {string} agentId */
export async function setDefaultAgent(agentId) {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.workspace.defaultAgent === agentId) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/default-agent`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    });
    applySnapshotPayload(body);
    connectEvents();
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** @param {string} agentId @param {string} role */
export async function setAgentRole(agentId, role) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(
      `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/role`,
      {
        method: "POST",
        body: JSON.stringify({ agentId, role: role || "none" }),
      },
    );
    applySnapshotPayload(body);
    connectEvents();
    state.error = body.message && /^Unknown|^Usage/.test(body.message) ? body.message : "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** @param {string} agentId @param {string} role */
export async function setAgentDefaultRole(agentId, role) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/default-role`, {
      method: "POST",
      body: JSON.stringify({ agentId, role: role || "none" }),
    });
    applySnapshotPayload(body);
    connectEvents();
    state.error = body.message && /^Unknown|^Usage/.test(body.message) ? body.message : "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** Set (or clear) the named account an agent's harness subprocess runs under.
 * Global (not per-room/workspace), so unlike setAgentRole this has no snapshot
 * in its response — the daemon's own applySettingsChange("global") reload
 * broadcasts a fresh snapshot over the already-open SSE stream, same as any
 * other global settings edit.
 * @param {string} agentId @param {string | null} account */
export async function setAgentAccount(agentId, account) {
  // Optimistic UI update: immediately update local state before API call completes
  const agent = state.snapshot?.agents.find((a) => a.id === agentId);
  if (agent) {
    agent.account = account || undefined;
    markDirty("panel");
  }
  
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}/account`, {
      method: "POST",
      body: JSON.stringify({ account: account || null }),
    });
    state.error = "";
    // SSE snapshot will arrive and re-sync state
  } catch (error) {
    // Revert optimistic update on error
    if (agent) {
      const snapshot = await api("/api/snapshot");
      state.snapshot = snapshot;
      markDirty();
    }
    setError(error);
  }
}

/** Reversible agent delete: moves agent dir to trash (recoverable).
 * @param {string} agentId
 */
export async function deleteAgent(agentId) {
  const ok = await confirmDialog(`Delete agent @${agentId}?`, {
    detail: "The agent moves to trash (recoverable). It won't appear in the agents list anymore.",
    okLabel: "Delete agent",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
      body: "{}",
    });
    state.error = "";
    // Global settings changed; SSE will broadcast snapshot update
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** @typedef {{ id: string, harness: string, label?: string, email?: string, workspace?: string, providers?: string[] }} AccountRecordSummary */
/** @typedef {{ id: string, label?: string, login: boolean }} AccountHarnessSummary */
/** @typedef {{ accounts: AccountRecordSummary[], harnesses: AccountHarnessSummary[] }} AccountsCatalog */

/** Cached GET /api/accounts — every caller (Settings' Accounts tab, the
 * agents panel's per-agent account picker) awaits the SAME in-flight/settled
 * request instead of each firing its own. @type {Promise<AccountsCatalog> | null} */
let accountsCatalogPromise = null;

/** @returns {Promise<AccountsCatalog>} */
export function accountsCatalog() {
  if (!accountsCatalogPromise) accountsCatalogPromise = api("/api/accounts");
  return accountsCatalogPromise;
}

/** Drop the cache so the next accountsCatalog() call refetches — call after
 * an account is added, removed, or logged in. */
export function refreshAccountsCatalog() {
  accountsCatalogPromise = null;
}

/** Run a room-local plugin action (popup form submit, item action button, or
 * an equivalent slash-command args array) and persist its result.
 * @param {string} command @param {string[]} args */
export async function runPluginAction(command, args) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(
      `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/plugins/${encodeURIComponent(command)}`,
      { method: "POST", body: JSON.stringify({ args }) },
    );
    applySnapshotPayload(body);
    state.error = body.message || "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** Toggle room agent-dialogue (agents responding to each other's @mentions).
 * @param {boolean} on */
export async function setRoomAgentDialogue(on) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(
      `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/agent-dialogue`,
      { method: "POST", body: JSON.stringify({ on }) },
    );
    applySnapshotPayload(body);
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/** An opaque, collision-resistant id for an auto-created room. The user never
 * types or sees it: the room takes its display title from its first message
 * (server-side — see isAutoRoomId/deriveRoomTitle in src/domain/rooms.ts), the
 * way a Claude Code / Codex session names itself from its opening prompt. The
 * `chat-` prefix is what the daemon keys the auto-title on, so keep it in sync
 * with AUTO_ROOM_PREFIX there.
 * @param {string} prefix */
function newAutoRoomId(prefix) {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a new room in the current workspace and switch to it — instantly, no
 * name dialog. The room is auto-named (its title is distilled from the first
 * message). ⌥-click / `incognito:true` makes it memory-off instead.
 * @param {{ incognito?: boolean, title?: string }} [opts]
 * @returns {Promise<{ workspaceId: string, roomId: string } | null>}
 */
export async function addRoom(opts = {}) {
  const snapshot = state.snapshot;
  if (!snapshot) return null;
  const incognito = opts.incognito === true;
  const roomId = newAutoRoomId(incognito ? "incognito-" : "chat-");
  try {
    await selectRoom(snapshot.workspace.id, roomId, { incognito });
    const title = String(opts.title ?? "").trim();
    if (title) {
      const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/title`, {
        method: "POST",
        body: JSON.stringify({ title, source: "auto" }),
      });
      applyRoomsPayload(snapshot.workspace.id, body.rooms);
      if (state.snapshot?.workspace.id === snapshot.workspace.id && state.snapshot.room.id === roomId) /** @type {any} */ (state.snapshot.room).title = title;
      markDirty("sidebar", "tabs", "status");
    }
    return { workspaceId: snapshot.workspace.id, roomId };
  } catch (error) {
    setError(error);
    return null;
  }
}

/**
 * Close a room tab. This only drops it from the working set — the room and its
 * transcript stay put and remain reachable from the sidebar tree. If the closed
 * tab was active, jump to a neighbour so a room is always in view.
 * @param {string} roomId
 */
export async function closeRoomTab(roomId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const isActive = snapshot.room.id === roomId;
  const neighbour = closeTab(roomId, snapshot.workspace.id, isActive);
  if (isActive && neighbour && neighbour !== roomId) await selectRoom(snapshot.workspace.id, neighbour);
  else markDirty("tabs", "sidebar");
}

/**
 * Permanently delete a room (reversible on the server — it moves to trash and is
 * purged from memory). Confirms first, then DELETEs; the server reselects a
 * neighbour and returns its snapshot, so a room is always in view afterward.
 * @param {string} roomId
 */
/**
 * Rename a room's display title. The room id/path stays stable.
 * @param {string} roomId
 * @param {string} [currentTitle]
 */
export async function renameRoom(roomId, currentTitle = "") {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const title = await promptText("Rename room", { value: currentTitle || roomId, okLabel: "Rename" });
  if (!title) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/title`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    applyRoomsPayload(snapshot.workspace.id, body.rooms);
    state.error = "";
    markDirty("sidebar", "tabs", "status");
  } catch (error) {
    setError(error);
  }
}

/** @param {string} workspaceId @param {unknown} rooms */
function applyRoomsPayload(workspaceId, rooms) {
  const snapshot = state.snapshot;
  if (!Array.isArray(rooms)) return;
  /** @type {import("./types.js").RoomSummary[]} */
  const summaries = rooms;
  state.workspaceRooms[workspaceId] = summaries;
  if (snapshot && snapshot.workspace.id === workspaceId) {
    snapshot.rooms = summaries.map((/** @type {import("./types.js").RoomSummary} */ room) => ({ ...room, isCurrent: room.id === snapshot.room.id }));
  }
}

/** Open a fresh SUBROOM nested under a parent room — a first-class room the
 * human talks in (full summon rights, normal memory), merely grouped under the
 * parent in the sidebar. Nothing is ever delivered back to the parent, and the
 * parent's running turn is never touched.
 * @param {string} parentRoomId */
export async function openSubroom(parentRoomId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const roomId = newAutoRoomId("chat-");
  try {
    await selectRoom(snapshot.workspace.id, roomId, { parentRoomId });
  } catch (error) {
    setError(error);
  }
}

/** Launch a background worker in ANY room from the UI — turn-independent:
 * the daemon spawns the child sub-room without touching the parent's running
 * turn (no steer, no agent tokens spent relaying the order), and the result
 * comes back as a collapsed note (deliver:"note").
 * @param {string} roomId @param {string} agentId */
export async function summonAgentInRoom(roomId, agentId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const task = await promptText(`Summon @${agentId} in a sub-room`, { placeholder: "task for the worker…", okLabel: "Summon" });
  if (typeof task !== "string" || !task.trim()) return;
  try {
    await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/summons`, {
      method: "POST",
      body: JSON.stringify({ agentId, task: task.trim() }),
    });
    state.error = "";
    markDirty("sidebar", "status");
  } catch (error) {
    setError(error);
  }
}

/** @param {string} roomId @param {boolean} favorite */
export async function setRoomFavorite(roomId, favorite) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/favorite`, {
      method: "POST",
      body: JSON.stringify({ favorite }),
    });
    applyRoomsPayload(snapshot.workspace.id, body.rooms);
    state.error = "";
    markDirty("sidebar", "tabs", "status");
  } catch (error) {
    setError(error);
  }
}

/** @param {string} roomId @param {string} eventId @param {string} name */
export async function setRoomBookmark(roomId, eventId, name) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/bookmarks`, {
      method: "POST",
      body: JSON.stringify({ eventId, name }),
    });
    applyRoomsPayload(snapshot.workspace.id, body.rooms);
    state.error = "";
    markDirty("sidebar", "tabs", "status", "panel");
  } catch (error) {
    setError(error);
  }
}

/** @param {string} roomId @param {string} bookmarkId */
export async function deleteRoomBookmark(roomId, bookmarkId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}/bookmarks/${encodeURIComponent(bookmarkId)}`, {
      method: "DELETE",
      body: "{}",
    });
    applyRoomsPayload(snapshot.workspace.id, body.rooms);
    state.error = "";
    markDirty("sidebar", "tabs", "status", "panel");
  } catch (error) {
    setError(error);
  }
}

/** @param {string} roomId */
export async function deleteRoom(roomId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const ok = await confirmDialog(`Delete room "${roomId}"?`, {
    detail: "The room moves to trash (recoverable) and is removed from memory/recall. It won't appear in the sidebar anymore.",
    okLabel: "Delete room",
    danger: true,
  });
  if (!ok) return;
  try {
    closeTab(roomId, snapshot.workspace.id, false); // drop from the working set if open
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(roomId)}`, {
      method: "DELETE",
      body: "{}",
    });
    state.sidebarFocus = null; // the target is gone; fall back to the new current room
    applySnapshotPayload(body);
    if (state.snapshot) openTab(state.snapshot.room.id, state.snapshot.workspace.id);
    connectEvents();
    state.error = "";
    markDirty();
  } catch (error) {
    setError(error);
  }
}

/**
 * Remove a workspace from GAIA's list. De-registration only — nothing on disk is
 * deleted (its .gaia data and project files stay put, so re-adding the folder
 * restores it). Confirms first, then DELETEs; the server returns the fresh app
 * payload with a remaining workspace selected (or none, if it was the last).
 * @param {string} workspaceId
 */
export async function deleteWorkspace(workspaceId) {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  const name = workspace?.name ?? workspaceId;
  const ok = await confirmDialog(`Remove workspace "${name}"?`, {
    detail: "Removes it from GAIA's workspace list. Nothing on disk is deleted — its .gaia data and files stay put, and you can re-add the folder to restore it.",
    okLabel: "Remove workspace",
    danger: true,
  });
  if (!ok) return;
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE", body: "{}" });
    state.sidebarFocus = null; // the target is gone; fall back to the new current room
    await applyAppPayload(body);
  } catch (error) {
    setError(error);
  }
}

/**
 * Upload one pasted file into the current room's files dir. Raw fetch, not
 * api(): the body is the file's bytes, not JSON.
 * @param {File} file
 * @param {string} name
 * @param {boolean} [mirrorToDownloads] dropped files (screenshot preview
 *   drags) are also written to ~/Downloads by the server — the drag happened
 *   before the file was saved anywhere the user can find it.
 * @returns {Promise<import("./types.js").UploadedAttachment>}
 */
export async function uploadAttachment(file, name, mirrorToDownloads = false) {
  const snapshot = state.snapshot;
  if (!snapshot) throw new Error("No room selected");
  const url = `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/files?name=${encodeURIComponent(name)}${mirrorToDownloads ? "&downloads=1" : ""}`;
  const response = await fetch(url, {
    method: "POST",
    ...(file.type ? { headers: { "content-type": file.type } } : {}),
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Upload failed: ${response.status}`);
  return body.attachment;
}

/**
 * @param {string} text
 * @param {import("./types.js").UploadedAttachment[]} [attachments]
 * @param {{ queue?: boolean, voice?: boolean, onTask?: (task: import("./types.js").Task) => void }} [options] queue:true forces
 *   the durable queue (Cmd/Ctrl+Enter) instead of steering the running turn;
 *   voice:true marks continuous voice-control origin; onTask observes the accepted task.
 * @returns {Promise<boolean>}
 */
export async function sendMessage(text, attachments = [], options = {}) {
  const snapshot = state.snapshot;
  if (!snapshot || (!text.trim() && attachments.length === 0)) return false;
  // Sending is a "follow along" intent: snap back to the bottom so the reader
  // sees their own message and the incoming reply even if they'd scrolled up.
  pinTranscriptToBottom();
  try {
    const body = await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        text,
        ...(attachments.length ? { attachments: attachments.map(({ id, name, mime }) => ({ id, name, mime })) } : {}),
        ...(options.queue ? { queue: true } : {}),
        ...(options.voice ? { voice: true } : {}),
      }),
    });
    if (body.task) options.onTask?.(body.task);
    // Reflect the accepted task immediately so busy state doesn't wait for SSE.
    if (body.task && state.snapshot === snapshot && !snapshot.tasks.some((task) => task.id === body.task.id)) {
      snapshot.tasks.push(body.task);
      markDirty("panel", "status", "composer");
    }
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

/**
 * Retry: regenerate everything from the user message that produced `eventId`
 * (works on an agent reply or a user message). The server forks the room
 * there — later events move to rewound.jsonl — and re-runs the same text.
 * @param {string} eventId
 */
export async function retryMessage(eventId) {
  return forkMessage("retry", { eventId });
}

/**
 * Edit: fork the room at the user message `eventId` and re-send it as `text`.
 * `keepAttachmentPaths`, when given, narrows the original message's own
 * attachments down to that set (an empty array drops them all) — omit it to
 * keep every original attachment unchanged.
 * @param {string} eventId
 * @param {string} text
 * @param {string[]} [keepAttachmentPaths]
 */
export async function editMessage(eventId, text, keepAttachmentPaths) {
  return forkMessage("edit", { eventId, text, ...(keepAttachmentPaths ? { keepAttachments: keepAttachmentPaths } : {}) });
}

/**
 * @param {"retry"|"edit"} action @param {{ eventId: string, text?: string, keepAttachments?: string[] }} payload
 * @returns {Promise<boolean>}
 */
async function forkMessage(action, payload) {
  const snapshot = state.snapshot;
  if (!snapshot) return false;
  try {
    const body = await api(
      `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/${action}`,
      { method: "POST", body: JSON.stringify(payload) },
    );
    if (body.task && state.snapshot === snapshot && !snapshot.tasks.some((task) => task.id === body.task.id)) {
      snapshot.tasks.push(body.task);
      markDirty("panel", "status", "composer");
    }
    return true;
  } catch (error) {
    setError(error);
    return false;
  }
}

/**
 * Delete a still-queued message so it never runs (the ✕ on a queued ghost
 * bubble). Harness-agnostic: the durable queue is shared room plumbing, so this
 * is a plain DELETE with no runtime involved. The server emits task-end
 * (status "cancelled") which drops the ghost; a 404 means it already started
 * running, so we just let the next snapshot reconcile.
 * @param {string} taskId
 */
export async function deleteQueuedMessage(taskId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/queue/${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      body: "{}",
    });
    // Reflect immediately so the ghost vanishes without waiting for SSE.
    if (state.snapshot === snapshot) {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (task) task.status = "cancelled";
      markDirty("transcript", "panel", "status", "composer");
    }
  } catch (error) {
    setError(error);
  }
}

/**
 * Dismiss a sticky note (the ✕ on a /note card in the tasks panel). Display
 * metadata only — no runtime, no queue; idempotent server-side.
 * @param {string} noteId
 */
export async function deleteNote(noteId) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/notes/${encodeURIComponent(noteId)}`, {
      method: "DELETE",
      body: "{}",
    });
    // Reflect immediately so the card vanishes without waiting for SSE.
    if (state.snapshot === snapshot && snapshot.notes) {
      snapshot.notes = snapshot.notes.filter((note) => note.id !== noteId);
      markDirty("panel");
    }
  } catch (error) {
    setError(error);
  }
}

/**
 * Pause or resume a still-queued message (⏸/▶ in the tasks panel). Paused
 * entries keep their queue slot but drain skips them until resumed. A 404
 * means it already started running — the next snapshot reconciles.
 * @param {string} taskId @param {boolean} paused
 */
export async function setQueuedPaused(taskId, paused) {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  try {
    await api(
      `/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/queue/${encodeURIComponent(taskId)}/paused`,
      { method: "POST", body: JSON.stringify({ paused }) },
    );
    // Reflect immediately so the chip flips without waiting for SSE.
    if (state.snapshot === snapshot) {
      const task = snapshot.tasks.find((candidate) => candidate.id === taskId);
      if (task) task.status = paused ? "paused" : "queued";
      markDirty("transcript", "panel", "status", "composer");
    }
  } catch (error) {
    setError(error);
  }
}

export async function cancelActiveTask() {
  const snapshot = state.snapshot;
  if (!snapshot || !activeTask(snapshot)) return;
  try {
    await api(`/api/workspaces/${encodeURIComponent(snapshot.workspace.id)}/rooms/${encodeURIComponent(snapshot.room.id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    setError(error);
  }
}

/**
 * Stop the ACTIVE ROOM's running turn only — bound to Esc and the stop button.
 * Deliberately CANNOT reach summons: UI/stream delay made any escalating
 * behavior kill summons by accident; only Ctrl+C (stopAll) stops those.
 */
export async function stopActiveRoom() {
  const snapshot = state.snapshot;
  if (!snapshot || !activeTask(snapshot)) return;
  try {
    await cancelActiveTask();
    setError("");
  } catch (error) {
    setError(error);
  }
}

/**
 * Stop every running summon descended from the active room. Summons nest;
 * runningSummonRooms walks the whole parent chain, so sub-sub-rooms are
 * included — one call clears the entire subtree.
 * Only reachable via stopAll (Ctrl+C) — never bound to Esc or the button directly.
 */
export async function stopSummons() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const workspaceId = snapshot.workspace.id;
  const summonRooms = runningSummonRooms(snapshot);
  if (summonRooms.length === 0) return;
  try {
    await Promise.allSettled(
      summonRooms.map((room) =>
        api(`/api/workspaces/${encodeURIComponent(workspaceId)}/rooms/${encodeURIComponent(room.id)}/cancel`, { method: "POST", body: "{}" }),
      ),
    );
    setError("");
  } catch (error) {
    setError(error);
  }
}

/**
 * Kill the whole tree at once, bound to Ctrl+C: the active room's running
 * turn AND every summon descended from it.
 */
export async function stopAll() {
  await Promise.allSettled([stopActiveRoom(), stopSummons()]);
}

// ---------------------------------------------------------------------------
// Settings modal: editable-file content load/save + keep-awake. File LISTS
// (state.settingsWorkspaceFiles / settingsGlobalFiles) arrive for free on the
// app/snapshot payloads above; only a single file's content+hints and the
// keep-awake toggle need their own round trip.

/**
 * Load one editable file's content (+ server-computed field hints) into
 * state.settingsFile / settingsFileHints for the Settings modal. Workspace-scoped
 * files need `workspaceId` so the daemon resolves the right workspace's copy;
 * global files (general/voice/agents) omit it.
 * @param {string} fileId
 * @param {{ workspaceId?: string }} [opts]
 */
export async function loadSettingsFile(fileId, opts = {}) {
  state.settingsError = "";
  try {
    const params = opts.workspaceId ? `?${new URLSearchParams({ workspaceId: opts.workspaceId })}` : "";
    const body = await api(`/api/files/${encodeURIComponent(fileId)}${params}`);
    state.settingsFile = body.file;
    state.settingsFileHints = body.file.hints;
  } catch (error) {
    state.settingsFile = null;
    state.settingsFileHints = undefined;
    state.settingsError = error instanceof Error ? error.message : String(error);
  }
  markDirty("settings");
}

/**
 * Save the Settings modal's currently open file with new raw text content.
 * @param {string} content
 */
export async function saveSettingsFile(content) {
  const file = state.settingsFile;
  if (!file) return;
  state.settingsError = "";
  try {
    const params = file.scope === "workspace" && state.snapshot ? `?${new URLSearchParams({ workspaceId: state.snapshot.workspace.id })}` : "";
    const body = await api(`/api/files/${encodeURIComponent(file.id)}${params}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    });
    state.settingsFile = body.file;
    state.settingsFileHints = body.file.hints;
  } catch (error) {
    state.settingsError = error instanceof Error ? error.message : String(error);
  }
  markDirty("settings");
}

/** "Keep laptop awake while GAIA runs" (Settings ▸ general): persist + apply
 * immediately via the daemon (services/keep-awake.ts, macOS-only — the toggle
 * hides itself elsewhere via state.keepAwake.supported).
 * @param {boolean} enabled */
export async function setKeepAwake(enabled) {
  try {
    const body = await api("/api/app/keep-awake", { method: "POST", body: JSON.stringify({ enabled }) });
    state.keepAwake = body.keepAwake ?? state.keepAwake;
    markDirty("settings");
  } catch (error) {
    setError(error);
  }
}

/** "Your name" (Settings ▸ General): persists the label agents use for the
 * human's own transcript lines in place of the anonymous "user" token
 * (services/user-name.ts). Empty string clears it back to that default.
 * @param {string} name */
export async function setUserName(name) {
  try {
    const body = await api("/api/app/user-name", { method: "POST", body: JSON.stringify({ name }) });
    state.userName = body.userName ?? state.userName;
    markDirty("settings");
  } catch (error) {
    setError(error);
  }
}
