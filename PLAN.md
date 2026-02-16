# AgentHQ — Full End-to-End Implementation Plan

## Product Vision

**AgentHQ** is an AI product team OS — "Cursor for Product Managers". You don't just chat with one AI, you orchestrate a team of AI agents like a real engineering org.

### The Mental Model

| Real World | AgentHQ |
|---|---|
| Product Manager | **PM Chat tab** — Lattice native chat, orchestrates the team |
| Software Engineers | **Agent tabs** — Claude Code, Codex, Gemini etc. running autonomously in terminals |
| Team communication | **Lattice MCP** — PM coordinates agents, reads their output, delegates tasks |
| Office / desk | **Mission** — a git worktree where an agent does their work |

---

## Terminology (Confirmed)

| Old | New | Usage |
|---|---|---|
| **Project** | **HQ** (Headquarters) | Full form "Headquarters" on empty states; "HQ" in compact UI |
| **Workspace** (worktree) | **Mission** | Each agent task/branch within an HQ |
| **New Project** button | **+ New HQ** | ✅ Done |
| **New Workspace** | **New Mission** | ✅ Done |
| **Chat** | **PM Chat** | The orchestrator tab |
| **Terminal** (agent) | **Agent Terminal** | Autonomous agent PTY sessions |

**Status: Terminology rename ✅ COMPLETE**

---

## Current Architecture

```
WorkspaceShell
├── ChatPane (flex-1, left)          ← user talks to Claude here
└── RightSidebar (fixed-width, right)
    └── tabset: [costs | review | terminal | explorer | cluster | models | browser]
```

---

## Target Architecture (All Phases)

```
WorkspaceShell
├── MainArea (flex-1, left)           ← Phase 1
│   ├── TabBar: [ PM Chat ★ | Claude Code | Codex | + ]
│   ├── "chat" tab    → ChatPane (PM orchestrator)
│   └── "terminal:<id>" tab → TerminalView (agent PTY session)
└── WorkspacePanel (fixed-width, right)
    └── tabset: [costs | review | explorer | cluster | models | browser]
        (terminal tab removed — lives in MainArea now)
```

---

---

# PHASE 0 — Terminology & Copy ✅ DONE

All user-facing strings renamed. No logic changes. See git history.

**Files changed:** `ProjectSidebar.tsx`, `sources.ts`, `WorkspaceShell.tsx`, `ArchivedWorkspaces.tsx`, `WorkspaceListItem.tsx`, `SectionHeader.tsx`, `CreationControls.tsx`, `ProjectCreateModal.tsx`

---

---

# PHASE 1 — Tabbed Main Area

**Goal:** Replace the flat `ChatPane` with a tabbed `MainArea` that holds PM Chat + agent terminal tabs side by side.

**No backend changes.** Pure frontend restructure using existing components.

---

## Step 1.1 — Add `"chat"` tab type

**File:** `src/browser/types/rightSidebar.ts`

Add `"chat"` to the `RIGHT_SIDEBAR_TABS` tuple (makes it a valid `TabType` automatically via the `as const` array):

```ts
export const RIGHT_SIDEBAR_TABS = [
  "chat",       // ← NEW: PM Chat tab (main area only)
  "costs",
  "review",
  "terminal",
  "explorer",
  "cluster",
  "models",
  "stats",
  "browser",
] as const;

// Add helper:
export function isChatTab(tab: TabType): boolean {
  return tab === "chat";
}
```

---

## Step 1.2 — Add storage key + default layout for MainArea

**File:** `src/common/constants/storage.ts`

Add one new workspace-scoped key function alongside the existing `getRightSidebarLayoutKey`:

```ts
export const getMainAreaLayoutKey = (workspaceId: string) =>
  `main-area:layout:${workspaceId}`;
```

**File:** `src/browser/utils/rightSidebarLayout.ts`

Add new exported function (analogous to `getDefaultRightSidebarLayoutState`):

```ts
export function getDefaultMainAreaLayoutState(): RightSidebarLayoutState {
  return {
    version: 1,
    nextId: 2,
    focusedTabsetId: "tabset-1",
    root: {
      type: "tabset",
      id: "tabset-1",
      tabs: ["chat"],
      activeTab: "chat",
    },
  };
}
```

Also in the same file — remove `"terminal"` from the RightSidebar defaults (terminals now live in MainArea):

```ts
// Before:
const baseTabs: TabType[] = ["costs", "review", "explorer", "cluster", "models", "browser"];
// (terminal was never in baseTabs — confirm it isn't added dynamically either)
```

> Check: run `grep -n "terminal" src/browser/utils/rightSidebarLayout.ts` to confirm terminal is not in defaults.

---

## Step 1.3 — New `MainArea` component

**New folder:** `src/browser/components/MainArea/`

### `MainArea.tsx`

Props:
```ts
interface MainAreaProps {
  // Identity
  workspaceId: string;
  workspacePath: string;   // namedWorkspacePath
  projectPath: string;
  projectName: string;
  workspaceName: string;
  // ChatPane passthrough
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  runtimeConfig?: RuntimeConfig;
  status?: "creating";
  className?: string;
}
```

Implementation pattern (mirrors RightSidebar):
1. Load layout from `localStorage.getItem(getMainAreaLayoutKey(workspaceId))`
2. Validate with `isRightSidebarLayoutState()`; fall back to `getDefaultMainAreaLayoutState()`
3. Ensure `"chat"` tab always exists — if missing after load, inject it as first tab
4. Keep `agentMeta: Map<sessionId, { slug: CliAgentSlug | "terminal"; label: string }>` in `useState`
5. Expose `addAgent(slug: CliAgentSlug | "terminal")` function:
   - calls `createTerminalSession(api, workspaceId, { initialCommand: slug === "terminal" ? undefined : CLI_AGENT_DEFINITIONS[slug].binaryNames[0] })`
   - stores `{ slug, label: displayName }` in `agentMeta`
   - calls `addTabToFocusedTabset(layout, makeTerminalTabType(sessionId))` and activates it
6. Persist layout changes to localStorage on every state update
7. Render `<MainAreaTabBar>` + tab content panels (keep-alive via `hidden` class)

### `MainAreaTabBar.tsx`

```
[ ⚡ PM Chat ] [ A Claude Code ✕ ] [ ▲ Codex ✕ ] [ + ]
```

Props:
```ts
interface MainAreaTabBarProps {
  layout: RightSidebarLayoutState;
  agentMeta: Map<string, { slug: string; label: string }>;
  onSelectTab: (tab: TabType) => void;
  onCloseTab: (tab: TabType) => void;
  onAddAgent: () => void;
}
```

Rendering:
- `"chat"` tab: Sparkles icon + "PM Chat" label, no close button, always first
- `"terminal:<sessionId>"` tabs: `CliAgentIcon` for slug + label from `agentMeta`, close (✕) button
- `+` button at end → calls `onAddAgent()` to open `AgentPicker`
- Active tab: accent underline / background highlight
- Tabs scrollable horizontally when many agents open

### `AgentPicker.tsx`

Popover that appears on `+` click. Lists all `CLI_AGENT_DEFINITIONS` entries + "Plain Terminal":

```
┌──────────────────────────────────────┐
│  Launch Agent                        │
├──────────────────────────────────────┤
│  [A] Claude Code                     │
│      Anthropic's coding agent  ▶     │
│  [▲] Codex                           │
│      OpenAI CLI coding agent   ▶     │
│  [G] Gemini                          │
│      Google's CLI coding agent ▶     │
│  [⬡] Amp                             │
│      Sourcegraph agent         ▶     │
│  [>_] Plain Terminal                 │
│      Open a bare shell         ▶     │
└──────────────────────────────────────┘
```

Each row is clickable → closes popover → calls `addAgent(slug)`.

Uses `CliAgentIcon` (existing component) for icons.

---

## Step 1.4 — Modify `WorkspaceShell.tsx`

Replace `<ChatPane ... />` with `<MainArea ... />`.

`ChatPane` is now rendered *inside* `MainArea` as the `"chat"` tab. Props passthrough unchanged.

Also: the `addTerminalRef` callback in `WorkspaceShell` currently wires to `RightSidebar`. After this change it should wire to `MainArea.addAgent("terminal")` so `onOpenTerminal` from ChatPane still works.

```ts
// WorkspaceShell: wire addTerminalRef → MainArea
const addAgentRef = useRef<((slug?: string) => void) | null>(null);

// Pass to MainArea:
<MainArea addAgentRef={addAgentRef} ... />

// Keep for ChatPane's onOpenTerminal:
const handleOpenTerminal = useCallback((options?) => {
  addAgentRef.current?.("terminal");
}, []);
```

---

## Step 1.5 — Keep-alive tab rendering in MainArea

```tsx
// Inside MainArea render:
const allTabs = getAllTabsFromLayout(layout);
const activeTab = getActiveTabInFocusedTabset(layout);

{allTabs.map(tab => (
  <div key={tab} className={cn("flex flex-1 overflow-hidden", tab !== activeTab && "hidden")}>
    {isChatTab(tab) && (
      <ChatPane
        workspaceId={workspaceId}
        projectPath={projectPath}
        ...allChatPaneProps
        onOpenTerminal={handleOpenTerminal}
      />
    )}
    {isTerminalTab(tab) && (
      <TerminalTab
        workspaceId={workspaceId}
        tabType={tab}
        visible={tab === activeTab}
        onTitleChange={(title) => handleTerminalTitleChange(tab, title)}
      />
    )}
  </div>
))}
```

---

## Phase 1 File Summary

| File | Action | Description |
|---|---|---|
| `src/browser/types/rightSidebar.ts` | Modify | Add `"chat"` to tab types + `isChatTab()` helper |
| `src/common/constants/storage.ts` | Modify | Add `getMainAreaLayoutKey()` |
| `src/browser/utils/rightSidebarLayout.ts` | Modify | Add `getDefaultMainAreaLayoutState()` |
| `src/browser/components/MainArea/MainArea.tsx` | **New** | Core tabbed main area component |
| `src/browser/components/MainArea/MainAreaTabBar.tsx` | **New** | Tab strip (PM Chat + agent tabs + `+`) |
| `src/browser/components/MainArea/AgentPicker.tsx` | **New** | Popover to launch agent terminals |
| `src/browser/components/WorkspaceShell.tsx` | Modify | Swap `ChatPane` → `MainArea` |

**No backend changes. No new API routes. No schema changes.**

## Phase 1 Verification

- [ ] PM Chat tab always present, active by default
- [ ] `+` button opens AgentPicker popover listing all CLI agents
- [ ] Selecting Claude Code opens a new terminal tab running `claude`
- [ ] Agent process stays alive when switching to PM Chat and back
- [ ] Agent tab shows CliAgentIcon + agent name
- [ ] Close (✕) on agent tab terminates that terminal session
- [ ] RightSidebar tabs (costs, explorer, etc.) work exactly as before
- [ ] Layout persists across page reload (chat tab always injected if missing)
- [ ] ChatPane's "open terminal" action opens a plain terminal tab in MainArea

---

---

# PHASE 2 — Agent Status + Awareness

**Goal:** Make the PM Chat aware of what agents are doing. Show live status on tabs.

---

## Step 2.1 — Agent tab status badges

Each agent tab in `MainAreaTabBar` shows a status badge:

| Badge | Meaning |
|---|---|
| `●` (green pulse) | Agent is running / producing output |
| `✓` (green) | Agent process exited cleanly (exit code 0) |
| `!` (amber) | Agent needs input or hit an error |
| `○` (grey) | Idle / no activity |

**Implementation:** `TerminalView` already emits OSC title-change events (used for terminal tab titles in RightSidebar). Extend this: detect when the PTY process exits via the existing `terminal.onExit` event (add to `TerminalTab` → surface via callback to `MainArea` → stored in `agentMeta`).

**Files:**
- `src/browser/components/MainArea/MainArea.tsx` — add `agentStatus: Map<sessionId, "running" | "done" | "error">` state
- `src/browser/components/MainArea/MainAreaTabBar.tsx` — render status badge per tab
- `src/browser/components/RightSidebar/TerminalTab.tsx` — add `onExit?: (code: number) => void` prop (passes through to `TerminalView`)

---

## Step 2.2 — Mission creation: choose agent at birth

When creating a new Mission (worktree), let the user optionally select which agent will run on it.

**File:** `src/browser/components/ChatInput/CreationControls.tsx`

Add a third dropdown row — **"Agent"** — beside the Runtime dropdown:

```
Row 1: [Mission name input ..................................]
Row 2: [HQ ▾] [Runtime ▾] [Agent ▾]
```

The Agent dropdown options:
- **PM Chat** (default) — opens regular ChatPane on this mission
- **Claude Code** — on mission open, auto-launches claude in an agent tab
- **Codex** — auto-launches codex
- **Gemini** — auto-launches gemini

This does NOT require backend schema changes in Phase 2. The selection is stored in `DraftWorkspaceSettings` (frontend only, like `selectedRuntime`). When the mission is opened for the first time, `MainArea` checks a `pendingAgent` signal and auto-spawns the agent.

**Files:**
- `src/browser/hooks/useDraftWorkspaceSettings.ts` — add `agentSlug?: CliAgentSlug` field
- `src/common/constants/storage.ts` — add `getAgentSlugKey(projectPath)`
- `src/browser/components/ChatInput/CreationControls.tsx` — add `AgentDropdown` component
- `src/browser/components/MainArea/MainArea.tsx` — on first mount, check `pendingAgent` and auto-spawn

---

## Step 2.3 — Child workspace agent tasks (existing system)

The codebase already has `taskStatus`, `taskPrompt`, `agentType`, `agentId` fields in `WorkspaceMetadataSchema`. These power the existing "child workspace / agent task" system.

Phase 2 connects this to MainArea: when a workspace has `agentType` set and `taskStatus === "running"`, MainArea auto-opens an agent terminal tab for it instead of showing the ChatPane.

**Files:**
- `src/browser/components/MainArea/MainArea.tsx` — check `workspaceMetadata.agentType` on mount

---

## Phase 2 File Summary

| File | Action | Description |
|---|---|---|
| `src/browser/components/MainArea/MainArea.tsx` | Modify | Add agent status map + auto-spawn on mount |
| `src/browser/components/MainArea/MainAreaTabBar.tsx` | Modify | Render status badges |
| `src/browser/components/RightSidebar/TerminalTab.tsx` | Modify | Add `onExit` callback |
| `src/browser/hooks/useDraftWorkspaceSettings.ts` | Modify | Add `agentSlug` field |
| `src/common/constants/storage.ts` | Modify | Add `getAgentSlugKey()` |
| `src/browser/components/ChatInput/CreationControls.tsx` | Modify | Add Agent dropdown |

---

---

# PHASE 3 — PM ↔ Agent Orchestration (MCP)

**Goal:** PM Chat can delegate tasks to agents and receive status updates back — closing the loop between the PM orchestrator and its subordinate agents.

---

## Step 3.1 — PM → Agent: "Delegate" action

In the PM Chat, add a slash command or quick action: `/delegate`

Flow:
1. User types `/delegate fix the auth bug` in PM Chat
2. PM Chat creates a new Mission (calls `api.workspace.create`) with `taskPrompt = "fix the auth bug"`
3. Opens the new mission in a new browser tab (or navigates to it)
4. In that mission, MainArea auto-spawns the selected agent with the prompt piped to its stdin

**Implementation:**
- PM Chat detects `/delegate <task>` in the input
- Calls `api.workspace.create({ projectPath, taskPrompt, agentSlug })`
- Backend: persist `taskPrompt` + `agentSlug` in workspace metadata (already has `taskPrompt` field)
- When that workspace opens, `MainArea` reads `metadata.taskPrompt` → passes as `initialCommand` suffix to `createTerminalSession`

**Files:**
- `src/browser/components/ChatInput/` — detect `/delegate` command
- `src/node/orpc/router.ts` — accept `agentSlug` in `workspace.create` input (minor schema addition)
- `src/browser/components/MainArea/MainArea.tsx` — read `taskPrompt` from metadata and auto-spawn

---

## Step 3.2 — Agent → PM: progress via Lattice MCP

Lattice already has an MCP server. Agents (Claude Code etc.) can call MCP tools.

Add new MCP tools the PM Chat subscribes to:

| Tool | Payload | PM Chat shows |
|---|---|---|
| `agent.progress` | `{ workspaceId, message }` | Inline update bubble in PM Chat |
| `agent.complete` | `{ workspaceId, summary, diff }` | "Agent finished" card with diff link |
| `agent.needs_input` | `{ workspaceId, question }` | Prompt user to switch to that agent tab |

**Files:**
- `src/node/mcp/` — add new tool handlers
- `src/browser/components/ChatPane/` — render agent update bubbles in message list
- `src/browser/components/MainArea/MainAreaTabBar.tsx` — pulse badge on `needs_input`

---

## Step 3.3 — PM model choice (user-facing)

The model picker in CreationControls already governs what model powers the PM Chat.

Phase 3 makes this explicit in the UI — rename "Model" label to "PM Model" and add a tooltip: *"This model orchestrates your agent team"*.

**File:** `src/browser/components/ChatInput/CreationControls.tsx`

---

## Phase 3 File Summary

| File | Action | Description |
|---|---|---|
| `src/node/orpc/router.ts` | Modify | Accept `agentSlug` in `workspace.create` |
| `src/node/mcp/` | Modify | Add `agent.progress`, `agent.complete`, `agent.needs_input` tools |
| `src/browser/components/ChatPane/` | Modify | Render agent update message bubbles |
| `src/browser/components/MainArea/MainArea.tsx` | Modify | Read `taskPrompt`, auto-delegate |
| `src/browser/components/ChatInput/CreationControls.tsx` | Modify | Rename model label to "PM Model" |

---

---

# PHASE 4 — AgentHQ Branding & Product Polish

**Goal:** Ship it as AgentHQ. Remove remaining Lattice-internal terminology from user-facing surfaces.

---

## Step 4.1 — App title + logo

- Browser tab title: **"AgentHQ"** (currently "Lattice Workbench")
- Sidebar logo: replace LatticeLogo with AgentHQ wordmark / icon
- `package.json` → `name: "agenthq"`, `productName: "AgentHQ"`

**Files:**
- `index.html` — `<title>AgentHQ</title>`
- `src/browser/components/ProjectSidebar.tsx` — swap `<LatticeLogo>` for AgentHQ icon
- `electron/main.ts` (if Electron) — `BrowserWindow` title

---

## Step 4.2 — Onboarding flow

When a new user opens AgentHQ with no HQs configured, show an onboarding screen:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│         ⚡ Welcome to AgentHQ                           │
│                                                         │
│   Your AI product team, ready to build.                 │
│                                                         │
│   1. Add a Headquarters (your codebase)                 │
│   2. Start a Mission (branch + task)                    │
│   3. Launch agents (Claude Code, Codex, Gemini...)      │
│   4. Coordinate from PM Chat                            │
│                                                         │
│              [ Add your first HQ → ]                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**File:** `src/browser/components/splashScreens/` — new `AgentHQWelcomeSplash.tsx` replacing or augmenting existing splash

---

## Step 4.3 — Section labels in right panel

Rename right panel section headers to match new vocabulary:
- "Costs" → **"Spend"** (more PM-friendly)
- "Cluster" → **"Team"** (agents = team members)
- "Models" → **"PM Model"**
- "Review" → **"Review"** (keep)
- "Explorer" → **"Files"** (simpler)
- "Browser" → **"Browser"** (keep)

**File:** `src/browser/components/RightSidebar.tsx` — tab label map

---

## Phase 4 File Summary

| File | Action | Description |
|---|---|---|
| `index.html` | Modify | App title → "AgentHQ" |
| `src/browser/components/ProjectSidebar.tsx` | Modify | Swap logo |
| `src/browser/components/splashScreens/AgentHQWelcomeSplash.tsx` | **New** | Welcome / onboarding screen |
| `src/browser/components/RightSidebar.tsx` | Modify | Rename right panel tab labels |

---

---

# Full Roadmap Summary

| Phase | Name | Scope | Backend? | Status |
|---|---|---|---|---|
| **0** | Terminology rename | UI copy only | No | ✅ Done |
| **1** | Tabbed MainArea | Frontend restructure | No | 🔲 Next |
| **2** | Agent status + mission agent selection | Frontend | Minimal | 🔲 |
| **3** | PM ↔ Agent orchestration via MCP | Full-stack | Yes | 🔲 |
| **4** | AgentHQ branding + onboarding | Frontend | No | 🔲 |

---

# Phase 1 Implementation Order (Step by Step)

When ready to implement Phase 1, execute in this exact order:

1. `rightSidebar.ts` — add `"chat"` + `isChatTab()`
2. `storage.ts` — add `getMainAreaLayoutKey()`
3. `rightSidebarLayout.ts` — add `getDefaultMainAreaLayoutState()`
4. Create `src/browser/components/MainArea/AgentPicker.tsx`
5. Create `src/browser/components/MainArea/MainAreaTabBar.tsx`
6. Create `src/browser/components/MainArea/MainArea.tsx`
7. Modify `WorkspaceShell.tsx` — swap ChatPane for MainArea
8. Verify build compiles clean: `bun run build`
9. Run dev: `bun run dev` and manually verify all checkboxes above
