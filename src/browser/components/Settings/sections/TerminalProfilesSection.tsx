/**
 * Terminal Profiles settings crew — auto-detects installed CLIs and lets
 * users enable/disable, install, and configure AI agent terminal profiles.
 *
 * Follows the same card-based pattern as ProvidersSection:
 * - Status dots (green = installed + enabled, gray = not installed, yellow = disabled)
 * - Install button opens a terminal running the install command
 * - Toggle enable/disable per profile
 * - Expandable details for command override, args, env
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Terminal } from "lucide-react";

import { Switch } from "@/browser/components/ui/switch";
import { Button } from "@/browser/components/ui/button";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type { TerminalProfileWithStatus } from "@/common/types/terminalProfile";
import type { InstallRecipe } from "@/common/constants/terminalProfiles";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; profiles: TerminalProfileWithStatus[] }
  | { status: "error"; message: string };

function statusDotColor(profile: TerminalProfileWithStatus): string {
  if (!profile.detection.installed) return "bg-border-medium";
  return profile.config.enabled ? "bg-success" : "bg-warning";
}

function statusDotTitle(profile: TerminalProfileWithStatus): string {
  if (!profile.detection.installed) return "Not installed";
  return profile.config.enabled ? "Installed & enabled" : "Installed but disabled";
}

function installMethodLabel(recipe: InstallRecipe): string {
  switch (recipe.method) {
    case "npm":
      return "npm";
    case "pip":
      return "pip";
    case "brew":
      return "Homebrew";
    case "curl":
      return "curl";
    case "gh-extension":
      return "gh extension";
    default:
      return recipe.method;
  }
}

export function TerminalProfilesSection() {
  const { api } = useAPI();
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  // Track in-flight config saves to avoid clobbering
  const savingRef = useRef<Set<string>>(new Set());

  // Fetch profiles on mount + when API becomes available
  const fetchProfiles = () => {
    if (!api) return;
    setLoadState({ status: "loading" });
    api.terminalProfiles
      .list()
      .then((profiles: TerminalProfileWithStatus[]) => {
        setLoadState({ status: "loaded", profiles });
      })
      .catch((err: unknown) => {
        setLoadState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load profiles",
        });
      });
  };

  useEffect(() => {
    fetchProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fetch when api changes
  }, [api]);

  const handleToggleEnabled = (profile: TerminalProfileWithStatus) => {
    // Can't enable a profile that isn't installed
    if (!api || savingRef.current.has(profile.id) || !profile.detection.installed) return;
    const nextEnabled = !profile.config.enabled;

    // Optimistic update
    if (loadState.status === "loaded") {
      setLoadState({
        status: "loaded",
        profiles: loadState.profiles.map((p) =>
          p.id === profile.id ? { ...p, config: { ...p.config, enabled: nextEnabled } } : p
        ),
      });
    }

    savingRef.current.add(profile.id);
    api.terminalProfiles
      .setConfig({
        profileId: profile.id,
        config: { ...profile.config, enabled: nextEnabled },
      })
      .catch(() => {
        // Revert on failure
        if (loadState.status === "loaded") {
          setLoadState({
            status: "loaded",
            profiles: loadState.profiles.map((p) =>
              p.id === profile.id ? { ...p, config: { ...p.config, enabled: !nextEnabled } } : p
            ),
          });
        }
      })
      .finally(() => {
        savingRef.current.delete(profile.id);
      });
  };

  const handleToggleExpanded = (profileId: string) => {
    setExpandedProfile((prev) => (prev === profileId ? null : profileId));
  };

  // Idle or loading states
  if (loadState.status === "idle" || loadState.status === "loading") {
    return (
      <div className="space-y-4">
        <CrewHeader />
        <div className="text-muted flex items-center gap-2 py-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Detecting installed CLI tools...
        </div>
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div className="space-y-4">
        <CrewHeader />
        <div className="text-muted py-4 text-sm">
          Failed to load profiles: {loadState.message}
          <Button variant="ghost" size="sm" onClick={fetchProfiles} className="ml-2">
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const { profiles } = loadState;

  return (
    <div className="space-y-4">
      <CrewHeader onRefresh={fetchProfiles} />

      <p className="text-muted text-xs">
        AI agent CLIs that can be launched directly from the terminal + menu. Installed tools are
        auto-detected; click Install to add missing ones.
      </p>

      {/* Group profiles by platform / community */}
      {(["platform", "community"] as const).map((group) => {
        const groupProfiles = profiles.filter((p) => p.group === group);
        if (groupProfiles.length === 0) return null;
        const label = group === "platform" ? "Platform" : "Community";
        return (
          <div key={group} className="space-y-2">
            <h3 className="text-muted text-[11px] font-medium tracking-wider uppercase">{label}</h3>
            {groupProfiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                expanded={expandedProfile === profile.id}
                onToggleExpanded={() => handleToggleExpanded(profile.id)}
                onToggleEnabled={() => handleToggleEnabled(profile)}
              />
            ))}
          </div>
        );
      })}

      {profiles.length === 0 && (
        <p className="text-muted py-4 text-center text-xs">No terminal profiles configured.</p>
      )}
    </div>
  );
}

function CrewHeader(props: { onRefresh?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Terminal className="text-muted h-4 w-4" />
        <h2 className="text-foreground text-sm font-semibold">Terminal Profiles</h2>
      </div>
      {props.onRefresh && (
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onRefresh}
          className="text-muted hover:text-foreground h-7 px-2 text-xs"
          title="Re-detect installed CLIs"
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          Refresh
        </Button>
      )}
    </div>
  );
}

function ProfileCard(props: {
  profile: TerminalProfileWithStatus;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
}) {
  const profile = props.profile;
  const installed = profile.detection.installed;
  const hasInstallRecipes = profile.installRecipes != null && profile.installRecipes.length > 0;

  return (
    <div className="border-border-medium bg-background-secondary overflow-hidden rounded-md border">
      {/* Header row: chevron + name + status dot + toggle */}
      <button
        type="button"
        className="hover:bg-hover/50 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
        onClick={props.onToggleExpanded}
      >
        {props.expanded ? (
          <ChevronDown className="text-muted h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-muted h-3.5 w-3.5 shrink-0" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-xs font-medium">{profile.displayName}</span>
            <span className="text-muted text-[10px]">{profile.command}</span>
          </div>
          <p className="text-muted mt-0.5 text-[11px] leading-tight">{profile.description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* Status badge */}
          {installed ? (
            <span className="text-success text-[10px] font-medium">Installed</span>
          ) : (
            <span className="text-muted text-[10px]">Not installed</span>
          )}

          {/* Status dot */}
          <div
            className={cn("h-2 w-2 shrink-0 rounded-full", statusDotColor(profile))}
            title={statusDotTitle(profile)}
          />

          {/* Enable/disable toggle — disabled when CLI isn't installed */}
          <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Switch
              checked={profile.config.enabled}
              onCheckedChange={props.onToggleEnabled}
              disabled={!installed}
              aria-label={`${profile.config.enabled ? "Disable" : "Enable"} ${profile.displayName}`}
            />
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {props.expanded && (
        <div className="border-border-medium space-y-3 border-t px-4 py-3">
          {/* Detection info */}
          {installed && profile.detection.commandPath && (
            <div>
              <span className="text-muted text-[10px] font-medium tracking-wider uppercase">
                Path
              </span>
              <p className="text-foreground mt-0.5 font-mono text-[11px]">
                {profile.detection.commandPath}
              </p>
            </div>
          )}

          {/* Install recipes (shown when NOT installed) */}
          {!installed && hasInstallRecipes && (
            <div className="space-y-2">
              <span className="text-muted text-[10px] font-medium tracking-wider uppercase">
                Install
              </span>
              {profile.installRecipes!.map((recipe, idx) => (
                <InstallRecipeRow key={idx} recipe={recipe} />
              ))}
            </div>
          )}

          {/* Install recipes (shown when installed, for reference) */}
          {installed && hasInstallRecipes && (
            <div className="space-y-1">
              <span className="text-muted text-[10px] font-medium tracking-wider uppercase">
                Install command
              </span>
              {profile.installRecipes!.map((recipe, idx) => (
                <p key={idx} className="text-muted font-mono text-[11px]">
                  {recipe.command}
                </p>
              ))}
            </div>
          )}

          {/* Command override info */}
          {profile.config.commandOverride && (
            <div>
              <span className="text-muted text-[10px] font-medium tracking-wider uppercase">
                Command override
              </span>
              <p className="text-foreground mt-0.5 font-mono text-[11px]">
                {profile.config.commandOverride}
              </p>
            </div>
          )}

          {/* Default args */}
          {profile.defaultArgs && profile.defaultArgs.length > 0 && (
            <div>
              <span className="text-muted text-[10px] font-medium tracking-wider uppercase">
                Default args
              </span>
              <p className="text-foreground mt-0.5 font-mono text-[11px]">
                {profile.defaultArgs.join(" ")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InstallRecipeRow(props: { recipe: InstallRecipe }) {
  const recipe = props.recipe;

  return (
    <div className="bg-hover/50 flex items-center justify-between rounded-md px-3 py-2">
      <div className="min-w-0 flex-1">
        <span className="text-muted text-[10px] font-medium">{installMethodLabel(recipe)}</span>
        <p className="text-foreground mt-0.5 font-mono text-[11px]">{recipe.command}</p>
      </div>
      <CopyInstallButton command={recipe.command} />
    </div>
  );
}

function CopyInstallButton(props: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(props.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="text-muted hover:text-foreground h-6 shrink-0 px-2 text-[10px]"
      title="Copy install command"
    >
      {copied ? (
        "Copied!"
      ) : (
        <>
          <Download className="mr-1 h-3 w-3" />
          Copy
        </>
      )}
    </Button>
  );
}
