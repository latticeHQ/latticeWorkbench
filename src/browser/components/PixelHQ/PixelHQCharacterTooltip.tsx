/**
 * PixelHQCharacterTooltip — Floating info panel shown when hovering a character.
 *
 * Displays minion name, crew badge, current status, active tool, and token usage.
 * Positioned near the cursor using absolute positioning within the canvas container.
 */

import type { Character } from "@/browser/utils/pixelHQ/engine/types";

interface PixelHQCharacterTooltipProps {
  character: Character;
  /** Screen-space X position (relative to canvas container) */
  x: number;
  /** Screen-space Y position (relative to canvas container) */
  y: number;
  /** Crew name for display */
  crewName?: string;
  /** Crew color for badge */
  crewColor?: string;
}

function getStatusLabel(char: Character): { text: string; color: string } {
  if (char.matrixEffect?.phase === "spawning") return { text: "Spawning...", color: "#10B981" };
  if (char.matrixEffect?.phase === "despawning") return { text: "Leaving...", color: "#EF4444" };
  if (char.bubbleType === "waiting") return { text: "Waiting for input", color: "#F59E0B" };
  if (char.bubbleType === "error") return { text: "Error", color: "#EF4444" };
  if (char.isActive && char.state === "type") return { text: "Writing code", color: "#10B981" };
  if (char.isActive && char.state === "read") return { text: "Reading files", color: "#3B82F6" };
  if (char.isActive) return { text: "Streaming", color: "#10B981" };
  if (char.mood === "sleeping") return { text: "Sleeping", color: "#6B7280" };
  if (char.mood === "frustrated") return { text: "Frustrated", color: "#EF4444" };
  if (char.mood === "celebrating") return { text: "Celebrating!", color: "#FBBF24" };
  return { text: "Idle", color: "#6B7280" };
}

function getToolLabel(toolName: string | null): string | null {
  if (!toolName) return null;
  const toolMap: Record<string, string> = {
    Edit: "Editing",
    Write: "Writing",
    Read: "Reading",
    Bash: "Running command",
    Grep: "Searching",
    Glob: "Finding files",
    WebFetch: "Fetching web",
    WebSearch: "Searching web",
  };
  return toolMap[toolName] ?? toolName;
}

export function PixelHQCharacterTooltip({
  character,
  x,
  y,
  crewName,
  crewColor,
}: PixelHQCharacterTooltipProps) {
  const status = getStatusLabel(character);
  const toolLabel = getToolLabel(character.currentTool);

  // Position tooltip above and to the right of cursor, clamped to viewport
  const tooltipX = x + 12;
  const tooltipY = Math.max(8, y - 60);

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{
        left: tooltipX,
        top: tooltipY,
        transform: "translateY(-100%)",
      }}
    >
      <div className="rounded-lg bg-[#111427]/95 backdrop-blur border border-[#1F2337] px-3 py-2 shadow-xl min-w-[160px] max-w-[240px]">
        {/* Name + crew badge */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[#E2E4EB] text-xs font-semibold truncate">
            {character.displayName}
          </span>
          {crewName && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
              style={{
                backgroundColor: (crewColor ?? "#6B7280") + "20",
                color: crewColor ?? "#6B7280",
              }}
            >
              {crewName}
            </span>
          )}
        </div>

        {/* Status */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <div
            className="h-1.5 w-1.5 rounded-full shrink-0"
            style={{ backgroundColor: status.color }}
          />
          <span className="text-[10px]" style={{ color: status.color }}>
            {status.text}
          </span>
        </div>

        {/* Active tool */}
        {toolLabel && (
          <div className="text-[10px] text-[#6B7280] truncate">
            Tool: {toolLabel}
          </div>
        )}

        {/* Sub-agent indicator */}
        {character.isSubagent && (
          <div className="text-[10px] text-[#6B7280] mt-0.5">
            Sidekick
          </div>
        )}
      </div>
    </div>
  );
}
