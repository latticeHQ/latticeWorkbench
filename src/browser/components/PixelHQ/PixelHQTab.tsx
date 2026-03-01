/**
 * PixelHQTab — Main React component for the Pixel HQ office visualization.
 *
 * This is the master orchestrator that wires together ALL Pixel HQ systems:
 *
 *   Phase 1 — Engine: OfficeState, PixelHQRenderer, SpriteCache, GameLoop
 *   Phase 2 — Bridge: usePixelHQBridge (Lattice state → engine)
 *   Phase 3 — Layout: generateDefaultLayout from crews
 *   Phase 4 — Editor: EditorState, EditorOverlayRenderer, PixelHQEditor
 *   Phase 5 — Polish: Keybinds, Audio, Morale, Day/Night, OffscreenTileCache
 *
 * Mouse interaction: ctrl+scroll=zoom, scroll=pan, click=select character.
 * Keyboard: see usePixelHQKeybinds for full shortcut list.
 */

import { useRef, useState, useEffect, useCallback } from "react";

// ── Engine ──
import { OfficeState } from "@/browser/utils/pixelHQ/engine/officeState";
import { PixelHQRenderer } from "@/browser/utils/pixelHQ/engine/renderer";
import { SpriteCache } from "@/browser/utils/pixelHQ/engine/spriteCache";
import { startVisibilityAwareGameLoop } from "@/browser/utils/pixelHQ/engine/gameLoop";
import { TILE_SIZE } from "@/browser/utils/pixelHQ/engine/constants";

// ── Layout ──
import { generateDefaultLayout } from "@/browser/utils/pixelHQ/layouts/defaultLayout";
import { FURNITURE_CATALOG_MAP } from "@/browser/utils/pixelHQ/layouts/furnitureCatalog";

// ── Bridge ──
import { usePixelHQBridge } from "@/browser/utils/pixelHQ/bridge/usePixelHQBridge";

// ── Editor ──
import { EditorState, EditTool } from "@/browser/utils/pixelHQ/editor/editorState";
import { EditorOverlayRenderer } from "@/browser/utils/pixelHQ/editor/editorRenderer";
import { PixelHQEditor } from "./PixelHQEditor";
import type { RoomTemplate } from "@/browser/utils/pixelHQ/layouts/roomTemplates";

// ── Polish ──
import { usePixelHQKeybinds } from "@/browser/hooks/usePixelHQKeybinds";
import { PixelHQAudio } from "@/browser/utils/pixelHQ/audio/pixelHQAudio";
import { MoraleTracker } from "@/browser/utils/pixelHQ/engine/morale";
import { computeDayNightState, applyDayNightOverlay } from "@/browser/utils/pixelHQ/engine/dayNight";
import { OffscreenTileCache } from "@/browser/utils/pixelHQ/engine/offscreenTileCache";

// ── Contexts ──
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionContext } from "@/browser/contexts/MinionContext";

// ── UI ──
import { PixelHQToolbar } from "./PixelHQToolbar";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PixelHQTabProps {
  projectPath: string;
  projectName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PixelHQTab({ projectPath }: PixelHQTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Core engine state (created once, lives for component lifetime)
  const [officeState] = useState(() => new OfficeState());
  const [renderer, setRenderer] = useState<PixelHQRenderer | null>(null);

  // Editor state
  const [editorActive, setEditorActive] = useState(false);
  const editorStateRef = useRef<EditorState | null>(null);
  const editorOverlayRef = useRef<EditorOverlayRenderer | null>(null);

  // Polish systems (refs to avoid re-renders)
  const audioRef = useRef<PixelHQAudio | null>(null);
  const moraleRef = useRef<MoraleTracker | null>(null);
  const tileCacheRef = useRef<OffscreenTileCache | null>(null);

  // Game loop control
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  // Contexts
  const { projects } = useProjectContext();
  useMinionContext(); // Ensure context is available for bridge

  // Wire up the data bridge (Phase 2)
  usePixelHQBridge(projectPath, officeState);

  // ── Initialize engine + all systems ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Phase 1 — Engine
    const spriteCache = new SpriteCache();
    const r = new PixelHQRenderer(canvas, spriteCache);
    setRenderer(r);

    // Phase 3 — Layout
    const projectConfig = projects.get(projectPath);
    const crews = projectConfig?.crews ?? [];
    officeState.setFurnitureCatalog(FURNITURE_CATALOG_MAP);
    const layout = generateDefaultLayout(crews);
    officeState.rebuildFromLayout(layout);
    r.centerOnLayout(layout.cols, layout.rows);

    // Phase 4 — Editor (create but don't activate)
    const editor = new EditorState(layout);
    editorStateRef.current = editor;
    const editorOverlay = new EditorOverlayRenderer();
    editorOverlayRef.current = editorOverlay;

    // Phase 5 — Polish systems
    const audio = new PixelHQAudio();
    audioRef.current = audio;

    const morale = new MoraleTracker();
    moraleRef.current = morale;

    const tileCache = new OffscreenTileCache();
    tileCacheRef.current = tileCache;

    // Day/night state (recomputed periodically, not every frame)
    let dayNightState = computeDayNightState();
    let dayNightTimer = 0;

    // Audio event tracking — detect state changes for sound triggers
    let prevCharCount = 0;
    let prevBubbleSet = new Set<string>();
    let typingClickTimer = 0;

    // Build initial tile cache and wire into renderer
    tileCache.rebuild(officeState.layout, dayNightState.brightness);
    r.setTileCache(tileCache);

    // Start game loop
    const cleanup = startVisibilityAwareGameLoop(canvas, {
      update: (dt) => {
        if (pausedRef.current) return;

        // Update engine
        officeState.update(dt);

        // Update morale system
        morale.update(dt, officeState.characters);

        // ── Audio triggers ──
        if (audio.enabled) {
          const charCount = officeState.characters.size;

          // Spawn/despawn detection
          if (charCount > prevCharCount) {
            audio.playSpawnTone();
          } else if (charCount < prevCharCount) {
            audio.playDespawnTone();
          }
          prevCharCount = charCount;

          // Bubble detection (new bubbles trigger a pop)
          const newBubbleSet = new Set<string>();
          for (const [id, char] of officeState.characters) {
            if (char.bubbleType) newBubbleSet.add(id);
          }
          for (const id of newBubbleSet) {
            if (!prevBubbleSet.has(id)) {
              audio.playBubblePop();
              break; // Only one pop per frame
            }
          }
          prevBubbleSet = newBubbleSet;

          // Typing click (periodic while any character is typing)
          let anyTyping = false;
          for (const char of officeState.characters.values()) {
            if (char.state === "type") {
              anyTyping = true;
              break;
            }
          }
          if (anyTyping) {
            typingClickTimer += dt;
            if (typingClickTimer >= 0.15) {
              audio.playTypingClick();
              typingClickTimer = 0;
            }
          } else {
            typingClickTimer = 0;
          }

          // Celebration detection
          for (const char of officeState.characters.values()) {
            if (char.mood === "celebrating" && char.moodTimer < dt * 2) {
              audio.playCelebration();
              break;
            }
          }
        }

        // Recompute day/night every 10 seconds (not every frame)
        dayNightTimer += dt;
        if (dayNightTimer >= 10) {
          dayNightState = computeDayNightState();
          dayNightTimer = 0;
          // Invalidate tile cache if brightness changed
          if (tileCache.needsRebuild(officeState.layout, dayNightState.brightness)) {
            tileCache.rebuild(officeState.layout, dayNightState.brightness);
          }
        }
      },
      render: (dt) => {
        if (pausedRef.current) return;

        // Main render pass
        r.renderFrame(officeState, dt);

        // Day/night overlay (after game render, before UI overlays)
        const { width, height } = r.getContainerSize();
        const ctx = r.getContext();
        applyDayNightOverlay(ctx, dayNightState, width, height);

        // Editor overlay (if editor is active)
        const currentEditor = editorStateRef.current;
        if (currentEditor?.isActive) {
          editorOverlay.render(ctx, r.getCamera(), currentEditor, width, height);
        }
      },
    });

    // Handle resize
    const observer = new ResizeObserver(() => {
      r.resizeCanvas();
      tileCache.invalidate();
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      cleanup();
      observer.disconnect();
      r.dispose();
      audio.dispose();
      tileCache.dispose();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally run once

  // ── Keybinds (Phase 5) ─────────────────────────────────────────────────
  const handleTogglePause = useCallback(() => {
    setPaused((p) => {
      pausedRef.current = !p;
      return !p;
    });
  }, []);

  const handleToggleEditor = useCallback(() => {
    const editor = editorStateRef.current;
    if (!editor) return;

    if (editor.isActive) {
      // Deactivate editor — apply changes back to engine
      const finalLayout = editor.deactivate();
      officeState.rebuildFromLayout(finalLayout);
      tileCacheRef.current?.invalidate();
      setEditorActive(false);
    } else {
      // Activate editor with current layout
      editor.activate(officeState.layout);
      setEditorActive(true);
    }
  }, [officeState]);

  const handleFollowChange = useCallback((_following: boolean) => {
    // Could update toolbar state here if needed
  }, []);

  usePixelHQKeybinds({
    renderer,
    officeState,
    editorState: editorStateRef.current,
    isActive: true,
    onTogglePause: handleTogglePause,
    onToggleEditor: handleToggleEditor,
    onFollowChange: handleFollowChange,
  });

  // ── Mouse handlers ─────────────────────────────────────────────────────
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (renderer) {
        if (e.ctrlKey || e.metaKey) {
          renderer.zoomBy(e.deltaY > 0 ? -0.25 : 0.25);
        } else {
          renderer.panBy(e.deltaX, e.deltaY);
        }
      }
    },
    [renderer],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!renderer) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = renderer.screenToWorld(screenX, screenY);

      // Editor mode: handle tool-specific clicks
      const editor = editorStateRef.current;
      if (editor?.isActive) {
        switch (editor.activeTool) {
          case EditTool.TILE_PAINT:
          case EditTool.WALL_PAINT:
            editor.paintTile(col, row);
            tileCacheRef.current?.invalidate();
            return;
          case EditTool.FURNITURE_PLACE:
            editor.placeFurniture(col, row);
            return;
          case EditTool.ERASE:
            editor.eraseAtTile(col, row, FURNITURE_CATALOG_MAP);
            tileCacheRef.current?.invalidate();
            return;
          case EditTool.SELECT: {
            const furn = editor.findFurnitureAtTile(col, row, FURNITURE_CATALOG_MAP);
            editor.selectFurniture(furn?.uid ?? null);
            return;
          }
        }
        return;
      }

      // Normal mode: click to select character
      const char = officeState.getCharacterAt(col * TILE_SIZE, row * TILE_SIZE);
      if (char) {
        renderer.setFollowTarget(char.id);
        // Initialize audio on first user interaction
        if (!audioRef.current?.enabled) {
          audioRef.current?.init();
        }
      }
    },
    [renderer, officeState],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!renderer) return;
      const editor = editorStateRef.current;
      if (!editor?.isActive) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = renderer.screenToWorld(screenX, screenY);

      // Update ghost preview
      editor.updateGhost(col, row);
    },
    [renderer],
  );

  // ── Editor template application ────────────────────────────────────────
  const handleApplyTemplate = useCallback(
    (template: RoomTemplate) => {
      const editor = editorStateRef.current;
      if (!editor?.isActive) return;
      const templateLayout = template.createLayout();
      // Place at current center of view
      const camera = renderer?.getCamera();
      const offsetCol = camera ? Math.max(0, Math.floor(camera.x / TILE_SIZE) - Math.floor(template.width / 2)) : 0;
      const offsetRow = camera ? Math.max(0, Math.floor(camera.y / TILE_SIZE) - Math.floor(template.height / 2)) : 0;
      editor.applyTemplate(templateLayout, offsetCol, offsetRow);
      tileCacheRef.current?.invalidate();
    },
    [renderer],
  );

  // ── Cursor style based on editor tool ──────────────────────────────────
  const getCursor = (): string => {
    const editor = editorStateRef.current;
    if (!editor?.isActive) return "grab";
    switch (editor.activeTool) {
      case "tile_paint":
      case "wall_paint":
        return "crosshair";
      case "furniture_place":
        return "copy";
      case "erase":
        return "not-allowed";
      case "room_define":
        return "crosshair";
      default:
        return "default";
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[500px] overflow-hidden bg-[#0C0F1A]"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ cursor: getCursor() }}
        onWheel={handleWheel}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
      />

      {/* Toolbar — always visible */}
      {renderer && (
        <PixelHQToolbar renderer={renderer} officeState={officeState} />
      )}

      {/* Editor sidebar — visible when editor is active */}
      {editorActive && editorStateRef.current && (
        <PixelHQEditor
          editor={editorStateRef.current}
          onClose={handleToggleEditor}
          onApplyTemplate={handleApplyTemplate}
        />
      )}

      {/* Paused overlay */}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
          <div className="bg-[#111427]/90 backdrop-blur border border-[#1F2337]/50 rounded-lg px-4 py-2 shadow-lg">
            <span className="text-[#FBBF24] text-sm font-semibold tracking-wide">
              ⏸ PAUSED
            </span>
            <span className="text-[#6B7280] text-xs ml-2">
              Press Space to resume
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
