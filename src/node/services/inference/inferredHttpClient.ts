import type {
  InferredHealthResponse,
  InferredStatusResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ModelListResponse,
  ClusterState,
  ClusterNode,
  RDMAConfig,
  TransportStatus,
} from "./types";

/**
 * HTTP client for the `latticeinference serve` Go binary API.
 *
 * Maps 1:1 to the Go HTTP endpoints.
 */
export class InferredHttpClient {
  constructor(
    private baseUrl: string,
    private authToken?: string
  ) {}

  /** Update the base URL (e.g. after restart on new port). */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      h["Authorization"] = `Bearer ${this.authToken}`;
    }
    return h;
  }

  // ─── Health ──────────────────────────────────────────────────────────

  async healthz(): Promise<InferredHealthResponse> {
    const resp = await fetch(`${this.baseUrl}/healthz`, {
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`healthz failed: ${resp.status}`);
    return resp.json() as Promise<InferredHealthResponse>;
  }

  // ─── Model Management ────────────────────────────────────────────────

  async loadModel(modelId: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/inference/models/load`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: modelId }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`loadModel failed: ${resp.status} ${text}`);
    }
  }

  async unloadModel(modelId?: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/inference/models/unload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(modelId ? { model: modelId } : {}),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`unloadModel failed: ${resp.status} ${text}`);
    }
  }

  async getStatus(): Promise<InferredStatusResponse> {
    const resp = await fetch(`${this.baseUrl}/inference/status`, {
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`getStatus failed: ${resp.status}`);
    return resp.json() as Promise<InferredStatusResponse>;
  }

  async listModels(): Promise<ModelListResponse> {
    const resp = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.headers(),
    });
    if (!resp.ok) throw new Error(`listModels failed: ${resp.status}`);
    return resp.json() as Promise<ModelListResponse>;
  }

  // ─── Inference ───────────────────────────────────────────────────────

  async chatCompletions(req: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ...req, stream: false }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`chatCompletions failed: ${resp.status} ${text}`);
    }
    return resp.json() as Promise<ChatCompletionResponse>;
  }

  /**
   * Streaming chat completions via SSE.
   *
   * Parses `text/event-stream` response, yields ChatCompletionChunk objects.
   * Terminates on `data: [DONE]`.
   */
  async *chatCompletionsStream(
    req: ChatCompletionRequest,
    signal?: AbortSignal
  ): AsyncGenerator<ChatCompletionChunk> {
    const resp = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ ...req, stream: true }),
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`chatCompletionsStream failed: ${resp.status} ${text}`);
    }

    if (!resp.body) {
      throw new Error("No response body for streaming request");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (terminated by \n\n)
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // Keep incomplete last event

        for (const event of events) {
          const lines = event.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") return;

              try {
                const chunk = JSON.parse(data) as ChatCompletionChunk;
                yield chunk;
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Cluster ─────────────────────────────────────────────────────────

  async getClusterStatus(): Promise<ClusterState | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/inference/cluster/status`, {
        headers: this.headers(),
      });
      if (!resp.ok) return null;
      return resp.json() as Promise<ClusterState>;
    } catch {
      return null;
    }
  }

  async getClusterNodes(): Promise<ClusterNode[]> {
    try {
      const resp = await fetch(`${this.baseUrl}/inference/cluster/nodes`, {
        headers: this.headers(),
      });
      if (!resp.ok) return [];
      const state = (await resp.json()) as { nodes?: ClusterNode[] };
      return state.nodes ?? [];
    } catch {
      return [];
    }
  }

  // ─── Metrics ─────────────────────────────────────────────────────────

  async getMetrics(): Promise<string> {
    try {
      const resp = await fetch(`${this.baseUrl}/metrics`, {
        headers: this.headers(),
      });
      if (!resp.ok) return "";
      return resp.text();
    } catch {
      return "";
    }
  }

  // ─── RDMA / Transport ───────────────────────────────────────────────

  async getRdmaStatus(): Promise<RDMAConfig | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/inference/rdma`, {
        headers: this.headers(),
      });
      if (!resp.ok) return null;
      return resp.json() as Promise<RDMAConfig>;
    } catch {
      return null;
    }
  }

  async getTransportStatus(): Promise<TransportStatus | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/inference/transport`, {
        headers: this.headers(),
      });
      if (!resp.ok) return null;
      return resp.json() as Promise<TransportStatus>;
    } catch {
      return null;
    }
  }

  // ─── Benchmark ────────────────────────────────────────────────────────

  async runBenchmark(modelId?: string): Promise<{
    model: string;
    completion_tokens: number;
    total_time_ms: number;
    time_to_first_token_ms: number;
    tokens_per_second: number;
    peak_memory_bytes: number;
  }> {
    const resp = await fetch(`${this.baseUrl}/inference/benchmark`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model: modelId ?? "", max_tokens: 128 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      throw new Error(`Benchmark failed: ${resp.status}`);
    }
    return resp.json();
  }
}
