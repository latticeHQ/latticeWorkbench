/**
 * Always-visible Lattice Runtime connection indicator for the TitleBar.
 *
 * Shows a small status icon that, when clicked, opens a popover with
 * deployment info and quick actions (connect, disconnect, switch).
 */
import { Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/browser/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/browser/components/ui/tooltip";
import { Button } from "@/browser/components/ui/button";
import { LatticeLoginDialog } from "@/browser/components/LatticeLoginDialog";
import {
  useLatticeRuntime,
  type LatticeConnectionState,
} from "@/browser/contexts/LatticeRuntimeContext";
import { cn } from "@/common/lib/utils";

// ---------------------------------------------------------------------------
// Status dot styling
// ---------------------------------------------------------------------------

function getStatusStyles(state: LatticeConnectionState) {
  switch (state) {
    case "connected":
      return {
        dotColor: "bg-green-500",
        icon: Cloud,
        iconClass: "text-green-500",
        tooltip: "Connected to Lattice Runtime",
      };
    case "connecting":
      return {
        dotColor: "bg-amber-500 animate-pulse",
        icon: Loader2,
        iconClass: "text-amber-500 animate-spin",
        tooltip: "Checking Lattice connection...",
      };
    case "disconnected":
      return {
        dotColor: "bg-muted-foreground",
        icon: CloudOff,
        iconClass: "text-muted-foreground",
        tooltip: "Not connected to Lattice Runtime",
      };
    case "error":
      return {
        dotColor: "bg-red-500",
        icon: CloudOff,
        iconClass: "text-red-500",
        tooltip: "Lattice connection error",
      };
    case "unavailable":
      return null; // Don't render anything
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LatticeConnectionHub() {
  const {
    connectionState,
    whoami,
    info,
    refresh,
    loginDialogOpen,
    openLoginDialog,
    closeLoginDialog,
  } = useLatticeRuntime();

  const styles = getStatusStyles(connectionState);

  // Don't show anything if Lattice CLI is not installed
  if (!styles) return null;

  const StatusIcon = styles.icon;

  const deploymentUrl =
    whoami?.state === "authenticated" ? whoami.deploymentUrl : undefined;
  const username =
    whoami?.state === "authenticated" ? whoami.username : undefined;

  return (
    <>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={styles.tooltip}
                className={cn(
                  "border-border-light text-muted-foreground hover:border-border-medium/80 hover:bg-toggle-bg/70",
                  "flex h-5 w-5 items-center justify-center rounded border transition-colors"
                )}
              >
                <StatusIcon className={cn("h-3 w-3", styles.iconClass)} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent align="end">{styles.tooltip}</TooltipContent>
        </Tooltip>

        <PopoverContent align="end" className="w-72 p-3">
          {/* Connected state */}
          {connectionState === "connected" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-foreground text-sm font-medium">Connected</span>
                </div>
                {username && (
                  <p className="text-muted-foreground pl-4 text-xs">
                    Signed in as <span className="text-foreground font-medium">{username}</span>
                  </p>
                )}
                {deploymentUrl && (
                  <p className="text-muted-foreground truncate pl-4 text-xs">{deploymentUrl}</p>
                )}
              </div>
              <div className="border-border-light flex gap-2 border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 flex-1 text-xs"
                  onClick={openLoginDialog}
                >
                  Switch Deployment
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 text-xs"
                  onClick={refresh}
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Refresh
                </Button>
              </div>
            </div>
          )}

          {/* Disconnected state */}
          {connectionState === "disconnected" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-gray-500" />
                  <span className="text-foreground text-sm font-medium">Not Connected</span>
                </div>
                <p className="text-muted-foreground pl-4 text-xs">
                  Connect to a Lattice Runtime deployment to manage remote minions.
                </p>
              </div>
              <Button
                size="sm"
                className="h-7 w-full text-xs"
                onClick={openLoginDialog}
              >
                <Cloud className="mr-1.5 h-3 w-3" />
                Connect to Lattice Runtime
              </Button>
            </div>
          )}

          {/* Connecting state */}
          {connectionState === "connecting" && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              <span className="text-muted-foreground text-sm">
                Checking connection...
              </span>
            </div>
          )}

          {/* Error state */}
          {connectionState === "error" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-foreground text-sm font-medium">Connection Error</span>
                </div>
                <p className="text-muted-foreground pl-4 text-xs">
                  {info?.state === "unavailable" && info.reason !== "missing"
                    ? info.reason.message
                    : "Failed to connect to Lattice Runtime."}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={refresh}
              >
                <RefreshCw className="mr-1.5 h-3 w-3" />
                Retry
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Login dialog (shared, managed by context) */}
      <LatticeLoginDialog
        open={loginDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeLoginDialog();
        }}
        onLoginSuccess={() => {
          closeLoginDialog();
          refresh();
        }}
      />
    </>
  );
}
