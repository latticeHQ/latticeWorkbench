/**
 * MinionToolBadges — compact badge chips showing model, provider, agent,
 * terminal profile, runtime, and MCP skills.
 *
 * Reads from:
 *   - FrontendMinionMetadata (agentId, runtimeConfig, taskModelString, aiSettings)
 *   - useMinionSidebarState  (currentModel, loadedSkills, terminalActiveCount)
 *   - useAPI → terminal.listSessions (profileId per terminal session)
 */
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/common/lib/utils";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { useMinionSidebarState } from "@/browser/stores/MinionStore";
import { useAPI } from "@/browser/contexts/API";
import {
  Brain, Cpu, Bot, Monitor, Wrench, Terminal,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Model string parser
// ─────────────────────────────────────────────────────────────────────────────

interface ModelInfo {
  provider: string;
  model: string;
  short: string; // abbreviated model name for badges
}

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "vertex-ai": "Vertex",
  bedrock: "Bedrock",
  fireworks: "Fireworks",
  together: "Together",
  groq: "Groq",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  openrouter: "OpenRouter",
  copilot: "Copilot",
};

/** Display-friendly names for known terminal profiles. */
const PROFILE_DISPLAY: Record<string, string> = {
  "claude-code": "Claude Code",
  "gemini-cli": "Gemini CLI",
  "github-copilot": "Copilot",
  codex: "Codex",
  aider: "Aider",
  amp: "Amp",
};

/** Abbreviate long model names for badge display. */
function abbreviateModel(raw: string): string {
  if (/claude-sonnet-4/i.test(raw)) return "Sonnet 4";
  if (/claude-opus-4/i.test(raw)) return "Opus 4";
  if (/claude-3[.-]5-sonnet/i.test(raw)) return "Sonnet 3.5";
  if (/claude-3[.-]5-haiku/i.test(raw)) return "Haiku 3.5";
  if (/claude-3-opus/i.test(raw)) return "Opus 3";
  if (/claude-3-sonnet/i.test(raw)) return "Sonnet 3";
  if (/claude-3-haiku/i.test(raw)) return "Haiku 3";
  if (/gpt-4o-mini/i.test(raw)) return "4o-mini";
  if (/gpt-4o/i.test(raw)) return "GPT-4o";
  if (/gpt-4-turbo/i.test(raw)) return "4-Turbo";
  if (/gpt-4/i.test(raw)) return "GPT-4";
  if (/o3-mini/i.test(raw)) return "o3-mini";
  if (/o3/i.test(raw)) return "o3";
  if (/o1-mini/i.test(raw)) return "o1-mini";
  if (/o1/i.test(raw)) return "o1";
  if (/gemini-2/i.test(raw)) return "Gemini 2";
  if (/gemini-1\.5-pro/i.test(raw)) return "Gemini Pro";
  if (/gemini-1\.5-flash/i.test(raw)) return "Gemini Flash";
  if (/deepseek-r1/i.test(raw)) return "R1";
  if (/deepseek-v3/i.test(raw)) return "V3";
  // Fallback: take last meaningful segment
  const parts = raw.split(/[-_]/);
  if (parts.length > 2) return parts.slice(-3, -1).join("-");
  return raw.length > 16 ? raw.slice(0, 14) + "…" : raw;
}

/** Infer provider from model name when not explicitly in the string. */
function inferProvider(model: string): string {
  if (/claude/i.test(model)) return "Anthropic";
  if (/gpt|o[13]/i.test(model)) return "OpenAI";
  if (/gemini/i.test(model)) return "Google";
  if (/deepseek/i.test(model)) return "DeepSeek";
  if (/mistral|mixtral/i.test(model)) return "Mistral";
  if (/llama/i.test(model)) return "Meta";
  return "";
}

export function parseModelInfo(modelString: string | null | undefined): ModelInfo | null {
  if (!modelString) return null;

  // Format: "provider:model-name" or just "model-name"
  const colonIdx = modelString.indexOf(":");
  let provider: string;
  let model: string;

  if (colonIdx > 0) {
    const rawProvider = modelString.slice(0, colonIdx);
    model = modelString.slice(colonIdx + 1);
    provider = PROVIDER_DISPLAY[rawProvider] ?? rawProvider;
  } else {
    model = modelString;
    provider = inferProvider(model);
  }

  return {
    provider,
    model,
    short: abbreviateModel(model),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime display
// ─────────────────────────────────────────────────────────────────────────────

function getRuntimeLabel(ws: FrontendMinionMetadata): string {
  const t = ws.runtimeConfig?.type;
  if (!t) return "local";
  if (t === "worktree") return "worktree";
  if (t === "ssh") return "SSH";
  if (t === "docker") return "Docker";
  if (t === "devcontainer") return "devcontainer";
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal profile hook — fetches active terminal profileIds per minion
// ─────────────────────────────────────────────────────────────────────────────

function useTerminalProfiles(minionId: string, sessionCount: number): string[] {
  const apiState = useAPI();
  const api = apiState.status === "connected" || apiState.status === "degraded"
    ? apiState.api
    : null;
  const [profiles, setProfiles] = useState<string[]>([]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    api.terminal.listSessions({ minionId }).then(sessions => {
      if (cancelled) return;
      const ids = sessions
        .map((s: { sessionId: string; profileId?: string | null }) => s.profileId)
        .filter((id): id is string => !!id);
      // Deduplicate
      setProfiles([...new Set(ids)]);
    }).catch(() => {
      // Silently ignore — terminal may not be available
    });

    return () => { cancelled = true; };
  }, [api, minionId, sessionCount]); // re-fetch when terminal sessions change

  return profiles;
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge chip
// ─────────────────────────────────────────────────────────────────────────────

function Badge({ icon: Icon, label, title, accent }: {
  icon: typeof Brain;
  label: string;
  title?: string;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-[2px] rounded-sm leading-tight",
        accent
          ? "bg-[var(--color-exec-mode)]/10 text-[var(--color-exec-mode)]/80"
          : "bg-muted/8 text-foreground/50"
      )}
      title={title}
    >
      <Icon className="h-2 w-2 shrink-0 opacity-60" />
      <span className="truncate max-w-[80px]">{label}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function MinionToolBadges({ ws, compact }: {
  ws: FrontendMinionMetadata;
  /** If true, show fewer badges (for crew rows). */
  compact?: boolean;
}) {
  const state = useMinionSidebarState(ws.id);
  const modelStr = state.currentModel ?? ws.taskModelString ?? ws.aiSettings?.model ?? null;
  const modelInfo = useMemo(() => parseModelInfo(modelStr), [modelStr]);
  const runtime = getRuntimeLabel(ws);
  const isLive = state.canInterrupt || state.isStarting;
  const termProfiles = useTerminalProfiles(ws.id, state.terminalSessionCount);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {/* Primary row: model + provider */}
      <div className="flex items-center gap-1 flex-wrap">
        {modelInfo?.short && (
          <Badge
            icon={Brain}
            label={modelInfo.short}
            title={modelInfo.model}
            accent={isLive}
          />
        )}
        {modelInfo?.provider && !compact && (
          <Badge icon={Cpu} label={modelInfo.provider} />
        )}
        {ws.agentId && (
          <Badge icon={Bot} label={ws.agentId} title={`Agent: ${ws.agentId}`} />
        )}
      </div>

      {/* Secondary row: terminal profiles + runtime + skills */}
      {!compact && (
        <div className="flex items-center gap-1 flex-wrap">
          {termProfiles.map(pid => (
            <Badge
              key={pid}
              icon={Terminal}
              label={PROFILE_DISPLAY[pid] ?? pid}
              title={`Terminal: ${pid}`}
              accent={state.terminalActiveCount > 0}
            />
          ))}
          <Badge icon={Monitor} label={runtime} title={`Runtime: ${runtime}`} />
          {state.loadedSkills.length > 0 && (
            <Badge
              icon={Wrench}
              label={`${state.loadedSkills.length} skill${state.loadedSkills.length !== 1 ? "s" : ""}`}
              title={state.loadedSkills.map(s => s.name).join(", ")}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Inline badge for crew cards — model + terminal profile. */
export function MinionModelBadge({ ws }: { ws: FrontendMinionMetadata }) {
  const state = useMinionSidebarState(ws.id);
  const modelStr = state.currentModel ?? ws.taskModelString ?? ws.aiSettings?.model ?? null;
  const modelInfo = useMemo(() => parseModelInfo(modelStr), [modelStr]);
  const termProfiles = useTerminalProfiles(ws.id, state.terminalSessionCount);

  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      {modelInfo?.short && (
        <span
          className="inline-flex items-center gap-0.5 text-[7px] font-mono px-1 py-[1px] rounded-sm bg-muted/8 text-foreground/40 leading-tight"
          title={modelInfo.model}
        >
          {modelInfo.short}
        </span>
      )}
      {termProfiles.length > 0 && (
        <span
          className="inline-flex items-center gap-0.5 text-[7px] font-mono px-1 py-[1px] rounded-sm bg-muted/8 text-foreground/35 leading-tight"
          title={termProfiles.join(", ")}
        >
          <Terminal className="h-1.5 w-1.5 opacity-50" />
          {PROFILE_DISPLAY[termProfiles[0]] ?? termProfiles[0]}
        </span>
      )}
    </div>
  );
}
