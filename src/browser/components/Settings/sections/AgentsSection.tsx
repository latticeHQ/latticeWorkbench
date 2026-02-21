import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  RefreshCw,
  Square,
  Terminal,
  Save,
} from "lucide-react";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { useCliAgentHealth } from "@/browser/hooks/useCliAgentHealth";
import { useCliAgentPreferences } from "@/browser/hooks/useCliAgentPreferences";
import { CliAgentWithIcon } from "@/browser/components/CliAgentIcon";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import { Switch } from "@/browser/components/ui/switch";
import type { AgentHealthStatus, CliAgentDetectionResult, CliAgentPreferences } from "@/common/orpc/types";

export function AgentsSection() {
  const { api } = useAPI();
  const { agents, detectedAgents, missingAgents, loading, refresh } = useCliAgentDetection();
  const { healthMap, refreshOne: refreshHealth } = useCliAgentHealth(
    detectedAgents.map((a) => a.slug)
  );
  const {
    getPrefs,
    updatePrefs,
    toggleEnabled,
    isEnabled,
    loading: prefsLoading,
  } = useCliAgentPreferences();
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  // Parallel installs: track multiple slugs simultaneously
  const [installingSlugs, setInstallingSlugs] = useState<Set<string>>(new Set());
  // Streaming output per slug
  const [installOutput, setInstallOutput] = useState<Record<string, string>>({});
  const [installResults, setInstallResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});
  // AbortControllers for cancellable installs
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  // Cleanup abort controllers on unmount
  useEffect(() => {
    return () => {
      for (const controller of abortControllers.current.values()) {
        controller.abort();
      }
    };
  }, []);

  const handleToggle = (slug: string) => {
    setExpandedSlug((prev) => (prev === slug ? null : slug));
  };

  const handleInstall = useCallback(
    async (slug: string) => {
      if (!api || installingSlugs.has(slug)) return;

      // Mark this slug as installing (parallel-safe)
      setInstallingSlugs((prev) => new Set(prev).add(slug));
      setInstallOutput((prev) => ({ ...prev, [slug]: "" }));
      setInstallResults((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });

      // Auto-expand to show streaming output
      setExpandedSlug(slug);

      const controller = new AbortController();
      abortControllers.current.set(slug, controller);

      try {
        const iterator = await api.cliAgents.installStream({ slug }, { signal: controller.signal });

        for await (const event of iterator) {
          if (controller.signal.aborted) break;

          if (event.type === "stdout" || event.type === "stderr") {
            setInstallOutput((prev) => ({
              ...prev,
              [slug]: (prev[slug] ?? "") + event.data,
            }));
          } else if (event.type === "result") {
            setInstallResults((prev) => ({
              ...prev,
              [slug]: { success: event.success, message: event.message },
            }));
            if (event.success) {
              void refresh();
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setInstallResults((prev) => ({
            ...prev,
            [slug]: {
              success: false,
              message: error instanceof Error ? error.message : "Install failed",
            },
          }));
        }
      } finally {
        setInstallingSlugs((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
        abortControllers.current.delete(slug);
      }
    },
    [api, installingSlugs, refresh]
  );

  const handleCancelInstall = useCallback((slug: string) => {
    const controller = abortControllers.current.get(slug);
    if (controller) {
      controller.abort();
      abortControllers.current.delete(slug);
    }
    setInstallingSlugs((prev) => {
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
    setInstallResults((prev) => ({
      ...prev,
      [slug]: { success: false, message: "Installation cancelled." },
    }));
  }, []);

  if (loading || prefsLoading || !agents) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="text-muted h-5 w-5 animate-spin" />
        <span className="text-muted text-xs">Scanning for providers...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted text-xs">
          AI employees detected on your system. Each employee handles its own authentication and model
          access.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh()}
          className="h-6 gap-1 px-2 text-[11px]"
        >
          <RefreshCw className="h-3 w-3" />
          Rescan
        </Button>
      </div>

      {/* Agent table */}
      <div className="border-border-medium overflow-hidden rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-border-medium bg-background-secondary/50 border-b">
              <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-muted">
                Employee
              </th>
              <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Status</th>
              <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Health</th>
              <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Version</th>
              <th className="py-1.5 pr-2 text-center text-[11px] font-medium text-muted">
                Enabled
              </th>
              <th className="py-1.5 pr-3 text-right text-[11px] font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <AgentRow
                key={agent.slug}
                agent={agent}
                health={healthMap[agent.slug]}
                onCheckHealth={() => void refreshHealth(agent.slug)}
                isExpanded={expandedSlug === agent.slug}
                onToggle={() => handleToggle(agent.slug)}
                onInstall={() => void handleInstall(agent.slug)}
                onCancelInstall={() => handleCancelInstall(agent.slug)}
                isInstalling={installingSlugs.has(agent.slug)}
                installOutput={installOutput[agent.slug] ?? ""}
                installResult={installResults[agent.slug] ?? null}
                enabled={isEnabled(agent.slug)}
                onToggleEnabled={() => void toggleEnabled(agent.slug)}
                preferences={getPrefs(agent.slug)}
                onUpdatePreferences={(prefs) => void updatePrefs(agent.slug, prefs)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="text-muted text-[11px]">
        {detectedAgents.length} detected, {missingAgents.length} available to install
      </div>
    </div>
  );
}

interface AgentRowProps {
  agent: CliAgentDetectionResult;
  health?: AgentHealthStatus;
  onCheckHealth: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  onInstall: () => void;
  onCancelInstall: () => void;
  isInstalling: boolean;
  installOutput: string;
  installResult: { success: boolean; message: string } | null;
  enabled: boolean;
  onToggleEnabled: () => void;
  preferences: CliAgentPreferences;
  onUpdatePreferences: (prefs: CliAgentPreferences) => void;
}

function AgentRow({
  agent,
  health,
  onCheckHealth,
  isExpanded,
  onToggle,
  onInstall,
  onCancelInstall,
  isInstalling,
  installOutput,
  installResult,
  enabled,
  onToggleEnabled,
  preferences,
  onUpdatePreferences,
}: AgentRowProps) {
  const [draftFlags, setDraftFlags] = useState(preferences.defaultFlags ?? "");
  const [draftEnv, setDraftEnv] = useState(
    preferences.env
      ? Object.entries(preferences.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : ""
  );
  const [draftTimeout, setDraftTimeout] = useState(
    preferences.timeoutMs ? String(preferences.timeoutMs / 1000) : ""
  );
  const [saved, setSaved] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [installOutput]);

  const handleSavePrefs = () => {
    const envRecord: Record<string, string> = {};
    if (draftEnv.trim()) {
      for (const line of draftEnv.split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          envRecord[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
        }
      }
    }
    const timeoutMs = draftTimeout ? Math.round(parseFloat(draftTimeout) * 1000) : undefined;
    onUpdatePreferences({
      enabled,
      defaultFlags: draftFlags || undefined,
      env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
      timeoutMs: timeoutMs && timeoutMs > 0 ? timeoutMs : undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <React.Fragment>
      {/* Main row */}
      <tr
        className={`border-border-medium group cursor-pointer border-b transition-colors ${
          isExpanded ? "bg-background-secondary/40" : "hover:bg-background-secondary/30"
        }`}
        onClick={onToggle}
      >
        {/* Agent name + icon */}
        <td className="py-2 pl-3 pr-2">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="text-muted h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="text-muted h-3 w-3 shrink-0" />
            )}
            <CliAgentWithIcon
              slug={agent.slug}
              displayName={agent.displayName}
              className="text-foreground text-xs font-medium"
            />
          </div>
        </td>

        {/* Status dot + label */}
        <td className="py-2 pr-2">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                agent.detected
                  ? "bg-accent"
                  : isInstalling
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-border-medium"
              }`}
            />
            <span
              className={`text-[11px] ${
                agent.detected ? "text-accent" : isInstalling ? "text-yellow-500" : "text-muted"
              }`}
            >
              {agent.detected ? "Detected" : isInstalling ? "Installing..." : "Not installed"}
            </span>
          </div>
        </td>

        {/* Health */}
        <td className="py-2 pr-2">
          {agent.detected ? (
            <div className="flex items-center gap-1.5">
              <div
                className={`h-1.5 w-1.5 rounded-full ${
                  !health || health.status === "checking"
                    ? "bg-blue-400 animate-pulse"
                    : health.status === "healthy"
                      ? "bg-green-500"
                      : health.status === "unhealthy"
                        ? "bg-orange-500"
                        : "bg-border-medium"
                }`}
              />
              <span
                className={`text-[11px] ${
                  !health || health.status === "checking"
                    ? "text-blue-400"
                    : health.status === "healthy"
                      ? "text-green-500"
                      : health.status === "unhealthy"
                        ? "text-orange-500"
                        : "text-muted"
                }`}
                title={health?.message}
              >
                {!health || health.status === "checking"
                  ? "Checking..."
                  : health.status === "healthy"
                    ? "Healthy"
                    : health.status === "unhealthy"
                      ? "Unhealthy"
                      : "Unknown"}
              </span>
              <button
                type="button"
                className="text-muted hover:text-accent ml-0.5 p-0.5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckHealth();
                }}
                title="Re-check health"
              >
                <Heart className="h-2.5 w-2.5" />
              </button>
            </div>
          ) : null}
        </td>

        {/* Version */}
        <td className="py-2 pr-2">
          <span className="font-mono text-[11px] text-muted">
            {agent.version ?? (agent.detected ? "—" : "")}
          </span>
        </td>

        {/* Enable/Disable toggle */}
        <td className="py-2 pr-2 text-center">
          {agent.detected && (
            <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={enabled}
                onCheckedChange={() => onToggleEnabled()}
                aria-label={`${enabled ? "Disable" : "Enable"} ${agent.displayName}`}
              />
            </div>
          )}
        </td>

        {/* Actions */}
        <td className="py-2 pr-3">
          <div className="flex items-center justify-end gap-1.5">
            {!agent.detected && agent.installCommand && !isInstalling && (
              <button
                type="button"
                className="text-accent hover:text-accent-light p-0.5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onInstall();
                }}
                title="Install"
              >
                <Download className="h-3 w-3" />
              </button>
            )}
            {isInstalling && (
              <button
                type="button"
                className="text-red-400 hover:text-red-300 p-0.5 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelInstall();
                }}
                title="Cancel install"
              >
                <Square className="h-3 w-3" />
              </button>
            )}
            <a
              href={agent.installUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-accent p-0.5 transition-colors"
              onClick={(e) => e.stopPropagation()}
              title="Documentation"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </td>
      </tr>

      {/* Expanded detail row */}
      {isExpanded && (
        <tr className="border-border-medium border-b">
          <td colSpan={6} className="bg-background-secondary/20 px-4 py-3">
            <div className="ml-5 space-y-3">
              <div className="text-muted text-[11px]">{agent.description}</div>

              {agent.detected && agent.binaryPath && (
                <div className="flex items-center gap-2 text-[11px]">
                  <Terminal className="text-muted h-3 w-3" />
                  <code className="text-accent">{agent.binaryPath}</code>
                </div>
              )}

              {!agent.detected && agent.installCommand && !isInstalling && !installResult && (
                <div className="space-y-2">
                  <div className="text-muted text-[11px]">
                    Install: <code className="text-accent">{agent.installCommand}</code>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onInstall}
                    className="h-6 gap-1.5 px-2.5 text-[11px]"
                  >
                    <Download className="h-3 w-3" />
                    Install Now
                  </Button>
                </div>
              )}

              {/* Streaming install output */}
              {(isInstalling || installOutput) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted">
                      <Terminal className="h-3 w-3" />
                      Install output
                    </div>
                    {isInstalling && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onCancelInstall}
                        className="h-5 gap-1 px-1.5 text-[10px] text-red-400 hover:text-red-300"
                      >
                        <Square className="h-2.5 w-2.5" />
                        Cancel
                      </Button>
                    )}
                  </div>
                  <pre
                    ref={outputRef}
                    className="bg-dark border-border-medium max-h-40 overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed text-foreground/80"
                  >
                    {installOutput || (isInstalling ? "Starting install...\n" : "")}
                    {isInstalling && <span className="text-yellow-500 animate-pulse">█</span>}
                  </pre>
                </div>
              )}

              {!agent.detected && !agent.installCommand && (
                <div className="text-muted text-[11px]">
                  Visit{" "}
                  <a
                    href={agent.installUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {agent.installUrl}
                  </a>{" "}
                  to install.
                </div>
              )}

              {installResult && (
                <div
                  className={`text-[11px] ${installResult.success ? "text-green-500" : "text-red-400"}`}
                >
                  {installResult.message}
                </div>
              )}

              {/* Per-agent configuration — only for detected agents */}
              {agent.detected && (
                <div className="border-border-medium/50 space-y-2.5 border-t pt-3">
                  <span className="text-muted text-[11px] font-medium">Employee Configuration</span>

                  {/* Default CLI flags */}
                  <div className="space-y-1">
                    <label className="text-muted text-[10px]">
                      Default flags (appended to every run)
                    </label>
                    <input
                      type="text"
                      value={draftFlags}
                      onChange={(e) => setDraftFlags(e.target.value)}
                      placeholder="e.g. --verbose --output-format stream-json"
                      className="border-border-medium bg-dark text-foreground placeholder:text-muted/50 focus:border-accent h-6 w-full rounded border px-2 font-mono text-[11px] focus:outline-none"
                    />
                  </div>

                  {/* Environment variables */}
                  <div className="space-y-1">
                    <label className="text-muted text-[10px]">
                      Environment variables (one per line, KEY=VALUE)
                    </label>
                    <textarea
                      value={draftEnv}
                      onChange={(e) => setDraftEnv(e.target.value)}
                      placeholder={"ANTHROPIC_MODEL=claude-sonnet-4-20250514\nLOG_LEVEL=debug"}
                      rows={2}
                      className="border-border-medium bg-dark text-foreground placeholder:text-muted/50 focus:border-accent w-full resize-none rounded border px-2 py-1 font-mono text-[11px] leading-relaxed focus:outline-none"
                    />
                  </div>

                  {/* Timeout */}
                  <div className="space-y-1">
                    <label className="text-muted text-[10px]">
                      Timeout (seconds, blank = default 300s)
                    </label>
                    <input
                      type="number"
                      value={draftTimeout}
                      onChange={(e) => setDraftTimeout(e.target.value)}
                      placeholder="300"
                      min={10}
                      max={3600}
                      className="border-border-medium bg-dark text-foreground placeholder:text-muted/50 focus:border-accent h-6 w-24 rounded border px-2 font-mono text-[11px] focus:outline-none"
                    />
                  </div>

                  {/* Save button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSavePrefs}
                    className="h-6 gap-1.5 px-2.5 text-[11px]"
                  >
                    {saved ? (
                      <>
                        <Check className="h-3 w-3 text-green-500" />
                        Saved
                      </>
                    ) : (
                      <>
                        <Save className="h-3 w-3" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
