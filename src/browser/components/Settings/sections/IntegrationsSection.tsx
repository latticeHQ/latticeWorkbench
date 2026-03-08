import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";

type ConnectionStatus = "idle" | "testing" | "connected" | "error";

export function IntegrationsSection() {
  const { api } = useAPI();

  // Parallel AI state
  const [apiKey, setApiKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState("");

  // Load existing API key from secrets
  const loadApiKey = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const secrets = await api.secrets.get({});
      const existing = secrets.find((s) => s.key === "PARALLEL_API_KEY");
      if (existing && typeof existing.value === "string") {
        setApiKey(existing.value);
        setSavedKey(existing.value);
      }
    } catch (err) {
      console.error("Failed to load secrets:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadApiKey();
  }, [loadApiKey]);

  const saveApiKey = useCallback(async () => {
    if (!api) return;
    setSaving(true);
    try {
      // Load all existing secrets, update PARALLEL_API_KEY, save back
      const secrets = await api.secrets.get({});
      const filtered = secrets.filter((s) => s.key !== "PARALLEL_API_KEY");
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

      // Simple search to verify the key works
      await client.beta.search({
        objective: "test connection",
        max_results: 1,
      });

      setConnectionStatus("connected");
    } catch (err) {
      setConnectionStatus("error");
      setConnectionError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [apiKey]);

  const hasUnsavedChanges = apiKey !== savedKey;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Integrations</h3>
        <p className="text-xs text-muted-foreground">
          Configure external service integrations for enhanced agent capabilities.
        </p>
      </div>

      {/* Parallel AI */}
      <div className="rounded-md border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium">Parallel AI</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Web search, content extraction, and deep research for agents.
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
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground" htmlFor="parallel-api-key">
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
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
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
              . Enables <code className="text-[10px] bg-muted px-1 py-0.5 rounded">parallel_search</code>,{" "}
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded">parallel_extract</code>, and{" "}
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded">parallel_research</code> tools.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
