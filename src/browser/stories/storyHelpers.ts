/**
 * Shared story setup helpers to reduce boilerplate.
 *
 * These helpers encapsulate common patterns used across multiple stories,
 * making each story file more focused on the specific visual state being tested.
 */

import type { AgentSkillDescriptor, AgentSkillIssue } from "@/common/types/agentSkill";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type {
  MinionChatMessage,
  ChatLatticeMessage,
  ProvidersConfigMap,
  MinionStatsSnapshot,
} from "@/common/orpc/types";
import type { LatticeMessage } from "@/common/types/message";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { APIClient } from "@/browser/contexts/API";
import {
  SELECTED_MINION_KEY,
  EXPANDED_PROJECTS_KEY,
  WORKBENCH_PANEL_COLLAPSED_KEY,
  getInputKey,
  getModelKey,
  getReviewsKey,
  getHunkFirstSeenKey,
  REVIEW_SORT_ORDER_KEY,
  MINION_DRAFTS_BY_PROJECT_KEY,
  getDraftScopeId,
  getMinionNameStateKey,
} from "@/common/constants/storage";
import type { ReviewSortOrder } from "@/common/types/review";
import type { HunkFirstSeenState } from "@/browser/hooks/useHunkFirstSeen";
import { updatePersistedState } from "@/browser/hooks/usePersistedState";
import type { Review, ReviewsState } from "@/common/types/review";
import { DEFAULT_MODEL } from "@/common/constants/knownModels";
import {
  createMinion,
  groupMinionsByProject,
  createStaticChatHandler,
  createStreamingChatHandler,
  createGitStatusOutput,
  type GitStatusFixture,
} from "./mockFactory";
import { createMockORPCClient, type MockSessionUsage } from "@/browser/stories/mocks/orpc";

// ═══════════════════════════════════════════════════════════════════════════════
// MINION SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** Set localStorage to select a minion */
export function selectMinion(minion: FrontendMinionMetadata): void {
  localStorage.setItem(
    SELECTED_MINION_KEY,
    JSON.stringify({
      minionId: minion.id,
      projectPath: minion.projectPath,
      projectName: minion.projectName,
      namedMinionPath: minion.namedMinionPath,
    })
  );
}

/** Clear minion selection from localStorage (for sidebar-focused stories) */
export function clearMinionSelection(): void {
  localStorage.removeItem(SELECTED_MINION_KEY);
}

/** Set input text for a minion */
export function setMinionInput(minionId: string, text: string): void {
  localStorage.setItem(getInputKey(minionId), JSON.stringify(text));
}

/** Set model for a minion */
export function setMinionModel(minionId: string, model: string): void {
  localStorage.setItem(getModelKey(minionId), model);
}

/** Expand projects in the sidebar */
export function expandProjects(projectPaths: string[]): void {
  localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify(projectPaths));
}

/** Collapse the workbench panel (default for most stories) */
export function collapseWorkbenchPanel(): void {
  localStorage.setItem(WORKBENCH_PANEL_COLLAPSED_KEY, JSON.stringify(true));
}

/** Expand the workbench panel (for stories testing it) */
export function expandWorkbenchPanel(): void {
  localStorage.setItem(WORKBENCH_PANEL_COLLAPSED_KEY, JSON.stringify(false));
}

/** Set reviews for a minion */
export function setReviews(minionId: string, reviews: Review[]): void {
  const state: ReviewsState = {
    minionId,
    reviews: Object.fromEntries(reviews.map((r) => [r.id, r])),
    lastUpdated: Date.now(),
  };
  updatePersistedState(getReviewsKey(minionId), state);
}

/** Set hunk first-seen timestamps for a minion (for storybook) */
export function setHunkFirstSeen(minionId: string, firstSeen: Record<string, number>): void {
  const state: HunkFirstSeenState = { firstSeen };
  updatePersistedState(getHunkFirstSeenKey(minionId), state);
}

/** Set the review panel sort order (global) */
export function setReviewSortOrder(order: ReviewSortOrder): void {
  localStorage.setItem(REVIEW_SORT_ORDER_KEY, JSON.stringify(order));
}

/** Create a sample review for stories */
// ═══════════════════════════════════════════════════════════════════════════════
// MINION DRAFTS
// ═══════════════════════════════════════════════════════════════════════════════

export interface MinionDraftFixture {
  draftId: string;
  /** Optional: crew ID the draft belongs to */
  crewId?: string | null;
  /** Optional: draft prompt text */
  prompt?: string;
  /** Optional: minion name (either manual or generated) */
  minionName?: string;
  /** Optional: timestamp for sorting */
  createdAt?: number;
}

/**
 * Set minion drafts for a project in localStorage.
 * This seeds the sidebar with UI-only draft placeholders.
 */
export function setMinionDrafts(projectPath: string, drafts: MinionDraftFixture[]): void {
  // Set the drafts index
  const draftsByProject = JSON.parse(
    localStorage.getItem(MINION_DRAFTS_BY_PROJECT_KEY) ?? "{}"
  ) as Record<string, Array<{ draftId: string; crewId?: string | null; createdAt?: number }>>;

  draftsByProject[projectPath] = drafts.map((d) => ({
    draftId: d.draftId,
    crewId: d.crewId,
    createdAt: d.createdAt ?? Date.now(),
  }));

  localStorage.setItem(MINION_DRAFTS_BY_PROJECT_KEY, JSON.stringify(draftsByProject));

  // Set individual draft data (prompt and name)
  for (const draft of drafts) {
    const scopeId = getDraftScopeId(projectPath, draft.draftId);

    // Set prompt if provided
    if (draft.prompt !== undefined) {
      localStorage.setItem(getInputKey(scopeId), JSON.stringify(draft.prompt));
    }

    // Set minion name state if provided
    if (draft.minionName !== undefined) {
      const nameState = {
        autoGenerate: false,
        manualName: draft.minionName,
      };
      localStorage.setItem(getMinionNameStateKey(scopeId), JSON.stringify(nameState));
    }
  }
}

export function createReview(
  id: string,
  filePath: string,
  lineRange: string,
  note: string,
  status: "pending" | "attached" | "checked" = "pending",
  createdAt?: number
): Review {
  return {
    id,
    data: {
      filePath,
      lineRange,
      selectedCode: "// sample code",
      userNote: note,
    },
    status,
    createdAt: createdAt ?? Date.now(),
    statusChangedAt: status === "checked" ? Date.now() : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GIT STATUS/DIFF EXECUTOR
// ═══════════════════════════════════════════════════════════════════════════════

export interface GitDiffFixture {
  /** The raw unified diff output */
  diffOutput: string;
  /** The numstat output (additions, deletions per file) */
  numstatOutput?: string;
  /** File contents for read-more feature (path -> full file content as lines) */
  fileContents?: Map<string, string[]>;
  /** List of untracked files (for UntrackedStatus banner) */
  untrackedFiles?: string[];
}

// Default mock file tree for explorer stories
// Mock ls output - order doesn't matter, parseLsOutput sorts the result
const DEFAULT_LS_OUTPUT = `total 40
drwxr-xr-x  5 user group  160 Jan 15 10:00 .
drwxr-xr-x  3 user group   96 Jan 15 10:00 ..
drwxr-xr-x 10 user group  320 Jan 15 10:00 node_modules
drwxr-xr-x  3 user group   96 Jan 15 10:00 src
drwxr-xr-x  2 user group   64 Jan 15 10:00 tests
-rw-r--r--  1 user group  128 Jan 15 10:00 README.md
-rw-r--r--  1 user group 1024 Jan 15 10:00 package.json
-rw-r--r--  1 user group  256 Jan 15 10:00 tsconfig.json`;

const DEFAULT_SRC_LS_OUTPUT = `total 24
drwxr-xr-x  3 user group   96 Jan 15 10:00 .
drwxr-xr-x  5 user group  160 Jan 15 10:00 ..
drwxr-xr-x  2 user group   64 Jan 15 10:00 components
-rw-r--r--  1 user group  256 Jan 15 10:00 App.tsx
-rw-r--r--  1 user group  512 Jan 15 10:00 index.ts`;

/**
 * Creates an executeBash function that returns git status and diff output for minions.
 * Handles: git status, git diff, git diff --numstat, git show (for read-more),
 * git ls-files --others (for untracked files), ls -la (for file explorer), git check-ignore
 */
export function createGitStatusExecutor(
  gitStatus?: Map<string, GitStatusFixture>,
  gitDiff?: Map<string, GitDiffFixture>
) {
  return (minionId: string, script: string) => {
    // Handle ls -la for file explorer
    if (script.startsWith("ls -la")) {
      // Check if it's the root or a subdirectory
      const isRoot = script === "ls -la ." || script === "ls -la";
      const output = isRoot ? DEFAULT_LS_OUTPUT : DEFAULT_SRC_LS_OUTPUT;
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    // Handle git check-ignore for empty ignored directories
    if (script.includes("git check-ignore")) {
      // Return node_modules as ignored if it's in the input
      const output = script.includes("node_modules") ? "node_modules" : "";
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    if (script.includes("git status")) {
      const status = gitStatus?.get(minionId) ?? {};
      // For git status --ignored --porcelain, add !! node_modules to mark it as ignored
      let output = createGitStatusOutput(status);
      if (script.includes("--ignored")) {
        output = output ? `${output}\n!! node_modules/` : "!! node_modules/";
      }
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    // Handle git ls-files --others (untracked files)
    if (script.includes("git ls-files --others")) {
      const diff = gitDiff?.get(minionId);
      const output = diff?.untrackedFiles?.join("\n") ?? "";
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    // Handle git diff --numstat
    if (script.includes("git diff") && script.includes("--numstat")) {
      const diff = gitDiff?.get(minionId);
      const output = diff?.numstatOutput ?? "";
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    // Handle git diff (regular diff output)
    if (script.includes("git diff")) {
      const diff = gitDiff?.get(minionId);
      const output = diff?.diffOutput ?? "";
      return Promise.resolve({ success: true as const, output, exitCode: 0, wall_duration_ms: 50 });
    }

    // Handle git show for read-more feature (e.g., git show "HEAD:file.ts" | sed -n '1,20p')
    const gitShowMatch = /git show "[^:]+:([^"]+)"/.exec(script);
    const sedMatch = /sed -n '(\d+),(\d+)p'/.exec(script);
    if (gitShowMatch && sedMatch) {
      const filePath = gitShowMatch[1];
      const startLine = parseInt(sedMatch[1], 10);
      const endLine = parseInt(sedMatch[2], 10);
      const diff = gitDiff?.get(minionId);
      const lines = diff?.fileContents?.get(filePath);
      if (lines) {
        // sed uses 1-based indexing
        const output = lines.slice(startLine - 1, endLine).join("\n");
        return Promise.resolve({
          success: true as const,
          output,
          exitCode: 0,
          wall_duration_ms: 50,
        });
      }
    }

    return Promise.resolve({
      success: true as const,
      output: "",
      exitCode: 0,
      wall_duration_ms: 0,
    });
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT HANDLER ADAPTER
// ═══════════════════════════════════════════════════════════════════════════════

export type ChatHandler = (callback: (event: MinionChatMessage) => void) => () => void;

/** Adapts callback-based chat handlers to ORPC onChat format */
export function createOnChatAdapter(chatHandlers: Map<string, ChatHandler>) {
  return (minionId: string, emit: (msg: MinionChatMessage) => void) => {
    const handler = chatHandlers.get(minionId);
    if (handler) {
      return handler(emit);
    }
    // Default: emit caught-up immediately. Modern backends include hasOlderHistory
    // on full replays; default to false in stories to avoid phantom pagination UI.
    queueMicrotask(() => emit({ type: "caught-up", hasOlderHistory: false }));
    return undefined;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMPLE CHAT STORY SETUP
// ═══════════════════════════════════════════════════════════════════════════════

export interface BackgroundProcessFixture {
  id: string;
  pid: number;
  script: string;
  displayName?: string;
  startTime: number;
  status: "running" | "exited" | "killed" | "failed";
  exitCode?: number;
}

export interface SimpleChatSetupOptions {
  minionId?: string;
  minionName?: string;
  projectName?: string;
  projectPath?: string;
  messages: ChatLatticeMessage[];
  gitStatus?: GitStatusFixture;
  /** Git diff output for Review tab */
  gitDiff?: GitDiffFixture;
  providersConfig?: ProvidersConfigMap;
  backgroundProcesses?: BackgroundProcessFixture[];
  /** Session usage data for Costs tab */
  statsTabEnabled?: boolean;
  sessionUsage?: MockSessionUsage;
  /** Mock transcripts for minion.getSidekickTranscript (taskId -> persisted transcript response). */
  sidekickTranscripts?: Map<
    string,
    { messages: LatticeMessage[]; model?: string; thinkingLevel?: ThinkingLevel }
  >;
  /** Optional custom chat handler for emitting additional events (e.g., queued-message-changed) */
  onChat?: (minionId: string, emit: (msg: MinionChatMessage) => void) => void;
  /** Idle compaction hours for context meter (null = disabled) */
  idleCompactionHours?: number | null;
  /** Override signing capabilities (for testing warning states) */
  signingCapabilities?: {
    publicKey: string | null;
    githubUser: string | null;
    error: { message: string; hasEncryptedKey: boolean } | null;
  };
  /** Custom executeBash mock (for file viewer stories) */
  executeBash?: (
    minionId: string,
    script: string
  ) => Promise<{ success: true; output: string; exitCode: number; wall_duration_ms: number }>;
  /** Available agent skills for the project */
  agentSkills?: AgentSkillDescriptor[];
  /** Agent skills that were discovered but couldn't be loaded (SKILL.md parse errors, etc.) */
  invalidAgentSkills?: AgentSkillIssue[];
  /** Mock log entries for Output tab */
  logEntries?: Array<{
    timestamp: number;
    level: "error" | "warn" | "info" | "debug";
    message: string;
    location: string;
  }>;
  /** Mock clearLogs result */
  clearLogsResult?: { success: boolean; error?: string | null };
}

/**
 * Setup a simple chat story with one minion and messages.
 * Returns an APIClient configured with the mock data.
 */
export function setupSimpleChatStory(opts: SimpleChatSetupOptions): APIClient {
  const minionId = opts.minionId ?? "ws-chat";
  const projectName = opts.projectName ?? "my-app";
  const projectPath = opts.projectPath ?? `/home/user/projects/${projectName}`;
  const minions = [
    createMinion({
      id: minionId,
      name: opts.minionName ?? "feature",
      projectName,
      projectPath,
    }),
  ];

  const chatHandlers = new Map([[minionId, createStaticChatHandler(opts.messages)]]);
  const gitStatus = opts.gitStatus
    ? new Map<string, GitStatusFixture>([[minionId, opts.gitStatus]])
    : undefined;
  const gitDiff = opts.gitDiff
    ? new Map<string, GitDiffFixture>([[minionId, opts.gitDiff]])
    : undefined;

  // Set localStorage for minion selection and collapse workbench panel by default
  selectMinion(minions[0]);
  collapseWorkbenchPanel();

  // Set up background processes map
  const bgProcesses = opts.backgroundProcesses
    ? new Map([[minionId, opts.backgroundProcesses]])
    : undefined;

  // Set up session usage map
  const sessionUsageMap = opts.sessionUsage
    ? new Map([[minionId, opts.sessionUsage]])
    : undefined;

  // Set up idle compaction hours map
  const idleCompactionHours =
    opts.idleCompactionHours !== undefined
      ? new Map([[projectPath, opts.idleCompactionHours]])
      : undefined;

  // Create onChat handler that combines static messages with custom handler
  const baseOnChat = createOnChatAdapter(chatHandlers);
  const onChat = opts.onChat
    ? (wsId: string, emit: (msg: MinionChatMessage) => void) => {
        const cleanup = baseOnChat(wsId, emit);
        opts.onChat!(wsId, emit);
        return cleanup;
      }
    : baseOnChat;

  // Compose executeBash: use custom if provided, otherwise fall back to git status executor
  const gitStatusExecutor = createGitStatusExecutor(gitStatus, gitDiff);
  const executeBash = opts.executeBash
    ? async (wsId: string, script: string) => {
        // Try custom handler first, fall back to git status executor
        const customResult = await opts.executeBash!(wsId, script);
        if (customResult.output || customResult.exitCode !== 0) {
          return customResult;
        }
        // Fall back to git status executor for git commands
        return gitStatusExecutor(wsId, script);
      }
    : gitStatusExecutor;

  // Return ORPC client
  return createMockORPCClient({
    projects: groupMinionsByProject(minions),
    minions,
    onChat,
    executeBash,
    providersConfig: opts.providersConfig,
    backgroundProcesses: bgProcesses,
    statsTabVariant: opts.statsTabEnabled ? "stats" : "control",
    sessionUsage: sessionUsageMap,
    sidekickTranscripts: opts.sidekickTranscripts,
    idleCompactionHours,
    signingCapabilities: opts.signingCapabilities,
    agentSkills: opts.agentSkills,
    invalidAgentSkills: opts.invalidAgentSkills,
    logEntries: opts.logEntries,
    clearLogsResult: opts.clearLogsResult,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAMING CHAT STORY SETUP
// ═══════════════════════════════════════════════════════════════════════════════

export interface StreamingChatSetupOptions {
  minionId?: string;
  minionName?: string;
  projectName?: string;
  messages: ChatLatticeMessage[];
  streamingMessageId: string;
  model?: string;
  historySequence: number;
  streamText?: string;
  pendingTool?: { toolCallId: string; toolName: string; args: object };
  gitStatus?: GitStatusFixture;
  statsTabEnabled?: boolean;
}

/**
 * Setup a streaming chat story with active streaming state.
 * Returns an APIClient configured with the mock data.
 */
export function setupStreamingChatStory(opts: StreamingChatSetupOptions): APIClient {
  const minionId = opts.minionId ?? "ws-streaming";
  const minions = [
    createMinion({
      id: minionId,
      name: opts.minionName ?? "feature",
      projectName: opts.projectName ?? "my-app",
    }),
  ];

  const chatHandlers = new Map([
    [
      minionId,
      createStreamingChatHandler({
        messages: opts.messages,
        streamingMessageId: opts.streamingMessageId,
        model: opts.model ?? DEFAULT_MODEL,
        historySequence: opts.historySequence,
        streamText: opts.streamText,
        pendingTool: opts.pendingTool,
      }),
    ],
  ]);

  const gitStatus = opts.gitStatus
    ? new Map<string, GitStatusFixture>([[minionId, opts.gitStatus]])
    : undefined;

  // Set localStorage for minion selection and collapse workbench panel by default
  selectMinion(minions[0]);
  collapseWorkbenchPanel();

  const minionStatsSnapshots = new Map<string, MinionStatsSnapshot>();
  if (opts.statsTabEnabled) {
    minionStatsSnapshots.set(minionId, {
      minionId,
      generatedAt: Date.now(),
      active: {
        messageId: opts.streamingMessageId,
        model: "openai:gpt-4o",
        elapsedMs: 2000,
        ttftMs: 200,
        toolExecutionMs: 0,
        modelTimeMs: 2000,
        streamingMs: 1800,
        outputTokens: 100,
        reasoningTokens: 0,
        liveTokenCount: 100,
        liveTPS: 50,
        invalid: false,
        anomalies: [],
      },
      session: {
        totalDurationMs: 0,
        totalToolExecutionMs: 0,
        totalStreamingMs: 0,
        totalTtftMs: 0,
        ttftCount: 0,
        responseCount: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        byModel: {},
      },
    });
  }

  // Return ORPC client
  return createMockORPCClient({
    projects: groupMinionsByProject(minions),
    minions,
    onChat: createOnChatAdapter(chatHandlers),
    executeBash: createGitStatusExecutor(gitStatus),
    minionStatsSnapshots,
    statsTabVariant: opts.statsTabEnabled ? "stats" : "control",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOM CHAT HANDLER SETUP
// ═══════════════════════════════════════════════════════════════════════════════

export interface CustomChatSetupOptions {
  minionId?: string;
  minionName?: string;
  projectName?: string;
  providersConfig?: ProvidersConfigMap;
  chatHandler: ChatHandler;
}

/**
 * Setup a chat story with a custom chat handler for special scenarios
 * (e.g., stream errors, custom message sequences).
 * Returns an APIClient configured with the mock data.
 */
export function setupCustomChatStory(opts: CustomChatSetupOptions): APIClient {
  const minionId = opts.minionId ?? "ws-custom";
  const minions = [
    createMinion({
      id: minionId,
      name: opts.minionName ?? "feature",
      projectName: opts.projectName ?? "my-app",
    }),
  ];

  const chatHandlers = new Map([[minionId, opts.chatHandler]]);

  // Set localStorage for minion selection and collapse workbench panel by default
  selectMinion(minions[0]);
  collapseWorkbenchPanel();

  // Return ORPC client
  return createMockORPCClient({
    projects: groupMinionsByProject(minions),
    minions,
    onChat: createOnChatAdapter(chatHandlers),
    providersConfig: opts.providersConfig,
  });
}
