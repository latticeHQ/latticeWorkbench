/**
 * usePixelHQKeybinds — Keyboard shortcut hook for Pixel HQ
 *
 * Provides keyboard shortcuts for navigation, zoom, follow, pause,
 * room jumping, and editor tool selection when the Pixel HQ tab
 * is active and focused.
 *
 * Shortcuts:
 *   + / =     Zoom in
 *   - / _     Zoom out
 *   Arrow keys  Pan camera
 *   F          Toggle follow active character
 *   R          Reset camera
 *   Space      Pause/unpause game loop
 *   1-9        Jump to room by index
 *   E          Toggle editor mode
 *   Ctrl+Z     Undo (editor)
 *   Ctrl+Shift+Z / Ctrl+Y  Redo (editor)
 *   V, B, W, D  Editor tool shortcuts
 *   Escape     Close editor / deselect
 */

import { useEffect, useCallback } from "react";
import type { PixelHQRenderer } from "@/browser/utils/pixelHQ/engine/renderer";
import type { OfficeState } from "@/browser/utils/pixelHQ/engine/officeState";
import type { EditorState } from "@/browser/utils/pixelHQ/editor/editorState";
import { EditTool } from "@/browser/utils/pixelHQ/editor/editorState";

interface UsePixelHQKeybindsOptions {
  renderer: PixelHQRenderer | null;
  officeState: OfficeState;
  editorState: EditorState | null;
  /** Whether the Pixel HQ canvas is focused/active */
  isActive: boolean;
  /** Callback to toggle pause */
  onTogglePause?: () => void;
  /** Callback to toggle editor */
  onToggleEditor?: () => void;
  /** Callback when follow state changes */
  onFollowChange?: (following: boolean) => void;
}

const PAN_AMOUNT = 40;

export function usePixelHQKeybinds({
  renderer,
  officeState,
  editorState,
  isActive,
  onTogglePause,
  onToggleEditor,
  onFollowChange,
}: UsePixelHQKeybindsOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive || !renderer) return;

      // Don't capture when user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      // ── Editor shortcuts (when editor is active) ─────────────────────
      if (editorState?.isActive) {
        // Undo / Redo
        if (isCtrl && key === "z" && !isShift) {
          e.preventDefault();
          editorState.undo();
          return;
        }
        if ((isCtrl && key === "z" && isShift) || (isCtrl && key === "y")) {
          e.preventDefault();
          editorState.redo();
          return;
        }

        // Tool shortcuts (only when not holding modifiers)
        if (!isCtrl && !isShift) {
          switch (key) {
            case "v":
              e.preventDefault();
              editorState.setTool(EditTool.SELECT);
              return;
            case "b":
              e.preventDefault();
              editorState.setTool(EditTool.TILE_PAINT);
              return;
            case "w":
              e.preventDefault();
              editorState.setTool(EditTool.WALL_PAINT);
              return;
            case "f":
              e.preventDefault();
              editorState.setTool(EditTool.FURNITURE_PLACE);
              return;
            case "d":
              e.preventDefault();
              editorState.setTool(EditTool.ROOM_DEFINE);
              return;
            case "e":
              // "E" toggles editor off when already in editor
              e.preventDefault();
              onToggleEditor?.();
              return;
            case "escape":
              e.preventDefault();
              // First deselect, then close editor
              if (editorState.selectedFurnitureUid || editorState.selectedRoomId) {
                editorState.selectFurniture(null);
                editorState.selectRoom(null);
              } else {
                onToggleEditor?.();
              }
              return;
            case "delete":
            case "backspace":
              e.preventDefault();
              if (editorState.selectedFurnitureUid) {
                editorState.removeFurniture(editorState.selectedFurnitureUid);
              }
              return;
          }
        }
      }

      // ── Global shortcuts ─────────────────────────────────────────────

      // Zoom
      if (key === "=" || key === "+") {
        e.preventDefault();
        renderer.zoomBy(0.5);
        return;
      }
      if (key === "-" || key === "_") {
        e.preventDefault();
        renderer.zoomBy(-0.5);
        return;
      }

      // Pan with arrow keys
      if (key === "arrowleft") {
        e.preventDefault();
        renderer.panBy(-PAN_AMOUNT, 0);
        return;
      }
      if (key === "arrowright") {
        e.preventDefault();
        renderer.panBy(PAN_AMOUNT, 0);
        return;
      }
      if (key === "arrowup") {
        e.preventDefault();
        renderer.panBy(0, -PAN_AMOUNT);
        return;
      }
      if (key === "arrowdown") {
        e.preventDefault();
        renderer.panBy(0, PAN_AMOUNT);
        return;
      }

      // Follow active character
      if (key === "f" && !isCtrl && !editorState?.isActive) {
        e.preventDefault();
        const camera = renderer.getCamera();
        if (camera.followId) {
          renderer.setFollowTarget(null);
          onFollowChange?.(false);
        } else {
          for (const char of officeState.characters.values()) {
            if (char.isActive) {
              renderer.setFollowTarget(char.id);
              onFollowChange?.(true);
              break;
            }
          }
        }
        return;
      }

      // Reset camera
      if (key === "r" && !isCtrl && !editorState?.isActive) {
        e.preventDefault();
        renderer.resetCamera();
        onFollowChange?.(false);
        return;
      }

      // Pause
      if (key === " ") {
        e.preventDefault();
        onTogglePause?.();
        return;
      }

      // Room jump (1-9)
      if (!isCtrl && key >= "1" && key <= "9" && !editorState?.isActive) {
        e.preventDefault();
        const roomIndex = parseInt(key) - 1;
        const rooms = Array.from(officeState.rooms.values());
        if (roomIndex < rooms.length) {
          const room = rooms[roomIndex];
          const centerX =
            (room.bounds.col + room.bounds.width / 2) * 16;
          const centerY =
            (room.bounds.row + room.bounds.height / 2) * 16;
          renderer.panTo(centerX, centerY);
        }
        return;
      }

      // Toggle editor
      if (key === "e" && !isCtrl && !editorState?.isActive) {
        e.preventDefault();
        onToggleEditor?.();
        return;
      }

      // Escape when not in editor
      if (key === "escape" && !editorState?.isActive) {
        e.preventDefault();
        renderer.setFollowTarget(null);
        onFollowChange?.(false);
        return;
      }
    },
    [renderer, officeState, editorState, isActive, onTogglePause, onToggleEditor, onFollowChange],
  );

  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleKeyDown]);
}
