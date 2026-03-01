/**
 * Pixel HQ Editor Overlay Renderer
 *
 * Draws editor-specific overlays on top of the main PixelHQ canvas:
 * - Grid lines (tile boundaries)
 * - Ghost furniture preview (semi-transparent, green/red validity)
 * - Selection rectangle (blue highlight)
 * - Room boundary outlines (dashed)
 * - Selected furniture highlight (yellow border + handles)
 * - Erase cursor (red X)
 *
 * This renderer reads from EditorState and draws additively —
 * it never clears the canvas, only overlays on existing frame.
 */

import type { Camera } from "../engine/types";
import type { EditorState, GhostPreview, SelectionRect } from "./editorState";
import { EditTool } from "./editorState";
import {
  TILE_SIZE,
  THEME_ACCENT_YELLOW,
  THEME_ACCENT_BLUE,
  THEME_ERROR,
  THEME_ACTIVE,
  THEME_TEXT,
} from "../engine/constants";

// ─────────────────────────────────────────────────────────────────────────────
// EditorOverlayRenderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders editor overlays on top of the Pixel HQ canvas.
 *
 * Usage:
 * ```ts
 * // After main renderer draws the frame
 * editorOverlay.render(ctx, camera, editorState);
 * ```
 */
export class EditorOverlayRenderer {
  /**
   * Render all active editor overlays onto the canvas context.
   *
   * Should be called AFTER the main PixelHQRenderer draws the frame
   * but BEFORE the minimap is drawn (so overlays appear in world space).
   *
   * @param ctx - Canvas 2D context (already has camera transform applied)
   * @param camera - Current camera state for coordinate mapping
   * @param editor - EditorState to read overlay data from
   * @param canvasWidth - Logical canvas width (for screen-space elements)
   * @param canvasHeight - Logical canvas height
   */
  render(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    editor: EditorState,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    if (!editor.isActive) return;

    const layout = editor.getLayout();

    // Save context state
    ctx.save();

    // Apply camera transform for world-space overlays
    ctx.translate(-camera.x * camera.zoom, -camera.y * camera.zoom);
    ctx.scale(camera.zoom, camera.zoom);

    // 1. Grid lines
    if (editor.showGrid) {
      this.renderGrid(ctx, layout.cols, layout.rows, camera.zoom);
    }

    // 2. Room boundary outlines
    this.renderRoomBounds(ctx, layout.rooms, editor.selectedRoomId);

    // 3. Selection rectangle
    if (editor.selection) {
      this.renderSelection(ctx, editor.selection);
    }

    // 4. Ghost furniture preview
    if (editor.ghost) {
      this.renderGhost(ctx, editor.ghost);
    }

    // 5. Selected furniture highlight
    if (editor.selectedFurnitureUid) {
      const furn = layout.furniture.find((f) => f.uid === editor.selectedFurnitureUid);
      if (furn) {
        this.renderFurnitureHighlight(ctx, furn.col, furn.row, 2, 1); // Default size fallback
      }
    }

    // 6. Erase cursor (rendered at mouse position — requires external mouse coord)
    // This is handled in the component via CSS cursor

    ctx.restore();

    // Screen-space overlays (tool info bar, etc.)
    this.renderToolInfo(ctx, editor, canvasWidth, canvasHeight);
  }

  // ─── Grid Lines ─────────────────────────────────────────────────────────

  private renderGrid(
    ctx: CanvasRenderingContext2D,
    cols: number,
    rows: number,
    zoom: number,
  ): void {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 0.5 / zoom; // Constant screen-space thickness

    ctx.beginPath();

    // Vertical lines
    for (let c = 0; c <= cols; c++) {
      const x = c * TILE_SIZE;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows * TILE_SIZE);
    }

    // Horizontal lines
    for (let r = 0; r <= rows; r++) {
      const y = r * TILE_SIZE;
      ctx.moveTo(0, y);
      ctx.lineTo(cols * TILE_SIZE, y);
    }

    ctx.stroke();
  }

  // ─── Room Boundaries ──────────────────────────────────────────────────

  private renderRoomBounds(
    ctx: CanvasRenderingContext2D,
    rooms: readonly { id: string; label: string; bounds: { col: number; row: number; width: number; height: number }; crewColor?: string }[],
    selectedRoomId: string | null,
  ): void {
    for (const room of rooms) {
      const b = room.bounds;
      const x = b.col * TILE_SIZE;
      const y = b.row * TILE_SIZE;
      const w = b.width * TILE_SIZE;
      const h = b.height * TILE_SIZE;

      const isSelected = room.id === selectedRoomId;
      const color = room.crewColor ?? THEME_ACCENT_BLUE;

      // Dashed outline
      ctx.save();
      ctx.strokeStyle = isSelected ? THEME_ACCENT_YELLOW : color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.setLineDash(isSelected ? [4, 2] : [3, 3]);
      ctx.globalAlpha = isSelected ? 0.9 : 0.4;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();

      // Room label
      ctx.save();
      ctx.fillStyle = isSelected ? THEME_ACCENT_YELLOW : THEME_TEXT;
      ctx.globalAlpha = isSelected ? 1.0 : 0.5;
      ctx.font = "bold 5px monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(room.label, x + 2, y + 2);
      ctx.restore();
    }
  }

  // ─── Selection Rectangle ──────────────────────────────────────────────

  private renderSelection(ctx: CanvasRenderingContext2D, sel: SelectionRect): void {
    const minCol = Math.min(sel.startCol, sel.endCol);
    const maxCol = Math.max(sel.startCol, sel.endCol);
    const minRow = Math.min(sel.startRow, sel.endRow);
    const maxRow = Math.max(sel.startRow, sel.endRow);

    const x = minCol * TILE_SIZE;
    const y = minRow * TILE_SIZE;
    const w = (maxCol - minCol + 1) * TILE_SIZE;
    const h = (maxRow - minRow + 1) * TILE_SIZE;

    // Fill
    ctx.save();
    ctx.fillStyle = THEME_ACCENT_BLUE;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x, y, w, h);

    // Border
    ctx.strokeStyle = THEME_ACCENT_BLUE;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();

    // Dimension label
    ctx.save();
    ctx.fillStyle = THEME_TEXT;
    ctx.globalAlpha = 0.8;
    ctx.font = "4px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `${maxCol - minCol + 1}×${maxRow - minRow + 1}`,
      x + w / 2,
      y - 1,
    );
    ctx.restore();
  }

  // ─── Ghost Furniture Preview ──────────────────────────────────────────

  private renderGhost(ctx: CanvasRenderingContext2D, ghost: GhostPreview): void {
    const x = ghost.col * TILE_SIZE;
    const y = ghost.row * TILE_SIZE;
    const w = ghost.catalog.width * TILE_SIZE;
    const h = ghost.catalog.height * TILE_SIZE;

    ctx.save();

    // Translucent fill (green = valid, red = invalid)
    ctx.fillStyle = ghost.valid ? THEME_ACTIVE : THEME_ERROR;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, y, w, h);

    // Border
    ctx.strokeStyle = ghost.valid ? THEME_ACTIVE : THEME_ERROR;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(x, y, w, h);

    // Label
    ctx.fillStyle = THEME_TEXT;
    ctx.globalAlpha = 0.8;
    ctx.font = "3px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.setLineDash([]);
    ctx.fillText(ghost.catalog.name, x + w / 2, y + h / 2);

    // Seat offset indicators (small dots)
    if (ghost.catalog.seatOffsets) {
      for (const offset of ghost.catalog.seatOffsets) {
        const seatX = (ghost.col + offset.col) * TILE_SIZE + TILE_SIZE / 2;
        const seatY = (ghost.row + offset.row) * TILE_SIZE + TILE_SIZE / 2;
        ctx.fillStyle = THEME_ACCENT_YELLOW;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(seatX, seatY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // ─── Selected Furniture Highlight ─────────────────────────────────────

  private renderFurnitureHighlight(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    width: number,
    height: number,
  ): void {
    const x = col * TILE_SIZE;
    const y = row * TILE_SIZE;
    const w = width * TILE_SIZE;
    const h = height * TILE_SIZE;

    ctx.save();

    // Yellow selection border (animated dash)
    ctx.strokeStyle = THEME_ACCENT_YELLOW;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    const offset = (Date.now() / 100) % 8;
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = offset;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);

    // Corner handles (small squares for resize/move)
    const handleSize = 3;
    ctx.fillStyle = THEME_ACCENT_YELLOW;
    ctx.globalAlpha = 1.0;
    ctx.setLineDash([]);

    // Top-left
    ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    // Top-right
    ctx.fillRect(x + w - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    // Bottom-left
    ctx.fillRect(x - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);
    // Bottom-right
    ctx.fillRect(x + w - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);

    // Delete button (red X in top-right corner)
    const btnX = x + w + 2;
    const btnY = y - 2;
    const btnSize = 6;
    ctx.fillStyle = THEME_ERROR;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(btnX, btnY, btnSize, btnSize);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(btnX + 1.5, btnY + 1.5);
    ctx.lineTo(btnX + btnSize - 1.5, btnY + btnSize - 1.5);
    ctx.moveTo(btnX + btnSize - 1.5, btnY + 1.5);
    ctx.lineTo(btnX + 1.5, btnY + btnSize - 1.5);
    ctx.stroke();

    ctx.restore();
  }

  // ─── Tool Info Bar ────────────────────────────────────────────────────

  private renderToolInfo(
    ctx: CanvasRenderingContext2D,
    editor: EditorState,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    const toolLabels: Record<string, string> = {
      [EditTool.SELECT]: "🖱 SELECT",
      [EditTool.TILE_PAINT]: "🎨 TILE PAINT",
      [EditTool.WALL_PAINT]: "🧱 WALL PAINT",
      [EditTool.FURNITURE_PLACE]: "🪑 PLACE FURNITURE",
      [EditTool.ROOM_DEFINE]: "📐 DEFINE ROOM",
      [EditTool.ERASE]: "🗑 ERASE",
    };

    const label = toolLabels[editor.activeTool] ?? editor.activeTool;

    // Bottom-center info pill
    const padding = 6;
    ctx.save();
    ctx.font = "bold 10px monospace";
    const textWidth = ctx.measureText(label).width;
    const pillW = textWidth + padding * 2;
    const pillH = 18;
    const pillX = (canvasWidth - pillW) / 2;
    const pillY = canvasHeight - pillH - 8;

    // Background pill
    ctx.fillStyle = "#111427";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 4);
    ctx.fill();

    // Border
    ctx.strokeStyle = THEME_ACCENT_YELLOW;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.fillStyle = THEME_ACCENT_YELLOW;
    ctx.globalAlpha = 1.0;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, canvasWidth / 2, pillY + pillH / 2);

    // Undo/redo indicator
    if (editor.canUndo() || editor.canRedo()) {
      const historyText = `↩${editor.canUndo() ? "✓" : "—"} ↪${editor.canRedo() ? "✓" : "—"}`;
      ctx.font = "8px monospace";
      ctx.fillStyle = THEME_TEXT;
      ctx.globalAlpha = 0.5;
      ctx.textAlign = "right";
      ctx.fillText(historyText, canvasWidth - 8, pillY + pillH / 2);
    }

    ctx.restore();
  }
}
