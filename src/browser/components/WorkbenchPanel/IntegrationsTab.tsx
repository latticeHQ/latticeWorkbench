/**
 * Integrations tab — Parallel AI dashboard for the WorkbenchPanel.
 *
 * Displays:
 *  1. Connection status & API key configuration link
 *  2. All 7 Parallel AI tools with status, tier badges, and usage hints
 *  3. MCP server registration status with enable/remove toggle
 */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  Layers,
  Loader2,
  MessageCircle,
  Search,
  Server,
  Settings,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";

/** Tool metadata for the capability grid. */
const PARALLEL_TOOLS = [
  {
    name: "parallel_search",
    label: "Search",
    icon: Search,
    desc: "Web search with ranked results and excerpts",
    hint: "Search the web for current information",
    tier: "Core" as const,
  },
  {
    name: "parallel_extract",
    label: "Extract",
    icon: FileText,
    desc: "Content extraction from URLs",
    hint: "Extract full page content from up to 5 URLs",
    tier: "Core" as const,
  },
  {
    name: "parallel_research",
    label: "Research",
    icon: BookOpen,
    desc: "Deep multi-source research reports",
    hint: "Run deep research with processor tiers (base → ultra)",
    tier: "Core" as const,
  },
  {
    name: "parallel_findall",
    label: "FindAll",
    icon: Users,
    desc: "Web-scale entity discovery with citations",
    hint: "Find all companies/people/products matching criteria",
    tier: "Beta" as const,
  },
  {
    name: "parallel_chat",
    label: "Chat",
    icon: MessageCircle,
    desc: "Web-grounded Q&A with live citations",
    hint: "Quick factual answers backed by real-time web data",
    tier: "Beta" as const,
  },
  {
    name: "parallel_batch",
    label: "Batch",
    icon: Layers,
    desc: "Parallel batch processing at scale",
    hint: "Process up to 50 items in parallel (enrichment, lookups)",
    tier: "Beta" as const,
  },
  {
    name: "parallel_monitor",
    label: "Monitor",
    icon: Activity,
    desc: "Web change tracking and alerts",
    hint: "Create monitors that track web changes over time",
    tier: "Alpha" as const,
  },
] as const;

const TIER_STYLES = {
  Core: "bg-green-500/10 text-green-500 border-green-500/20",
  Beta: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Alpha: "bg-orange-500/10 text-orange-500 border-orange-500/20",
} as const;

export interface IntegrationsTabProps {
  minionId: string;
}

export function IntegrationsTab(_props: IntegrationsTabProps) {
  const { api } = useAPI();

  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mcpRegistered, setMcpRegistered] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "connected" | "error"
  >("idle");

  const loadState = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const secrets = await api.secrets.get({});
      const existing = secrets.find(
        (s: any) => s.key === "PARALLEL_API_KEY"
      );
      setHasKey(
        Boolean(existing && typeof existing.value === "string" && existing.value.trim())
      );

      try {
        const mcpServers = await api.mcp.list({});
        const serverMap =
          mcpServers && typeof mcpServers === "object" ? mcpServers : {};
        setMcpRegistered("parallel-ai" in serverMap);
      } catch {
        // MCP list may not be available
      }
    } catch (err) {
      console.error("Failed to load integrations state:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const testConnection = useCallback(async () => {
    if (!api) return;
    setTestStatus("testing");
    try {
      const secrets = await api.secrets.get({});
      const existing = secrets.find(
        (s: any) => s.key === "PARALLEL_API_KEY"
      );
      const key =
        existing && typeof existing.value === "string"
          ? existing.value.trim()
          : "";
      if (!key) {
        setTestStatus("error");
        return;
      }
      const { Parallel } = await import("parallel-web");
      const client = new Parallel({ apiKey: key });
      await client.beta.search({ objective: "test", max_results: 1 });
      setTestStatus("connected");
    } catch {
      setTestStatus("error");
    }
  }, [api]);

  const enableMcpServer = useCallback(async () => {
    if (!api) return;
    setMcpLoading(true);
    setMcpError("");
    try {
      await api.mcp.add({
        name: "parallel-ai",
        transport: "sse",
        url: "https://search-mcp.parallel.ai/mcp",
        headers: { Authorization: { secret: "PARALLEL_API_KEY" } },
      } as any);
      setMcpRegistered(true);
    } catch (err) {
      setMcpError(
        err instanceof Error ? err.message : "Failed to enable MCP server"
      );
    } finally {
      setMcpLoading(false);
    }
  }, [api]);

  const disableMcpServer = useCallback(async () => {
    if (!api) return;
    setMcpLoading(true);
    setMcpError("");
    try {
      await api.mcp.remove({ name: "parallel-ai" });
      setMcpRegistered(false);
    } catch (err) {
      setMcpError(
        err instanceof Error ? err.message : "Failed to disable MCP server"
      );
    } finally {
      setMcpLoading(false);
    }
  }, [api]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading integrations...
      </div>
    );
  }

  return (
    <div className="text-light font-primary text-[13px] leading-relaxed p-4 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Parallel AI</h2>
          <a
            href="https://parallel.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status */}
          {hasKey ? (
            <span className="flex items-center gap-1 text-[11px] text-green-500">
              <CheckCircle2 className="h-3 w-3" />
              API Key Configured
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <XCircle className="h-3 w-3" />
              Not Configured
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => void testConnection()}
            disabled={testStatus === "testing" || !hasKey}
          >
            {testStatus === "testing" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : testStatus === "connected" ? (
              <span className="flex items-center gap-1 text-green-500">
                <Zap className="h-3 w-3" />
                Live
              </span>
            ) : (
              "Test"
            )}
          </Button>
        </div>
      </div>

      {/* Configure prompt if no key */}
      {!hasKey && (
        <div className="rounded-md border border-dashed p-3 text-center space-y-2">
          <Settings className="h-5 w-5 text-muted-foreground mx-auto" />
          <p className="text-xs text-muted-foreground">
            Configure your API key in{" "}
            <span className="font-medium text-foreground">
              Settings → Integrations
            </span>{" "}
            to enable all Parallel AI tools.
          </p>
        </div>
      )}

      {/* Tool Cards Grid */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Agent Tools ({PARALLEL_TOOLS.length})
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {PARALLEL_TOOLS.map((t) => {
            const Icon = t.icon;
            const tierStyle = TIER_STYLES[t.tier];
            return (
              <div
                key={t.name}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                  hasKey
                    ? "bg-card hover:bg-accent/50"
                    : "opacity-60"
                }`}
              >
                <div
                  className={`rounded-md p-1.5 ${
                    hasKey
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{t.label}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${tierStyle}`}
                    >
                      {t.tier}
                    </span>
                    {hasKey && (
                      <CheckCircle2 className="h-3 w-3 text-green-500 ml-auto shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.desc}
                  </p>
                  <code className="text-[10px] text-muted-foreground/70 bg-muted px-1 py-0.5 rounded mt-1 inline-block">
                    {t.name}
                  </code>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MCP Server Section */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          MCP Server
        </h3>
        <div className="rounded-lg border px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium">
                  search-mcp.parallel.ai
                </p>
                <p className="text-[10px] text-muted-foreground">
                  SSE transport · Uses PARALLEL_API_KEY secret
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {mcpRegistered ? (
                <>
                  <span className="flex items-center gap-1 text-[11px] text-green-500">
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => void disableMcpServer()}
                    disabled={mcpLoading}
                  >
                    {mcpLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      "Remove"
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => void enableMcpServer()}
                  disabled={mcpLoading || !hasKey}
                >
                  {mcpLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Enable"
                  )}
                </Button>
              )}
            </div>
          </div>
          {mcpError && (
            <p className="text-[11px] text-red-500 mt-1">{mcpError}</p>
          )}
          {!hasKey && !mcpRegistered && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Save an API key in Settings → Integrations first.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
