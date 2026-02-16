/**
 * WorkbenchClient — HTTP + WebSocket client for Lattice Workbench ORPC API.
 *
 * Uses fetch() for request-response calls and WebSocket for streaming
 * subscriptions (workspace.onChat). Falls back to polling if WS unavailable.
 *
 * All methods correspond to ORPC routes exposed at /api/*.
 */
import WebSocket from "ws";

// ── Stream event types (subset of workspace chat events) ──────────────
interface StreamEvent {
  type: string;
  workspaceId?: string;
  messageId?: string;
  delta?: string;
  text?: string;
  content?: string;
  role?: string;
  [key: string]: unknown;
}

export interface WorkbenchClientOptions {
  baseUrl: string;
  authToken?: string;
}

export class WorkbenchClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly authToken?: string;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsSubscriptions = new Map<string, (event: StreamEvent) => void>();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsPingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorkbenchClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.authToken = options.authToken;
    this.headers = {
      "Content-Type": "application/json",
      ...(options.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
    };
  }

  // ── WebSocket lifecycle ─────────────────────────────────────────────

  /**
   * Connect WebSocket for streaming subscriptions.
   * Called lazily on first streamForResponse() call.
   */
  private connectWebSocket(): Promise<void> {
    if (this.wsConnected && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const wsBase = this.baseUrl.replace(/^http/, "ws");
      const wsUrl = this.authToken
        ? `${wsBase}/orpc/ws?token=${encodeURIComponent(this.authToken)}`
        : `${wsBase}/orpc/ws`;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (err) {
        reject(err);
        return;
      }

      const timeout = setTimeout(() => {
        this.ws?.terminate();
        reject(new Error("WebSocket connection timeout (10s)"));
      }, 10_000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        this.wsConnected = true;
        console.error("[lattice-mcp] WebSocket connected");

        // Keepalive ping every 25s
        this.wsPingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 25_000);

        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleWsMessage(msg);
        } catch {
          // Non-JSON message (pong, etc.)
        }
      });

      this.ws.on("close", () => {
        this.wsConnected = false;
        if (this.wsPingTimer) clearInterval(this.wsPingTimer);
        console.error("[lattice-mcp] WebSocket disconnected");
        // Don't auto-reconnect — reconnect on next streamForResponse call
      });

      this.ws.on("error", (err) => {
        clearTimeout(timeout);
        console.error("[lattice-mcp] WebSocket error:", err.message);
        if (!this.wsConnected) reject(err);
      });
    });
  }

  private handleWsMessage(msg: unknown): void {
    // ORPC WebSocket messages come as arrays or objects with subscription IDs
    // We dispatch based on workspace ID embedded in the event
    if (!msg || typeof msg !== "object") return;

    const event = msg as StreamEvent;
    const wsId = event.workspaceId;

    if (wsId && this.wsSubscriptions.has(wsId)) {
      this.wsSubscriptions.get(wsId)!(event);
    }
  }

  /**
   * Close WebSocket connection and clean up.
   */
  closeWebSocket(): void {
    if (this.wsPingTimer) clearInterval(this.wsPingTimer);
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);
    this.wsSubscriptions.clear();
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  // ── Generic request helpers ───────────────────────────────────────

  private async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/orpc${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Workbench API error ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  // ── Health check ──────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── Headquarters ──────────────────────────────────────────────────────

  async listProjects(): Promise<Array<{ path: string; config: unknown }>> {
    return this.post("/projects.list");
  }

  async createProject(projectPath: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/projects.create", { projectPath });
  }

  async listBranches(
    projectPath: string
  ): Promise<{ branches: string[]; recommendedTrunk: string | null }> {
    return this.post("/projects.listBranches", { projectPath });
  }

  // ── Workspaces ────────────────────────────────────────────────────

  async listWorkspaces(
    archived?: boolean
  ): Promise<Array<{ id: string; title: string; projectPath: string; [key: string]: unknown }>> {
    return this.post("/workspace.list", archived !== undefined ? { archived } : undefined);
  }

  async createWorkspace(params: {
    projectPath: string;
    branchName: string;
    trunkBranch?: string;
    title?: string;
  }): Promise<{ success: boolean; data?: { metadata: { id: string } }; error?: string }> {
    return this.post("/workspace.create", params);
  }

  async removeWorkspace(
    workspaceId: string,
    force?: boolean
  ): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.remove", { workspaceId, force });
  }

  async getWorkspaceInfo(workspaceId: string): Promise<unknown> {
    return this.post("/workspace.getInfo", { workspaceId });
  }

  async renameWorkspace(
    workspaceId: string,
    title: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.rename", { workspaceId, title });
  }

  async forkWorkspace(
    workspaceId: string,
    branchName: string,
    title?: string
  ): Promise<{ success: boolean; data?: { metadata: { id: string } }; error?: string }> {
    return this.post("/workspace.fork", { workspaceId, branchName, title });
  }

  async archiveWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.archive", { workspaceId });
  }

  async unarchiveWorkspace(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.unarchive", { workspaceId });
  }

  async getFullReplay(workspaceId: string): Promise<unknown[]> {
    return this.post("/workspace.getFullReplay", { workspaceId });
  }

  /**
   * Send a message to a workspace agent.
   * This triggers the agent loop — the response streams back asynchronously.
   * Use pollForResponse() after calling this to get the assistant's reply.
   */
  async sendMessage(
    workspaceId: string,
    message: string,
    options?: { model?: string; agentId?: string }
  ): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.sendMessage", {
      workspaceId,
      message,
      ...options,
    });
  }

  async interruptStream(workspaceId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/workspace.interruptStream", { workspaceId });
  }

  /**
   * Execute a bash script in a workspace runtime.
   */
  async executeBash(
    workspaceId: string,
    script: string,
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.post("/workspace.executeBash", {
      workspaceId,
      script,
      ...(timeout ? { timeout } : {}),
    });
  }

  // ── Channels ──────────────────────────────────────────────────────

  async listChannels(): Promise<
    Array<{
      type: string;
      accountId: string;
      status: string;
      enabled: boolean;
      sessionCount: number;
    }>
  > {
    return this.post("/channels.list");
  }

  async connectChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.connect", { accountId });
  }

  async disconnectChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.disconnect", { accountId });
  }

  async sendChannelMessage(
    accountId: string,
    to: string,
    text: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.sendMessage", {
      accountId,
      message: { to: { id: to }, text },
    });
  }

  async getChannel(accountId: string): Promise<{
    type: string;
    accountId: string;
    enabled: boolean;
    defaultProjectPath: string;
    sessionScope: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown>;
  }> {
    return this.post("/channels.get", { accountId });
  }

  async createChannel(config: {
    type: string;
    accountId: string;
    enabled: boolean;
    defaultProjectPath: string;
    sessionScope?: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.create", config);
  }

  async updateChannel(config: {
    type: string;
    accountId: string;
    enabled: boolean;
    defaultProjectPath: string;
    sessionScope?: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.update", config);
  }

  async removeChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    return this.post("/channels.remove", { accountId });
  }

  async listChannelSessions(accountId?: string): Promise<
    Array<{
      sessionKey: string;
      workspaceId: string;
      channelType: string;
      accountId: string;
      peerId: string;
      peerKind: string;
      displayName?: string;
      lastMessageAt: number;
      createdAt: number;
    }>
  > {
    return this.post("/channels.sessions.list", accountId ? { accountId } : {});
  }

  // ── Providers ─────────────────────────────────────────────────────

  async listProviders(): Promise<unknown[]> {
    return this.post("/providers.list");
  }

  // ── Inference / Models ──────────────────────────────────────────────

  async listModels(): Promise<
    Array<{
      id: string;
      name: string;
      format?: string;
      sizeBytes?: number;
      quantization?: string;
      localPath?: string;
      backend?: string;
    }>
  > {
    return this.post("/inference.listModels");
  }

  async getInferenceStatus(): Promise<{ available: boolean; loadedModelId: string | null }> {
    return this.post("/inference.getStatus");
  }

  // ── Workspace Activity ──────────────────────────────────────────────

  async listWorkspaceActivity(): Promise<
    Record<
      string,
      {
        status?: string;
        streaming?: boolean;
        lastActivity?: number;
        [key: string]: unknown;
      }
    >
  > {
    return this.post("/workspace.activity.list");
  }

  // ── File / Directory Operations ─────────────────────────────────────

  async listDirectory(dirPath: string): Promise<unknown> {
    return this.post("/general.listDirectory", { path: dirPath });
  }

  async createDirectory(
    dirPath: string
  ): Promise<{ success: boolean; data?: { normalizedPath: string }; error?: string }> {
    return this.post("/general.createDirectory", { path: dirPath });
  }

  // ── Response waiting strategies ──────────────────────────────────────

  /**
   * Stream-based response waiting — connects via WebSocket to workspace.onChat
   * subscription, accumulates stream-delta events, resolves on stream-end.
   *
   * Falls back to polling if WebSocket connection fails.
   */
  async streamForResponse(workspaceId: string, timeoutMs: number = 120_000): Promise<string> {
    try {
      await this.connectWebSocket();
    } catch (err) {
      console.error(
        "[lattice-mcp] WebSocket unavailable, falling back to polling:",
        (err as Error).message
      );
      const replay = (await this.getFullReplay(workspaceId)) as unknown[];
      return this.pollForResponse(workspaceId, replay.length, timeoutMs);
    }

    return new Promise<string>((resolve) => {
      let accumulated = "";
      let streamStarted = false;
      let resolved = false;

      const cleanup = () => {
        this.wsSubscriptions.delete(workspaceId);
        if (timer) clearTimeout(timer);
      };

      const finish = (text: string) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(text);
      };

      // Timeout fallback
      const timer = setTimeout(async () => {
        if (resolved) return;
        cleanup();
        // On timeout, try one last poll to grab whatever's there
        try {
          const replay = (await this.getFullReplay(workspaceId)) as Array<{
            role?: string;
            type?: string;
            content?: string;
            text?: string;
          }>;
          const assistantMsgs = replay.filter(
            (m) => m.role === "assistant" || m.type === "assistant"
          );
          if (assistantMsgs.length > 0) {
            const last = assistantMsgs[assistantMsgs.length - 1]!;
            finish((last.content ?? last.text ?? accumulated) || "[Timeout: no response]");
            return;
          }
        } catch {}
        finish(accumulated || "[Timeout: agent did not respond within the time limit]");
      }, timeoutMs);

      // Subscribe to events for this workspace
      this.wsSubscriptions.set(workspaceId, (event: StreamEvent) => {
        switch (event.type) {
          case "stream-start":
            streamStarted = true;
            accumulated = "";
            break;

          case "stream-delta":
            if (event.delta) accumulated += event.delta;
            break;

          case "stream-end":
            // Stream complete — give a tiny delay to catch any trailing deltas
            setTimeout(() => finish(accumulated), 100);
            break;

          case "stream-abort":
            finish(accumulated || "[Stream aborted]");
            break;

          // For non-streaming assistant messages (e.g., from replay)
          case "assistant":
            if (!streamStarted && (event.content || event.text)) {
              finish((event.content ?? event.text) as string);
            }
            break;
        }
      });

      // Send ORPC subscription request over WebSocket
      // The ORPC wire protocol sends a subscription message
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(
            JSON.stringify({
              type: "subscribe",
              path: "workspace.onChat",
              input: { workspaceId },
            })
          );
        } catch {
          // If send fails, fall back to polling
          cleanup();
          this.getFullReplay(workspaceId)
            .then((replay) => {
              this.pollForResponse(workspaceId, (replay as unknown[]).length, timeoutMs).then(
                resolve
              );
            })
            .catch(() => resolve("[Error: failed to subscribe and poll]"));
        }
      }
    });
  }

  /**
   * Poll-based response waiting (v1 — reliable fallback).
   * After sending a message, polls getFullReplay until a new assistant
   * message appears. Returns the assistant's response text.
   */
  async pollForResponse(
    workspaceId: string,
    previousMessageCount: number,
    timeoutMs: number = 120_000
  ): Promise<string> {
    const startTime = Date.now();
    const pollInterval = 2000;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollInterval));

      try {
        const replay = await this.getFullReplay(workspaceId);
        const messages = replay as Array<{
          role?: string;
          type?: string;
          content?: string;
          text?: string;
        }>;

        // Look for new assistant messages beyond what we had before
        if (messages.length > previousMessageCount) {
          // Find the last assistant message
          const assistantMessages = messages.filter(
            (m) => m.role === "assistant" || m.type === "assistant"
          );

          if (assistantMessages.length > 0) {
            const last = assistantMessages[assistantMessages.length - 1]!;
            const text = last.content ?? last.text ?? "";

            if (text.length > 0) {
              // Wait one more poll to make sure streaming is complete
              await new Promise((r) => setTimeout(r, pollInterval));
              const final = await this.getFullReplay(workspaceId);
              const finalMessages = final as Array<{
                role?: string;
                type?: string;
                content?: string;
                text?: string;
              }>;
              const finalAssistant = finalMessages.filter(
                (m) => m.role === "assistant" || m.type === "assistant"
              );
              if (finalAssistant.length > 0) {
                const finalLast = finalAssistant[finalAssistant.length - 1]!;
                return finalLast.content ?? finalLast.text ?? text;
              }
              return text;
            }
          }
        }
      } catch {
        // Transient error — keep polling
      }
    }

    return "[Timeout: agent did not respond within the time limit]";
  }

  /**
   * Smart response waiting — tries WebSocket streaming first, falls back to polling.
   * This is the recommended method for all callers.
   */
  async waitForResponse(
    workspaceId: string,
    previousMessageCount: number,
    timeoutMs: number = 120_000
  ): Promise<string> {
    // Try streaming if WebSocket is connected or connectable
    try {
      return await this.streamForResponse(workspaceId, timeoutMs);
    } catch {
      // Fall back to polling
      return this.pollForResponse(workspaceId, previousMessageCount, timeoutMs);
    }
  }
}
