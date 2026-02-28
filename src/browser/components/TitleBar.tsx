import { useEffect, useState } from "react";
import { cn } from "@/common/lib/utils";
import { VERSION } from "@/version";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import type { UpdateStatus } from "@/common/orpc/types";
import { AlertTriangle, Download, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { useAPI } from "@/browser/contexts/API";
import { useAboutDialog } from "@/browser/contexts/AboutDialogContext";
import { usePolicy } from "@/browser/contexts/PolicyContext";
import {
  isDesktopMode,
  getTitlebarLeftInset,
  DESKTOP_TITLEBAR_HEIGHT_CLASS,
} from "@/browser/hooks/useDesktopTitlebar";

// Update check interval
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface VersionRecord {
  git?: unknown;
  git_describe?: unknown;
}

function getGitDescribe(version: unknown): string | undefined {
  if (typeof version !== "object" || version === null) {
    return undefined;
  }

  const versionRecord = version as VersionRecord;

  if (typeof versionRecord.git_describe === "string") {
    return versionRecord.git_describe;
  }

  if (typeof versionRecord.git === "string") {
    return versionRecord.git;
  }

  return undefined;
}

export function TitleBar() {
  const { api } = useAPI();
  const { open: openAboutDialog } = useAboutDialog();
  const policyState = usePolicy();
  const policyEnforced = policyState.status.state === "enforced";

  const gitDescribe = getGitDescribe(VERSION satisfies unknown);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ type: "idle" });

  useEffect(() => {
    // Skip update checks in browser mode - app updates only apply to Electron
    if (!window.api) {
      return;
    }

    if (!api) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        const iterator = await api.update.onStatus(undefined, { signal });
        for await (const status of iterator) {
          if (signal.aborted) {
            break;
          }
          setUpdateStatus(status);
        }
      } catch (error) {
        if (!signal.aborted) {
          console.error("Update status stream error:", error);
        }
      }
    })();

    // Check for updates on mount
    api.update.check({ source: "auto" }).catch(console.error);

    // Check periodically
    const checkInterval = setInterval(() => {
      api.update.check({ source: "auto" }).catch(console.error);
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      controller.abort();
      clearInterval(checkInterval);
    };
  }, [api]);

  const updateBadgeIcon = (() => {
    if (updateStatus.type === "available") {
      return <Download className="size-3.5" />;
    }

    if (updateStatus.type === "downloaded") {
      return <RefreshCw className="size-3.5" />;
    }

    if (updateStatus.type === "downloading" || updateStatus.type === "checking") {
      return <Loader2 className="size-3.5 animate-spin" />;
    }

    if (updateStatus.type === "error") {
      return <AlertTriangle className="size-3.5" />;
    }

    return null;
  })();

  // In desktop mode, add left padding for macOS traffic lights
  const leftInset = getTitlebarLeftInset();
  const isDesktop = isDesktopMode();

  return (
    <div
      className={cn(
        "bg-sidebar border-border-light font-primary text-muted titlebar-safe-left titlebar-safe-left-gutter-4 flex shrink-0 items-center justify-between border-b px-4 text-[11px] select-none",
        isDesktop ? DESKTOP_TITLEBAR_HEIGHT_CLASS : "h-8",
        // In desktop mode, make header draggable for window movement
        isDesktop && "titlebar-drag"
      )}
    >
      <div
        // Desktop titlebar: this wrapper is `flex-1` (for version ellipsis) so it fills the gap.
        // Keep it draggable; apply `titlebar-no-drag` only to the interactive controls inside.
        className={cn(
          "mr-4 flex min-w-0 flex-1",
          leftInset > 0 ? "flex-col" : "items-center gap-2"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open about dialog"
              className={cn(
                // Keep the version row shrinkable so long git-describe values ellipsize
                // instead of overlapping the settings controls.
                "flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit transition-opacity hover:opacity-70",
                isDesktop && "titlebar-no-drag"
              )}
              onClick={openAboutDialog}
            >
              <div
                className={cn(
                  "min-w-0 flex-1 truncate font-normal tracking-wider",
                  leftInset > 0 ? "text-[10px]" : "text-xs"
                )}
              >
                {gitDescribe ?? "(dev)"}
              </div>
              {updateBadgeIcon && (
                <div className="text-accent flex h-3.5 w-3.5 items-center justify-center">
                  {updateBadgeIcon}
                </div>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent align="start">Click for more details</TooltipContent>
        </Tooltip>
      </div>
      <div className={cn("flex shrink-0 items-center gap-1.5", isDesktop && "titlebar-no-drag")}>
        {policyEnforced && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                role="img"
                aria-label="Settings controlled by policy"
                className="border-border-light text-muted-foreground hover:border-border-medium/80 hover:bg-toggle-bg/70 flex h-5 w-5 items-center justify-center rounded border"
              >
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              </div>
            </TooltipTrigger>
            <TooltipContent align="end">Your settings are controlled by a policy.</TooltipContent>
          </Tooltip>
        )}
        {/* Analytics + Settings buttons moved to minion panels */}
      </div>
    </div>
  );
}
