/**
 * Agent Execution Panel
 *
 * Full-featured panel for selecting a CLI agent, sending a prompt,
 * and viewing streaming output. Integrates with the orchestration service
 * via the useCliAgentExecution hook.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Square,
  Loader2,
  Terminal,
  ChevronDown,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { CliAgentWithIcon } from "@/browser/components/CliAgentIcon";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { useCliAgentExecution } from "@/browser/hooks/useCliAgentExecution";
import type { AgentSession, AgentRunResult } from "@/common/orpc/types";
import { cn } from "@/common/lib/utils";

interface AgentExecutionPanelProps {
  projectPath: string;
  className?: string;
  /** Workspace ID for runtime-aware agent detection (SSH/Docker) */
  workspaceId?: string;
}

export function AgentExecutionPanel({ projectPath, className, workspaceId }: AgentExecutionPanelProps) {
  const { detectedAgents, loading: detectLoading } = useCliAgentDetection(workspaceId);
  const { run, stop, running, sessions, refreshSessions, lastResult } = useCliAgentExecution();

  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [prompt, setPrompt] = useState("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [history, setHistory] = useState<AgentRunResult[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const outputRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Auto-select first detected agent
  useEffect(() => {
    if (!selectedSlug && detectedAgents.length > 0) {
      setSelectedSlug(detectedAgents[0].slug);
    }
  }, [detectedAgents, selectedSlug]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lastResult?.output, sessions]);

  // Close picker on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    }
    if (showAgentPicker) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showAgentPicker]);

  // Poll sessions while running
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      void refreshSessions();
    }, 1000);
    return () => clearInterval(interval);
  }, [running, refreshSessions]);

  const handleRun = useCallback(async () => {
    if (!selectedSlug || !prompt.trim() || running) return;

    const result = await run({
      slug: selectedSlug,
      prompt: prompt.trim(),
      cwd: projectPath,
      timeoutMs: 5 * 60 * 1000,
    });

    if (result) {
      setActiveSessionId(result.sessionId);
      setHistory((prev) => [result, ...prev]);
    }
  }, [selectedSlug, prompt, running, run, projectPath]);

  const handleStop = useCallback(async () => {
    if (activeSessionId) {
      await stop(activeSessionId);
    }
  }, [activeSessionId, stop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleRun();
      }
    },
    [handleRun]
  );

  const selectedAgent = detectedAgents.find((a) => a.slug === selectedSlug);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  if (detectLoading) {
    return (
      <div className={cn("flex items-center justify-center gap-2 py-12", className)}>
        <Loader2 className="text-muted h-5 w-5 animate-spin" />
        <span className="text-muted text-xs">Detecting agents...</span>
      </div>
    );
  }

  if (detectedAgents.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
        <Terminal className="text-muted h-8 w-8" />
        <p className="text-muted text-xs">No providers detected. Install one to get started.</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Agent selector + prompt input */}
      <div className="border-border-medium bg-background-secondary/30 rounded-lg border p-3">
        {/* Agent picker row */}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setShowAgentPicker(!showAgentPicker)}
              className="border-border-medium bg-separator hover:bg-hover flex h-7 items-center gap-1.5 rounded border px-2 text-xs transition-colors"
            >
              {selectedAgent ? (
                <CliAgentWithIcon
                  slug={selectedAgent.slug}
                  displayName={selectedAgent.displayName}
                  iconClassName="h-3.5 w-3.5"
                  className="text-foreground text-xs font-medium"
                />
              ) : (
                <span className="text-muted">Select agent</span>
              )}
              <ChevronDown className="text-muted h-3 w-3" />
            </button>

            {/* Dropdown */}
            {showAgentPicker && (
              <div className="bg-dark border-border absolute top-full left-0 z-50 mt-1 min-w-[200px] overflow-hidden rounded-md border shadow-lg">
                {detectedAgents.map((agent) => (
                  <button
                    key={agent.slug}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      agent.slug === selectedSlug
                        ? "bg-accent/15 text-accent"
                        : "text-foreground hover:bg-hover"
                    )}
                    onClick={() => {
                      setSelectedSlug(agent.slug);
                      setShowAgentPicker(false);
                    }}
                  >
                    <CliAgentWithIcon
                      slug={agent.slug}
                      displayName={agent.displayName}
                      iconClassName="h-3.5 w-3.5"
                      className="text-xs"
                    />
                    {agent.version && (
                      <span className="text-muted ml-auto font-mono text-[10px]">
                        {agent.version.split(" ").pop()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Run / Stop buttons */}
          <div className="ml-auto flex items-center gap-1.5">
            {running ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleStop()}
                className="h-7 gap-1.5 px-2.5 text-[11px]"
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => void handleRun()}
                disabled={!selectedSlug || !prompt.trim()}
                className="h-7 gap-1.5 px-2.5 text-[11px]"
              >
                <Play className="h-3 w-3" />
                Run
              </Button>
            )}
          </div>
        </div>

        {/* Prompt textarea */}
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a prompt for the agent..."
          rows={3}
          disabled={running}
          className={cn(
            "border-border-medium bg-dark w-full resize-none rounded border p-2 font-mono text-xs",
            "text-foreground placeholder:text-muted focus:border-accent focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        />
      </div>

      {/* Active execution output */}
      {(running || lastResult) && (
        <div className="border-border-medium rounded-lg border">
          {/* Header */}
          <div className="border-border-medium flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2">
              {running ? (
                <Loader2 className="text-accent h-3.5 w-3.5 animate-spin" />
              ) : lastResult?.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              )}
              <span className="text-foreground text-xs font-medium">
                {running
                  ? `Running ${selectedAgent?.displayName ?? selectedSlug}...`
                  : lastResult?.success
                    ? "Completed"
                    : "Failed"}
              </span>
            </div>
            {lastResult && !running && (
              <div className="flex items-center gap-2 text-[10px]">
                <Clock className="text-muted h-3 w-3" />
                <span className="text-muted">{(lastResult.durationMs / 1000).toFixed(1)}s</span>
                {lastResult.exitCode !== undefined && (
                  <span className="text-muted">exit {lastResult.exitCode}</span>
                )}
              </div>
            )}
          </div>

          {/* Output */}
          <pre
            ref={outputRef}
            className={cn(
              "m-0 max-h-[400px] overflow-auto p-3 font-mono text-[11px] leading-relaxed",
              "whitespace-pre-wrap break-all",
              "bg-black/30 text-light"
            )}
          >
            {running ? (activeSession?.output ?? "Starting agent...") : (lastResult?.output ?? "")}
          </pre>
        </div>
      )}

      {/* Execution history */}
      {history.length > 1 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted text-[11px] font-medium">Recent Runs</span>
            <button
              type="button"
              onClick={() => setHistory([])}
              className="text-muted hover:text-foreground text-[10px] transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {history.slice(1, 6).map((result, idx) => (
            <div
              key={result.sessionId || idx}
              className="border-border-medium/50 flex items-center gap-2 rounded border px-2 py-1"
            >
              {result.success ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
              ) : (
                <XCircle className="h-3 w-3 shrink-0 text-red-400" />
              )}
              <span className="text-foreground min-w-0 flex-1 truncate text-[10px]">
                {result.output.slice(0, 80).replace(/\n/g, " ")}
              </span>
              <span className="text-muted shrink-0 text-[10px]">
                {(result.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
