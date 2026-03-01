/**
 * BuildingCrossSection — A visual building sidebar for the Pixel HQ tab.
 *
 * Renders all projects as stacked floors in a building cross-section.
 * The current project's floor is highlighted. Clicking another floor
 * navigates to that project.
 *
 * Visual structure:
 *
 *   ┌───────────────────────┐
 *   │    ▲ LATTICE HQ ▲    │  ← Roof / Building name
 *   ╞═══════════════════════╡
 *   │ 3F │ my-app       ● 2│  ← Floor (dimmed)
 *   │────│──────────────────│
 *   │ 2F │ api-svc    ★ ● 5│  ← Current floor (highlighted)
 *   │────│──────────────────│
 *   │ 1F │ docs         ● 0│  ← Floor (dimmed)
 *   ╞═══════════════════════╡
 *   │    ░░ LOBBY ░░       │  ← Ground level
 *   └───────────────────────┘
 */

import { useMemo } from "react";
import { cn } from "@/common/lib/utils";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import { useRouter } from "@/browser/contexts/RouterContext";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface BuildingCrossSectionProps {
  /** Current project path (this floor is highlighted) */
  projectPath: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveProjectName(path: string): string {
  if (!path) return "Project";
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function BuildingCrossSection({ projectPath }: BuildingCrossSectionProps) {
  const { projects } = useProjectContext();
  const { minionMetadata } = useMinionContext();
  const { navigateToProject } = useRouter();

  // Build floor data: each project = one floor, sorted alphabetically, floor 1 = bottom
  const floors = useMemo(() => {
    const paths = Array.from(projects.keys()).sort();
    return paths.map((p, i) => {
      const name = deriveProjectName(p);
      let total = 0;
      let active = 0;
      for (const m of minionMetadata.values()) {
        if (m.projectPath === p) {
          total++;
          if (m.taskStatus === "running") active++;
        }
      }
      return {
        path: p,
        name,
        floorNumber: i + 1,
        isCurrent: p === projectPath,
        totalMinions: total,
        activeMinions: active,
      };
    });
  }, [projects, minionMetadata, projectPath]);

  // Render floors top-down (highest floor at top)
  const floorsTopDown = useMemo(() => [...floors].reverse(), [floors]);

  return (
    <div className="flex h-full w-[180px] shrink-0 flex-col border-r border-[#1F2337]">
      {/* ── Roof / Building Name ── */}
      <div className="relative flex flex-col items-center pb-1 pt-3">
        {/* Roof triangle */}
        <div
          className="mb-1"
          style={{
            width: 0,
            height: 0,
            borderLeft: "40px solid transparent",
            borderRight: "40px solid transparent",
            borderBottom: "16px solid #1F2337",
          }}
        />
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#6B7280]">
          Lattice HQ
        </span>
      </div>

      {/* ── Top building line ── */}
      <div className="mx-3 h-px bg-[#2A3050]" />
      <div className="mx-3 mt-px h-px bg-[#1F2337]" />

      {/* ── Floors ── */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {floorsTopDown.map((floor, i) => (
          <div key={floor.path}>
            {/* Floor separator */}
            {i > 0 && (
              <div className="mx-2 flex items-center gap-1 py-px">
                <div className="h-px flex-1 bg-[#1F2337]" />
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (!floor.isCurrent) navigateToProject(floor.path);
              }}
              className={cn(
                "group flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left transition-all",
                floor.isCurrent
                  ? "bg-[#FBBF24]/[0.08] ring-1 ring-[#FBBF24]/20"
                  : "hover:bg-white/[0.03] cursor-pointer",
              )}
            >
              {/* Floor number badge */}
              <div
                className={cn(
                  "flex h-5 w-7 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold tabular-nums",
                  floor.isCurrent
                    ? "bg-[#FBBF24]/20 text-[#FBBF24]"
                    : floor.activeMinions > 0
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-[#1F2337]/50 text-[#4B5563]",
                )}
              >
                {floor.floorNumber}F
              </div>

              {/* Project name */}
              <span
                className={cn(
                  "flex-1 truncate text-[10px] font-medium",
                  floor.isCurrent
                    ? "text-[#E2E4EB]"
                    : "text-[#6B7280] group-hover:text-[#9CA3AF]",
                )}
              >
                {floor.name}
              </span>

              {/* Minion count + activity dot */}
              <div className="flex shrink-0 items-center gap-1">
                {floor.activeMinions > 0 && (
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
                <span
                  className={cn(
                    "text-[9px] tabular-nums",
                    floor.isCurrent
                      ? "text-[#9CA3AF]"
                      : "text-[#4B5563]",
                  )}
                >
                  {floor.totalMinions}
                </span>
              </div>
            </button>
          </div>
        ))}

        {floors.length === 0 && (
          <div className="px-2 py-4 text-center text-[10px] text-[#4B5563]">
            No projects
          </div>
        )}
      </div>

      {/* ── Bottom building line ── */}
      <div className="mx-3 h-px bg-[#1F2337]" />
      <div className="mx-3 mt-px h-px bg-[#2A3050]" />

      {/* ── Foundation / Ground ── */}
      <div className="flex items-center justify-center gap-1 py-2">
        {/* Pixel-art ground blocks */}
        <div className="flex gap-px">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-2 w-3 rounded-sm"
              style={{
                backgroundColor: i % 2 === 0 ? "#1F2337" : "#252E4C",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
