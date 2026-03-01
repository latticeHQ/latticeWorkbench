/**
 * Pixel HQ Layout Editor State
 *
 * Manages the editor tool palette, undo/redo history, ghost preview,
 * selection state, and layout import/export. The editor is a modal
 * overlay on top of the Pixel HQ canvas that lets users customize
 * their office layout.
 */

import type {
  OfficeLayout,
  TileType,
  PlacedFurniture,
  FurnitureCatalogEntry,
  TileColorConfig,
  RoomDefinition,
} from "../engine/types";
import { TileType as TT } from "../engine/types";

// ─────────────────────────────────────────────────────────────────────────────
// Editor Tool Types
// ─────────────────────────────────────────────────────────────────────────────

export const EditTool = {
  SELECT: "select",
  TILE_PAINT: "tile_paint",
  WALL_PAINT: "wall_paint",
  FURNITURE_PLACE: "furniture_place",
  ROOM_DEFINE: "room_define",
  ERASE: "erase",
} as const;
export type EditTool = (typeof EditTool)[keyof typeof EditTool];

export interface GhostPreview {
  /** Catalog entry being placed */
  catalog: FurnitureCatalogEntry;
  /** Ghost position in tile coordinates */
  col: number;
  row: number;
  /** Whether the ghost position is valid for placement */
  valid: boolean;
}

export interface SelectionRect {
  /** Start tile (where drag began) */
  startCol: number;
  startRow: number;
  /** End tile (current drag position) */
  endCol: number;
  endRow: number;
}

export interface EditorHistoryEntry {
  /** Snapshot of the layout at this point */
  layout: OfficeLayout;
  /** Description of the action */
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// EditorState
// ─────────────────────────────────────────────────────────────────────────────

const MAX_UNDO_LEVELS = 50;

let furnitureEditorUidCounter = 10000;

function nextEditorFurnitureUid(): string {
  return `efurn_${++furnitureEditorUidCounter}`;
}

/**
 * Central state manager for the Pixel HQ layout editor.
 *
 * Tracks the active tool, selection state, ghost preview, and a full
 * undo/redo history stack. Provides methods for all editor operations:
 * painting tiles, placing/removing furniture, defining rooms, and
 * importing/exporting layouts.
 */
export class EditorState {
  /** The currently active editor tool */
  activeTool: EditTool = EditTool.SELECT;

  /** Selected tile type for tile/wall painting */
  selectedTileType: TileType = TT.FLOOR_1;

  /** Selected furniture catalog entry for placement */
  selectedFurniture: FurnitureCatalogEntry | null = null;

  /** Ghost preview of furniture being placed */
  ghost: GhostPreview | null = null;

  /** Current drag-selection rectangle */
  selection: SelectionRect | null = null;

  /** Selected furniture UID (for move/delete) */
  selectedFurnitureUid: string | null = null;

  /** Selected room ID (for room editor) */
  selectedRoomId: string | null = null;

  /** Whether the editor grid overlay is visible */
  showGrid: boolean = true;

  /** Whether the editor is active (modal overlay) */
  isActive: boolean = false;

  /** Current working layout (mutable during editing) */
  private layout: OfficeLayout;

  /** Undo history stack (most recent last) */
  private undoStack: EditorHistoryEntry[] = [];

  /** Redo history stack (most recent last) */
  private redoStack: EditorHistoryEntry[] = [];

  /** Listeners for state changes */
  private listeners: Set<() => void> = new Set();

  constructor(initialLayout: OfficeLayout) {
    this.layout = this.cloneLayout(initialLayout);
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getLayout(): OfficeLayout {
    return this.layout;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  getUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  getRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  // ─── Tool Selection ───────────────────────────────────────────────────────

  setTool(tool: EditTool): void {
    this.activeTool = tool;
    this.ghost = null;
    this.selection = null;
    this.selectedFurnitureUid = null;
    this.notify();
  }

  setSelectedTileType(tileType: TileType): void {
    this.selectedTileType = tileType;
    this.notify();
  }

  setSelectedFurniture(entry: FurnitureCatalogEntry | null): void {
    this.selectedFurniture = entry;
    if (entry) {
      this.activeTool = EditTool.FURNITURE_PLACE;
    }
    this.ghost = null;
    this.notify();
  }

  // ─── Editor Activation ────────────────────────────────────────────────────

  activate(layout: OfficeLayout): void {
    this.layout = this.cloneLayout(layout);
    this.undoStack = [];
    this.redoStack = [];
    this.isActive = true;
    this.activeTool = EditTool.SELECT;
    this.ghost = null;
    this.selection = null;
    this.selectedFurnitureUid = null;
    this.selectedRoomId = null;
    this.notify();
  }

  deactivate(): OfficeLayout {
    this.isActive = false;
    this.ghost = null;
    this.selection = null;
    this.notify();
    return this.cloneLayout(this.layout);
  }

  // ─── History (Undo / Redo) ────────────────────────────────────────────────

  private pushHistory(description: string): void {
    this.undoStack.push({
      layout: this.cloneLayout(this.layout),
      description,
    });
    // Trim to max levels
    if (this.undoStack.length > MAX_UNDO_LEVELS) {
      this.undoStack.shift();
    }
    // Clear redo stack on new action
    this.redoStack = [];
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;

    // Push current state to redo
    this.redoStack.push({
      layout: this.cloneLayout(this.layout),
      description: entry.description,
    });

    this.layout = entry.layout;
    this.notify();
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;

    // Push current state to undo
    this.undoStack.push({
      layout: this.cloneLayout(this.layout),
      description: entry.description,
    });

    this.layout = entry.layout;
    this.notify();
  }

  // ─── Tile Operations ──────────────────────────────────────────────────────

  /** Paint a single tile at (col, row) with the selected tile type. */
  paintTile(col: number, row: number, tileType?: TileType): void {
    const tt = tileType ?? this.selectedTileType;
    const idx = row * this.layout.cols + col;
    if (idx < 0 || idx >= this.layout.tiles.length) return;
    if (this.layout.tiles[idx] === tt) return; // No-op if same

    this.pushHistory(`Paint tile at (${col}, ${row})`);
    this.layout.tiles[idx] = tt;
    this.notify();
  }

  /** Paint tiles in a rectangular region. */
  paintTileRect(startCol: number, startRow: number, endCol: number, endRow: number, tileType?: TileType): void {
    const tt = tileType ?? this.selectedTileType;
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    this.pushHistory(`Paint rect (${minCol},${minRow})→(${maxCol},${maxRow})`);

    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const idx = r * this.layout.cols + c;
        if (idx >= 0 && idx < this.layout.tiles.length) {
          this.layout.tiles[idx] = tt;
        }
      }
    }
    this.notify();
  }

  /** Set the color config for a tile at (col, row). */
  setTileColor(col: number, row: number, color: TileColorConfig | null): void {
    const idx = row * this.layout.cols + col;
    if (idx < 0 || idx >= this.layout.tileColors.length) return;

    this.pushHistory(`Tint tile at (${col}, ${row})`);
    this.layout.tileColors[idx] = color;
    this.notify();
  }

  // ─── Furniture Operations ─────────────────────────────────────────────────

  /** Place furniture from the selected catalog entry at (col, row). */
  placeFurniture(col: number, row: number, catalogId?: string, roomId?: string): string | null {
    const catId = catalogId ?? this.selectedFurniture?.id;
    if (!catId) return null;

    // Check bounds
    if (col < 0 || row < 0 || col >= this.layout.cols || row >= this.layout.rows) return null;

    const uid = nextEditorFurnitureUid();
    const placed: PlacedFurniture = {
      uid,
      catalogId: catId,
      col,
      row,
      roomId: roomId ?? this.findRoomAtTile(col, row)?.id,
    };

    this.pushHistory(`Place ${catId} at (${col}, ${row})`);
    this.layout.furniture.push(placed);
    this.notify();
    return uid;
  }

  /** Remove a furniture instance by UID. */
  removeFurniture(uid: string): boolean {
    const idx = this.layout.furniture.findIndex((f) => f.uid === uid);
    if (idx === -1) return false;

    const furn = this.layout.furniture[idx];
    this.pushHistory(`Remove ${furn.catalogId} at (${furn.col}, ${furn.row})`);
    this.layout.furniture.splice(idx, 1);

    if (this.selectedFurnitureUid === uid) {
      this.selectedFurnitureUid = null;
    }
    this.notify();
    return true;
  }

  /** Move a furniture instance to a new position. */
  moveFurniture(uid: string, newCol: number, newRow: number): boolean {
    const furn = this.layout.furniture.find((f) => f.uid === uid);
    if (!furn) return false;

    this.pushHistory(`Move ${furn.catalogId} to (${newCol}, ${newRow})`);
    furn.col = newCol;
    furn.row = newRow;
    furn.roomId = this.findRoomAtTile(newCol, newRow)?.id;
    this.notify();
    return true;
  }

  /** Select a furniture instance by UID. */
  selectFurniture(uid: string | null): void {
    this.selectedFurnitureUid = uid;
    if (uid) {
      this.activeTool = EditTool.SELECT;
    }
    this.notify();
  }

  /** Find a furniture piece at a given tile coordinate. */
  findFurnitureAtTile(col: number, row: number, catalog: Map<string, FurnitureCatalogEntry>): PlacedFurniture | null {
    for (const furn of this.layout.furniture) {
      const entry = catalog.get(furn.catalogId);
      if (!entry) continue;
      if (
        col >= furn.col &&
        col < furn.col + entry.width &&
        row >= furn.row &&
        row < furn.row + entry.height
      ) {
        return furn;
      }
    }
    return null;
  }

  // ─── Ghost Preview ────────────────────────────────────────────────────────

  /** Update the ghost preview position for furniture placement. */
  updateGhost(col: number, row: number): void {
    if (!this.selectedFurniture || this.activeTool !== EditTool.FURNITURE_PLACE) {
      this.ghost = null;
      return;
    }

    const catalog = this.selectedFurniture;
    const valid =
      col >= 0 &&
      row >= 0 &&
      col + catalog.width <= this.layout.cols &&
      row + catalog.height <= this.layout.rows;

    this.ghost = { catalog, col, row, valid };
    this.notify();
  }

  clearGhost(): void {
    this.ghost = null;
    this.notify();
  }

  // ─── Selection Rectangle ──────────────────────────────────────────────────

  startSelection(col: number, row: number): void {
    this.selection = { startCol: col, startRow: row, endCol: col, endRow: row };
    this.notify();
  }

  updateSelection(col: number, row: number): void {
    if (!this.selection) return;
    this.selection.endCol = col;
    this.selection.endRow = row;
    this.notify();
  }

  commitSelection(): SelectionRect | null {
    const sel = this.selection;
    this.selection = null;
    this.notify();
    return sel;
  }

  // ─── Room Operations ──────────────────────────────────────────────────────

  /** Add a new room definition to the layout. */
  addRoom(room: RoomDefinition): void {
    this.pushHistory(`Add room "${room.label}"`);
    this.layout.rooms.push(room);
    this.notify();
  }

  /** Remove a room by ID. */
  removeRoom(roomId: string): boolean {
    const idx = this.layout.rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return false;

    const room = this.layout.rooms[idx];
    this.pushHistory(`Remove room "${room.label}"`);
    this.layout.rooms.splice(idx, 1);
    if (this.selectedRoomId === roomId) {
      this.selectedRoomId = null;
    }
    this.notify();
    return true;
  }

  /** Update a room's properties. */
  updateRoom(roomId: string, updates: Partial<Pick<RoomDefinition, "label" | "bounds" | "crewId" | "crewColor">>): boolean {
    const room = this.layout.rooms.find((r) => r.id === roomId);
    if (!room) return false;

    this.pushHistory(`Update room "${room.label}"`);
    if (updates.label !== undefined) room.label = updates.label;
    if (updates.bounds !== undefined) room.bounds = updates.bounds;
    if (updates.crewId !== undefined) room.crewId = updates.crewId;
    if (updates.crewColor !== undefined) room.crewColor = updates.crewColor;
    this.notify();
    return true;
  }

  selectRoom(roomId: string | null): void {
    this.selectedRoomId = roomId;
    this.notify();
  }

  // ─── Erase Operations ────────────────────────────────────────────────────

  /** Erase at a tile position: removes furniture or sets tile to VOID. */
  eraseAtTile(col: number, row: number, catalog: Map<string, FurnitureCatalogEntry>): void {
    // First try to remove furniture at this tile
    const furn = this.findFurnitureAtTile(col, row, catalog);
    if (furn) {
      this.removeFurniture(furn.uid);
      return;
    }

    // Otherwise erase the tile
    this.paintTile(col, row, TT.VOID);
  }

  // ─── Room Helpers ─────────────────────────────────────────────────────────

  /** Find which room a tile belongs to (first match). */
  findRoomAtTile(col: number, row: number): RoomDefinition | null {
    for (const room of this.layout.rooms) {
      const b = room.bounds;
      if (col >= b.col && col < b.col + b.width && row >= b.row && row < b.row + b.height) {
        return room;
      }
    }
    return null;
  }

  // ─── Import / Export ──────────────────────────────────────────────────────

  /** Export the current layout as a JSON string. */
  exportLayout(): string {
    return JSON.stringify(this.layout, null, 2);
  }

  /** Import a layout from JSON string. Replaces the current layout. */
  importLayout(json: string): boolean {
    try {
      const parsed = JSON.parse(json) as OfficeLayout;
      // Basic validation
      if (
        !parsed.cols ||
        !parsed.rows ||
        !Array.isArray(parsed.tiles) ||
        !Array.isArray(parsed.furniture) ||
        !Array.isArray(parsed.rooms)
      ) {
        return false;
      }
      if (parsed.tiles.length !== parsed.cols * parsed.rows) {
        return false;
      }
      this.pushHistory("Import layout");
      this.layout = parsed;
      // Ensure tileColors exists
      if (!this.layout.tileColors || this.layout.tileColors.length !== this.layout.tiles.length) {
        this.layout.tileColors = new Array(this.layout.tiles.length).fill(null);
      }
      this.notify();
      return true;
    } catch {
      return false;
    }
  }

  /** Apply a room template by merging its layout into the current one at a position. */
  applyTemplate(
    template: OfficeLayout,
    offsetCol: number,
    offsetRow: number,
  ): void {
    this.pushHistory("Apply room template");

    // Expand grid if needed
    const neededCols = offsetCol + template.cols;
    const neededRows = offsetRow + template.rows;
    if (neededCols > this.layout.cols || neededRows > this.layout.rows) {
      this.resizeGrid(
        Math.max(this.layout.cols, neededCols),
        Math.max(this.layout.rows, neededRows),
      );
    }

    // Copy tiles from template
    for (let r = 0; r < template.rows; r++) {
      for (let c = 0; c < template.cols; c++) {
        const srcIdx = r * template.cols + c;
        const dstIdx = (r + offsetRow) * this.layout.cols + (c + offsetCol);
        if (template.tiles[srcIdx] !== TT.VOID) {
          this.layout.tiles[dstIdx] = template.tiles[srcIdx];
        }
        if (template.tileColors?.[srcIdx]) {
          this.layout.tileColors[dstIdx] = template.tileColors[srcIdx];
        }
      }
    }

    // Copy furniture with offset
    for (const furn of template.furniture) {
      this.layout.furniture.push({
        ...furn,
        uid: nextEditorFurnitureUid(),
        col: furn.col + offsetCol,
        row: furn.row + offsetRow,
      });
    }

    // Copy rooms with offset
    for (const room of template.rooms) {
      this.layout.rooms.push({
        ...room,
        id: `${room.id}_${Date.now()}`,
        bounds: {
          ...room.bounds,
          col: room.bounds.col + offsetCol,
          row: room.bounds.row + offsetRow,
        },
      });
    }

    this.notify();
  }

  // ─── Grid Resize ──────────────────────────────────────────────────────────

  /** Resize the grid, preserving existing content. */
  resizeGrid(newCols: number, newRows: number): void {
    if (newCols === this.layout.cols && newRows === this.layout.rows) return;

    this.pushHistory(`Resize grid to ${newCols}×${newRows}`);

    const newTiles: TileType[] = new Array(newCols * newRows).fill(TT.VOID);
    const newColors: Array<TileColorConfig | null> = new Array(newCols * newRows).fill(null);

    // Copy existing data
    const copyRows = Math.min(this.layout.rows, newRows);
    const copyCols = Math.min(this.layout.cols, newCols);
    for (let r = 0; r < copyRows; r++) {
      for (let c = 0; c < copyCols; c++) {
        newTiles[r * newCols + c] = this.layout.tiles[r * this.layout.cols + c];
        newColors[r * newCols + c] = this.layout.tileColors[r * this.layout.cols + c];
      }
    }

    this.layout.tiles = newTiles;
    this.layout.tileColors = newColors;
    this.layout.cols = newCols;
    this.layout.rows = newRows;

    // Remove furniture that's now out of bounds
    this.layout.furniture = this.layout.furniture.filter(
      (f) => f.col >= 0 && f.col < newCols && f.row >= 0 && f.row < newRows,
    );

    this.notify();
  }

  // ─── Listener Pattern ─────────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  // ─── Deep Clone Utility ───────────────────────────────────────────────────

  private cloneLayout(layout: OfficeLayout): OfficeLayout {
    return {
      version: layout.version,
      cols: layout.cols,
      rows: layout.rows,
      tiles: [...layout.tiles],
      furniture: layout.furniture.map((f) => ({ ...f })),
      tileColors: [...layout.tileColors],
      rooms: layout.rooms.map((r) => ({ ...r, bounds: { ...r.bounds } })),
    };
  }
}
