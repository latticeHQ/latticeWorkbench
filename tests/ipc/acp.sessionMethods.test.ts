import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import type { OnChatMode, MinionChatMessage } from "../../src/common/orpc/types";
import { LatticeAgent } from "../../src/node/acp/agent";
import type { ORPCClient, ServerConnection } from "../../src/node/acp/serverConnection";

type WorkspaceInfo = NonNullable<Awaited<ReturnType<ORPCClient["minion"]["getInfo"]>>>;
type WorkspaceActivityById = Awaited<ReturnType<ORPCClient["minion"]["activity"]["list"]>>;

interface HarnessOptions {
  activeWorkspaces?: WorkspaceInfo[];
  archivedWorkspaces?: WorkspaceInfo[];
  workspaceActivity?: WorkspaceActivityById;
  onChatEvents?: MinionChatMessage[];
  onChatStream?: AsyncIterable<MinionChatMessage>;
  agentOptions?: ConstructorParameters<typeof LatticeAgent>[2];
}

interface Harness {
  agent: LatticeAgent;
  onChatCalls: Array<{ minionId: string; mode?: OnChatMode }>;
  listCalls: Array<{ archived?: boolean } | undefined>;
}

function createInMemoryAcpStream() {
  return ndJsonStream(new WritableStream<Uint8Array>({}), new ReadableStream<Uint8Array>());
}

function createWorkspaceInfo(overrides?: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: "ws-default",
    name: "ws-default",
    title: "Default workspace",
    projectName: "project",
    projectPath: "/repo/default",
    runtimeConfig: { type: "local" },
    namedMinionPath: "/repo/default",
    agentId: "exec",
    aiSettings: {
      model: "anthropic:claude-sonnet-4-5",
      thinkingLevel: "medium",
    },
    aiSettingsByAgent: {
      exec: {
        model: "anthropic:claude-sonnet-4-5",
        thinkingLevel: "medium",
      },
    },
    ...overrides,
  };
}

function createHarness(options?: HarnessOptions): Harness {
  const activeWorkspaces = options?.activeWorkspaces ?? [createWorkspaceInfo()];
  const archivedWorkspaces = options?.archivedWorkspaces ?? [];
  const workspaceActivity = options?.workspaceActivity ?? {};
  const onChatEvents = options?.onChatEvents ?? [];
  const sharedOnChatStream = options?.onChatStream;

  const allWorkspacesById = new Map<string, WorkspaceInfo>();
  for (const workspace of [...activeWorkspaces, ...archivedWorkspaces]) {
    allWorkspacesById.set(workspace.id, workspace);
  }

  const onChatCalls: Array<{ minionId: string; mode?: OnChatMode }> = [];
  const listCalls: Array<{ archived?: boolean } | undefined> = [];

  const client: Partial<ORPCClient> = {
    minion: {
      list: async (input?: { archived?: boolean }) => {
        listCalls.push(input);
        return input?.archived ? archivedWorkspaces : activeWorkspaces;
      },
      activity: {
        list: async () => workspaceActivity,
      },
      getInfo: async ({ minionId }: { minionId: string }) =>
        allWorkspacesById.get(minionId) ?? null,
      onChat: async (input: { minionId: string; mode?: OnChatMode }) => {
        onChatCalls.push(input);
        return sharedOnChatStream ?? createChatStream(onChatEvents);
      },
    } as ORPCClient["minion"],
    agentSkills: {
      list: async () => [],
      listDiagnostics: async () => {
        throw new Error("createHarness: listDiagnostics not implemented for this test");
      },
      get: async () => {
        throw new Error("createHarness: get not implemented for this test");
      },
    } as ORPCClient["agentSkills"],
  };

  const server: ServerConnection = {
    client: client as ORPCClient,
    baseUrl: "ws://127.0.0.1:1234",
    close: async () => undefined,
  };

  let agentInstance: LatticeAgent | null = null;
  // Use a real ACP connection instead of casting a hand-rolled stub to
  // AgentSideConnection. This keeps the test harness type-safe and exercises
  // the same connection surface LatticeAgent uses in production.
  const _connection = new AgentSideConnection((connectionToAgent) => {
    const createdAgent = new LatticeAgent(connectionToAgent, server, options?.agentOptions);
    agentInstance = createdAgent;
    return createdAgent;
  }, createInMemoryAcpStream());
  void _connection;

  if (agentInstance == null) {
    throw new Error("createHarness: failed to construct LatticeAgent");
  }

  return {
    agent: agentInstance,
    onChatCalls,
    listCalls,
  };
}

async function* createChatStream(
  events: MinionChatMessage[]
): AsyncIterable<MinionChatMessage> {
  for (const event of events) {
    yield event;
  }
}

function createNeverEndingChatStream(
  seedEvents: MinionChatMessage[] = []
): AsyncIterable<MinionChatMessage> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<MinionChatMessage> {
      for (const event of seedEvents) {
        yield event;
      }

      while (true) {
        // Keep stream open to simulate an existing active subscription while
        // still yielding to iterator.return() shutdown in cleanup paths.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
  };
}
describe("ACP unstable session support", () => {
  it("advertises unstable list/fork/resume session capabilities", async () => {
    const harness = createHarness();

    const response = await harness.agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
    });

    expect(response.agentCapabilities?.loadSession).toBe(true);
    expect(response.agentCapabilities?.sessionCapabilities?.fork).toEqual({});
    expect(response.agentCapabilities?.sessionCapabilities?.list).toEqual({});
    expect(response.agentCapabilities?.sessionCapabilities?.resume).toEqual({});
  });

  it("lists sessions with cwd filtering and cursor pagination", async () => {
    const repoARecency = Date.parse("2026-02-18T10:00:00.000Z");
    const repoAArchivedRecency = Date.parse("2026-02-17T10:00:00.000Z");
    const repoBRecency = Date.parse("2026-02-16T10:00:00.000Z");

    const wsA = createWorkspaceInfo({
      id: "ws-a",
      name: "feature-a",
      title: "Feature A",
      projectPath: "/repo/a",
      namedMinionPath: "/repo/a/.lattice/feature-a",
    });
    const wsB = createWorkspaceInfo({
      id: "ws-b",
      name: "feature-b",
      title: "Feature B",
      projectPath: "/repo/b",
      namedMinionPath: "/repo/b/.lattice/feature-b",
    });
    const wsArchived = createWorkspaceInfo({
      id: "ws-archived",
      name: "archived-a",
      title: "Archived A",
      projectPath: "/repo/a",
      namedMinionPath: "/repo/a/.lattice/archived-a",
      archivedAt: "2026-02-17T12:00:00.000Z",
    });

    const harness = createHarness({
      activeWorkspaces: [wsA, wsB],
      archivedWorkspaces: [wsArchived],
      workspaceActivity: {
        "ws-a": {
          recency: repoARecency,
          streaming: false,
          lastModel: "anthropic:claude-sonnet-4-5",
          lastThinkingLevel: "medium",
        },
        "ws-b": {
          recency: repoBRecency,
          streaming: false,
          lastModel: "anthropic:claude-sonnet-4-5",
          lastThinkingLevel: "medium",
        },
        "ws-archived": {
          recency: repoAArchivedRecency,
          streaming: false,
          lastModel: "anthropic:claude-sonnet-4-5",
          lastThinkingLevel: "medium",
        },
      },
    });

    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    const firstPage = await harness.agent.unstable_listSessions({
      cwd: "/repo/a/",
    });

    expect(firstPage.nextCursor).toBeUndefined();
    expect(firstPage.sessions.map((session) => session.sessionId)).toEqual(["ws-a", "ws-archived"]);
    expect(firstPage.sessions.map((session) => session.cwd)).toEqual(["/repo/a", "/repo/a"]);
    expect(firstPage.sessions.map((session) => session.updatedAt)).toEqual([
      new Date(repoARecency).toISOString(),
      new Date(repoAArchivedRecency).toISOString(),
    ]);

    const secondPage = await harness.agent.unstable_listSessions({
      cwd: "/repo/a/",
      cursor: "1",
    });

    expect(secondPage.sessions.map((session) => session.sessionId)).toEqual(["ws-archived"]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(harness.listCalls.slice(0, 2)).toEqual([{ archived: false }, { archived: true }]);
  });

  it("rejects invalid list cursor values", async () => {
    const harness = createHarness();
    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    await expect(
      harness.agent.unstable_listSessions({
        cursor: "not-a-number",
      })
    ).rejects.toThrow("invalid cursor");

    await expect(
      harness.agent.unstable_listSessions({
        cursor: "1abc",
      })
    ).rejects.toThrow("invalid cursor");
  });

  it("rejects resume when session does not belong to requested cwd", async () => {
    const workspace = createWorkspaceInfo({
      id: "ws-cwd-check",
      projectPath: "/repo/correct",
      namedMinionPath: "/repo/correct/.lattice/ws-cwd-check",
    });

    const harness = createHarness({
      activeWorkspaces: [workspace],
      onChatEvents: [{ type: "caught-up" } as MinionChatMessage],
    });

    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    await expect(
      harness.agent.unstable_resumeSession({
        sessionId: "ws-cwd-check",
        cwd: "/repo/wrong",
        mcpServers: [],
      })
    ).rejects.toThrow("is not in cwd");
  });

  it("resumes sessions with onChat live mode (no history replay)", async () => {
    const workspace = createWorkspaceInfo({
      id: "ws-resume",
      projectPath: "/repo/resume",
      namedMinionPath: "/repo/resume/.lattice/ws-resume",
    });

    const harness = createHarness({
      activeWorkspaces: [workspace],
      onChatEvents: [{ type: "caught-up" } as MinionChatMessage],
    });

    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    const response = await harness.agent.unstable_resumeSession({
      sessionId: "ws-resume",
      cwd: "/repo/resume/",
      mcpServers: [],
    });

    expect(response.configOptions?.length).toBeGreaterThan(0);
    expect(harness.onChatCalls[0]).toEqual({
      minionId: "ws-resume",
      mode: { type: "live" },
    });
  });

  it("updates cached onChat mode even when a subscription already exists", async () => {
    const workspace = createWorkspaceInfo({
      id: "ws-live-to-full",
      projectPath: "/repo/resume",
      namedMinionPath: "/repo/resume/.lattice/ws-live-to-full",
    });

    const harness = createHarness({
      activeWorkspaces: [workspace],
      onChatStream: createNeverEndingChatStream([{ type: "caught-up" } as MinionChatMessage]),
    });

    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    await harness.agent.unstable_resumeSession({
      sessionId: "ws-live-to-full",
      cwd: "/repo/resume",
      mcpServers: [],
    });

    const modeMap = (
      harness.agent as unknown as {
        onChatModeBySessionId: Map<string, OnChatMode>;
      }
    ).onChatModeBySessionId;

    expect(modeMap.get("ws-live-to-full")).toEqual({ type: "live" });

    await harness.agent.loadSession({
      sessionId: "ws-live-to-full",
      cwd: "/repo/resume",
      mcpServers: [],
    });

    expect(modeMap.get("ws-live-to-full")).toEqual({ type: "full" });
    expect(harness.onChatCalls).toHaveLength(2);
    expect(harness.onChatCalls[0]).toEqual({
      minionId: "ws-live-to-full",
      mode: { type: "live" },
    });
    expect(harness.onChatCalls[1]).toEqual({
      minionId: "ws-live-to-full",
      mode: { type: "full" },
    });
  });

  it("evicts least-recently-used idle sessions when tracked session cap is exceeded", async () => {
    const workspaceA = createWorkspaceInfo({
      id: "ws-a",
      projectPath: "/repo/lru",
      namedMinionPath: "/repo/lru/.lattice/ws-a",
    });
    const workspaceB = createWorkspaceInfo({
      id: "ws-b",
      projectPath: "/repo/lru",
      namedMinionPath: "/repo/lru/.lattice/ws-b",
    });
    const workspaceC = createWorkspaceInfo({
      id: "ws-c",
      projectPath: "/repo/lru",
      namedMinionPath: "/repo/lru/.lattice/ws-c",
    });

    const harness = createHarness({
      activeWorkspaces: [workspaceA, workspaceB, workspaceC],
      onChatStream: createNeverEndingChatStream([{ type: "caught-up" } as MinionChatMessage]),
      agentOptions: {
        maxTrackedSessions: 2,
        sessionIdleTtlMs: 60_000,
      },
    });

    await harness.agent.initialize({ protocolVersion: PROTOCOL_VERSION });

    await harness.agent.unstable_resumeSession({
      sessionId: "ws-a",
      cwd: "/repo/lru",
      mcpServers: [],
    });
    await harness.agent.unstable_resumeSession({
      sessionId: "ws-b",
      cwd: "/repo/lru",
      mcpServers: [],
    });
    await harness.agent.unstable_resumeSession({
      sessionId: "ws-c",
      cwd: "/repo/lru",
      mcpServers: [],
    });

    const sessionStateMap = (
      harness.agent as unknown as {
        sessionStateById: Map<string, { minionId: string }>;
      }
    ).sessionStateById;

    expect(sessionStateMap.has("ws-a")).toBe(false);
    expect(sessionStateMap.has("ws-b")).toBe(true);
    expect(sessionStateMap.has("ws-c")).toBe(true);
    expect(harness.onChatCalls).toHaveLength(3);
  });
});
