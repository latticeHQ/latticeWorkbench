/**
 * Pixel HQ Canvas 2D Rendering Pipeline
 *
 * Handles all visual rendering for the pixel-art office visualization:
 * tile grid, furniture, characters, speech bubbles, room labels, and minimap.
 *
 * The renderer is purely read-only with respect to game state -- it never
 * mutates the OfficeState, only reads it each frame.
 *
 * Rendering order (back to front):
 *   1. Clear canvas with theme background
 *   2. Apply camera transform (translate + scale)
 *   3. Tile grid (floor and wall colored rectangles)
 *   4. Room labels (text above each room)
 *   5. Furniture (Z-sorted by bottom edge Y)
 *   6. Characters (Z-sorted by Y position)
 *   7. Speech bubbles (above characters)
 *   8. Restore camera transform
 *   9. Minimap overlay (fixed screen position)
 */

import type {
  Camera,
  Character,
  FurnitureInstance,
  OfficeLayout,
  RoomDefinition,
} from "./types";
import { TileType as TT, BubbleType, CharacterState } from "./types";
import { SpriteCache } from "./spriteCache";
import {
  TILE_SIZE,
  CHAR_WIDTH,
  CHAR_HEIGHT,
  THEME_BG,
  THEME_FLOOR_COLORS,
  THEME_WALL,
  THEME_WALL_ACCENT,
  THEME_ACCENT_YELLOW,
  THEME_ACCENT_BLUE,
  THEME_TEXT,
  THEME_TEXT_MUTED,
  THEME_ACTIVE,
  THEME_ERROR,
  THEME_WARNING,
  THEME_BORDER,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_DEFAULT,
  CAMERA_LERP_SPEED,
  BUBBLE_FADE_SEC,
  BUBBLE_OFFSET_Y,
  BUBBLE_WIDTH,
  BUBBLE_HEIGHT,
  MATRIX_EFFECT_DURATION_SEC,
  MATRIX_RAIN_COLUMNS,
  ROOM_LABEL_FONT_SIZE,
  MINIMAP_WIDTH,
  MINIMAP_HEIGHT,
  MINIMAP_PADDING,
  MINIMAP_BG_ALPHA,
  MINIMAP_DOT_SIZE,
} from "./constants";

import { OfficeState } from "./officeState";
import type { OffscreenTileCache } from "./offscreenTileCache";

// ─────────────────────────────────────────────────────────────────────────────
// Matrix Rain Characters
// ─────────────────────────────────────────────────────────────────────────────

/** Character set used for the matrix rain spawn/despawn effect. */
const MATRIX_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*";

// ─────────────────────────────────────────────────────────────────────────────
// Furniture Drawing Colors
// ─────────────────────────────────────────────────────────────────────────────

/** Procedural color palette for furniture types (fallback when no sprite). */
const FURNITURE_COLORS: Record<string, { fill: string; accent: string }> = {
  desk: { fill: "#6B4226", accent: "#8B5A3E" },
  chair: { fill: "#4A4A62", accent: "#5E5E78" },
  server_rack: { fill: "#2D3148", accent: "#10B981" },
  plant: { fill: "#2E7D32", accent: "#66BB6A" },
  bookshelf: { fill: "#5D4037", accent: "#8D6E63" },
  whiteboard: { fill: "#E8E8E8", accent: "#CCCCCC" },
  coffee_machine: { fill: "#4E342E", accent: "#A1887F" },
  couch: { fill: "#455A64", accent: "#607D8B" },
  water_cooler: { fill: "#37474F", accent: "#4FC3F7" },
  conf_table: { fill: "#3E2723", accent: "#5D4037" },
};

/** Default furniture color when catalog ID is not recognized. */
const DEFAULT_FURNITURE_COLOR = { fill: "#4A4A62", accent: "#5E5E78" };

// ─────────────────────────────────────────────────────────────────────────────
// PixelHQRenderer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canvas 2D rendering pipeline for the Pixel HQ engine.
 *
 * Manages camera state, DPI-aware canvas sizing, and all draw calls
 * for the layered office scene. The renderer is instantiated once per
 * canvas element and reused across the application lifecycle.
 *
 * @example
 * ```ts
 * const renderer = new PixelHQRenderer(canvas, spriteCache);
 * // In your game loop:
 * renderer.renderFrame(officeState, dt);
 * ```
 */
export class PixelHQRenderer {
  /** The target canvas element. */
  private canvas: HTMLCanvasElement;

  /** The 2D rendering context for the canvas. */
  private ctx: CanvasRenderingContext2D;

  /** Shared sprite cache for loaded and procedural sprites. */
  private spriteCache: SpriteCache;

  /** Current camera state (position, zoom, follow target). */
  private camera: Camera;

  /** Logical width of the canvas container in CSS pixels. */
  private containerWidth: number;

  /** Logical height of the canvas container in CSS pixels. */
  private containerHeight: number;

  /** Accumulated time for animation effects (walking bob, blinking). */
  private animTime: number;

  /** Optional tile cache for fast tile rendering. */
  private tileCache: OffscreenTileCache | null = null;

  /**
   * Create a new PixelHQRenderer.
   *
   * @param canvas - The HTML canvas element to render into.
   * @param spriteCache - Shared sprite cache instance for image lookups.
   */
  constructor(canvas: HTMLCanvasElement, spriteCache: SpriteCache) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("[PixelHQRenderer] Failed to get 2D rendering context");
    }
    this.ctx = ctx;
    this.spriteCache = spriteCache;

    this.containerWidth = canvas.clientWidth || canvas.width;
    this.containerHeight = canvas.clientHeight || canvas.height;
    this.animTime = 0;

    this.camera = {
      x: 0,
      y: 0,
      zoom: ZOOM_DEFAULT,
      targetX: 0,
      targetY: 0,
      targetZoom: ZOOM_DEFAULT,
      followId: null,
    };

    // Initial canvas sizing
    this.resizeCanvas();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — Main Render Entry Point
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render one complete frame of the office scene.
   *
   * This is the main entry point called every animation frame by the game loop.
   * It updates the camera, clears the canvas, and draws all layers in order.
   *
   * @param state - The current office simulation state (read-only).
   * @param dt - Delta time in seconds since the last frame.
   */
  renderFrame(state: OfficeState, dt: number): void {
    const { ctx } = this;
    this.animTime += dt;

    // Update camera position (smooth follow and lerp)
    this.updateCamera(state, dt);

    // 1. Clear canvas with theme background
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = THEME_BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();

    // 2. Apply camera transform
    ctx.save();
    ctx.translate(
      -this.camera.x * this.camera.zoom + this.containerWidth / 2,
      -this.camera.y * this.camera.zoom + this.containerHeight / 2,
    );
    ctx.scale(this.camera.zoom, this.camera.zoom);

    // 3. Render tile grid
    this.renderTileGrid(state.layout);

    // 4. Render room labels
    this.renderRoomLabels(state.layout.rooms);

    // 5. Render furniture (Z-sorted)
    this.renderFurniture(state.furnitureInstances);

    // 6. Render characters (Z-sorted by Y)
    const sortedCharacters = this.getSortedCharacters(state.characters);
    this.renderCharacters(sortedCharacters, state.elapsedTime);

    // 7. Render speech bubbles
    this.renderBubbles(sortedCharacters);

    // 8. Restore camera transform
    ctx.restore();

    // 9. Render minimap (fixed screen position, no camera transform)
    this.renderMinimap(state);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — Camera Controls
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Set the character ID for the camera to follow.
   * Pass `null` to stop following and allow free panning.
   *
   * @param characterId - The character ID to follow, or null to unfollow.
   */
  setFollowTarget(characterId: string | null): void {
    this.camera.followId = characterId;
  }

  /**
   * Adjust the camera zoom level by a relative delta.
   * The zoom is clamped between ZOOM_MIN and ZOOM_MAX.
   *
   * @param delta - Zoom delta (positive = zoom in, negative = zoom out).
   */
  zoomBy(delta: number): void {
    this.camera.targetZoom = clamp(
      this.camera.targetZoom + delta,
      ZOOM_MIN,
      ZOOM_MAX,
    );
  }

  /**
   * Set the camera zoom level to an absolute value.
   * The zoom is clamped between ZOOM_MIN and ZOOM_MAX.
   *
   * @param level - Desired zoom level.
   */
  zoomTo(level: number): void {
    this.camera.targetZoom = clamp(level, ZOOM_MIN, ZOOM_MAX);
  }

  /**
   * Pan the camera by a relative offset in world-space pixels.
   * Clears the follow target so the camera stays at the new position.
   *
   * @param dx - Horizontal pan delta in world pixels.
   * @param dy - Vertical pan delta in world pixels.
   */
  panBy(dx: number, dy: number): void {
    this.camera.followId = null;
    this.camera.targetX += dx;
    this.camera.targetY += dy;
  }

  /**
   * Pan the camera to center on a specific world-space position.
   * Clears the follow target so the camera stays at the new position.
   *
   * @param worldX - Target world X coordinate.
   * @param worldY - Target world Y coordinate.
   */
  panTo(worldX: number, worldY: number): void {
    this.camera.followId = null;
    this.camera.targetX = worldX;
    this.camera.targetY = worldY;
  }

  /**
   * Reset the camera to the default position and zoom.
   * Centers on the origin and restores default zoom level.
   */
  resetCamera(): void {
    this.camera.followId = null;
    this.camera.targetX = 0;
    this.camera.targetY = 0;
    this.camera.targetZoom = ZOOM_DEFAULT;
  }

  /**
   * Center the camera on the middle of the given layout grid.
   * Call after the layout is generated.
   */
  centerOnLayout(cols: number, rows: number): void {
    const centerX = (cols * TILE_SIZE) / 2;
    const centerY = (rows * TILE_SIZE) / 2;
    this.camera.x = centerX;
    this.camera.y = centerY;
    this.camera.targetX = centerX;
    this.camera.targetY = centerY;
  }

  /**
   * Fit the entire layout into the viewport by calculating the optimal zoom
   * level and centering the camera. Adds a small margin so tiles don't touch
   * the canvas edge.
   */
  fitToLayout(cols: number, rows: number): void {
    const worldWidth = cols * TILE_SIZE;
    const worldHeight = rows * TILE_SIZE;
    const margin = 0.9; // 90% of viewport used, 10% padding

    const zoomX = (this.containerWidth * margin) / worldWidth;
    const zoomY = (this.containerHeight * margin) / worldHeight;
    const fitZoom = Math.min(zoomX, zoomY);

    // Clamp to allowed range
    const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fitZoom));

    const centerX = worldWidth / 2;
    const centerY = worldHeight / 2;

    this.camera.x = centerX;
    this.camera.y = centerY;
    this.camera.targetX = centerX;
    this.camera.targetY = centerY;
    this.camera.zoom = clampedZoom;
    this.camera.targetZoom = clampedZoom;
  }

  /**
   * Get a read-only snapshot of the current camera state.
   *
   * @returns A copy of the current camera state.
   */
  getCamera(): Camera {
    return { ...this.camera };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — Coordinate Conversion
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Convert screen (CSS pixel) coordinates to world tile coordinates.
   *
   * @param screenX - X position in CSS pixels relative to the canvas.
   * @param screenY - Y position in CSS pixels relative to the canvas.
   * @returns The tile column and row under the given screen position.
   */
  screenToWorld(
    screenX: number,
    screenY: number,
  ): { col: number; row: number } {
    const worldX =
      (screenX - this.containerWidth / 2) / this.camera.zoom + this.camera.x;
    const worldY =
      (screenY - this.containerHeight / 2) / this.camera.zoom + this.camera.y;
    return {
      col: Math.floor(worldX / TILE_SIZE),
      row: Math.floor(worldY / TILE_SIZE),
    };
  }

  /**
   * Convert world tile coordinates to screen (CSS pixel) coordinates.
   *
   * @param col - Tile column.
   * @param row - Tile row.
   * @returns The screen position in CSS pixels relative to the canvas.
   */
  worldToScreen(col: number, row: number): { x: number; y: number } {
    const worldX = col * TILE_SIZE;
    const worldY = row * TILE_SIZE;
    return {
      x: (worldX - this.camera.x) * this.camera.zoom + this.containerWidth / 2,
      y:
        (worldY - this.camera.y) * this.camera.zoom +
        this.containerHeight / 2,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — Canvas Sizing
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resize the canvas to match its CSS container size, accounting for
   * device pixel ratio (DPI) for crisp rendering on high-DPI displays.
   *
   * Follows the same pattern as PowerModeEngine.ts: multiply the logical
   * size by `devicePixelRatio`, then use `setTransform` so all subsequent
   * draw calls operate in CSS-pixel space.
   */
  resizeCanvas(): void {
    const parent = this.canvas.parentElement;
    if (parent) {
      this.containerWidth = parent.clientWidth;
      this.containerHeight = parent.clientHeight;
    } else {
      this.containerWidth = this.canvas.clientWidth || this.canvas.width;
      this.containerHeight = this.canvas.clientHeight || this.canvas.height;
    }

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(this.containerWidth * dpr);
    this.canvas.height = Math.floor(this.containerHeight * dpr);
    this.canvas.style.width = `${this.containerWidth}px`;
    this.canvas.style.height = `${this.containerHeight}px`;

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — Cleanup
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get the 2D rendering context for external overlay rendering.
   * Used by EditorOverlayRenderer and day/night overlay.
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * Get the logical container dimensions (CSS pixels).
   */
  getContainerSize(): { width: number; height: number } {
    return { width: this.containerWidth, height: this.containerHeight };
  }

  /**
   * Set the offscreen tile cache for optimized tile rendering.
   * When set, the tile grid is drawn via a single drawImage call
   * from the cached canvas instead of iterating every tile each frame.
   *
   * @param cache - The OffscreenTileCache instance, or null to disable.
   */
  setTileCache(cache: OffscreenTileCache | null): void {
    this.tileCache = cache;
  }

  /**
   * Release all resources held by the renderer.
   * After calling dispose, the renderer should not be used again.
   */
  dispose(): void {
    // Clear the canvas one final time
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Camera Update
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Update camera position by lerping toward the target.
   * If a follow target is set and the character exists, the camera
   * target is updated to center on that character each frame.
   *
   * @param state - Current office state (for character lookup).
   * @param dt - Delta time in seconds.
   */
  private updateCamera(state: OfficeState, dt: number): void {
    // Follow target character if set
    if (this.camera.followId !== null) {
      const followed = state.characters.get(this.camera.followId);
      if (followed) {
        this.camera.targetX = followed.x;
        this.camera.targetY = followed.y;
      }
    }

    // Lerp position toward target
    const lerpFactor = 1 - Math.exp(-CAMERA_LERP_SPEED * dt);
    this.camera.x += (this.camera.targetX - this.camera.x) * lerpFactor;
    this.camera.y += (this.camera.targetY - this.camera.y) * lerpFactor;
    this.camera.zoom +=
      (this.camera.targetZoom - this.camera.zoom) * lerpFactor;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 3: Tile Grid
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render the tile grid. Each tile is drawn as a colored rectangle
   * based on its tile type. VOID tiles are skipped (transparent).
   * Floor tiles use THEME_FLOOR_COLORS; wall tiles use THEME_WALL.
   *
   * @param layout - The office layout containing tile data.
   */
  private renderTileGrid(layout: OfficeLayout): void {
    const { ctx } = this;

    // Fast path: use pre-rendered tile cache if available
    if (this.tileCache && !this.tileCache.isDirty) {
      this.tileCache.drawTo(ctx);
      return;
    }

    // Slow path: draw each tile individually (fallback)
    const { cols, rows, tiles } = layout;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileIndex = row * cols + col;
        const tileType = tiles[tileIndex];

        // Skip VOID tiles
        if (tileType === TT.VOID) continue;

        const px = col * TILE_SIZE;
        const py = row * TILE_SIZE;

        if (tileType === TT.WALL) {
          // Draw wall rectangle with accent border
          ctx.fillStyle = THEME_WALL;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = THEME_WALL_ACCENT;
          ctx.fillRect(px, py, TILE_SIZE, 2);
          ctx.fillRect(px, py, 2, TILE_SIZE); // Left accent
        } else {
          // Floor tiles: map tile type to color index (FLOOR_1=0, FLOOR_2=1, ...)
          const floorIndex = (tileType as number) - (TT.FLOOR_1 as number);
          const color =
            THEME_FLOOR_COLORS[floorIndex] ?? THEME_FLOOR_COLORS[0];
          ctx.fillStyle = color;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Subtle grid line for floor tiles
          ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
          ctx.fillRect(px, py, TILE_SIZE, 0.5);
          ctx.fillRect(px, py, 0.5, TILE_SIZE);
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 4: Room Labels
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render room labels above each room's bounding box.
   * Uses the room's crewColor if available, otherwise falls back
   * to THEME_TEXT_MUTED for neutral rooms.
   *
   * @param rooms - Array of room definitions from the layout.
   */
  private renderRoomLabels(rooms: RoomDefinition[]): void {
    const { ctx } = this;

    ctx.save();
    ctx.font = `bold ${ROOM_LABEL_FONT_SIZE}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    for (const room of rooms) {
      const { bounds, label, crewColor, zone } = room;

      // Skip common aisle labels — too noisy
      if (zone === "common_aisle") continue;

      // Label position: inside top-left of section with padding
      const labelX = bounds.col * TILE_SIZE + 3;
      const labelY = bounds.row * TILE_SIZE + 2;

      // Background pill behind label for readability
      const labelWidth = ctx.measureText(label).width;
      const pillColor = crewColor ? crewColor + "30" : "rgba(11, 14, 24, 0.7)";
      ctx.fillStyle = pillColor;
      ctx.fillRect(
        labelX - 2,
        labelY - 1,
        labelWidth + 4,
        ROOM_LABEL_FONT_SIZE + 3,
      );

      // Label text
      ctx.fillStyle = crewColor ?? THEME_TEXT_MUTED;
      ctx.globalAlpha = 0.9;
      ctx.fillText(label, labelX, labelY);

      // Section divider: subtle vertical dashed line on the RIGHT edge of crew sections
      if (zone === "crew_section") {
        const rightEdgeX = (bounds.col + bounds.width) * TILE_SIZE;
        ctx.strokeStyle = THEME_WALL_ACCENT;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(rightEdgeX, bounds.row * TILE_SIZE);
        ctx.lineTo(rightEdgeX, (bounds.row + bounds.height) * TILE_SIZE);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 5: Furniture
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render furniture instances sorted by their Z-sort Y value (bottom edge).
   * When a sprite is available in the cache, it is drawn with drawImage.
   * Otherwise, a procedural colored rectangle with simple pixel features
   * is drawn as a fallback.
   *
   * @param instances - Array of resolved furniture instances.
   */
  private renderFurniture(instances: FurnitureInstance[]): void {
    const { ctx } = this;

    // Sort by zY for correct depth ordering
    const sorted = [...instances].sort((a, b) => a.zY - b.zY);

    for (const inst of sorted) {
      const { catalog } = inst;
      const px = inst.x;
      const py = inst.y;
      const w = catalog.width * TILE_SIZE;
      const h = catalog.height * TILE_SIZE;

      // Try to use cached sprite first
      const sprite = this.spriteCache.get(catalog.spriteKey);
      if (sprite) {
        ctx.drawImage(sprite, px, py, w, h);
        continue;
      }

      // Procedural fallback: draw colored rectangle with features
      const catalogBase = catalog.id.split("_")[0].toLowerCase();
      const colors = FURNITURE_COLORS[catalogBase] ?? DEFAULT_FURNITURE_COLOR;

      ctx.fillStyle = colors.fill;
      ctx.fillRect(px, py, w, h);

      // Draw type-specific pixel features
      this.drawFurnitureFeatures(ctx, catalogBase, px, py, w, h, colors.accent);
    }
  }

  /**
   * Draw simple pixel features on a procedural furniture rectangle.
   * Each furniture type gets distinctive visual details.
   *
   * @param ctx - The 2D rendering context.
   * @param catalogBase - The base catalog identifier (e.g., "desk", "chair").
   * @param px - Pixel X position.
   * @param py - Pixel Y position.
   * @param w - Width in pixels.
   * @param h - Height in pixels.
   * @param accent - Accent color for highlights.
   */
  private drawFurnitureFeatures(
    ctx: CanvasRenderingContext2D,
    catalogBase: string,
    px: number,
    py: number,
    w: number,
    h: number,
    accent: string,
  ): void {
    switch (catalogBase) {
      case "desk": {
        // Lighter top edge to suggest a monitor/screen
        ctx.fillStyle = accent;
        ctx.fillRect(px + 2, py, w - 4, 2);
        // Small "monitor" rectangle
        ctx.fillStyle = "#1A1F38";
        ctx.fillRect(px + 3, py + 1, w - 6, 4);
        // Screen glow pixel
        ctx.fillStyle = THEME_ACTIVE;
        ctx.fillRect(px + 4, py + 2, 2, 2);
        break;
      }
      case "chair": {
        // Smaller inner rectangle for seat cushion
        const inset = Math.max(1, Math.floor(w * 0.2));
        ctx.fillStyle = accent;
        ctx.fillRect(px + inset, py + inset, w - inset * 2, h - inset * 2);
        break;
      }
      case "server": {
        // LED indicator lights
        const ledCount = Math.max(1, Math.floor(h / 4));
        for (let i = 0; i < ledCount; i++) {
          const ledY = py + 2 + i * 4;
          ctx.fillStyle =
            i % 3 === 0 ? THEME_ACTIVE : i % 3 === 1 ? THEME_WARNING : accent;
          ctx.fillRect(px + w - 3, ledY, 2, 1);
        }
        break;
      }
      case "plant": {
        // Small leaf pixels
        ctx.fillStyle = accent;
        ctx.fillRect(px + w / 2 - 1, py, 2, 3);
        ctx.fillRect(px + w / 2 - 3, py + 2, 6, 2);
        // Pot
        ctx.fillStyle = "#795548";
        ctx.fillRect(px + 1, py + h - 4, w - 2, 4);
        break;
      }
      case "bookshelf": {
        // Horizontal shelf lines
        const shelfCount = Math.max(1, Math.floor(h / 5));
        ctx.fillStyle = accent;
        for (let i = 1; i <= shelfCount; i++) {
          const shelfY = py + Math.floor((h / (shelfCount + 1)) * i);
          ctx.fillRect(px + 1, shelfY, w - 2, 1);
        }
        break;
      }
      case "whiteboard": {
        // Border
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
        break;
      }
      case "coffee": {
        // Steam pixels
        ctx.fillStyle = "#9E9E9E";
        ctx.fillRect(px + w / 2, py - 1, 1, 1);
        ctx.fillRect(px + w / 2 + 1, py - 2, 1, 1);
        break;
      }
      case "couch": {
        // Arm rests
        ctx.fillStyle = accent;
        ctx.fillRect(px, py, 2, h);
        ctx.fillRect(px + w - 2, py, 2, h);
        break;
      }
      default: {
        // Generic accent border on top
        ctx.fillStyle = accent;
        ctx.fillRect(px, py, w, 1);
        break;
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 6: Characters
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get all characters sorted by Y position for correct depth rendering.
   * Characters further down (higher Y) are drawn on top.
   *
   * @param characters - Map of character ID to Character.
   * @returns Sorted array of characters.
   */
  private getSortedCharacters(characters: Map<string, Character>): Character[] {
    return Array.from(characters.values()).sort((a, b) => a.y - b.y);
  }

  /**
   * Render all characters in Z-sorted order.
   * Characters with an active matrix effect get the matrix rain rendering.
   * All others are drawn as procedural minions.
   *
   * @param characters - Y-sorted array of characters.
   * @param elapsedTime - Total elapsed simulation time for animation phases.
   */
  private renderCharacters(
    characters: Character[],
    elapsedTime: number,
  ): void {
    for (const char of characters) {
      if (char.matrixEffect) {
        this.renderMatrixEffect(char);
      } else {
        this.renderProceduralMinion(char, elapsedTime);
      }
    }
  }

  /**
   * Render the matrix rain spawn/despawn effect for a character.
   * Displays falling green characters in columns, with opacity based
   * on the effect timer progress.
   *
   * @param char - The character with an active matrix effect.
   */
  private renderMatrixEffect(char: Character): void {
    const { ctx } = this;
    const effect = char.matrixEffect!;
    const progress = effect.timer / MATRIX_EFFECT_DURATION_SEC;

    // Overall opacity: fade in for spawn, fade out for despawn
    const alpha =
      effect.phase === "spawning" ? progress : 1 - progress;

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = "4px monospace";
    ctx.fillStyle = THEME_ACTIVE;

    const charX = char.x - CHAR_WIDTH / 2;
    const charY = char.y - CHAR_HEIGHT;
    const colWidth = CHAR_WIDTH / Math.min(MATRIX_RAIN_COLUMNS, 4);

    for (let col = 0; col < Math.min(MATRIX_RAIN_COLUMNS, 4); col++) {
      const seed = effect.columnSeeds[col] ?? 0;
      const columnX = charX + col * colWidth;

      // Staggered timing per column
      const columnProgress = clamp(
        (progress - seed * 0.3) / 0.7,
        0,
        1,
      );
      const visibleRows = Math.floor(columnProgress * 8);

      for (let row = 0; row < visibleRows; row++) {
        const charIndex = Math.floor(
          (seed * 100 + row * 7 + this.animTime * 10) % MATRIX_CHARS.length,
        );
        const matrixChar = MATRIX_CHARS[charIndex];
        const rowAlpha = 1 - row / 8;

        ctx.globalAlpha = clamp(alpha * rowAlpha, 0, 1);
        ctx.fillText(matrixChar, columnX, charY + row * 4);
      }
    }

    ctx.restore();
  }

  /**
   * Draw a procedural minion character (yellow pill body, blue overalls,
   * goggle eyes). This is the fallback rendering until proper sprite
   * sheets are loaded into the sprite cache.
   *
   * Animations applied:
   * - Walk: vertical bob (sine wave on Y based on elapsed time)
   * - Type: alternating arm extension rectangles
   * - Read: one arm holding a "paper" rectangle
   * - Idle: standing still with periodic eye blink
   *
   * @param char - The character to draw.
   * @param elapsedTime - Total elapsed time for animation phase calculation.
   */
  private renderProceduralMinion(
    char: Character,
    elapsedTime: number,
  ): void {
    const { ctx } = this;
    const cx = char.x;
    let cy = char.y;

    // Sitting offset: draw character slightly higher when seated
    const isSeated =
      char.seatId !== null &&
      (char.state === CharacterState.TYPE ||
        char.state === CharacterState.READ);
    if (isSeated) {
      cy -= 2;
    }

    // Walking bob: sine wave offset on Y
    let bobOffset = 0;
    if (char.state === CharacterState.WALK) {
      bobOffset = Math.sin(elapsedTime * 10 + char.frameTimer * 20) * 1.5;
    }

    const bodyTop = cy - 24 + bobOffset;

    // Apply hue shift via canvas filter if supported
    ctx.save();
    if (char.hueShift !== 0) {
      ctx.filter = `hue-rotate(${char.hueShift}deg)`;
    }

    // ── Yellow pill body ──
    ctx.fillStyle = THEME_ACCENT_YELLOW;
    roundRect(ctx, cx - 5, bodyTop, 10, 20, 5);
    ctx.fill();

    // ── Blue overalls (bottom half) ──
    ctx.fillStyle = THEME_ACCENT_BLUE;
    ctx.fillRect(cx - 5, bodyTop + 12, 10, 8);

    // Overall strap details (2 small rectangles)
    ctx.fillRect(cx - 3, bodyTop + 10, 2, 3);
    ctx.fillRect(cx + 1, bodyTop + 10, 2, 3);

    // ── Goggle(s) ──
    const goggleY = bodyTop + 6;
    const isOnEyed = char.palette % 2 === 0;

    if (isOnEyed) {
      // Single large goggle (centered)
      this.drawGoggle(ctx, cx, goggleY, 5, char, elapsedTime);
    } else {
      // Two smaller goggles
      this.drawGoggle(ctx, cx - 3, goggleY, 3.5, char, elapsedTime);
      this.drawGoggle(ctx, cx + 3, goggleY, 3.5, char, elapsedTime);
    }

    // ── Feet (simple 2px rectangles) ──
    ctx.fillStyle = "#1A1A2E";
    ctx.fillRect(cx - 4, bodyTop + 20, 3, 2);
    ctx.fillRect(cx + 1, bodyTop + 20, 3, 2);

    // ── State-specific animation details ──
    switch (char.state) {
      case CharacterState.TYPE: {
        // Arms extended to "keyboard" — alternate positions
        const armPhase = Math.floor(elapsedTime * 6 + char.frameTimer * 4) % 2;
        ctx.fillStyle = THEME_ACCENT_YELLOW;
        if (armPhase === 0) {
          ctx.fillRect(cx - 7, bodyTop + 12, 2, 2);
          ctx.fillRect(cx + 5, bodyTop + 14, 2, 2);
        } else {
          ctx.fillRect(cx - 7, bodyTop + 14, 2, 2);
          ctx.fillRect(cx + 5, bodyTop + 12, 2, 2);
        }
        break;
      }
      case CharacterState.READ: {
        // One arm holding a "paper" rectangle
        ctx.fillStyle = THEME_ACCENT_YELLOW;
        ctx.fillRect(cx + 5, bodyTop + 10, 2, 4);
        // Paper
        ctx.fillStyle = "#E0E0E0";
        ctx.fillRect(cx + 6, bodyTop + 8, 4, 6);
        // Text lines on paper
        ctx.fillStyle = THEME_TEXT_MUTED;
        ctx.fillRect(cx + 7, bodyTop + 9, 2, 1);
        ctx.fillRect(cx + 7, bodyTop + 11, 2, 1);
        break;
      }
      case CharacterState.WALK: {
        // Legs alternate — already handled by bob, add arm swing
        const legPhase =
          Math.floor(elapsedTime * 8 + char.frameTimer * 16) % 2;
        ctx.fillStyle = THEME_ACCENT_YELLOW;
        if (legPhase === 0) {
          ctx.fillRect(cx - 6, bodyTop + 14, 2, 2);
        } else {
          ctx.fillRect(cx + 4, bodyTop + 14, 2, 2);
        }
        break;
      }
      case CharacterState.IDLE:
      default:
        // Standing still — no extra details (blink handled in goggle drawing)
        break;
    }

    ctx.filter = "none";
    ctx.restore();
  }

  /**
   * Draw a single goggle (circular eye) at the given position.
   * Includes periodic blinking for idle characters.
   *
   * @param ctx - The 2D rendering context.
   * @param gx - Goggle center X position.
   * @param gy - Goggle center Y position.
   * @param radius - Goggle outer radius.
   * @param char - The character (for state-based blink timing).
   * @param elapsedTime - Elapsed time for blink animation.
   */
  private drawGoggle(
    ctx: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    radius: number,
    char: Character,
    elapsedTime: number,
  ): void {
    // Silver goggle rim
    ctx.fillStyle = "#9CA3AF";
    ctx.beginPath();
    ctx.arc(gx, gy, radius + 0.5, 0, Math.PI * 2);
    ctx.fill();

    // White eye fill
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Blink detection: every ~3 seconds, close eyes for 0.15s
    const blinkCycle = (elapsedTime + char.frameTimer * 0.5) % 3.0;
    const isBlinking =
      char.state === CharacterState.IDLE && blinkCycle > 2.85;

    if (isBlinking) {
      // Closed eye — horizontal line
      ctx.strokeStyle = "#1F2937";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx - radius * 0.6, gy);
      ctx.lineTo(gx + radius * 0.6, gy);
      ctx.stroke();
    } else {
      // Dark pupil
      const pupilRadius = radius * 0.45;
      ctx.fillStyle = "#1F2937";
      ctx.beginPath();
      ctx.arc(gx, gy, pupilRadius, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight (tiny white dot)
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(
        gx - pupilRadius * 0.3,
        gy - pupilRadius * 0.3,
        pupilRadius * 0.3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 7: Speech Bubbles
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render speech bubbles above characters that have an active bubbleType.
   * Bubbles fade out based on the remaining bubbleTimer.
   *
   * @param characters - Y-sorted array of characters.
   */
  private renderBubbles(characters: Character[]): void {
    const { ctx } = this;

    for (const char of characters) {
      if (char.bubbleType === null) continue;

      // Calculate fade-out alpha
      let alpha = 1;
      if (char.bubbleTimer <= BUBBLE_FADE_SEC) {
        alpha = clamp(char.bubbleTimer / BUBBLE_FADE_SEC, 0, 1);
      }
      if (alpha <= 0) continue;

      const bx = char.x - BUBBLE_WIDTH / 2;
      const by = char.y - CHAR_HEIGHT + BUBBLE_OFFSET_Y - BUBBLE_HEIGHT;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Bubble background (white rounded rect)
      ctx.fillStyle = "#FFFFFF";
      roundRect(ctx, bx, by, BUBBLE_WIDTH, BUBBLE_HEIGHT, 3);
      ctx.fill();

      // Bubble border
      ctx.strokeStyle = THEME_BORDER;
      ctx.lineWidth = 0.5;
      roundRect(ctx, bx, by, BUBBLE_WIDTH, BUBBLE_HEIGHT, 3);
      ctx.stroke();

      // Small triangle pointer at bottom
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.moveTo(char.x - 2, by + BUBBLE_HEIGHT);
      ctx.lineTo(char.x, by + BUBBLE_HEIGHT + 3);
      ctx.lineTo(char.x + 2, by + BUBBLE_HEIGHT);
      ctx.closePath();
      ctx.fill();

      // Bubble icon
      const iconX = bx + BUBBLE_WIDTH / 2;
      const iconY = by + BUBBLE_HEIGHT / 2;
      this.drawBubbleIcon(ctx, char.bubbleType, iconX, iconY);

      ctx.restore();
    }
  }

  /**
   * Draw the icon inside a speech bubble.
   *
   * @param ctx - The 2D rendering context.
   * @param bubbleType - The type of bubble to draw an icon for.
   * @param x - Center X of the icon area.
   * @param y - Center Y of the icon area.
   */
  private drawBubbleIcon(
    ctx: CanvasRenderingContext2D,
    bubbleType: string,
    x: number,
    y: number,
  ): void {
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    switch (bubbleType) {
      case BubbleType.WAITING:
        ctx.fillStyle = THEME_WARNING;
        ctx.fillText("?", x, y);
        break;
      case BubbleType.ERROR:
        ctx.fillStyle = THEME_ERROR;
        ctx.fillText("!", x, y);
        break;
      case BubbleType.COST_WARNING:
        ctx.fillStyle = THEME_WARNING;
        ctx.fillText("$", x, y);
        break;
      case BubbleType.PERMISSION: {
        // Small lock icon (procedural)
        ctx.fillStyle = THEME_TEXT_MUTED;
        // Lock body
        ctx.fillRect(x - 2, y - 1, 4, 3);
        // Lock shackle
        ctx.strokeStyle = THEME_TEXT_MUTED;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y - 2, 2, Math.PI, 0);
        ctx.stroke();
        break;
      }
      case BubbleType.THINKING: {
        // Cloud-like dots (thinking indicator)
        ctx.fillStyle = THEME_TEXT_MUTED;
        ctx.beginPath();
        ctx.arc(x - 2, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 1, y - 1, 1.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 3, y, 0.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default:
        // Unknown bubble type — draw generic dot
        ctx.fillStyle = THEME_TEXT_MUTED;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private — Layer 9: Minimap
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Render the minimap overlay in the bottom-right corner of the canvas.
   * The minimap shows a scaled-down overview of the full office layout
   * with colored dots for each character and a rectangle indicating the
   * current camera viewport.
   *
   * @param state - The current office state.
   */
  private renderMinimap(state: OfficeState): void {
    const { ctx } = this;
    const { layout, characters } = state;

    // Minimap position (bottom-right, fixed screen coordinates)
    const mmX = this.containerWidth - MINIMAP_WIDTH - MINIMAP_PADDING;
    const mmY = this.containerHeight - MINIMAP_HEIGHT - MINIMAP_PADDING;

    // Scale factors from world to minimap
    const worldWidth = layout.cols * TILE_SIZE;
    const worldHeight = layout.rows * TILE_SIZE;
    const scaleX = MINIMAP_WIDTH / worldWidth;
    const scaleY = MINIMAP_HEIGHT / worldHeight;
    const scale = Math.min(scaleX, scaleY);

    // Centered offset within minimap area
    const scaledWidth = worldWidth * scale;
    const scaledHeight = worldHeight * scale;
    const offsetX = mmX + (MINIMAP_WIDTH - scaledWidth) / 2;
    const offsetY = mmY + (MINIMAP_HEIGHT - scaledHeight) / 2;

    ctx.save();

    // Minimap background
    ctx.fillStyle = THEME_BG;
    ctx.globalAlpha = MINIMAP_BG_ALPHA;
    roundRect(ctx, mmX - 2, mmY - 2, MINIMAP_WIDTH + 4, MINIMAP_HEIGHT + 4, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Minimap border
    ctx.strokeStyle = THEME_BORDER;
    ctx.lineWidth = 1;
    roundRect(ctx, mmX - 2, mmY - 2, MINIMAP_WIDTH + 4, MINIMAP_HEIGHT + 4, 4);
    ctx.stroke();

    // Draw tiles (simplified — only walls and floors as tiny rectangles)
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const tileType = layout.tiles[row * layout.cols + col];
        if (tileType === TT.VOID) continue;

        const tx = offsetX + col * TILE_SIZE * scale;
        const ty = offsetY + row * TILE_SIZE * scale;
        const tw = Math.max(1, TILE_SIZE * scale);
        const th = Math.max(1, TILE_SIZE * scale);

        if (tileType === TT.WALL) {
          ctx.fillStyle = THEME_WALL_ACCENT;
        } else {
          ctx.fillStyle = THEME_FLOOR_COLORS[0];
        }
        ctx.fillRect(tx, ty, tw, th);
      }
    }

    // Draw character dots
    for (const char of characters.values()) {
      const dotX = offsetX + char.x * scale;
      const dotY = offsetY + char.y * scale;

      ctx.fillStyle = char.isActive ? THEME_ACTIVE : THEME_ACCENT_YELLOW;
      ctx.beginPath();
      ctx.arc(dotX, dotY, MINIMAP_DOT_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw camera viewport rectangle
    const vpWorldLeft =
      this.camera.x - this.containerWidth / (2 * this.camera.zoom);
    const vpWorldTop =
      this.camera.y - this.containerHeight / (2 * this.camera.zoom);
    const vpWorldWidth = this.containerWidth / this.camera.zoom;
    const vpWorldHeight = this.containerHeight / this.camera.zoom;

    const vpX = offsetX + vpWorldLeft * scale;
    const vpY = offsetY + vpWorldTop * scale;
    const vpW = vpWorldWidth * scale;
    const vpH = vpWorldHeight * scale;

    ctx.strokeStyle = THEME_TEXT;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clamp a numeric value between a minimum and maximum.
 *
 * @param value - The value to clamp.
 * @param min - Minimum allowed value.
 * @param max - Maximum allowed value.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Trace a rounded rectangle path on the canvas context.
 * Does NOT fill or stroke — the caller must do so after calling this.
 *
 * Uses `ctx.roundRect` if available (modern browsers), otherwise falls
 * back to manual arc-and-line path construction.
 *
 * @param ctx - The 2D rendering context.
 * @param x - Top-left X.
 * @param y - Top-left Y.
 * @param w - Width.
 * @param h - Height.
 * @param r - Corner radius.
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();

  // Use native roundRect if available
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // Manual fallback for older browsers
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }

  ctx.closePath();
}
