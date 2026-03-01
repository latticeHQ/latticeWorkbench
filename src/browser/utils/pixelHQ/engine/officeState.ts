/**
 * Pixel HQ Office State
 *
 * Master state class for the Pixel HQ engine. Manages all characters,
 * seats, rooms, furniture, and layout. Acts as the central hub that
 * coordinates the tile grid, pathfinding, character FSM, and furniture
 * placement systems.
 *
 * Adapted from Pixel Agents (MIT) and extended for Lattice Workbench
 * multi-room, multi-crew architecture.
 */

import type {
  BubbleType,
  Character,
  CharacterCreateConfig,
  FurnitureCatalogEntry,
  FurnitureInstance,
  OfficeLayout,
  RoomDefinition,
  RoomZone,
  Seat,
  ServerRackState,
  TileType,
} from "./types";
import { TileType as TT } from "./types";
import {
  TILE_SIZE,
  BUBBLE_DURATION_SEC,
  SERVER_LED_CYCLE_SEC,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from "./constants";
import {
  createCharacter,
  updateCharacter,
  startDespawnEffect,
  isDespawnComplete,
  walkCharacterTo,
  getWorkStateForTool,
} from "./characters";
import { findNearestWalkable } from "./pathfinding";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Counter for generating unique seat IDs */
let seatUidCounter = 0;

/**
 * Check whether a tile type represents a walkable floor tile.
 * VOID and WALL are not walkable; all FLOOR variants are.
 */
function isFloorTile(tile: TileType): boolean {
  return tile !== TT.VOID && tile !== TT.WALL;
}

/**
 * Generate a unique seat UID.
 */
function nextSeatUid(): string {
  return `seat_${++seatUidCounter}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// OfficeState
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Master state for the Pixel HQ office visualization.
 *
 * Owns all mutable game state: characters, seats, rooms, furniture instances,
 * the walkable grid, and server rack LED state. Provides methods for adding
 * and removing agents, assigning seats, showing bubbles, and advancing the
 * simulation each frame.
 *
 * Usage:
 * ```ts
 * const state = new OfficeState(layout);
 * state.addAgent({ id: "m1", minionId: "m1", ... });
 * state.update(dt);
 * ```
 */
export class OfficeState {
  /** Character map: id -> Character */
  characters: Map<string, Character>;

  /** Seat map: uid -> Seat */
  seats: Map<string, Seat>;

  /** Room map: id -> RoomDefinition */
  rooms: Map<string, RoomDefinition>;

  /** Resolved furniture instances for rendering (sorted by depth) */
  furnitureInstances: FurnitureInstance[];

  /** Current office layout (tile grid, furniture placements, room definitions) */
  layout: OfficeLayout;

  /** 2D walkability grid: walkableGrid[row][col] */
  walkableGrid: boolean[][];

  /** Server rack LED state: name -> ServerRackState */
  serverRacks: Map<string, ServerRackState>;

  /** Elapsed simulation time in seconds (used for animation phases) */
  elapsedTime: number;

  /**
   * Furniture catalog for resolving catalog IDs to their entries.
   * Must be populated before calling rebuildFromLayout() if the layout
   * contains placed furniture.
   */
  private furnitureCatalog: Map<string, FurnitureCatalogEntry>;

  /**
   * Create a new OfficeState, optionally initialized from a layout.
   *
   * @param layout - Office layout to build from. If omitted, an empty
   *                 default layout is created.
   */
  constructor(layout?: OfficeLayout) {
    this.characters = new Map();
    this.seats = new Map();
    this.rooms = new Map();
    this.furnitureInstances = [];
    this.walkableGrid = [];
    this.serverRacks = new Map();
    this.elapsedTime = 0;
    this.furnitureCatalog = new Map();

    this.layout = layout ?? {
      version: 1,
      cols: DEFAULT_COLS,
      rows: DEFAULT_ROWS,
      tiles: new Array(DEFAULT_COLS * DEFAULT_ROWS).fill(TT.VOID),
      furniture: [],
      tileColors: new Array(DEFAULT_COLS * DEFAULT_ROWS).fill(null),
      rooms: [],
    };

    if (layout) {
      this.rebuildFromLayout(layout);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Layout Reconstruction
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Set the furniture catalog used for resolving placed furniture.
   * Should be called before `rebuildFromLayout()` if furniture needs
   * seat offsets or rendering metadata.
   *
   * @param catalog - Map of catalog ID to FurnitureCatalogEntry
   */
  setFurnitureCatalog(catalog: Map<string, FurnitureCatalogEntry>): void {
    this.furnitureCatalog = catalog;
  }

  /**
   * Reconstruct all derived state from a new layout.
   *
   * Rebuilds the walkable grid, extracts seats from furniture with
   * seat offsets, resolves furniture instances for rendering, and
   * populates the rooms map. Existing characters are preserved but
   * their seat assignments may become invalid if seats changed.
   *
   * @param layout - The new office layout to build from
   */
  rebuildFromLayout(layout: OfficeLayout): void {
    this.layout = layout;

    // Rebuild rooms map
    this.rooms.clear();
    for (const room of layout.rooms) {
      this.rooms.set(room.id, room);
    }

    // Rebuild derived structures
    this.buildWalkableGrid();
    this.buildSeatsFromFurniture();
    this.buildFurnitureInstances();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Character Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a new agent character to the office.
   *
   * Creates the character at the specified tile position, then attempts
   * to assign it to an available seat in the appropriate room based on
   * its crew ID.
   *
   * @param config - Character creation configuration
   * @returns The newly created Character
   */
  addAgent(config: CharacterCreateConfig): Character {
    const char = createCharacter(config);

    // Try to assign to a room based on crew ID
    if (config.crewId) {
      const room = this.findRoomForCrew(config.crewId);
      if (room) {
        char.roomId = room.id;
        const seat = this.findAvailableSeat(room.id);
        if (seat) {
          this.assignSeatToCharacter(char, seat);
        }
      }
    } else {
      // No crew -- try lobby or any room with available seats
      const lobbyRoom = this.findRoomByZone("lobby");
      if (lobbyRoom) {
        char.roomId = lobbyRoom.id;
        const seat = this.findAvailableSeat(lobbyRoom.id);
        if (seat) {
          this.assignSeatToCharacter(char, seat);
        }
      }
    }

    this.characters.set(char.id, char);
    return char;
  }

  /**
   * Remove an agent from the office.
   *
   * If the character exists and has no active despawn effect, a matrix
   * despawn animation is started. The character will be fully removed
   * once the effect completes during the next `update()` cycle.
   * If the character is already despawning or not found, this is a no-op.
   *
   * @param minionId - The minion/character ID to remove
   */
  removeAgent(minionId: string): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    // If already despawning, don't restart the effect
    if (char.matrixEffect?.phase === "despawning") return;

    // Release seat before despawn
    this.releaseSeat(minionId);

    // Start despawn effect -- character will be cleaned up in update()
    startDespawnEffect(char);
  }

  /**
   * Spawn a sub-agent near its parent character.
   *
   * The sub-agent is created with a matrix spawn effect and placed
   * adjacent to the parent character. It inherits the parent's room
   * assignment and is given a nearby available seat.
   *
   * @param parentId - ID of the parent agent
   * @param config - Character creation configuration (isSubagent and
   *                 parentAgentId will be set automatically)
   * @returns The newly created sub-agent Character
   * @throws Error if the parent character is not found
   */
  addSubagent(parentId: string, config: CharacterCreateConfig): Character {
    const parent = this.characters.get(parentId);
    if (!parent) {
      throw new Error(`Parent agent "${parentId}" not found`);
    }

    // Ensure sub-agent config is set correctly
    const subConfig: CharacterCreateConfig = {
      ...config,
      isSubagent: true,
      parentAgentId: parentId,
      withSpawnEffect: true,
    };

    // Try to place near parent
    const spawnTile = findNearestWalkable(
      parent.tileCol,
      parent.tileRow,
      this.walkableGrid,
      this.layout.cols,
      this.layout.rows,
      5,
    );

    if (spawnTile) {
      subConfig.tileCol = spawnTile.col;
      subConfig.tileRow = spawnTile.row;
    }

    const child = createCharacter(subConfig);
    child.roomId = parent.roomId;

    // Try to find a seat in the same room
    if (child.roomId) {
      const seat = this.findAvailableSeat(child.roomId);
      if (seat) {
        this.assignSeatToCharacter(child, seat);
      }
    }

    this.characters.set(child.id, child);
    return child;
  }

  /**
   * Remove a specific sub-agent.
   *
   * Starts the despawn effect on the sub-agent. The character is
   * fully removed during the next `update()` cycle after the
   * despawn animation completes.
   *
   * @param childId - ID of the sub-agent to remove
   */
  removeSubagent(childId: string): void {
    const child = this.characters.get(childId);
    if (!child || !child.isSubagent) return;

    this.releaseSeat(childId);
    startDespawnEffect(child);
  }

  /**
   * Remove all sub-agents belonging to a parent agent.
   *
   * Iterates all characters and despawns any sub-agent whose
   * `parentAgentId` matches the given parent ID.
   *
   * @param parentId - ID of the parent agent whose children to remove
   */
  removeAllSubagents(parentId: string): void {
    for (const [id, char] of this.characters) {
      if (char.isSubagent && char.parentAgentId === parentId) {
        this.removeSubagent(id);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // State Transitions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Toggle the active/working state of an agent.
   *
   * When set to active, the character transitions to a work animation
   * (TYPE or READ) at their seat. When set to inactive, the character
   * returns to idle wandering behavior.
   *
   * @param minionId - The minion/character ID
   * @param active - Whether the agent is actively working
   */
  setAgentActive(minionId: string, active: boolean): void {
    const char = this.characters.get(minionId);
    if (!char) return;
    char.isActive = active;
  }

  /**
   * Set the current tool for a character, affecting its work animation.
   *
   * Tools like Read/Grep/Glob trigger the READ animation, while
   * Edit/Write/Bash trigger the TYPE animation.
   *
   * @param minionId - The minion/character ID
   * @param toolName - Tool name string, or null to clear
   */
  setAgentTool(minionId: string, toolName: string | null): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    char.currentTool = toolName;

    // If actively working, update the animation state to match the new tool
    if (char.isActive && (char.state === "type" || char.state === "read")) {
      char.state = getWorkStateForTool(toolName);
      char.frame = 0;
      char.frameTimer = 0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bubbles
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Show a speech bubble above a character.
   *
   * The bubble is displayed for `BUBBLE_DURATION_SEC` seconds before
   * automatically clearing.
   *
   * @param minionId - The minion/character ID
   * @param type - The bubble type to display
   */
  showBubble(minionId: string, type: BubbleType): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    char.bubbleType = type;
    char.bubbleTimer = BUBBLE_DURATION_SEC;
  }

  /**
   * Immediately hide any active speech bubble on a character.
   *
   * @param minionId - The minion/character ID
   */
  clearBubble(minionId: string): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    char.bubbleType = null;
    char.bubbleTimer = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Room Assignment
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Assign a character to a specific room zone.
   *
   * Finds the room matching the given zone type and optional crew ID,
   * locates an available seat within that room, assigns the character
   * to it, and walks the character to the seat position.
   *
   * @param minionId - The minion/character ID
   * @param roomZone - The target room zone type
   * @param crewId - Optional crew ID for crew-specific rooms
   */
  assignCharacterToRoom(
    minionId: string,
    roomZone: RoomZone,
    crewId?: string,
  ): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    // Find the appropriate room
    let targetRoom: RoomDefinition | null = null;

    for (const room of this.rooms.values()) {
      if (room.zone !== roomZone) continue;
      // If crewId is specified, match it; otherwise take any room of this zone
      if (crewId && room.crewId !== crewId) continue;
      targetRoom = room;
      break;
    }

    if (!targetRoom) return;

    // Release current seat if any
    this.releaseSeat(minionId);

    // Update room assignment
    char.roomId = targetRoom.id;
    char.crewId = crewId ?? char.crewId;

    // Find and assign a seat in the target room
    const seat = this.findAvailableSeat(targetRoom.id);
    if (seat) {
      this.assignSeatToCharacter(char, seat);

      // Walk to the new seat
      walkCharacterTo(
        char,
        seat.col,
        seat.row,
        this.walkableGrid,
        this.layout.cols,
        this.layout.rows,
      );
    } else {
      // No available seats -- walk to a walkable tile inside the room bounds
      const roomCenter = findNearestWalkable(
        targetRoom.bounds.col + Math.floor(targetRoom.bounds.width / 2),
        targetRoom.bounds.row + Math.floor(targetRoom.bounds.height / 2),
        this.walkableGrid,
        this.layout.cols,
        this.layout.rows,
      );
      if (roomCenter) {
        walkCharacterTo(
          char,
          roomCenter.col,
          roomCenter.row,
          this.walkableGrid,
          this.layout.cols,
          this.layout.rows,
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Seat Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find an unassigned seat within a specific room.
   *
   * @param roomId - The room ID to search in
   * @returns The first available Seat, or null if all seats are occupied
   */
  findAvailableSeat(roomId: string): Seat | null {
    for (const seat of this.seats.values()) {
      if (seat.roomId === roomId && seat.assignedTo === null) {
        return seat;
      }
    }
    return null;
  }

  /**
   * Assign a character to a specific seat by seat UID.
   *
   * Releases any previously assigned seat for the character, then
   * assigns the new seat. Updates both the character and seat records.
   *
   * @param minionId - The minion/character ID
   * @param seatId - The seat UID to assign
   */
  assignSeat(minionId: string, seatId: string): void {
    const char = this.characters.get(minionId);
    if (!char) return;

    const seat = this.seats.get(seatId);
    if (!seat) return;

    // Release previous seat
    this.releaseSeat(minionId);

    // Assign new seat
    seat.assignedTo = minionId;
    char.seatId = seatId;
    char.roomId = seat.roomId;
  }

  /**
   * Release a character's currently assigned seat.
   *
   * Clears the seat assignment on both the character and the seat,
   * making the seat available for other characters.
   *
   * @param minionId - The minion/character ID whose seat to release
   */
  releaseSeat(minionId: string): void {
    const char = this.characters.get(minionId);
    if (!char || !char.seatId) return;

    const seat = this.seats.get(char.seatId);
    if (seat && seat.assignedTo === minionId) {
      seat.assignedTo = null;
    }

    char.seatId = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hit Testing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find the character at a given world-space pixel position.
   *
   * Uses a bounding-box test centered on each character's position.
   * Characters with active despawn effects are excluded from hit testing.
   *
   * @param worldX - World-space X coordinate in pixels
   * @param worldY - World-space Y coordinate in pixels
   * @returns The topmost Character at that position, or null
   */
  getCharacterAt(worldX: number, worldY: number): Character | null {
    // Iterate in reverse insertion order so topmost (latest added) wins
    const entries = Array.from(this.characters.values()).reverse();

    for (const char of entries) {
      // Skip characters that are despawning
      if (char.matrixEffect?.phase === "despawning") continue;

      // Bounding box: character sprite is TILE_SIZE wide, 2*TILE_SIZE tall,
      // anchored at bottom-center (char.x, char.y)
      const halfW = TILE_SIZE / 2;
      const charHeight = TILE_SIZE * 2; // CHAR_HEIGHT equivalent

      const left = char.x - halfW;
      const right = char.x + halfW;
      const top = char.y - charHeight;
      const bottom = char.y;

      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return char;
      }
    }

    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Update Loop
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Advance the office simulation by one frame.
   *
   * Updates all characters (FSM, movement, animation), checks for
   * completed despawn effects and removes those characters, and
   * advances animated furniture (e.g., server rack LEDs).
   *
   * @param dt - Delta time in seconds since last frame
   */
  update(dt: number): void {
    this.elapsedTime += dt;
    const despawnedIds: string[] = [];

    // Update all characters
    for (const char of this.characters.values()) {
      updateCharacter(
        char,
        dt,
        this.seats,
        this.walkableGrid,
        this.layout.cols,
        this.layout.rows,
      );

      // Check for completed despawn effects
      if (isDespawnComplete(char)) {
        despawnedIds.push(char.id);
      }
    }

    // Remove fully despawned characters
    for (const id of despawnedIds) {
      this.characters.delete(id);
    }

    // Animate furniture (server rack LEDs, etc.)
    this.updateFurnitureAnimation(dt);

    // Update server rack LED phases
    for (const rack of this.serverRacks.values()) {
      rack.ledPhase = (rack.ledPhase + dt / SERVER_LED_CYCLE_SEC) % 1.0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Walkable Grid
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Rebuild the walkability grid from the current layout and furniture.
   *
   * A tile is walkable if:
   * 1. Its tile type is a floor variant (not VOID, not WALL)
   * 2. It is not blocked by solid furniture
   *
   * The grid is stored as `walkableGrid[row][col]`.
   */
  private buildWalkableGrid(): void {
    const { cols, rows, tiles, furniture } = this.layout;

    // Initialize grid from tile types
    this.walkableGrid = [];
    for (let r = 0; r < rows; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < cols; c++) {
        const tileIndex = r * cols + c;
        const tileType = tiles[tileIndex] ?? TT.VOID;
        row.push(isFloorTile(tileType));
      }
      this.walkableGrid.push(row);
    }

    // Block tiles occupied by solid furniture
    for (const placed of furniture) {
      const catalog = this.furnitureCatalog.get(placed.catalogId);
      if (!catalog || !catalog.solid) continue;

      for (let dr = 0; dr < catalog.height; dr++) {
        for (let dc = 0; dc < catalog.width; dc++) {
          const r = placed.row + dr;
          const c = placed.col + dc;
          if (r >= 0 && r < rows && c >= 0 && c < cols) {
            this.walkableGrid[r][c] = false;
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Seats from Furniture
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extract seat positions from placed furniture that has seat offsets.
   *
   * For each placed furniture item whose catalog entry defines
   * `seatOffsets`, a Seat object is created at the offset position
   * relative to the furniture's top-left tile. Seats are assigned to
   * the room that the furniture belongs to.
   *
   * Previous seats are cleared and rebuilt. Characters whose seats
   * no longer exist will have their `seatId` set to null.
   */
  private buildSeatsFromFurniture(): void {
    // Track old seat assignments so we can try to restore them
    const oldAssignments = new Map<string, string>(); // charId -> old seatId
    for (const [uid, seat] of this.seats) {
      if (seat.assignedTo) {
        oldAssignments.set(seat.assignedTo, uid);
      }
    }

    // Clear all seats
    this.seats.clear();

    const { furniture } = this.layout;

    for (const placed of furniture) {
      const catalog = this.furnitureCatalog.get(placed.catalogId);
      if (!catalog?.seatOffsets) continue;

      // Determine which room this furniture is in
      const roomId = placed.roomId ?? this.findRoomAtTile(placed.col, placed.row);

      for (const offset of catalog.seatOffsets) {
        const seatCol = placed.col + offset.col;
        const seatRow = placed.row + offset.row;

        // Validate seat is within grid bounds
        if (
          seatCol < 0 || seatCol >= this.layout.cols ||
          seatRow < 0 || seatRow >= this.layout.rows
        ) {
          continue;
        }

        const uid = nextSeatUid();
        const roomZone = roomId ? (this.rooms.get(roomId)?.zone ?? "hallway") : "hallway";

        const seat: Seat = {
          uid,
          col: seatCol,
          row: seatRow,
          facingDir: offset.dir,
          assignedTo: null,
          roomId: roomId ?? "",
          roomZone: roomZone as RoomZone,
        };

        this.seats.set(uid, seat);
      }
    }

    // Clear stale seat references on characters
    for (const char of this.characters.values()) {
      if (char.seatId && !this.seats.has(char.seatId)) {
        char.seatId = null;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Furniture Instances
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve placed furniture into renderable FurnitureInstance objects.
   *
   * Combines each `PlacedFurniture` with its `FurnitureCatalogEntry` to
   * compute pixel positions, depth-sort values, and animation state.
   * Instances are sorted by Y position (bottom edge) for correct
   * depth rendering.
   */
  private buildFurnitureInstances(): void {
    this.furnitureInstances = [];

    const { furniture } = this.layout;

    for (const placed of furniture) {
      const catalog = this.furnitureCatalog.get(placed.catalogId);
      if (!catalog) continue;

      const x = placed.col * TILE_SIZE;
      const y = placed.row * TILE_SIZE;
      // Depth sort by bottom edge of furniture
      const zY = (placed.row + catalog.height) * TILE_SIZE;

      const instance: FurnitureInstance = {
        placed,
        catalog,
        x,
        y,
        zY,
        animFrame: 0,
        animTimer: 0,
      };

      this.furnitureInstances.push(instance);
    }

    // Sort by depth (Y of bottom edge) for painter's algorithm
    this.furnitureInstances.sort((a, b) => a.zY - b.zY);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Furniture Animation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Advance animation timers for animated furniture (e.g., server racks).
   *
   * @param dt - Delta time in seconds
   */
  private updateFurnitureAnimation(dt: number): void {
    for (const instance of this.furnitureInstances) {
      if (!instance.catalog.animatedFrames || instance.catalog.animatedFrames <= 1) {
        continue;
      }

      // Use a fixed frame rate for furniture animation
      const frameDuration = SERVER_LED_CYCLE_SEC / instance.catalog.animatedFrames;
      instance.animTimer += dt;

      if (instance.animTimer >= frameDuration) {
        instance.animTimer -= frameDuration;
        instance.animFrame =
          (instance.animFrame + 1) % instance.catalog.animatedFrames;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Room Lookup Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Find the room that contains a given tile coordinate.
   *
   * @param col - Tile column
   * @param row - Tile row
   * @returns The room ID, or null if the tile is not in any room
   */
  private findRoomAtTile(col: number, row: number): string | null {
    for (const room of this.rooms.values()) {
      const b = room.bounds;
      if (
        col >= b.col && col < b.col + b.width &&
        row >= b.row && row < b.row + b.height
      ) {
        return room.id;
      }
    }
    return null;
  }

  /**
   * Find a room assigned to a specific crew.
   *
   * @param crewId - The crew ID to match
   * @returns The matching RoomDefinition, or null
   */
  private findRoomForCrew(crewId: string): RoomDefinition | null {
    for (const room of this.rooms.values()) {
      if (room.zone === "crew_room" && room.crewId === crewId) {
        return room;
      }
    }
    return null;
  }

  /**
   * Find the first room matching a given zone type.
   *
   * @param zone - The room zone to search for
   * @returns The matching RoomDefinition, or null
   */
  private findRoomByZone(zone: RoomZone): RoomDefinition | null {
    for (const room of this.rooms.values()) {
      if (room.zone === zone) {
        return room;
      }
    }
    return null;
  }

  /**
   * Internal helper to assign a seat to a character and update both records.
   *
   * @param char - The character to assign
   * @param seat - The seat to assign to
   */
  private assignSeatToCharacter(char: Character, seat: Seat): void {
    seat.assignedTo = char.id;
    char.seatId = seat.uid;
    char.roomId = seat.roomId;
  }
}
