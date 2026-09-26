// The right-hand room panel, Apple language: HN carousel widget (→ hermes when
// a voice call is live), quick-links row, agent group rows, room header, and
// tasks. The three stateful widgets are mounted ONCE into persistent slot
// nodes; handing the same node references to replaceChildren on every render
// MOVES them rather than recreating them, so the carousel's fetch timers, the
// quick-links data and the strips' scroll positions all survive a re-render.
import { deleteAgent, deleteNote, deleteQueuedMessage, deleteRoomBookmark, setActiveAgent, setQueuedPaused, setRoomAgentDialogue } from "./actions.js";
import { mountAgentRows } from "./agent-rows.js";
import { $, h } from "./dom.js";
import { mountHnCarousel, setVoiceMode } from "./hn-widget.js";
import { LinkedText, PathText } from "./links.js";
import { shortModel } from "./models.js";
import { mountQuickLinks } from "./quick-links.js";
import { markDirty, registerRegion } from "./render.js";
import { openAgentSettings } from "./settings.js";
import { state } from "./state.js";
import { jumpToEvent } from "./transcript.js";
import { VoiceControlConsole, VoiceControlOrb } from "./voice-control.js";

// Persistent widget slots (see file header). Created lazily on first render,
// then reused for the life of the tab.
/** @type {HTMLElement|null} */ let widgetSlot = null;
/** @type {HTMLElement|null} */ let quickLinksSlot = null;
/** @type {HTMLElement|null} */ let agentsSlot = null;
/** @type {import("./hn-widget.js").CarouselHandle|null} */ let hnHandle = null;
/** @type {import("./agent-rows.js").AgentRowsHandle|null} */ let agentRowsHandle = null;
let lastVoiceOn = false;

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "apple";
}

/** Who this room is addressing: its remembered active agent, or the workspace
 * default when it has none yet. */
function activeAgentId() {
  const snapshot = state.snapshot;
  return snapshot ? (snapshot.room.activeAgent ?? snapshot.workspace.defaultAgent) : undefined;
}

/** Map snapshot agents to the agent-rows contract (avatar-first tiles).
 * @param {import("./types.js").AgentStatus[]} agents
 * @returns {import("./agent-rows.js").AgentTile[]}
 */
function mapAgents(agents) {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.displayName && agent.displayName.toLowerCase() !== agent.id.toLowerCase() ? agent.displayName : agent.id,
    handle: agent.id,
    model: agent.modelLabel ? shortModel(agent.modelLabel) : "",
    workspace: agent.workspace || "GENERAL",
    avatar: agent.avatarUrl,
    account: agent.account,
    status: agent.status,
  }));
}

/** Create + mount the three persistent widgets on first render. */
function ensureWidgets() {
  if (!widgetSlot) {
    widgetSlot = h("div", { class: "panel-widget-slot" });
    void mountHnCarousel(widgetSlot, { theme: currentTheme() }).then((handle) => {
      hnHandle = handle;
      lastVoiceOn = Boolean(state.voice);
      setVoiceMode(handle, lastVoiceOn); // reflect any call already live at mount
    });
  }
  if (!quickLinksSlot) {
    quickLinksSlot = h("div", { class: "panel-quicklinks-slot" });
    void mountQuickLinks(quickLinksSlot, {});
  }
  if (!agentsSlot) {
    agentsSlot = h("div", { class: "panel-agents-slot" });
    agentRowsHandle = mountAgentRows(agentsSlot, {
      agents: mapAgents(state.snapshot?.agents ?? []),
      activeAgent: activeAgentId(),
      onSelect: (agent) => void setActiveAgent(agent.id),
      onEdit: (agent) => void openAgentSettings(agent.id),
    });
    // Preserve the right-click → delete affordance the old rows had. Delegated
    // on the container so it survives the component re-rendering its tiles.
    agentsSlot.addEventListener("contextmenu", (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest(".agent-tile") : null;
      if (!(target instanceof HTMLElement) || !target.dataset.agentId) return;
      event.preventDefault();
      state.agentContextMenu = { agentId: target.dataset.agentId, x: event.clientX, y: event.clientY };
      markDirty("panel");
    });
  }
}

function renderPanel() {
  const panel = $("#room-panel");
  if (!panel) return;
  ensureWidgets();
  const snapshot = state.snapshot;
  const agents = snapshot?.agents ?? [];
  const tasks = snapshot?.tasks ?? [];
  const notes = snapshot?.notes ?? [];
  const activeAgent = activeAgentId();
  const currentRoom = snapshot?.rooms.find((room) => room.isCurrent);
  const bookmarks = currentRoom?.bookmarks ?? [];
  const roomId = snapshot?.room.id ?? "";
  const voiceControlOrb = VoiceControlOrb();
  const voiceControlConsole = VoiceControlConsole();
  const agentMenu = AgentContextMenu();
  panel.replaceChildren(
    ...(voiceControlOrb ? [voiceControlOrb] : []),
    ...(voiceControlConsole ? [voiceControlConsole] : []),
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, snapshot?.room.refCode ? h("span", { class: "room-ref room-ref-head", title: `room reference ${snapshot.room.refCode}`, text: snapshot.room.refCode }) : null, document.createTextNode("Room")),
      h("small", {}, snapshot?.room.statePath ? PathText(snapshot.room.statePath) : LinkedText("no room")),
    ),
    h(
      "div",
      { class: "room-toggle-wrap" },
      snapshot
        ? h(
            "label",
            { class: "room-toggle", title: "Let agents in this room reply to each other's @mentions. Off by default; bounded by a loop guard." },
            h("input", {
              type: "checkbox",
              checked: Boolean(snapshot.room.agentDialogue),
              onchange: (event) => void setRoomAgentDialogue(/** @type {HTMLInputElement} */ (event.target).checked),
            }),
            h("span", { text: "agents talk to each other" }),
          )
        : null,
    ),
    ...(bookmarks.length
      ? [
          h("h3", { text: "checkpoints" }),
          h(
            "div",
            { class: "checkpoint-list" },
            bookmarks.map((b) =>
              h(
                "div",
                { class: "checkpoint-row" },
                h("button", {
                  type: "button",
                  class: "checkpoint-name",
                  title: `@${b.author} · ${b.excerpt}`,
                  text: b.name,
                  onclick: () => void jumpToEvent(b.eventId),
                }),
                h("button", {
                  type: "button",
                  class: "checkpoint-remove",
                  title: "remove checkpoint",
                  text: "✕",
                  onclick: () => void deleteRoomBookmark(roomId, b.id),
                }),
              ),
            ),
          ),
        ]
      : []),
    // HN carousel (→ hermes on a live call), quick-links, then agent group rows.
    // These three are the SAME persistent nodes on every render (see header).
    // ensureWidgets() guaranteed them above; assert non-null for the checker.
    /** @type {HTMLElement} */ (widgetSlot),
    /** @type {HTMLElement} */ (quickLinksSlot),
    /** @type {HTMLElement} */ (agentsSlot),
    h("h3", { text: "tasks" }),
    h(
      "div",
      { class: "task-list" },
      notes.length === 0 && tasks.length === 0
        ? h("div", { class: "empty", text: "no tasks" })
        : [...NoteRows(notes), ...TaskRows(tasks)],
    ),
    ...(agentMenu ? [agentMenu] : []),
  );

  // Sync live state into the persistent widgets after they are (re-)attached.
  // Voice: a live call swaps the carousel out for the hermes slot.
  const voiceOn = Boolean(state.voice);
  if (hnHandle && voiceOn !== lastVoiceOn) setVoiceMode(hnHandle, voiceOn);
  lastVoiceOn = voiceOn;
  agentRowsHandle?.update({ agents: mapAgents(agents), activeAgent });
}

/**
 * Sticky notes (/note): prompt-later ideas, rendered as white sticky cards
 * ABOVE the task/queue rows — they are the shelf, the queue sits beneath.
 * @param {import("./types.js").RoomNote[]} notes
 */
function NoteRows(notes) {
  return notes.map((note) =>
    h(
      "div",
      { class: "sticky-note" },
      h("small", { text: note.text, title: note.text }),
      h("span", { class: "task-actions" },
        h("button", {
          class: "task-action danger",
          title: "dismiss this note",
          text: "\u2715",
          onclick: () => void deleteNote(note.id),
        }),
      ),
    ),
  );
}

/**
 * Task rows: the last few settled/running tasks, then EVERY queued/paused
 * entry (the waiting queue must stay fully visible — it's what the ⏸/▶/✕
 * controls operate on; only history is truncated).
 * @param {import("./types.js").Task[]} tasks
 */
function TaskRows(tasks) {
  const waiting = tasks.filter((task) => task.status === "queued" || task.status === "paused");
  const rest = tasks.filter((task) => task.status !== "queued" && task.status !== "paused").slice(-5);
  return [...rest, ...waiting].map((task) => {
    const isWaiting = task.status === "queued" || task.status === "paused";
    const isPaused = task.status === "paused";
    return h(
      "div",
      { class: `task ${task.status}` },
      h("span", { text: task.status }),
      h("small", { text: task.text, title: task.text }),
      isWaiting
        ? h("span", { class: "task-actions" },
            h("button", {
              class: "task-action",
              title: isPaused ? "resume — let it run when the agent is free" : "pause — hold it in the queue until resumed",
              text: isPaused ? "\u25b6" : "\u23f8",
              onclick: () => void setQueuedPaused(task.id, !isPaused),
            }),
            h("button", {
              class: "task-action danger",
              title: "drop this queued message (it never runs)",
              text: "\u2715",
              onclick: () => void deleteQueuedMessage(task.id),
            }),
          )
        : null,
    );
  });
}

/** Right-click menu on an agent row: delete (moves to trash, recoverable).
 * @returns {HTMLElement|null} */
function AgentContextMenu() {
  const open = state.agentContextMenu;
  if (!open) return null;
  const agent = (state.snapshot?.agents ?? []).find((candidate) => candidate.id === open.agentId);
  if (!agent) return null;
  const close = () => {
    state.agentContextMenu = null;
    markDirty("panel");
  };
  return h(
    "div",
    { class: "room-menu", style: `left:${open.x}px;top:${open.y}px`, oncontextmenu: (/** @type {MouseEvent} */ event) => event.preventDefault() },
    h("div", { class: "room-menu-title", text: `@${agent.id}` }),
    h("button", {
      type: "button",
      class: "danger",
      onclick: () => {
        close();
        void deleteAgent(agent.id);
      },
      text: "Delete agent",
    }),
  );
}

window.addEventListener("click", (event) => {
  if (!state.agentContextMenu) return;
  if (event.target instanceof HTMLElement && event.target.closest(".room-menu")) return;
  state.agentContextMenu = null;
  markDirty("panel");
});

registerRegion("panel", renderPanel);
