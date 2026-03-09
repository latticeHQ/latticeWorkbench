import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Loader2,
  MessageCircle,
  Search,
  Server,
  Users,
  XCircle,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

/** All Parallel AI tools with metadata for the capability grid. */
const PARALLEL_TOOLS = [
  {
    name: "parallel_search",
    label: "Search",
    icon: Search,
    desc: "Web search with ranked results & excerpts",
    tier: "Core",
  },
  {
    name: "parallel_extract",
    label: "Extract",
    icon: FileText,
    desc: "Content extraction from URLs",
    tier: "Core",
  },
  {
    name: "parallel_research",
    label: "Research",
    icon: BookOpen,
    desc: "Deep multi-source research reports",
    tier: "Core",
  },
  {
    name: "parallel_findall",
    label: "FindAll",
    icon: Users,
    desc: "Web-scale entity discovery",
    tier: "Beta",
  },
  {
    name: "parallel_chat",
    label: "Chat",
    icon: MessageCircle,
    desc: "Web-grounded Q&A with citations",
    tier: "Beta",
  },
  {
    name: "parallel_batch",
    label: "Batch",
    icon: Layers,
    desc: "Parallel batch processing at scale",
    tier: "Beta",
  },
  {
    name: "parallel_monitor",
    label: "Monitor",
    icon: Activity,
    desc: "Web change tracking & alerts",
    tier: "Alpha",
  },
] as const;

export function IntegrationsSection() {
  const { api } = useAPI();

  // API key state
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState("");

  // MCP server state
  const [mcpRegistered, setMcpRegistered] = useState(false);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");

  // Load existing API key + check MCP server status
  const loadState = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const secrets = await api.secrets.get({});
      const existing = secrets.find(
        (s: any) => s.key === "PARALLEL_API_KEY"
      );
      if (existing && typeof existing.value === "string") {
        setApiKey(existing.value);
        setSavedKey(existing.value);
      }

      // Check if MCP server is registered
      try {
        const mcpServers = await api.mcp.list({});
        const serverMap =
          mcpServers && typeof mcpServers === "object" ? mcpServers : {};
        setMcpRegistered("parallel-ai" in serverMap);
      } catch {
        // MCP list may fail if not configured
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

  const saveApiKey = useCallback(async () => {
    if (!api) return;
    setSaving(true);
    try {
      const secrets = await api.secrets.get({});
      const filtered = secrets.filter(
        (s: any) => s.key !== "PARALLEL_API_KEY"
      );
      if (apiKey.trim()) {
        filtered.push({ key: "PARALLEL_API_KEY", value: apiKey.trim() });
      }
      await api.secrets.update({ secrets: filtered });
      setSavedKey(apiKey.trim());
      setConnectionStatus("idle");
    } catch (err) {
      console.error("Failed to save API key:", err);
    } finally {
      setSaving(false);
    }
  }, [api, apiKey]);

  const testConnection = useCallback(async () => {
    if (!apiKey.trim()) {
      setConnectionStatus("error");
      setConnectionError("No API key configured");
      return;
    }

    setConnectionStatus("testing");
    setConnectionError("");

    try {
      const { Parallel } = await import("parallel-web");
      const client = new Parallel({ apiKey: apiKey.trim() });

      await client.beta.search({
        objective: "test connection",
        max_results: 1,
      });

      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      setConnectionError(
        err instanceof Error ? err.message : "Connection failed"
      );
    }
  }, [apiKey]);

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
        err instanceof Error ? err.message : "Failed to register MCP server"
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
        err instanceof Error ? err.message : "Failed to remove MCP server"
      );
    } finally {
      setMcpLoading(false);
    }
  }, [api]);

  const hasUnsavedChanges = apiKey !== savedKey;
  const hasKey = savedKey.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-sm font-medium mb-1">Integrations</h3>
        <p className="text-xs text-muted-foreground">
          Configure external service integrations for enhanced agent
          capabilities.
        </p>
      </div>

      {/* Parallel AI Card */}
      <div className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">Parallel AI</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Full-spectrum web intelligence: search, extract, research, entity
              discovery, chat, batch processing, and monitoring.
            </p>
          </div>
          {connectionStatus === "connected" && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          )}
          {connectionStatus === "error" && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <XCircle className="h-3.5 w-3.5" />
              Error
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            {/* API Key Input */}
            <div className="space-y-2">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="parallel-api-key"
              >
                API Key
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="parallel-api-key"
                    type={showKey ? "text" : "password"}
                    placeholder="Enter your Parallel AI API key"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setConnectionStatus("idle");
                    }}
                    className="pr-8 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void saveApiKey()}
                  disabled={saving || !hasUnsavedChanges}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void testConnection()}
                  disabled={connectionStatus === "testing" || !apiKey.trim()}
                >
                  {connectionStatus === "testing" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
            </div>

            {connectionError && (
              <p className="text-xs text-red-500">{connectionError}</p>
            )}

            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
              <a
                href="https://parallel.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                parallel.ai
              </a>
            </p>

            {/* Available Tools Grid */}
            <div className="space-y-2 pt-2 border-t">
              <h5 className="text-xs font-medium text-muted-foreground">
                Available Tools ({PARALLEL_TOOLS.length})
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {PARALLEL_TOOLS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <div
                      key={t.name}
                      className="flex items-center gap-2 rounded border px-2.5 py-2"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">
                            {t.label}
                          </span>
                          <span
                            className={`text-[9px] px-1 py-0.5 rounded-full font-medium ${
                              t.tier === "Core"
                                ? "bg-green-500/10 text-green-500"
                                : t.tier === "Beta"
                                  ? "bg-blue-500/10 text-blue-500"
                                  : "bg-orange-500/10 text-orange-500"
                            }`}
                          >
                            {t.tier}
                          </span>
                          {hasKey && (
                            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0 ml-auto" />
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {t.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MCP Server Section */}
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <h5 className="text-xs font-medium">MCP Server</h5>
                    <p className="text-[10px] text-muted-foreground">
                      search-mcp.parallel.ai/mcp (SSE transport)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {mcpRegistered ? (
                    <>
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <CheckCircle2 className="h-3 w-3" />
                        Registered
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void disableMcpServer()}
                        disabled={mcpLoading}
                      >
                        {mcpLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Remove"
                        )}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void enableMcpServer()}
                      disabled={mcpLoading || !hasKey}
                    >
                      {mcpLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Enable MCP Server"
                      )}
                    </Button>
                  )}
                </div>
              </div>
              {mcpError && <p className="text-xs text-red-500">{mcpError}</p>}
              {!hasKey && !mcpRegistered && (
                <p className="text-[10px] text-muted-foreground">
                  Save an API key first to enable the MCP server.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
