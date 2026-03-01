/**
 * PixelHQTab — Main React component for the Pixel HQ office visualization.
 *
 * This is the master orchestrator that wires together ALL Pixel HQ systems:
 *
 *   Phase 1 — Engine: OfficeState, PixelHQRenderer, SpriteCache, GameLoop
 *   Phase 2 — Bridge: usePixelHQBridge (Lattice state → engine)
 *   Phase 3 — Layout: generateFloorLayout from crews (open-plan)
 *   Phase 4 — Editor: EditorState, EditorOverlayRenderer, PixelHQEditor
 *   Phase 5 — Polish: Keybinds, Audio, Morale, Day/Night, OffscreenTileCache
 *   Phase 6 — Control Panel: Context menus, tooltips, CRUD actions
 *
 * Mouse interaction: ctrl+scroll=zoom, scroll=pan, click=select, right-click=context menu
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
import { generateFloorLayout } from "@/browser/utils/pixelHQ/layouts/defaultLayout";
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
import { useRouter } from "@/browser/contexts/RouterContext";
import { useAPI } from "@/browser/contexts/API";

// ── UI ──
import { PixelHQToolbar } from "./PixelHQToolbar";
import { PixelHQContextMenu, type HQContextTarget, type HQContextMenuActions } from "./PixelHQContextMenu";
import { PixelHQCharacterTooltip } from "./PixelHQCharacterTooltip";
import type { Character } from "@/browser/utils/pixelHQ/engine/types";

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

  // Context menu state
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<HQContextTarget>(null);

  // Tooltip state
  const [hoveredCharacter, setHoveredCharacter] = useState<Character | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Contexts
  const { projects } = useProjectContext();
  useMinionContext(); // Subscribe to context for bridge data
  const { navigateToMinion } = useRouter();
  const apiState = useAPI();

  // Wire up the data bridge (Phase 2)
  usePixelHQBridge(projectPath, officeState);

  // Get crews for context menu
  const projectConfig = projects.get(projectPath);
  const crews = projectConfig?.crews ?? [];

  // ── Initialize engine + all systems ────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Phase 1 — Engine
    const spriteCache = new SpriteCache();
    const r = new PixelHQRenderer(canvas, spriteCache);
    setRenderer(r);

    // Phase 3 — Layout (open-plan floor)
    const projectCfg = projects.get(projectPath);
    const crewList = projectCfg?.crews ?? [];
    officeState.setFurnitureCatalog(FURNITURE_CATALOG_MAP);
    const layout = generateFloorLayout(crewList);
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

    // Audio event tracking
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

        officeState.update(dt);
        morale.update(dt, officeState.characters);

        // ── Audio triggers ──
        if (audio.enabled) {
          const charCount = officeState.characters.size;
          if (charCount > prevCharCount) audio.playSpawnTone();
          else if (charCount < prevCharCount) audio.playDespawnTone();
          prevCharCount = charCount;

          const newBubbleSet = new Set<string>();
          for (const [id, char] of officeState.characters) {
            if (char.bubbleType) newBubbleSet.add(id);
          }
          for (const id of newBubbleSet) {
            if (!prevBubbleSet.has(id)) { audio.playBubblePop(); break; }
          }
          prevBubbleSet = newBubbleSet;

          let anyTyping = false;
          for (const char of officeState.characters.values()) {
            if (char.state === "type") { anyTyping = true; break; }
          }
          if (anyTyping) {
            typingClickTimer += dt;
            if (typingClickTimer >= 0.15) { audio.playTypingClick(); typingClickTimer = 0; }
          } else {
            typingClickTimer = 0;
          }

          for (const char of officeState.characters.values()) {
            if (char.mood === "celebrating" && char.moodTimer < dt * 2) {
              audio.playCelebration(); break;
            }
          }
        }

        // Recompute day/night every 10 seconds
        dayNightTimer += dt;
        if (dayNightTimer >= 10) {
          dayNightState = computeDayNightState();
          dayNightTimer = 0;
          if (tileCache.needsRebuild(officeState.layout, dayNightState.brightness)) {
            tileCache.rebuild(officeState.layout, dayNightState.brightness);
          }
        }
      },
      render: (dt) => {
        if (pausedRef.current) return;

        r.renderFrame(officeState, dt);

        const { width, height } = r.getContainerSize();
        const ctx = r.getContext();
        applyDayNightOverlay(ctx, dayNightState, width, height);

        const currentEditor = editorStateRef.current;
        if (currentEditor?.isActive) {
          editorOverlayRef.current?.render(ctx, r.getCamera(), currentEditor, width, height);
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
      const finalLayout = editor.deactivate();
      officeState.rebuildFromLayout(finalLayout);
      tileCacheRef.current?.invalidate();
      setEditorActive(false);
    } else {
      editor.activate(officeState.layout);
      setEditorActive(true);
    }
  }, [officeState]);

  const handleFollowChange = useCallback((_following: boolean) => {}, []);

  usePixelHQKeybinds({
    renderer,
    officeState,
    editorState: editorStateRef.current,
    isActive: true,
    onTogglePause: handleTogglePause,
    onToggleEditor: handleToggleEditor,
    onFollowChange: handleFollowChange,
  });

  // ── Context Menu Actions (Phase 6 — Control Panel) ────────────────────
  const contextMenuActions: HQContextMenuActions = {
    onViewChat: useCallback((minionId: string) => {
      navigateToMinion(minionId);
    }, [navigateToMinion]),

    onStopStream: useCallback(async (minionId: string) => {
      if (!apiState.api) return;
      try { await apiState.api.minion.interruptStream({ minionId }); } catch (e) { console.error("Failed to stop stream:", e); }
    }, [apiState.api]),

    onArchive: useCallback(async (minionId: string) => {
      if (!apiState.api) return;
      try { await apiState.api.minion.archive({ minionId }); } catch (e) { console.error("Failed to archive:", e); }
    }, [apiState.api]),

    onUnarchive: useCallback(async (minionId: string) => {
      if (!apiState.api) return;
      try { await apiState.api.minion.unarchive({ minionId }); } catch (e) { console.error("Failed to unarchive:", e); }
    }, [apiState.api]),

    onReassignCrew: useCallback(async (minionId: string, crewId: string | null) => {
      if (!apiState.api) return;
      try { await apiState.api.projects.crews.assignMinion({ projectPath, minionId, crewId }); } catch (e) { console.error("Failed to reassign:", e); }
    }, [apiState.api, projectPath]),

    onAnswerQuestion: useCallback((minionId: string) => {
      // Navigate to the minion's chat to answer the question
      navigateToMinion(minionId);
    }, [navigateToMinion]),

    onCopyId: useCallback((minionId: string) => {
      navigator.clipboard.writeText(minionId).catch(() => {});
    }, []),

    onNewMinion: useCallback(async (crewId?: string) => {
      if (!apiState.api) return;
      try {
        const result = await apiState.api.minion.create({ projectPath, branchName: "main", crewId });
        if (!result.success) {
          console.error("Failed to create minion:", result.error);
        }
      } catch (e) { console.error("Failed to create minion:", e); }
    }, [apiState.api, projectPath]),

    onNewCrew: useCallback(async () => {
      if (!apiState.api) return;
      try { await apiState.api.projects.crews.create({ projectPath, name: "New Crew" }); } catch (e) { console.error("Failed to create crew:", e); }
    }, [apiState.api, projectPath]),

    onRenameCrew: useCallback((_crewId: string) => {
      // TODO: Open inline rename UI
    }, []),

    onChangeCrewColor: useCallback((_crewId: string) => {
      // TODO: Open color picker UI
    }, []),
  };

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
        // Navigate to the minion chat
        navigateToMinion(char.minionId);
        // Initialize audio on first user interaction
        if (!audioRef.current?.enabled) {
          audioRef.current?.init();
        }
      }
    },
    [renderer, officeState, navigateToMinion],
  );

  // ── Right-click handler (context menu) ────────────────────────────────
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!renderer) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = renderer.screenToWorld(screenX, screenY);

      // Determine what was right-clicked (priority: character > desk > section > floor)
      const char = officeState.getCharacterAt(col * TILE_SIZE, row * TILE_SIZE);
      if (char) {
        setContextMenuTarget({ kind: "character", character: char });
      } else {
        const emptyDesk = officeState.getEmptyDeskAt(col, row, 2);
        if (emptyDesk) {
          const section = officeState.getSectionAt(col, row);
          setContextMenuTarget({ kind: "empty_desk", seat: emptyDesk, section });
        } else {
          const section = officeState.getSectionAt(col, row);
          if (section && section.zone === "crew_section") {
            setContextMenuTarget({ kind: "section", section });
          } else {
            setContextMenuTarget({ kind: "floor" });
          }
        }
      }

      setContextMenuPosition({ x: e.clientX, y: e.clientY });
      setContextMenuOpen(true);
    },
    [renderer, officeState],
  );

  // ── Mouse move handler (tooltip + editor ghost) ───────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!renderer) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const { col, row } = renderer.screenToWorld(screenX, screenY);

      // Editor ghost preview
      const editor = editorStateRef.current;
      if (editor?.isActive) {
        editor.updateGhost(col, row);
      }

      // Tooltip: check for hovered character
      const char = officeState.getCharacterAt(col * TILE_SIZE, row * TILE_SIZE);
      if (char) {
        setHoveredCharacter(char);
        setTooltipPos({ x: screenX, y: screenY });
      } else {
        setHoveredCharacter(null);
      }
    },
    [renderer, officeState],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredCharacter(null);
  }, []);

  // ── Editor template application ────────────────────────────────────────
  const handleApplyTemplate = useCallback(
    (template: RoomTemplate) => {
      const editor = editorStateRef.current;
      if (!editor?.isActive) return;
      const templateLayout = template.createLayout();
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

  // ── Resolve crew name/color for tooltip ───────────────────────────────
  const hoveredCrewName = hoveredCharacter?.crewId
    ? crews.find((c) => c.id === hoveredCharacter.crewId)?.name
    : undefined;
  const hoveredCrewColor = hoveredCharacter?.crewId
    ? crews.find((c) => c.id === hoveredCharacter.crewId)?.color ?? undefined
    : undefined;

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
        onContextMenu={handleContextMenu}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Toolbar — always visible */}
      {renderer && (
        <PixelHQToolbar
          renderer={renderer}
          officeState={officeState}
          crews={crews}
        />
      )}

      {/* Editor sidebar — visible when editor is active */}
      {editorActive && editorStateRef.current && (
        <PixelHQEditor
          editor={editorStateRef.current}
          onClose={handleToggleEditor}
          onApplyTemplate={handleApplyTemplate}
        />
      )}

      {/* Context menu — control panel */}
      <PixelHQContextMenu
        open={contextMenuOpen}
        onOpenChange={setContextMenuOpen}
        position={contextMenuPosition}
        target={contextMenuTarget}
        actions={contextMenuActions}
        crews={crews}
      />

      {/* Character tooltip — on hover */}
      {hoveredCharacter && !contextMenuOpen && (
        <PixelHQCharacterTooltip
          character={hoveredCharacter}
          x={tooltipPos.x}
          y={tooltipPos.y}
          crewName={hoveredCrewName}
          crewColor={hoveredCrewColor}
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
