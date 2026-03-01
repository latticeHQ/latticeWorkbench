/**
 * Pixel HQ Engine Constants
 *
 * Timing, sizing, theme colors, and animation parameters.
 * Adapted from Pixel Agents + Lattice dark-navy theme.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tile & Grid
// ─────────────────────────────────────────────────────────────────────────────

/** Tile size in pixels (16x16 standard pixel art) */
export const TILE_SIZE = 16;

/** Default grid columns */
export const DEFAULT_COLS = 64;

/** Default grid rows */
export const DEFAULT_ROWS = 32;

/** Maximum grid columns (for layout editor) */
export const MAX_COLS = 96;

/** Maximum grid rows */
export const MAX_ROWS = 64;

// ─────────────────────────────────────────────────────────────────────────────
// Character Sprites
// ─────────────────────────────────────────────────────────────────────────────

/** Character sprite width in pixels */
export const CHAR_WIDTH = 16;

/** Character sprite height in pixels */
export const CHAR_HEIGHT = 32;

/** Number of animation frames per row in spritesheet */
export const FRAMES_PER_ROW = 7;

/** Number of character palette variants */
export const SPRITE_PALETTES = 6;

/** Number of direction rows (down, up, right — left is h-mirror of right) */
export const SPRITE_DIRECTION_ROWS = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Wall Auto-Tiling
// ─────────────────────────────────────────────────────────────────────────────

/** Number of wall bitmask variants for auto-tiling */
export const WALL_BITMASK_VARIANTS = 16;

/** Wall sprite piece dimensions */
export const WALL_PIECE_WIDTH = 16;
export const WALL_PIECE_HEIGHT = 32;

// ─────────────────────────────────────────────────────────────────────────────
// Movement & Animation
// ─────────────────────────────────────────────────────────────────────────────

/** Walking speed in pixels per second */
export const WALK_SPEED_PX_PER_SEC = 48;

/** Duration of each walk animation frame in seconds */
export const WALK_FRAME_DURATION_SEC = 0.15;

/** Duration of each typing animation frame in seconds */
export const TYPE_FRAME_DURATION_SEC = 0.12;

/** Duration of each reading animation frame in seconds */
export const READ_FRAME_DURATION_SEC = 0.2;

/** Duration of each idle animation frame in seconds */
export const IDLE_FRAME_DURATION_SEC = 0.5;

/** Minimum idle pause before next wander (seconds) */
export const WANDER_PAUSE_MIN_SEC = 2.0;

/** Maximum idle pause before next wander (seconds) */
export const WANDER_PAUSE_MAX_SEC = 6.0;

/** Number of tiles a character can wander from their seat */
export const WANDER_RADIUS = 3;

/** Min wander moves before returning to seat */
export const WANDER_MIN_MOVES = 2;

/** Max wander moves before returning to seat */
export const WANDER_MAX_MOVES = 5;

/** Min time seated when inactive before starting to wander (seconds) */
export const SEAT_REST_MIN_SEC = 3.0;

/** Max time seated when inactive before starting to wander (seconds) */
export const SEAT_REST_MAX_SEC = 8.0;

// ─────────────────────────────────────────────────────────────────────────────
// Bubbles
// ─────────────────────────────────────────────────────────────────────────────

/** Duration a speech bubble is shown (seconds) */
export const BUBBLE_DURATION_SEC = 4.0;

/** Bubble fade-out duration (seconds) */
export const BUBBLE_FADE_SEC = 0.5;

/** Bubble float offset above character (pixels) */
export const BUBBLE_OFFSET_Y = -8;

/** Bubble width in pixels */
export const BUBBLE_WIDTH = 16;

/** Bubble height in pixels */
export const BUBBLE_HEIGHT = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Matrix Spawn/Despawn Effect
// ─────────────────────────────────────────────────────────────────────────────

/** Duration of matrix spawn/despawn effect (seconds) */
export const MATRIX_EFFECT_DURATION_SEC = 0.8;

/** Number of columns in matrix rain effect */
export const MATRIX_RAIN_COLUMNS = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

/** Camera lerp speed (higher = snappier following) */
export const CAMERA_LERP_SPEED = 5.0;

/** Minimum zoom level */
export const ZOOM_MIN = 0.5;

/** Maximum zoom level */
export const ZOOM_MAX = 6.0;

/** Default zoom level */
export const ZOOM_DEFAULT = 2.0;

/** Zoom step per scroll wheel tick */
export const ZOOM_STEP = 0.25;

// ─────────────────────────────────────────────────────────────────────────────
// Game Loop
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum delta time per frame (prevents physics jumps on tab refocus) */
export const MAX_DELTA_TIME_SEC = 0.034; // ~30fps minimum

// ─────────────────────────────────────────────────────────────────────────────
// Lattice Theme Colors
// ─────────────────────────────────────────────────────────────────────────────

/** Main background color (matches Lattice dark theme) */
export const THEME_BG = "#0C0F1A";

/** Floor tile base colors (dark navy variations) */
export const THEME_FLOOR_COLORS = [
  "#141829", // FLOOR_1 — darkest
  "#161B30", // FLOOR_2
  "#181D35", // FLOOR_3
  "#1A1F38", // FLOOR_4
  "#151A2E", // FLOOR_5
  "#171C33", // FLOOR_6
  "#191E36", // FLOOR_7 — lightest
] as const;

/** Wall color */
export const THEME_WALL = "#1E2236";

/** Wall accent/border color */
export const THEME_WALL_ACCENT = "#262A40";

/** Accent yellow (Minion yellow / Lattice brand) */
export const THEME_ACCENT_YELLOW = "#FBBF24";

/** Accent blue (Minion overalls) */
export const THEME_ACCENT_BLUE = "#3B82F6";

/** Text color for labels */
export const THEME_TEXT = "#E2E4EB";

/** Muted text color */
export const THEME_TEXT_MUTED = "#6B7280";

/** Active/live indicator */
export const THEME_ACTIVE = "#10B981";

/** Error indicator */
export const THEME_ERROR = "#EF4444";

/** Warning indicator */
export const THEME_WARNING = "#F59E0B";

/** Sidebar/panel background */
export const THEME_SIDEBAR = "#111427";

/** Border color */
export const THEME_BORDER = "#1F2337";

// ─────────────────────────────────────────────────────────────────────────────
// Room Label Rendering
// ─────────────────────────────────────────────────────────────────────────────

/** Room label font size in pixels (at 1x zoom) */
export const ROOM_LABEL_FONT_SIZE = 5;

/** Room label Y offset from top of room bounds (pixels) */
export const ROOM_LABEL_OFFSET_Y = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Minimap
// ─────────────────────────────────────────────────────────────────────────────

/** Minimap width in CSS pixels */
export const MINIMAP_WIDTH = 160;

/** Minimap height in CSS pixels */
export const MINIMAP_HEIGHT = 80;

/** Minimap padding from corner */
export const MINIMAP_PADDING = 12;

/** Minimap background opacity */
export const MINIMAP_BG_ALPHA = 0.85;

/** Character dot size on minimap */
export const MINIMAP_DOT_SIZE = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Server Room
// ─────────────────────────────────────────────────────────────────────────────

/** LED blink speed (seconds per cycle) */
export const SERVER_LED_CYCLE_SEC = 1.5;

// ─────────────────────────────────────────────────────────────────────────────
// Day/Night Cycle
// ─────────────────────────────────────────────────────────────────────────────

/** Hours that define each period */
export const DAY_MORNING_START = 6;
export const DAY_AFTERNOON_START = 12;
export const DAY_EVENING_START = 18;
export const DAY_NIGHT_START = 22;

/** Brightness multipliers for each period */
export const DAY_BRIGHTNESS = {
  morning: 0.9,
  afternoon: 1.0,
  evening: 0.7,
  night: 0.4,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Morale System
// ─────────────────────────────────────────────────────────────────────────────

/** Idle time before character falls asleep (seconds) */
export const MORALE_SLEEP_THRESHOLD_SEC = 600; // 10 minutes

/** Error count threshold before "frustrated" mood */
export const MORALE_FRUSTRATION_THRESHOLD = 3;

/** TPS threshold for "sweating" (tokens per second) */
export const MORALE_SWEAT_TPS_THRESHOLD = 100;

/** Celebration animation duration (seconds) */
export const MORALE_CELEBRATE_DURATION_SEC = 3.0;
