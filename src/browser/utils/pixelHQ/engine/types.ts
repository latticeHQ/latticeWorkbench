/**
 * Pixel HQ Engine Types
 *
 * Core type definitions for the pixel art office visualization engine.
 * Adapted from Pixel Agents (MIT) and extended for Lattice Workbench
 * multi-room, multi-crew architecture.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tile System
// ─────────────────────────────────────────────────────────────────────────────

export const TileType = {
  VOID: 0,
  WALL: 1,
  FLOOR_1: 2,
  FLOOR_2: 3,
  FLOOR_3: 4,
  FLOOR_4: 5,
  FLOOR_5: 6,
  FLOOR_6: 7,
  FLOOR_7: 8,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** Per-tile color/tint settings for floor colorization */
export interface TileColorConfig {
  /** Hue: 0-360 */
  h: number;
  /** Saturation: 0-100 */
  s: number;
  /** Brightness: -100 to 100 */
  b: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room System (NEW — not in Pixel Agents)
// ─────────────────────────────────────────────────────────────────────────────

export const RoomZone = {
  CREW_SECTION: "crew_section",
  ELEVATOR: "elevator",
  BREAK_ROOM: "break_room",
  SERVER_CLOSET: "server_closet",
  COMMON_AISLE: "common_aisle",
} as const;
export type RoomZone = (typeof RoomZone)[keyof typeof RoomZone];

export interface RoomDefinition {
  /** Unique room ID */
  id: string;
  /** Room type */
  zone: RoomZone;
  /** Display label */
  label: string;
  /** Bounding box in tile coordinates */
  bounds: RoomBounds;
  /** Links crew rooms to specific crew IDs */
  crewId?: string;
  /** Crew color for tinting */
  crewColor?: string;
}

export interface RoomBounds {
  col: number;
  row: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character System
// ─────────────────────────────────────────────────────────────────────────────

export const CharacterState = {
  IDLE: "idle",
  WALK: "walk",
  TYPE: "type",
  READ: "read",
} as const;
export type CharacterState =
  (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

export const BubbleType = {
  PERMISSION: "permission",
  WAITING: "waiting",
  ERROR: "error",
  COST_WARNING: "cost_warning",
  THINKING: "thinking",
} as const;
export type BubbleType = (typeof BubbleType)[keyof typeof BubbleType];

export const MoraleMood = {
  NEUTRAL: "neutral",
  HAPPY: "happy",
  CELEBRATING: "celebrating",
  FRUSTRATED: "frustrated",
  SWEATING: "sweating",
  SLEEPING: "sleeping",
} as const;
export type MoraleMood = (typeof MoraleMood)[keyof typeof MoraleMood];

export interface MatrixSpawnEffect {
  phase: "spawning" | "despawning";
  timer: number;
  /** Per-column random seeds for staggered rain timing */
  columnSeeds: number[];
}

export interface Character {
  /** Unique character ID (matches minion ID) */
  id: string;
  /** Reference to Lattice minion ID */
  minionId: string;
  /** Display name (minion title or name) */
  displayName: string;

  // ── FSM State ──
  state: CharacterState;
  dir: Direction;

  // ── Position (sub-pixel for smooth movement) ──
  x: number;
  y: number;

  // ── Tile Position ──
  tileCol: number;
  tileRow: number;

  // ── Pathfinding ──
  /** Remaining path tiles to walk */
  path: TileCoord[];
  /** 0-1 interpolation between current tile and next tile */
  moveProgress: number;

  // ── Appearance ──
  /** Sprite palette variant index (0-5) */
  palette: number;
  /** Hue shift in degrees for crew color differentiation */
  hueShift: number;

  // ── Animation ──
  /** Current animation frame index */
  frame: number;
  /** Time accumulator for frame advancing */
  frameTimer: number;

  // ── Wander Behavior ──
  /** Timer for idle wander pauses */
  wanderTimer: number;
  /** Number of wander steps in current roaming cycle */
  wanderCount: number;
  /** Max wander steps before returning to seat */
  wanderLimit: number;

  // ── Work State ──
  /** Whether the agent is actively streaming */
  isActive: boolean;
  /** Current tool being executed (for animation selection) */
  currentTool: string | null;

  // ── Seat Assignment ──
  /** Assigned seat UID, or null if no seat */
  seatId: string | null;
  /** Room this character belongs to */
  roomId: string | null;

  // ── Bubbles ──
  /** Active speech bubble type, or null */
  bubbleType: BubbleType | null;
  /** Countdown timer for bubble display */
  bubbleTimer: number;

  // ── Morale (Wow Feature) ──
  mood: MoraleMood;
  /** Timer for mood-specific animations */
  moodTimer: number;

  // ── Sidekick ──
  /** Whether this character is a sub-agent */
  isSubagent: boolean;
  /** Parent agent ID if sub-agent */
  parentAgentId: string | null;

  // ── Effects ──
  /** Active matrix spawn/despawn effect */
  matrixEffect: MatrixSpawnEffect | null;

  // ── Timer for staying seated after reassignment ──
  seatTimer: number;

  // ── Crew ──
  crewId: string | null;
}

export interface TileCoord {
  col: number;
  row: number;
}

export interface CharacterCreateConfig {
  id: string;
  minionId: string;
  displayName: string;
  tileCol: number;
  tileRow: number;
  palette: number;
  hueShift: number;
  crewId: string | null;
  isSubagent?: boolean;
  parentAgentId?: string | null;
  withSpawnEffect?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seat System
// ─────────────────────────────────────────────────────────────────────────────

export interface Seat {
  /** Unique seat ID */
  uid: string;
  /** Tile column where character sits */
  col: number;
  /** Tile row where character sits */
  row: number;
  /** Direction character faces when seated */
  facingDir: Direction;
  /** Character ID assigned to this seat, or null */
  assignedTo: string | null;
  /** Which room this seat belongs to */
  roomId: string;
  /** Room zone type */
  roomZone: RoomZone;
}

// ─────────────────────────────────────────────────────────────────────────────
// Furniture System
// ─────────────────────────────────────────────────────────────────────────────

export interface FurnitureCatalogEntry {
  /** Unique catalog ID */
  id: string;
  /** Display name */
  name: string;
  /** Footprint width in tiles */
  width: number;
  /** Footprint height in tiles */
  height: number;
  /** Sprite key in atlas */
  spriteKey: string;
  /** Whether this blocks walking */
  solid: boolean;
  /** Category for editor grouping */
  category?: string;
  /** Seat offsets relative to furniture origin */
  seatOffsets?: Array<{
    col: number;
    row: number;
    dir: Direction;
  }>;
  /** Whether furniture has animated frames (e.g. server rack LEDs) */
  animatedFrames?: number;
}

export interface PlacedFurniture {
  /** Unique instance ID */
  uid: string;
  /** Catalog entry ID */
  catalogId: string;
  /** Top-left tile column */
  col: number;
  /** Top-left tile row */
  row: number;
  /** Optional color tint */
  color?: TileColorConfig;
  /** Room this furniture belongs to */
  roomId?: string;
}

export interface FurnitureInstance {
  /** Placed furniture data */
  placed: PlacedFurniture;
  /** Catalog entry (resolved) */
  catalog: FurnitureCatalogEntry;
  /** Pixel x (top-left) */
  x: number;
  /** Pixel y (top-left) */
  y: number;
  /** Y value for depth sorting (typically bottom edge) */
  zY: number;
  /** Current animation frame (for animated furniture) */
  animFrame: number;
  /** Animation timer */
  animTimer: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Office Layout
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeLayout {
  version: number;
  /** Grid width in tiles */
  cols: number;
  /** Grid height in tiles */
  rows: number;
  /** Flat array of tile types (cols * rows), row-major order */
  tiles: TileType[];
  /** Placed furniture instances */
  furniture: PlacedFurniture[];
  /** Per-tile color configs (parallel to tiles array, null = no tint) */
  tileColors: Array<TileColorConfig | null>;
  /** Room definitions */
  rooms: RoomDefinition[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

export interface Camera {
  /** Current world-space X offset */
  x: number;
  /** Current world-space Y offset */
  y: number;
  /** Current zoom level */
  zoom: number;
  /** Target X for smooth interpolation */
  targetX: number;
  /** Target Y for smooth interpolation */
  targetY: number;
  /** Target zoom for smooth interpolation */
  targetZoom: number;
  /** Character ID to follow (camera centers on them), or null */
  followId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprite Rendering
// ─────────────────────────────────────────────────────────────────────────────

export interface SpriteFrame {
  /** Source image */
  image: HTMLImageElement;
  /** Source X in spritesheet */
  sx: number;
  /** Source Y in spritesheet */
  sy: number;
  /** Source width */
  sw: number;
  /** Source height */
  sh: number;
  /** Whether to flip horizontally (for LEFT direction) */
  flipH: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Server Room (MCP Visualization)
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerRackState {
  /** MCP server name */
  name: string;
  /** Connection status */
  status: "connected" | "disconnected" | "error";
  /** Number of tools provided */
  toolCount: number;
  /** Furniture UID of the server rack */
  furnitureUid: string;
  /** LED animation phase */
  ledPhase: number;
}
