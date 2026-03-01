/**
 * PixelHQEditor — Layout Editor Sidebar Panel
 *
 * A slide-out panel that provides the editor UI for customizing
 * the Pixel HQ office layout. Includes:
 *
 * - Tool palette (Select, Paint, Wall, Furniture, Room, Erase)
 * - Tile type selector
 * - Furniture catalog browser
 * - Room template browser
 * - Room manager (list + select rooms)
 * - Import/Export buttons
 * - Undo/Redo buttons
 *
 * Uses Tailwind CSS with the Lattice dark theme.
 */

import { useState, useCallback, useSyncExternalStore } from "react";
import {
  MousePointer2,
  PaintBucket,
  BrickWall,
  Sofa,
  SquareDashed,
  Eraser,
  Undo2,
  Redo2,
  Download,
  Upload,
  Grid3x3,
  X,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/common/lib/utils";
import { EditorState, EditTool } from "@/browser/utils/pixelHQ/editor/editorState";
import { FURNITURE_CATALOG } from "@/browser/utils/pixelHQ/layouts/furnitureCatalog";
import {
  getTemplatesByCategory,
  type RoomTemplate,
} from "@/browser/utils/pixelHQ/layouts/roomTemplates";
import { TileType as TT } from "@/browser/utils/pixelHQ/engine/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PixelHQEditorProps {
  editor: EditorState;
  onClose: () => void;
  onApplyTemplate: (template: RoomTemplate) => void;
}

type EditorSection = "tools" | "tiles" | "furniture" | "templates" | "rooms";

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  { id: EditTool.SELECT, label: "Select", icon: MousePointer2, shortcut: "V" },
  { id: EditTool.TILE_PAINT, label: "Paint", icon: PaintBucket, shortcut: "B" },
  { id: EditTool.WALL_PAINT, label: "Walls", icon: BrickWall, shortcut: "W" },
  { id: EditTool.FURNITURE_PLACE, label: "Furniture", icon: Sofa, shortcut: "F" },
  { id: EditTool.ROOM_DEFINE, label: "Rooms", icon: SquareDashed, shortcut: "D" },
  { id: EditTool.ERASE, label: "Erase", icon: Eraser, shortcut: "E" },
] as const;

const TILE_OPTIONS = [
  { type: TT.FLOOR_1, label: "Floor 1", color: "#141829" },
  { type: TT.FLOOR_2, label: "Floor 2", color: "#161B30" },
  { type: TT.FLOOR_3, label: "Floor 3", color: "#181D35" },
  { type: TT.FLOOR_4, label: "Floor 4", color: "#1A1F38" },
  { type: TT.FLOOR_5, label: "Floor 5", color: "#151A2E" },
  { type: TT.FLOOR_6, label: "Floor 6", color: "#171C33" },
  { type: TT.FLOOR_7, label: "Floor 7", color: "#191E36" },
  { type: TT.WALL, label: "Wall", color: "#1E2236" },
  { type: TT.VOID, label: "Void", color: "#0C0F1A" },
] as const;

const FURNITURE_CATEGORIES: Record<string, string> = {
  office: "Office",
  meeting: "Meeting",
  tech: "Tech",
  lounge: "Lounge",
  decor: "Decor",
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PixelHQEditor({ editor, onClose, onApplyTemplate }: PixelHQEditorProps) {
  const [activeSection, setActiveSection] = useState<EditorSection>("tools");

  // Subscribe to editor state changes for re-renders
  const editorSnapshot = useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => ({
      activeTool: editor.activeTool,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
      undoDesc: editor.getUndoDescription(),
      redoDesc: editor.getRedoDescription(),
      selectedFurniture: editor.selectedFurniture,
      selectedFurnitureUid: editor.selectedFurnitureUid,
      selectedRoomId: editor.selectedRoomId,
      showGrid: editor.showGrid,
      rooms: editor.getLayout().rooms,
    }),
  );

  const handleExport = useCallback(() => {
    const json = editor.exportLayout();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixelhq-layout-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editor]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const success = editor.importLayout(text);
      if (!success) {
        console.error("[PixelHQEditor] Failed to import layout — invalid format");
      }
    };
    input.click();
  }, [editor]);

  const handleToggleGrid = useCallback(() => {
    editor.showGrid = !editor.showGrid;
  }, [editor]);

  return (
    <div className="absolute top-0 left-0 bottom-0 w-[260px] bg-[#111427]/95 backdrop-blur-xl border-r border-[#1F2337]/60 flex flex-col overflow-hidden z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1F2337]/40">
        <span className="text-[11px] font-semibold text-[#FBBF24] tracking-wide">
          LAYOUT EDITOR
        </span>
        <div className="flex items-center gap-1">
          <EditorBtn
            onClick={handleToggleGrid}
            title="Toggle grid"
            active={editorSnapshot.showGrid}
          >
            <Grid3x3 size={12} />
          </EditorBtn>
          <EditorBtn onClick={onClose} title="Close editor">
            <X size={12} />
          </EditorBtn>
        </div>
      </div>

      {/* Undo/Redo + Export/Import */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#1F2337]/30">
        <EditorBtn
          onClick={() => editor.undo()}
          disabled={!editorSnapshot.canUndo}
          title={editorSnapshot.undoDesc ? `Undo: ${editorSnapshot.undoDesc}` : "Nothing to undo"}
        >
          <Undo2 size={11} />
        </EditorBtn>
        <EditorBtn
          onClick={() => editor.redo()}
          disabled={!editorSnapshot.canRedo}
          title={editorSnapshot.redoDesc ? `Redo: ${editorSnapshot.redoDesc}` : "Nothing to redo"}
        >
          <Redo2 size={11} />
        </EditorBtn>
        <div className="flex-1" />
        <EditorBtn onClick={handleImport} title="Import layout JSON">
          <Upload size={11} />
        </EditorBtn>
        <EditorBtn onClick={handleExport} title="Export layout JSON">
          <Download size={11} />
        </EditorBtn>
      </div>

      {/* Tool Palette */}
      <div className="grid grid-cols-6 gap-0.5 px-2 py-2 border-b border-[#1F2337]/30">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => editor.setTool(tool.id)}
            title={`${tool.label} (${tool.shortcut})`}
            className={cn(
              "flex flex-col items-center justify-center py-1.5 rounded text-[8px] transition-colors",
              editorSnapshot.activeTool === tool.id
                ? "bg-[#FBBF24]/20 text-[#FBBF24]"
                : "text-[#6B7280] hover:text-[#E2E4EB] hover:bg-white/5",
            )}
          >
            <tool.icon size={14} />
            <span className="mt-0.5">{tool.shortcut}</span>
          </button>
        ))}
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-0 px-1 py-1 border-b border-[#1F2337]/30">
        {(["tiles", "furniture", "templates", "rooms"] as EditorSection[]).map((section) => (
          <button
            key={section}
            type="button"
            onClick={() => setActiveSection(section)}
            className={cn(
              "flex-1 text-[9px] py-1 rounded transition-colors capitalize",
              activeSection === section
                ? "bg-[#FBBF24]/10 text-[#FBBF24]"
                : "text-[#6B7280] hover:text-[#E2E4EB]",
            )}
          >
            {section}
          </button>
        ))}
      </div>

      {/* Section Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {activeSection === "tiles" && (
          <TileSection editor={editor} snapshot={editorSnapshot} />
        )}
        {activeSection === "furniture" && (
          <FurnitureSection editor={editor} snapshot={editorSnapshot} />
        )}
        {activeSection === "templates" && (
          <TemplateSection onApplyTemplate={onApplyTemplate} />
        )}
        {activeSection === "rooms" && (
          <RoomSection editor={editor} snapshot={editorSnapshot} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Button Component
// ─────────────────────────────────────────────────────────────────────────────

function EditorBtn({
  onClick,
  title,
  children,
  active,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded text-[10px] transition-colors",
        disabled && "opacity-30 cursor-not-allowed",
        active
          ? "bg-[#FBBF24]/20 text-[#FBBF24]"
          : "text-[#6B7280] hover:text-[#E2E4EB] hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile Section
// ─────────────────────────────────────────────────────────────────────────────

function TileSection({
  editor,
}: {
  editor: EditorState;
  snapshot: { activeTool: string };
}) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] text-[#6B7280] uppercase tracking-wider">
        Tile Type
      </div>
      <div className="grid grid-cols-3 gap-1">
        {TILE_OPTIONS.map((opt) => (
          <button
            key={opt.type}
            type="button"
            onClick={() => {
              editor.setSelectedTileType(opt.type);
              editor.setTool(
                opt.type === TT.WALL ? EditTool.WALL_PAINT : EditTool.TILE_PAINT,
              );
            }}
            className={cn(
              "flex flex-col items-center gap-1 py-1.5 px-1 rounded border transition-colors",
              "border-[#1F2337]/40 hover:border-[#FBBF24]/30",
            )}
          >
            <div
              className="w-6 h-6 rounded"
              style={{ backgroundColor: opt.color }}
            />
            <span className="text-[8px] text-[#6B7280]">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Furniture Section
// ─────────────────────────────────────────────────────────────────────────────

function FurnitureSection({
  editor,
}: {
  editor: EditorState;
  snapshot: { selectedFurniture: unknown };
}) {
  // Group by category
  const byCategory = new Map<string, typeof FURNITURE_CATALOG>();
  for (const entry of FURNITURE_CATALOG) {
    const cat = entry.category ?? "other";
    const list = byCategory.get(cat) ?? [];
    list.push(entry);
    byCategory.set(cat, list);
  }

  return (
    <div className="space-y-3">
      {Array.from(byCategory.entries()).map(([cat, entries]) => (
        <div key={cat}>
          <div className="text-[9px] text-[#6B7280] uppercase tracking-wider mb-1">
            {FURNITURE_CATEGORIES[cat] ?? cat}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => editor.setSelectedFurniture(entry)}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 px-1 rounded border transition-colors text-left",
                  editor.selectedFurniture?.id === entry.id
                    ? "border-[#FBBF24]/50 bg-[#FBBF24]/10"
                    : "border-[#1F2337]/40 hover:border-[#FBBF24]/20",
                )}
              >
                <span className="text-[10px] text-[#E2E4EB]">{entry.name}</span>
                <span className="text-[8px] text-[#6B7280]">
                  {entry.width}×{entry.height}
                  {entry.seatOffsets
                    ? ` · ${entry.seatOffsets.length} seats`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Section
// ─────────────────────────────────────────────────────────────────────────────

function TemplateSection({
  onApplyTemplate,
}: {
  onApplyTemplate: (template: RoomTemplate) => void;
}) {
  const byCategory = getTemplatesByCategory();

  return (
    <div className="space-y-3">
      <div className="text-[9px] text-[#6B7280]">
        Click a template to stamp it into your layout.
      </div>
      {Array.from(byCategory.entries()).map(([cat, templates]) => (
        <div key={cat}>
          <div className="text-[9px] text-[#6B7280] uppercase tracking-wider mb-1 capitalize">
            {cat}
          </div>
          <div className="space-y-1">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onApplyTemplate(t)}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded border border-[#1F2337]/40 hover:border-[#FBBF24]/30 transition-colors text-left"
              >
                <span className="text-sm">{t.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-[#E2E4EB] truncate">
                    {t.name}
                  </div>
                  <div className="text-[8px] text-[#6B7280] truncate">
                    {t.description}
                  </div>
                </div>
                <span className="text-[8px] text-[#6B7280] shrink-0">
                  {t.width}×{t.height}
                </span>
                <ChevronRight size={10} className="text-[#6B7280] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Room Section
// ─────────────────────────────────────────────────────────────────────────────

function RoomSection({
  editor,
  snapshot,
}: {
  editor: EditorState;
  snapshot: {
    selectedRoomId: string | null;
    rooms: readonly { id: string; label: string; zone: string; crewColor?: string }[];
  };
}) {
  return (
    <div className="space-y-2">
      <div className="text-[9px] text-[#6B7280] uppercase tracking-wider">
        Rooms ({snapshot.rooms.length})
      </div>
      <div className="space-y-1">
        {snapshot.rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => editor.selectRoom(room.id === snapshot.selectedRoomId ? null : room.id)}
            className={cn(
              "w-full flex items-center gap-2 py-1.5 px-2 rounded border transition-colors text-left",
              room.id === snapshot.selectedRoomId
                ? "border-[#FBBF24]/50 bg-[#FBBF24]/10"
                : "border-[#1F2337]/40 hover:border-[#FBBF24]/20",
            )}
          >
            {room.crewColor && (
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: room.crewColor }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-[#E2E4EB] truncate">
                {room.label}
              </div>
              <div className="text-[8px] text-[#6B7280]">
                {room.zone}
              </div>
            </div>
          </button>
        ))}
      </div>
      {snapshot.rooms.length === 0 && (
        <div className="text-[9px] text-[#6B7280] text-center py-4">
          No rooms defined. Use the Room tool to draw room boundaries.
        </div>
      )}
    </div>
  );
}
