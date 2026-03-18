/**
 * Runtime Dashboard — the home screen when no minion is selected.
 *
 * Shows a Lattice Runtime connection banner, remote minions grid,
 * local minions summary, and quick action buttons.
 */
import { Cloud, FolderPlus, Loader2, Menu, Plus, RefreshCw, Server } from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { RemoteMinionCard } from "@/browser/components/RemoteMinionCard";
import { useLatticeRuntime } from "@/browser/contexts/LatticeRuntimeContext";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { cn } from "@/common/lib/utils";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { MinionSelection } from "@/browser/components/MinionListItem";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RuntimeDashboardProps {
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  minionMetadata: Map<string, FrontendMinionMetadata>;
  onSelectMinion: (selection: MinionSelection | null) => void;
  onStartMinionCreation: (projectPath: string) => void;
  onOpenProjectCreateModal: () => void;
  currentMinionId: string | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuntimeDashboard({
  leftSidebarCollapsed,
  onToggleLeftSidebarCollapsed,
  minionMetadata,
  onSelectMinion,
  onStartMinionCreation,
  onOpenProjectCreateModal,
  currentMinionId,
  loading,
}: RuntimeDashboardProps) {
  const lattice = useLatticeRuntime();
  const { projects } = useProjectContext();

  // If a minion ID was requested but not found, show loading/error
  if (currentMinionId) {
    return (
      <div className="bg-dark flex flex-1 flex-col overflow-hidden">
        <DashboardHeader
          sidebarCollapsed={leftSidebarCollapsed}
          onToggleSidebar={onToggleLeftSidebarCollapsed}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <h2 className="text-foreground mb-2 text-xl font-bold">
              {loading ? "Summoning minion..." : "Minion not found."}
            </h2>
            <p className="text-muted-foreground text-sm">
              {loading ? "Loading minion metadata..." : "This minion may have been deleted."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Group local minions by project
  const minionsByProject = new Map<string, FrontendMinionMetadata[]>();
  for (const [, meta] of minionMetadata) {
    const list = minionsByProject.get(meta.projectPath) ?? [];
    list.push(meta);
    minionsByProject.set(meta.projectPath, list);
  }

  const hasProjects = projects.size > 0;
  const hasRemoteMinions = lattice.remoteMinions.length > 0;
  const isConnected = lattice.connectionState === "connected";

  return (
    <div className="bg-dark flex flex-1 flex-col overflow-hidden">
      <DashboardHeader
        sidebarCollapsed={leftSidebarCollapsed}
        onToggleSidebar={onToggleLeftSidebarCollapsed}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          {/* Welcome header */}
          <div className="mb-8">
            <h1 className="text-foreground mb-2 text-2xl font-bold tracking-tight">
              Welcome to Lattice
            </h1>
            <p className="text-muted-foreground text-sm">
              {isConnected
                ? "Manage your remote and local minions from one place."
                : "Get started by adding a project or connecting to Lattice Runtime."}
            </p>
          </div>

          {/* Connection banner (when not connected) */}
          {lattice.connectionState !== "connected" &&
            lattice.connectionState !== "unavailable" &&
            lattice.connectionState !== "connecting" && (
              <div className="border-border-light bg-sidebar mb-6 flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Cloud className="text-muted-foreground h-5 w-5" />
                  <div>
                    <p className="text-foreground text-sm font-medium">
                      Connect to Lattice Runtime
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Access remote minions and cloud compute resources.
                    </p>
                  </div>
                </div>
                <Button size="sm" onClick={lattice.openLoginDialog}>
                  Connect
                </Button>
              </div>
            )}

          {/* Remote Minions section */}
          {isConnected && (
            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="text-muted-foreground h-4 w-4" />
                  <h2 className="text-foreground text-sm font-semibold">Remote Minions</h2>
                  {lattice.remoteMinionsFetching && (
                    <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-7 text-xs"
                  onClick={lattice.refreshRemoteMinions}
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  Refresh
                </Button>
              </div>

              {lattice.remoteMinionError && (
                <p className="text-destructive mb-3 text-xs">{lattice.remoteMinionError}</p>
              )}

              {hasRemoteMinions ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {lattice.remoteMinions
                    .filter((m) => m.status !== "deleted")
                    .map((minion) => (
                      <RemoteMinionCard
                        key={minion.name}
                        minion={minion}
                        onClick={() => {
                          // Find the first project to anchor creation to
                          const firstProject = projects.keys().next();
                          if (!firstProject.done) {
                            onStartMinionCreation(firstProject.value);
                          }
                        }}
                      />
                    ))}
                </div>
              ) : (
                !lattice.remoteMinionsFetching && (
                  <p className="text-muted-foreground text-sm">
                    No remote minions found. Create one from a template in the sidebar.
                  </p>
                )
              )}
            </section>
          )}

          {/* Local Minions section */}
          {hasProjects && minionMetadata.size > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-foreground text-sm font-semibold">Local Minions</h2>
                <span className="text-muted-foreground text-xs">({minionMetadata.size})</span>
              </div>

              <div className="space-y-3">
                {Array.from(minionsByProject.entries()).map(([projectPath, minions]) => {
                  const projectName =
                    projectPath.split("/").pop() ?? projectPath.split("\\").pop() ?? "Project";
                  return (
                    <div key={projectPath} className="border-border-light bg-sidebar rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-foreground text-xs font-medium">{projectName}</h3>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground h-6 text-[11px]"
                          onClick={() => onStartMinionCreation(projectPath)}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          New
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {minions.slice(0, 5).map((meta) => {
                          const name =
                            meta.name ??
                            meta.namedMinionPath?.split("/").pop() ??
                            meta.id;
                          return (
                            <button
                              key={meta.id}
                              type="button"
                              className="hover:bg-hover text-foreground flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors"
                              onClick={() =>
                                onSelectMinion({
                                  projectPath: meta.projectPath,
                                  projectName,
                                  namedMinionPath: meta.namedMinionPath ?? "",
                                  minionId: meta.id,
                                })
                              }
                            >
                              <div className="bg-muted-foreground/30 h-1.5 w-1.5 rounded-full" />
                              <span className="truncate">{meta.title ?? name}</span>
                            </button>
                          );
                        })}
                        {minions.length > 5 && (
                          <p className="text-muted-foreground px-2 text-[11px]">
                            +{minions.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Quick actions */}
          <section>
            <h2 className="text-foreground mb-3 text-sm font-semibold">Quick Actions</h2>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={onOpenProjectCreateModal}>
                <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                Add Project
              </Button>
              {hasProjects && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const firstProject = projects.keys().next();
                    if (!firstProject.done) {
                      onStartMinionCreation(firstProject.value);
                    }
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Minion
                </Button>
              )}
              {lattice.connectionState === "disconnected" && (
                <Button variant="outline" size="sm" onClick={lattice.openLoginDialog}>
                  <Cloud className="mr-1.5 h-3.5 w-3.5" />
                  Connect to Lattice Runtime
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header bar (matches the existing empty state header)
// ---------------------------------------------------------------------------

function DashboardHeader({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div
      className={cn(
        "bg-sidebar border-border-light flex shrink-0 items-center border-b px-[15px] [@media(max-width:768px)]:h-auto [@media(max-width:768px)]:py-2",
        isDesktopMode() ? "h-10 titlebar-drag" : "h-8"
      )}
    >
      {sidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          title="Open sidebar"
          aria-label="Open sidebar menu"
          className={cn(
            "mobile-menu-btn text-muted hover:text-foreground hidden h-6 w-6 shrink-0",
            isDesktopMode() && "titlebar-no-drag"
          )}
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
