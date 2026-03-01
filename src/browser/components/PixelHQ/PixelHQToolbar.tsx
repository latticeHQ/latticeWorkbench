/**
 * PixelHQToolbar — Floating toolbar overlay for Pixel HQ controls.
 *
 * Provides:
 *   - Section jump dropdown (jump camera to a crew section)
 *   - Active worker count badge
 *   - Zoom in/out, reset view, follow-active-character
 *
 * Rendered as an absolute-positioned bar in the top-right corner of the
 * canvas container.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  UserRound,
  ChevronDown,
  MapPin,
} from "lucide-react";
import { cn } from "@/common/lib/utils";
import { resolveCrewColor } from "@/common/constants/ui";
import type { PixelHQRenderer } from "@/browser/utils/pixelHQ/engine/renderer";
import type { OfficeState } from "@/browser/utils/pixelHQ/engine/officeState";
import type { CrewConfig } from "@/common/types/project";
import { TILE_SIZE } from "@/browser/utils/pixelHQ/engine/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PixelHQToolbarProps {
  renderer: PixelHQRenderer;
  officeState: OfficeState;
  crews: CrewConfig[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PixelHQToolbar({
  renderer,
  officeState,
  crews,
}: PixelHQToolbarProps) {
  const [following, setFollowing] = useState(false);
  const [sectionDropdownOpen, setSectionDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!sectionDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setSectionDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [sectionDropdownOpen]);

  // Count active (streaming) characters
  const activeCount = useMemo(() => {
    let count = 0;
    for (const char of officeState.characters.values()) {
      if (char.isActive) count++;
    }
    return count;
  }, [officeState.characters.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCount = officeState.characters.size;

  // Sections for the dropdown: crew sections + special rooms
  const sectionItems = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      color?: string;
      zone: string;
      charCount: number;
    }> = [];

    // Add crew sections
    for (const crew of crews) {
      const roomId = `section_${crew.id}`;
      let charCount = 0;
      for (const char of officeState.characters.values()) {
        if (char.crewId === crew.id) charCount++;
      }
      items.push({
        id: roomId,
        label: crew.name,
        color: resolveCrewColor(crew.color),
        zone: "crew_section",
        charCount,
      });
    }

    // Add special rooms
    const specialRooms = [
      { id: "elevator", label: "Elevator", zone: "elevator" },
      { id: "break_room", label: "Break Room", zone: "break_room" },
      { id: "server_closet", label: "Servers", zone: "server_closet" },
    ];

    for (const room of specialRooms) {
      let charCount = 0;
      for (const char of officeState.characters.values()) {
        if (char.roomId === room.id) charCount++;
      }
      items.push({ ...room, charCount });
    }

    return items;
  }, [crews, officeState.characters.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump camera to a section
  const jumpToSection = useCallback(
    (roomId: string) => {
      const room = officeState.layout.rooms.find((r) => r.id === roomId);
      if (room) {
        const centerX =
          (room.bounds.col + room.bounds.width / 2) * TILE_SIZE;
        const centerY =
          (room.bounds.row + room.bounds.height / 2) * TILE_SIZE;
        renderer.panTo(centerX, centerY);
      }
      setSectionDropdownOpen(false);
    },
    [renderer, officeState.layout],
  );

  const handleZoomIn = useCallback(() => renderer.zoomBy(0.5), [renderer]);
  const handleZoomOut = useCallback(() => renderer.zoomBy(-0.5), [renderer]);
  const handleReset = useCallback(() => {
    renderer.resetCamera();
    setFollowing(false);
  }, [renderer]);
  const handleToggleFollow = useCallback(() => {
    if (following) {
      renderer.setFollowTarget(null);
      setFollowing(false);
    } else {
      for (const char of officeState.characters.values()) {
        if (char.isActive) {
          renderer.setFollowTarget(char.id);
          setFollowing(true);
          break;
        }
      }
    }
  }, [renderer, officeState, following]);

  const ToolBtn = ({
    onClick,
    title,
    children,
    active,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    active?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded text-[10px] transition-colors",
        active
          ? "bg-[#FBBF24]/20 text-[#FBBF24]"
          : "text-[#6B7280] hover:text-[#E2E4EB] hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );

  return (
    <div className="absolute top-3 right-3 flex items-center gap-1">
      {/* Active worker count badge */}
      <div className="flex items-center gap-1.5 rounded-lg bg-[#111427]/90 backdrop-blur border border-[#1F2337]/50 px-2 py-1 shadow-lg mr-1">
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            activeCount > 0 ? "bg-emerald-400 animate-pulse" : "bg-[#6B7280]",
          )}
        />
        <span className="text-[10px] text-[#9CA3AF] font-medium tabular-nums">
          {activeCount}/{totalCount}
        </span>
      </div>

      {/* Section jump dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setSectionDropdownOpen((p) => !p)}
          className={cn(
            "flex items-center gap-1 h-7 rounded-lg bg-[#111427]/90 backdrop-blur border border-[#1F2337]/50 px-2 py-1 shadow-lg transition-colors",
            sectionDropdownOpen
              ? "text-[#E2E4EB]"
              : "text-[#6B7280] hover:text-[#E2E4EB]",
          )}
          title="Jump to section"
        >
          <MapPin size={11} />
          <span className="text-[10px] font-medium">Sections</span>
          <ChevronDown
            size={10}
            className={cn(
              "transition-transform",
              sectionDropdownOpen && "rotate-180",
            )}
          />
        </button>

        {sectionDropdownOpen && (
          <div className="absolute top-full right-0 mt-1 w-48 rounded-lg bg-[#111427]/95 backdrop-blur border border-[#1F2337]/50 shadow-xl z-50 py-1 overflow-hidden">
            {sectionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jumpToSection(item.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
              >
                {item.color ? (
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                ) : (
                  <div className="h-2 w-2 rounded-full shrink-0 bg-[#4B5563]" />
                )}
                <span className="text-[11px] text-[#D1D5DB] truncate flex-1">
                  {item.label}
                </span>
                {item.charCount > 0 && (
                  <span className="text-[9px] text-[#6B7280] tabular-nums">
                    {item.charCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main controls */}
      <div className="flex items-center gap-0.5 rounded-lg bg-[#111427]/90 backdrop-blur border border-[#1F2337]/50 px-1.5 py-1 shadow-lg">
        <ToolBtn onClick={handleZoomIn} title="Zoom in (+)">
          <ZoomIn size={12} />
        </ToolBtn>
        <ToolBtn onClick={handleZoomOut} title="Zoom out (-)">
          <ZoomOut size={12} />
        </ToolBtn>
        <ToolBtn onClick={handleReset} title="Reset view (R)">
          <Maximize size={12} />
        </ToolBtn>
        <div className="mx-0.5 h-4 w-px bg-[#1F2337]" />
        <ToolBtn
          onClick={handleToggleFollow}
          title="Follow active (F)"
          active={following}
        >
          <UserRound size={12} />
        </ToolBtn>
      </div>
    </div>
  );
}
