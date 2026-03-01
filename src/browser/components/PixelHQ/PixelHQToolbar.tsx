/**
 * PixelHQToolbar — Floating toolbar overlay for Pixel HQ controls.
 *
 * Provides zoom in/out, reset view, and follow-active-character buttons.
 * Rendered as an absolute-positioned bar in the top-right corner of the
 * canvas container.
 */

import { useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize, UserRound } from "lucide-react";
import { cn } from "@/common/lib/utils";
import type { PixelHQRenderer } from "@/browser/utils/pixelHQ/engine/renderer";
import type { OfficeState } from "@/browser/utils/pixelHQ/engine/officeState";

interface PixelHQToolbarProps {
  renderer: PixelHQRenderer;
  officeState: OfficeState;
}

export function PixelHQToolbar({ renderer, officeState }: PixelHQToolbarProps) {
  const [following, setFollowing] = useState(false);

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
      // Follow first active character
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
    <div className="absolute top-3 right-3 flex items-center gap-0.5 rounded-lg bg-[#111427]/90 backdrop-blur border border-[#1F2337]/50 px-1.5 py-1 shadow-lg">
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
  );
}
