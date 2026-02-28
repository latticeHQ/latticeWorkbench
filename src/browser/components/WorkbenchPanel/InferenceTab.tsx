import { useEffect, useState } from "react";
import { Download, Play, Cpu, Network, RefreshCw, Server, AlertCircle, Loader2 } from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import type { z } from "zod";
import type { ExoStatusSchema, ExoClusterStateSchema, ExoNodeSchema, ExoModelSchema } from "@/common/orpc/schemas/inference";

// Infer types from Zod schemas
type ExoStatus = z.infer<typeof ExoStatusSchema>;
type ExoClusterState = z.infer<typeof ExoClusterStateSchema>;
type ExoNode = z.infer<typeof ExoNodeSchema>;
type ExoModel = z.infer<typeof ExoModelSchema>;

interface InferenceTabProps {
  minionId: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function InferenceTab(props: InferenceTabProps) {
  const { api } = useAPI();
  const [status, setStatus] = useState<ExoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await (api as any).inference.getStatus();
        if (!cancelled) {
          setStatus(result as ExoStatus);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError("Failed to check exo status");
      }
    }

    async function subscribe() {
      try {
        const stream = await (api as any).inference.subscribe(
          undefined,
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setStatus(snapshot as ExoStatus);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("InferenceTab: subscription error:", err);
        }
      }
    }

    void load();
    void subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api]);

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!status) {
    return <LoadingState />;
  }

  switch (status.status) {
    case "not_installed":
      return <NotInstalledView minionId={props.minionId} />;
    case "installed_not_running":
      return <NotRunningView minionId={props.minionId} commandPath={status.commandPath} />;
    case "running":
      return <ClusterDashboard state={status.clusterState} />;
    case "error":
      return <ErrorState message={status.message} />;
  }
}

// ---------------------------------------------------------------------------
// Not Installed view
// ---------------------------------------------------------------------------

// Install script — handles prerequisites, clone, dashboard build
const EXO_INSTALL_CMD = [
  'echo "🔧 Installing exo prerequisites…"',
  "brew install uv macmon node cmake 2>/dev/null || true",
  "xcodebuild -downloadComponent MetalToolchain 2>/dev/null || true",
  'command -v rustc >/dev/null || { echo "📦 Installing Rust…"; curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"; }',
  'rustup toolchain install nightly 2>/dev/null || true',
  'echo "📥 Cloning exo…"',
  "git clone https://github.com/exo-explore/exo.git ~/.exo-cluster 2>/dev/null || { cd ~/.exo-cluster && git pull; }",
  'echo "🏗️  Building dashboard…"',
  "cd ~/.exo-cluster/dashboard && npm install && npm run build",
  'echo ""',
  'echo "✅ exo installed — click Start Cluster to begin"',
].join(" && ");

function NotInstalledView({ minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    if (!api || installing) return;
    setInstalling(true);
    try {
      await api.terminal.create({
        minionId,
        cols: 120,
        rows: 30,
        initialCommand: EXO_INSTALL_CMD,
      });
    } catch (err) {
      console.error("Failed to create terminal for install:", err);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Download className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Exo Not Installed</h3>
        <p className="text-muted mt-1 text-xs">
          Run AI models locally with distributed inference across your devices.
        </p>
      </div>
      <button
        type="button"
        onClick={handleInstall}
        disabled={installing}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {installing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        Install exo
      </button>
      <p className="text-muted text-[10px]">
        Clones <a href="https://github.com/exo-explore/exo" target="_blank" rel="noopener" className="underline">exo-explore/exo</a>, installs prereqs via brew, and builds the dashboard.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed but not running view
// ---------------------------------------------------------------------------

function NotRunningView({ minionId, commandPath }: { minionId: string; commandPath: string }) {
  const { api } = useAPI();
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!api || starting) return;
    setStarting(true);
    try {
      // exo-explore/exo runs via `uv run exo` from its repo directory
      await api.terminal.create({
        minionId,
        cols: 120,
        rows: 30,
        initialCommand: `cd ${commandPath} && uv run exo`,
      });
    } catch (err) {
      console.error("Failed to start exo:", err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Server className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Exo Installed</h3>
        <p className="text-muted mt-1 text-xs">
          Start the inference cluster to run models locally.
        </p>
      </div>
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--color-success)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Start Cluster
      </button>
      <p className="text-muted text-[10px]">
        Runs: <code className="rounded bg-[var(--color-bg-secondary)] px-1">cd {commandPath} && uv run exo</code>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cluster Dashboard
// ---------------------------------------------------------------------------

function ClusterDashboard({ state }: { state: ExoClusterState }) {
  const [iframeError, setIframeError] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Compact header bar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          <span className="font-medium">{state.nodes.length} node{state.nodes.length !== 1 ? "s" : ""}</span>
          <span className="text-muted">·</span>
          <span>{state.models.length} model{state.models.length !== 1 ? "s" : ""}</span>
        </span>
        <span className="ml-auto">
          <code className="text-muted rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px]">
            {state.apiEndpoint}
          </code>
        </span>
      </div>

      {/* Embedded exo dashboard */}
      {!iframeError ? (
        <iframe
          src={state.apiEndpoint}
          title="Exo Cluster Dashboard"
          className="flex-1 border-0"
          style={{ width: "100%", height: "100%", colorScheme: "normal" }}
          onError={() => setIframeError(true)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        /* Fallback: show our own card-based dashboard if iframe fails */
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <section>
            <h4 className="text-muted mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
              <Network className="h-3 w-3" />
              Nodes
            </h4>
            <div className="flex flex-col gap-1.5">
              {state.nodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          </section>

          {state.models.length > 0 && (
            <section>
              <h4 className="text-muted mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                <Cpu className="h-3 w-3" />
                Models
              </h4>
              <div className="flex flex-col gap-1">
                {state.models.map((model) => (
                  <ModelRow key={model.modelId} model={model} />
                ))}
              </div>
            </section>
          )}

          <section className="border-t border-[var(--color-border)] pt-2">
            <p className="text-muted text-[10px]">
              OpenAI-compatible API available at{" "}
              <code className="rounded bg-[var(--color-bg-secondary)] px-1">
                {state.apiEndpoint}/v1/chat/completions
              </code>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------

function NodeCard({ node }: { node: ExoNode }) {
  const memUsed = node.gpuMemoryTotal - node.gpuMemoryFree;
  const memPct = node.gpuMemoryTotal > 0 ? (memUsed / node.gpuMemoryTotal) * 100 : 0;

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{node.name}</span>
        <span className="text-muted text-[10px]">{node.host}:{node.port}</span>
      </div>
      <div className="text-muted mt-0.5 text-[10px]">{node.gpuName}</div>
      {node.gpuMemoryTotal > 0 && (
        <div className="mt-1.5">
          <div className="mb-0.5 flex justify-between text-[10px]">
            <span className="text-muted">Memory</span>
            <span className="text-muted">
              {formatBytes(memUsed)} / {formatBytes(node.gpuMemoryTotal)}
            </span>
          </div>
          <MemoryBar percent={memPct} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model row
// ---------------------------------------------------------------------------

function ModelRow({ model }: { model: ExoModel }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5">
      <span className="text-xs font-medium">{model.modelId}</span>
      <StatusBadge status={model.status} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function MemoryBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${Math.min(100, percent)}%`,
          background: percent > 90 ? "var(--color-destructive)" : "var(--color-accent)",
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    status === "running"
      ? "bg-green-500/10 text-green-500"
      : status === "loading"
        ? "bg-yellow-500/10 text-yellow-500"
        : status === "available"
          ? "bg-blue-500/10 text-blue-500"
          : "bg-red-500/10 text-red-500";

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <RefreshCw className="text-muted h-5 w-5 animate-spin" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertCircle className="h-6 w-6 text-[var(--color-destructive)]" />
      <p className="text-muted text-xs">{message}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}
