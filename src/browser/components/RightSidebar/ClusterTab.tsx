/**
 * ClusterTab — exo-style cluster dashboard panel.
 *
 * Shows local device info (hostname, username, OS, CPU, memory, GPU),
 * RDMA/transport status, peer topology, pool status, and cluster nodes
 * in a compact, real-time panel — like Activity Monitor.
 */

import React, { useEffect } from "react";
import {
  Cable,
  Cpu,
  HardDrive,
  Info,
  Monitor,
  Network,
  RefreshCw,
  Server,
  User,
  Wifi,
  Zap,
} from "lucide-react";
import { useInference } from "@/browser/hooks/useInference";
import { cn } from "@/common/lib/utils";

interface ClusterTabProps {
  workspaceId: string;
}

// ─── Shared tiny components ──────────────────────────────────────────

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
        className
      )}
    >
      {children}
    </span>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0">
      <span className="text-muted text-[9px] font-medium uppercase tracking-wider">{label}</span>
      <span className="text-foreground text-sm font-bold leading-tight">{value}</span>
      {sub && <span className="text-muted text-[9px]">{sub}</span>}
    </div>
  );
}

function SectionHeader({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="text-muted flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest">
      {icon}
      {children}
    </div>
  );
}

// ─── Memory bar (exo-style) ─────────────────────────────────────────

function MemoryBar({ used, total, label }: { used: number; total: number; label?: string }) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const usedGB = (used / 1024 / 1024 / 1024).toFixed(1);
  const totalGB = (total / 1024 / 1024 / 1024).toFixed(1);

  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[9px]">
        <span className="text-muted">
          {label ? `${label}: ` : ""}
          {usedGB} / {totalGB} GB
        </span>
        <span className="text-muted">{pct.toFixed(0)}%</span>
      </div>
      <div className="bg-background h-1.5 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-green-500"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Info Row ───────────────────────────────────────────────────────

function InfoRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {icon && <span className="text-muted">{icon}</span>}
      <span className="text-muted text-[10px] w-20 shrink-0">{label}</span>
      <span className="text-foreground text-[10px] font-medium truncate flex-1">{value}</span>
    </div>
  );
}

// ─── Device Card (exo-style: laptop icon + stats sidebar) ───────────

function DeviceCard({
  name,
  hostname,
  username,
  memUsed,
  memTotal,
  modelsLoaded,
  maxModels,
}: {
  name: string;
  hostname?: string;
  username?: string;
  memUsed: number;
  memTotal: number;
  modelsLoaded: number;
  maxModels: number;
}) {
  const pct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

  return (
    <div className="border-border-medium bg-background-secondary/30 flex items-center gap-3 rounded-lg border p-3">
      {/* Device icon */}
      <div className="flex flex-col items-center gap-1">
        <div className="text-muted">
          <Monitor className="h-10 w-10 stroke-[1.2]" />
        </div>
        <span className="text-foreground text-[10px] font-bold">{name}</span>
        {hostname && (
          <span className="text-muted text-[8px] truncate max-w-[80px]" title={hostname}>
            {hostname}
          </span>
        )}
      </div>

      {/* Stats sidebar */}
      <div className="flex flex-1 flex-col gap-1.5">
        {username && (
          <div className="flex items-center gap-1 text-[9px]">
            <User className="h-2.5 w-2.5 text-muted" />
            <span className="text-foreground font-medium">{username}</span>
          </div>
        )}
        <MemoryBar used={memUsed} total={memTotal} label="VRAM" />
        <div className="flex items-center justify-between text-[9px]">
          <span className="text-muted">Models</span>
          <span className="text-foreground font-mono font-bold">
            {modelsLoaded}/{maxModels}
          </span>
        </div>
        <div className="flex items-center justify-between text-[9px]">
          <span className="text-muted">Usage</span>
          <span className="text-foreground font-mono font-bold">{pct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Derive a human-friendly device name instead of legacy navigator.platform */
function getDeviceName(): string {
  const cores = navigator.hardwareConcurrency ?? 0;
  // navigator.userAgentData is available in Chromium-based browsers (Electron)
  const uaData = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? "";

  if (platform === "macOS" || platform.startsWith("Mac")) {
    const arch = (navigator as { userAgentData?: { architecture?: string } }).userAgentData
      ?.architecture;
    if (arch === "arm") return `Apple Silicon · ${cores} cores`;
    if (arch === "x86") return `Mac Intel · ${cores} cores`;
    return cores >= 8 ? `Apple Silicon · ${cores} cores` : `Mac · ${cores} cores`;
  }
  if (platform.startsWith("Win")) return `Windows · ${cores} cores`;
  if (platform.startsWith("Linux")) return `Linux · ${cores} cores`;
  return `${platform} · ${cores} cores`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ─── Main ClusterTab ────────────────────────────────────────────────

export const ClusterTab: React.FC<ClusterTabProps> = () => {
  const {
    status: inferenceStatus,
    poolStatus,
    clusterStatus,
    transportStatus,
    systemInfo,
    models: localModels,
    refreshPoolStatus,
    refreshClusterStatus,
    refreshTransportStatus,
    refreshSystemInfo,
  } = useInference();

  // Auto-refresh every 3s when tab is visible
  useEffect(() => {
    const refresh = () => {
      void refreshPoolStatus();
      void refreshClusterStatus();
      void refreshTransportStatus();
      void refreshSystemInfo();
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refreshPoolStatus, refreshClusterStatus, refreshTransportStatus, refreshSystemInfo]);

  const isOnline = inferenceStatus?.available === true;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="text-muted h-4 w-4" />
          <span className="text-foreground text-xs font-bold uppercase tracking-widest">
            Cluster
          </span>
          <Badge
            className={isOnline ? "bg-green-500/15 text-green-500" : "bg-red-500/15 text-red-500"}
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                isOnline ? "bg-green-500" : "bg-red-500"
              )}
            />
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </div>
        <button
          type="button"
          className="text-muted hover:text-foreground transition-colors"
          onClick={() => {
            void refreshPoolStatus();
            void refreshClusterStatus();
            void refreshTransportStatus();
            void refreshSystemInfo();
          }}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── System Info (Activity Monitor style) ──────────────────── */}
      {systemInfo && (
        <div className="space-y-2">
          <SectionHeader icon={<Server className="h-3 w-3" />}>System</SectionHeader>
          <div className="border-border-medium bg-background-secondary/30 rounded-lg border p-2.5 space-y-0.5">
            <InfoRow
              icon={<User className="h-2.5 w-2.5" />}
              label="User"
              value={systemInfo.username}
            />
            <InfoRow
              icon={<Network className="h-2.5 w-2.5" />}
              label="Hostname"
              value={systemInfo.hostname}
            />
            <InfoRow
              icon={<Monitor className="h-2.5 w-2.5" />}
              label="OS"
              value={`${systemInfo.osType} ${systemInfo.osRelease}`}
            />
            <InfoRow
              icon={<Cpu className="h-2.5 w-2.5" />}
              label="CPU"
              value={`${systemInfo.cpuModel.replace(/\s+/g, " ").trim()}`}
            />
            <InfoRow
              icon={<Cpu className="h-2.5 w-2.5" />}
              label="Cores"
              value={`${systemInfo.cpuCores} (${systemInfo.arch})`}
            />
            <InfoRow
              icon={<HardDrive className="h-2.5 w-2.5" />}
              label="Memory"
              value={`${formatBytes(systemInfo.totalMemoryBytes)} total · ${formatBytes(systemInfo.freeMemoryBytes)} free`}
            />
            <InfoRow
              icon={<Info className="h-2.5 w-2.5" />}
              label="Uptime"
              value={formatUptime(systemInfo.uptime)}
            />
            <InfoRow
              icon={<Server className="h-2.5 w-2.5" />}
              label="Node.js"
              value={`${systemInfo.nodeVersion} (PID ${systemInfo.pid})`}
            />
          </div>

          {/* System memory bar */}
          <MemoryBar
            used={systemInfo.totalMemoryBytes - systemInfo.freeMemoryBytes}
            total={systemInfo.totalMemoryBytes}
            label="System RAM"
          />
        </div>
      )}

      {/* ── Local Device (exo-style card) ───────────────────────── */}
      <div className="space-y-2">
        <SectionHeader icon={<Monitor className="h-3 w-3" />}>This Device</SectionHeader>
        <DeviceCard
          name={getDeviceName()}
          hostname={systemInfo?.hostname}
          username={systemInfo?.username}
          memUsed={poolStatus?.estimatedVramBytes ?? 0}
          memTotal={poolStatus?.memoryBudgetBytes ?? 0}
          modelsLoaded={poolStatus?.modelsLoaded ?? 0}
          maxModels={poolStatus?.maxLoadedModels ?? 0}
        />

        {/* Quick stats row */}
        <div className="grid grid-cols-3 gap-2">
          <Metric
            label="CPU"
            value={String(systemInfo?.cpuCores ?? navigator.hardwareConcurrency ?? "?")}
            sub="cores"
          />
          <Metric label="Models" value={String(localModels.length)} sub="available" />
          <Metric
            label="VRAM"
            value={
              poolStatus?.estimatedVramBytes
                ? `${(poolStatus.estimatedVramBytes / 1024 / 1024 / 1024).toFixed(1)}G`
                : "0G"
            }
            sub="in use"
          />
        </div>
      </div>

      {/* ── Transport & RDMA ────────────────────────────────────── */}
      <div className="space-y-2">
        <SectionHeader icon={<Cable className="h-3 w-3" />}>Transport</SectionHeader>

        {transportStatus ? (
          <div className="space-y-2">
            {/* RDMA status line */}
            <div className="border-border-medium bg-background-secondary/30 flex items-center gap-2 rounded-lg border px-3 py-2">
              {transportStatus.rdma.available ? (
                <>
                  <Zap className="h-3.5 w-3.5 text-green-500" />
                  <div className="flex-1">
                    <div className="text-foreground text-[11px] font-semibold">
                      {transportStatus.rdma.mode === "rdma-verbs" ? "RDMA Verbs" : "TCP-RDMA"}
                    </div>
                    <div className="text-muted text-[9px]">
                      {transportStatus.rdma.bandwidth_gbps > 0
                        ? `${transportStatus.rdma.bandwidth_gbps} Gbps`
                        : ""}
                      {transportStatus.rdma.latency_us > 0
                        ? ` · ${transportStatus.rdma.latency_us}μs`
                        : ""}
                      {transportStatus.rdma.device ? ` · ${transportStatus.rdma.device}` : ""}
                    </div>
                  </div>
                  <Badge className="bg-green-500/15 text-green-500">Active</Badge>
                </>
              ) : (
                <>
                  <Wifi className="text-muted h-3.5 w-3.5" />
                  <div className="flex-1">
                    <div className="text-foreground text-[11px] font-semibold">TCP</div>
                    <div className="text-muted text-[9px]">
                      {transportStatus.rdma.error || "Standard network transport"}
                    </div>
                  </div>
                  <Badge className="bg-background text-muted">Fallback</Badge>
                </>
              )}
            </div>

            {/* Peer connections */}
            {transportStatus.peer_transports.length > 0 && (
              <div className="space-y-1">
                {transportStatus.peer_transports.map((peer) => (
                  <div
                    key={peer.peer_id}
                    className="border-border-medium flex items-center gap-2 rounded border px-2.5 py-1.5 text-[10px]"
                  >
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        peer.connected ? "bg-green-500" : "bg-red-500"
                      )}
                    />
                    <span className="text-foreground flex-1 truncate font-mono text-[10px] font-medium">
                      {peer.peer_name || peer.peer_id.slice(0, 12)}
                    </span>
                    <Badge
                      className={
                        peer.transport === "rdma-verbs"
                          ? "bg-green-500/10 text-green-500"
                          : peer.transport === "tcp-rdma-fallback"
                            ? "bg-yellow-500/10 text-yellow-500"
                            : "bg-background text-muted"
                      }
                    >
                      {peer.transport === "rdma-verbs" && <Zap className="h-2 w-2" />}
                      {peer.transport === "tcp-rdma-fallback" && <Cable className="h-2 w-2" />}
                      {peer.transport === "tcp" && <Wifi className="h-2 w-2" />}
                      {peer.transport}
                    </Badge>
                    {peer.bandwidth_gbps > 0 && (
                      <span className="text-muted font-mono">{peer.bandwidth_gbps}G</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted border-border-medium rounded-lg border px-3 py-3 text-center text-[10px]">
            Transport status unavailable
          </div>
        )}
      </div>

      {/* ── Cluster Nodes ────────────────────────────────────────── */}
      {clusterStatus && clusterStatus.total_nodes > 0 && (
        <div className="space-y-2">
          <SectionHeader icon={<Network className="h-3 w-3" />}>
            Peers · {clusterStatus.total_nodes} node{clusterStatus.total_nodes !== 1 ? "s" : ""}
          </SectionHeader>

          <div className="space-y-1.5">
            {clusterStatus.nodes.map((node) => {
              const isHealthy = node.status === "healthy" || node.status === "online";
              return (
                <div
                  key={node.id}
                  className="border-border-medium bg-background-secondary/30 space-y-1.5 rounded-lg border p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Monitor
                      className={cn(
                        "h-5 w-5 stroke-[1.2]",
                        isHealthy ? "text-muted" : "text-red-500/50"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground text-[11px] font-bold truncate">
                          {node.name || node.id.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                            isHealthy ? "bg-green-500" : "bg-red-500"
                          )}
                        />
                      </div>
                      <div className="text-muted text-[9px]">{node.address}</div>
                    </div>
                  </div>

                  {/* Node details */}
                  <div className="grid grid-cols-3 gap-1.5 text-[9px]">
                    <div>
                      <span className="text-muted">GPU</span>
                      <div className="text-foreground font-medium">{node.gpu_type || "CPU"}</div>
                    </div>
                    <div>
                      <span className="text-muted">Models</span>
                      <div className="text-foreground font-medium">{node.loaded_models.length}</div>
                    </div>
                    <div>
                      <span className="text-muted">Active</span>
                      <div className="text-foreground font-medium">{node.active_inferences}</div>
                    </div>
                  </div>

                  {node.tokens_per_second_avg > 0 && (
                    <div className="text-[9px]">
                      <span className="text-muted">Throughput: </span>
                      <span className="text-foreground font-medium">
                        {node.tokens_per_second_avg.toFixed(1)} tok/s
                      </span>
                    </div>
                  )}

                  <MemoryBar used={node.used_memory_bytes} total={node.total_memory_bytes} />

                  {/* Node's loaded models */}
                  {node.loaded_models.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {node.loaded_models.map((m) => (
                        <span
                          key={m}
                          className="bg-background rounded px-1 py-0.5 text-[8px] font-mono text-muted truncate max-w-[120px]"
                          title={m}
                        >
                          {m.split("/").pop() ?? m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Loaded Models ────────────────────────────────────────── */}
      {poolStatus && poolStatus.loadedModels.length > 0 && (
        <div className="space-y-2">
          <SectionHeader icon={<Cpu className="h-3 w-3" />}>
            Loaded · {poolStatus.loadedModels.length}
          </SectionHeader>

          <div className="space-y-1">
            {poolStatus.loadedModels.map((m) => (
              <div
                key={m.model_id}
                className="border-border-medium flex items-center gap-2 rounded border px-2.5 py-1.5"
              >
                <HardDrive className="text-muted h-3 w-3 shrink-0" />
                <span className="text-foreground flex-1 truncate font-mono text-[10px]">
                  {m.model_id}
                </span>
                {m.estimated_bytes > 0 && (
                  <span className="text-muted text-[9px] font-mono">
                    {(m.estimated_bytes / 1024 / 1024 / 1024).toFixed(1)}G
                  </span>
                )}
                <Badge
                  className={
                    m.alive ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
                  }
                >
                  {m.alive ? "loaded" : "idle"}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isOnline && (
        <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 py-8">
          <Network className="h-8 w-8 opacity-30" />
          <span className="text-[11px]">Inference engine not running</span>
          <span className="text-[9px] opacity-60">
            Start the inference service to see cluster status
          </span>
        </div>
      )}
    </div>
  );
};
