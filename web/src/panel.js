// The right-hand room panel: agents (role select, main-agent star, voice call
// button) and recent tasks.
import { accountsCatalog, deleteAgent, deleteNote, deleteQueuedMessage, deleteRoomBookmark, setActiveAgent, setAgentConfig, setAgentDefaultRole, setAgentRole, setDefaultAgent, setQueuedPaused, setRoomAgentDialogue } from "./actions.js";
import { armCompactTick, CompactBar, compactDetail } from "./compactprogress.js";
import { $, h } from "./dom.js";
import { LinkedText, PathText } from "./links.js";
import { shortModel } from "./models.js";
import { markDirty, registerRegion } from "./render.js";
import { openAgentSettings } from "./settings.js";
import { state } from "./state.js";
import { jumpToEvent } from "./transcript.js";
import { toggleCall } from "./voice.js";
import { VoiceControlConsole, VoiceControlOrb } from "./voice-control.js";

/** Account catalog for the per-agent picker below: fetched once (accountsCatalog()
 * caches the request itself), held here as the last resolved value so a render
 * pass stays synchronous. Guarded by `accountsCatalogRequested` so attaching
 * .then() doesn't re-fire markDirty on every render once it has resolved. */
/** @type {import("./actions.js").AccountsCatalog | null} */
let accountsCatalogValue = null;
let accountsCatalogRequested = false;

function ensureAccountsCatalog() {
  if (accountsCatalogRequested) return;
  accountsCatalogRequested = true;
  void accountsCatalog()
    .then((catalog) => {
      accountsCatalogValue = catalog;
      markDirty("panel");
    })
    .catch(() => {
      accountsCatalogRequested = false; // let the next render retry
    });
}

/**
 * The one-line agent subtitle (status / model), shown under the @id and mirrored
 * into the row's title so it survives ellipsis-truncation on a narrow panel.
 * @param {import("./types.js").AgentStatus} agent
 * @param {string | undefined} activeAgent
 */
function agentSubtitle(agent, activeAgent) {
  return [
    // Only when it says more than the id already does.
    agent.displayName && agent.displayName.toLowerCase() !== agent.id.toLowerCase() ? agent.displayName : "",
    agent.id === activeAgent ? "active" : "",
    agent.isDefault ? "default" : "",
    agent.status === "running" ? "running" : "",
    agent.status === "compacting" ? `compacting… ${agent.compact ? compactDetail(agent.compact) : ""}`.trim() : "",
    agent.voice ? `voice:${agent.voice}` : "",
    agent.modelLabel ? shortModel(agent.modelLabel) : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

/** @param {import("./actions.js").AccountHarnessSummary | undefined} harness @returns {string[]} */
function harnessProviders(harness) {
  return harness?.modelProviderIds ?? (harness?.lockedProvider ? [harness.lockedProvider] : []);
}

/** Model datalist suggestions from harness/account data, with the current
 * configured value kept even when the catalog is narrower than reality.
 * @param {import("./types.js").AgentStatus} agent
 * @param {import("./actions.js").AccountHarnessSummary | undefined} harness
 * @param {import("./actions.js").AccountRecordSummary[]} accounts
 */
function modelSuggestions(agent, harness, accounts) {
  const values = new Set();
  if (agent.configuredModel && agent.configuredModel !== "default") values.add(agent.configuredModel);
  const providers = new Set([...harnessProviders(harness), ...accounts.flatMap((account) => account.providers ?? [])]);
  const names = harness?.modelNameOptions ?? [];
  for (const provider of providers) for (const name of names) values.add(`${provider}/${name}`);
  if (agent.configuredModel?.includes("/")) {
    const name = agent.configuredModel.slice(agent.configuredModel.indexOf("/") + 1);
    for (const provider of providers) values.add(`${provider}/${name}`);
  }
  return [...values].sort();
}

function renderPanel() {
  const panel = $("#room-panel");
  if (!panel) return;
  ensureAccountsCatalog();
  const snapshot = state.snapshot;
  const agents = snapshot?.agents ?? [];
  const tasks = snapshot?.tasks ?? [];
  const notes = snapshot?.notes ?? [];
  // The agent this room is currently addressing: its remembered active agent,
  // or the workspace default when it has none yet. Marks the "active" row and
  // is who a bare next message goes to.
  const activeAgent = snapshot ? (snapshot.room.activeAgent ?? snapshot.workspace.defaultAgent) : undefined;
  const currentRoom = snapshot?.rooms.find((room) => room.isCurrent);
  const bookmarks = currentRoom?.bookmarks ?? [];
  const roomId = snapshot?.room.id ?? "";
  const voiceControlOrb = VoiceControlOrb();
  const voiceControlConsole = VoiceControlConsole();
  
  // Group agents by workspace
  const agentsByWorkspace = new Map();
  for (const agent of agents) {
    const ws = agent.workspace || "GENERAL";
    if (!agentsByWorkspace.has(ws)) agentsByWorkspace.set(ws, []);
    agentsByWorkspace.get(ws).push(agent);
  }
  const workspaces = Array.from(agentsByWorkspace.keys()).sort();
  
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
    h("h3", { text: "agents" }),
    h(
      "div",
      { class: "agent-list" },
      workspaces.flatMap((workspace) => {
        const wsAgents = agentsByWorkspace.get(workspace) || [];
        const expanded = state.expandedWorkspaceGroups.has(workspace);
        return [
          h(
            "button",
            {
              class: "workspace-group-header",
              onclick: () => {
                if (expanded) state.expandedWorkspaceGroups.delete(workspace);
                else state.expandedWorkspaceGroups.add(workspace);
                markDirty("panel");
              },
            },
            h("span", { text: expanded ? "\u25bc" : "\u25b6" }),
            h("strong", { text: workspace }),
            h("small", { text: ` (${wsAgents.length})` }),
          ),
          ...(expanded ? wsAgents.map((/** @type {import("./types.js").AgentStatus} */ agent) => {
        const onCall = state.voice?.agentId === agent.id;
        const connecting = state.voicePendingAgentId === agent.id;
        const roles = agent.roles ?? [];
        // "none" is an explicit opt-out; otherwise a room override wins, falling
        // back to the agent's global default role.
        const effectiveRole = agent.activeRole === "none" ? undefined : (agent.activeRole ?? agent.defaultRole);
        const agentAccounts = (accountsCatalogValue?.accounts ?? []).filter((account) => account.harness === agent.harness);
        const agentHarness = accountsCatalogValue?.harnesses.find((harness) => harness.id === agent.harness);
        const modelOptionId = `agent-model-options-${agent.id}`;
        const modelValue = agent.configuredModel && agent.configuredModel !== "default" ? agent.configuredModel : "";
        const suggestedModels = modelSuggestions(agent, agentHarness, agentAccounts);
        return h(
          "div",
          {
            class: `agent-row ${onCall ? "on-call" : ""} ${agent.status === "running" || agent.status === "compacting" ? "running" : ""} ${effectiveRole ? "has-role" : ""} ${agent.id === activeAgent ? "active-agent" : ""}`,
            oncontextmenu: (/** @type {MouseEvent} */ event) => {
              event.preventDefault();
              state.agentContextMenu = { agentId: agent.id, x: event.clientX, y: event.clientY };
              markDirty("panel");
            },
          },
          h(
            "div",
            { class: `agent-cell ${roles.length > 0 ? "with-role" : ""} ${agentAccounts.length > 0 ? "with-account" : ""}` },
            h(
              "button",
              { class: "agent-main", title: `open @${agent.id} settings`, onclick: () => void openAgentSettings(agent.id) },
              h("span", { class: `dot ${agent.status}` }),
              h(
                "strong",
                {},
                agent.avatarUrl
                  ? h("img", { class: "agent-avatar", src: agent.avatarUrl, alt: agent.displayName || agent.id, loading: "lazy" })
                  : h("span", { class: "agent-icon", text: agent.icon }),
                h("span", { text: `@${agent.id}` }),
              ),
              h("small", {
                // One line, ellipsized when narrow — mirror the full text into
                // title so it stays recoverable on hover.
                title: agentSubtitle(agent, activeAgent),
                text: agentSubtitle(agent, activeAgent),
              }),
              agent.description
                ? h("small", {
                    class: "agent-description",
                    title: agent.description,
                    text: agent.description,
                  })
                : null,
              agent.status === "compacting" && agent.compact ? CompactBar(agent.compact) : null,
            ),
            h(
              "div",
              { class: "agent-config-row" },
              h("input", {
                class: `model-select ${modelValue ? "active" : ""}`,
                list: modelOptionId,
                value: modelValue,
                placeholder: "model",
                title: `model for @${agent.id}: provider/name; blank = default`,
                onchange: (event) => void setAgentConfig(agent.id, { model: /** @type {HTMLInputElement} */ (event.target).value.trim() || null }),
              }),
              h(
                "datalist",
                { id: modelOptionId },
                suggestedModels.map((model) => h("option", { value: model })),
              ),
              agentAccounts.length > 0
                ? h(
                    "select",
                    {
                      class: `account-select ${agent.account ? "active" : ""}`,
                      title: `account for @${agent.id}`,
                      onchange: (event) => void setAgentConfig(agent.id, { account: /** @type {HTMLSelectElement} */ (event.target).value || null }),
                    },
                    h("option", { value: "", text: "shared login", selected: !agent.account }),
                    agentAccounts.map((account) =>
                      h("option", { value: account.id, text: account.label || account.id, selected: account.id === agent.account }),
                    ),
                  )
                : null,
              roles.length > 0
                ? h(
                    "select",
                    {
                      class: `role-select ${effectiveRole ? "active" : ""}`,
                      title: `role for @${agent.id}`,
                      onchange: (event) => void setAgentRole(agent.id, /** @type {HTMLSelectElement} */ (event.target).value),
                    },
                    h("option", {
                      value: "default",
                      text: agent.defaultRole ? `default (${agent.defaultRole})` : "default",
                      selected: !agent.activeRole,
                    }),
                    h("option", { value: "none", text: "none", selected: agent.activeRole === "none" }),
                    roles.map((roleName) => h("option", { value: roleName, text: roleName, selected: roleName === agent.activeRole })),
                  )
                : null,
              agent.activeRole && agent.activeRole !== "none"
                ? h("button", {
                    class: "role-global-button",
                    text: "⌂",
                    title: `make "${agent.activeRole}" the global default for @${agent.id} (all rooms)`,
                    onclick: async () => {
                      const role = agent.activeRole;
                      if (!role) return;
                      await setAgentDefaultRole(agent.id, role);
                      await setAgentRole(agent.id, "default");
                    },
                  })
                : null,
            ),
          ),
          h("button", {
            class: `main-button ${agent.id === activeAgent ? "active" : ""}`,
            title: agent.id === activeAgent ? `@${agent.id} is this room's active agent` : `talk to @${agent.id} in this room`,
            disabled: agent.id === activeAgent,
            onclick: () => void setActiveAgent(agent.id),
            text: agent.id === activeAgent ? "●" : "○",
          }),
          h("button", {
            class: `main-button ${agent.isDefault ? "active" : ""}`,
            title: agent.isDefault
              ? `@${agent.id} is the default agent — it seeds the active agent in a new room`
              : `make @${agent.id} the default agent (seeds new rooms; doesn't change who this room is talking to)`,
            disabled: agent.isDefault,
            onclick: () => void setDefaultAgent(agent.id),
            text: agent.isDefault ? "★" : "☆",
          }),
          h("button", {
            class: `call-button ${onCall ? "active" : ""}`,
            title: onCall ? `hang up @${agent.id}` : `start voice call with @${agent.id}`,
            disabled: connecting || (Boolean(state.voice) && !onCall),
            onclick: () => void toggleCall(agent.id),
            text: connecting ? "..." : onCall ? "⏹" : "📞",
          }),
        );
      }) : []),
        ];
      }),
    ),
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
  // Keep the elapsed advancing between server snapshots while any pass runs.
  armCompactTick(agents.some((agent) => agent.status === "compacting"));
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
