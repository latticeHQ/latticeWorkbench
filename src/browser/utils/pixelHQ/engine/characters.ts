/**
 * Pixel HQ Character System
 *
 * Character creation, FSM update, and sprite selection.
 * Adapted from Pixel Agents' character engine and extended with
 * READ state, crew hue-shift, morale expressions.
 *
 * State Machine:
 *   IDLE  → walks randomly near seat, pauses, returns to seat
 *   WALK  → follows BFS path to target tile
 *   TYPE  → seated at desk, typing animation (Edit/Write/Bash tools)
 *   READ  → seated at desk, reading animation (Read/Grep/Glob tools)
 */

import {
  type Character,
  type CharacterCreateConfig,
  type CharacterState,
  type Direction,
  type Seat,
  CharacterState as CS,
  Direction as Dir,
  MoraleMood,
} from "./types";
import {
  TILE_SIZE,
  WALK_SPEED_PX_PER_SEC,
  WALK_FRAME_DURATION_SEC,
  TYPE_FRAME_DURATION_SEC,
  READ_FRAME_DURATION_SEC,
  IDLE_FRAME_DURATION_SEC,
  WANDER_PAUSE_MIN_SEC,
  WANDER_PAUSE_MAX_SEC,
  WANDER_RADIUS,
  WANDER_MIN_MOVES,
  WANDER_MAX_MOVES,
  SEAT_REST_MIN_SEC,
  SEAT_REST_MAX_SEC,
  MATRIX_EFFECT_DURATION_SEC,
  MATRIX_RAIN_COLUMNS,
  FRAMES_PER_ROW,
} from "./constants";
import { findPath, getRandomWalkableInRadius } from "./pathfinding";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(randBetween(min, max + 1));
}

/** Direction from one tile to an adjacent tile */
function tileDirection(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (Math.abs(dc) > Math.abs(dr)) {
    return dc > 0 ? Dir.RIGHT : Dir.LEFT;
  }
  return dr > 0 ? Dir.DOWN : Dir.UP;
}

/** Tools that trigger reading animation */
const READ_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "Task",  // sub-agent monitoring looks like reading
]);

/** Tools that trigger typing animation */
const TYPE_TOOLS = new Set([
  "Edit",
  "Write",
  "Bash",
  "NotebookEdit",
  "TodoWrite",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Character Creation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new character at the given tile position.
 */
export function createCharacter(config: CharacterCreateConfig): Character {
  const matrixSeeds = config.withSpawnEffect
    ? Array.from({ length: MATRIX_RAIN_COLUMNS }, () => Math.random())
    : [];

  return {
    id: config.id,
    minionId: config.minionId,
    displayName: config.displayName,

    state: CS.IDLE,
    dir: Dir.DOWN,

    x: config.tileCol * TILE_SIZE + TILE_SIZE / 2,
    y: config.tileRow * TILE_SIZE + TILE_SIZE,
    tileCol: config.tileCol,
    tileRow: config.tileRow,

    path: [],
    moveProgress: 0,

    palette: config.palette,
    hueShift: config.hueShift,

    frame: 0,
    frameTimer: 0,
    wanderTimer: randBetween(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC),
    wanderCount: 0,
    wanderLimit: randInt(WANDER_MIN_MOVES, WANDER_MAX_MOVES),

    isActive: false,
    currentTool: null,
    seatId: null,
    roomId: null,

    bubbleType: null,
    bubbleTimer: 0,

    mood: MoraleMood.NEUTRAL,
    moodTimer: 0,

    isSubagent: config.isSubagent ?? false,
    parentAgentId: config.parentAgentId ?? null,

    matrixEffect: config.withSpawnEffect
      ? { phase: "spawning", timer: 0, columnSeeds: matrixSeeds }
      : null,

    seatTimer: 0,
    crewId: config.crewId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Character Update (FSM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a character's state for one frame.
 *
 * @param char - The character to update
 * @param dt - Delta time in seconds
 * @param seats - Map of seat UID → Seat
 * @param walkable - 2D walkability grid [row][col]
 * @param cols - Grid width
 * @param rows - Grid height
 */
export function updateCharacter(
  char: Character,
  dt: number,
  seats: Map<string, Seat>,
  walkable: boolean[][],
  cols: number,
  rows: number,
): void {
  // Update matrix effect
  if (char.matrixEffect) {
    char.matrixEffect.timer += dt;
    if (char.matrixEffect.timer >= MATRIX_EFFECT_DURATION_SEC) {
      if (char.matrixEffect.phase === "despawning") {
        // Character should be removed by OfficeState after despawn completes
        return;
      }
      char.matrixEffect = null;
    }
    // Don't update FSM during matrix effect
    return;
  }

  // Update bubble timer
  if (char.bubbleType !== null) {
    char.bubbleTimer -= dt;
    if (char.bubbleTimer <= 0) {
      char.bubbleType = null;
      char.bubbleTimer = 0;
    }
  }

  // Update mood timer
  if (char.moodTimer > 0) {
    char.moodTimer -= dt;
    if (char.moodTimer <= 0) {
      char.mood = MoraleMood.NEUTRAL;
      char.moodTimer = 0;
    }
  }

  // FSM dispatch
  switch (char.state) {
    case CS.TYPE:
    case CS.READ:
      updateWorkState(char, dt, seats, walkable, cols, rows);
      break;
    case CS.IDLE:
      updateIdleState(char, dt, seats, walkable, cols, rows);
      break;
    case CS.WALK:
      updateWalkState(char, dt, seats, walkable, cols, rows);
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State: TYPE / READ (working at desk)
// ─────────────────────────────────────────────────────────────────────────────

function updateWorkState(
  char: Character,
  dt: number,
  seats: Map<string, Seat>,
  _walkable: boolean[][],
  _cols: number,
  _rows: number,
): void {
  // If no longer active, transition to IDLE
  if (!char.isActive) {
    char.state = CS.IDLE;
    char.wanderTimer = randBetween(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
    char.wanderCount = 0;
    char.wanderLimit = randInt(WANDER_MIN_MOVES, WANDER_MAX_MOVES);
    return;
  }

  // Ensure seated facing correct direction
  if (char.seatId) {
    const seat = seats.get(char.seatId);
    if (seat) {
      char.dir = seat.facingDir;
      char.tileCol = seat.col;
      char.tileRow = seat.row;
      char.x = seat.col * TILE_SIZE + TILE_SIZE / 2;
      char.y = seat.row * TILE_SIZE + TILE_SIZE;
    }
  }

  // Advance animation frame
  const frameDuration =
    char.state === CS.TYPE ? TYPE_FRAME_DURATION_SEC : READ_FRAME_DURATION_SEC;
  char.frameTimer += dt;
  if (char.frameTimer >= frameDuration) {
    char.frameTimer -= frameDuration;
    char.frame = (char.frame + 1) % FRAMES_PER_ROW;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State: IDLE (wandering near seat)
// ─────────────────────────────────────────────────────────────────────────────

function updateIdleState(
  char: Character,
  dt: number,
  seats: Map<string, Seat>,
  walkable: boolean[][],
  cols: number,
  rows: number,
): void {
  // If became active, transition to work state
  if (char.isActive) {
    transitionToWork(char, seats, walkable, cols, rows);
    return;
  }

  // Advance idle animation (blinking)
  char.frameTimer += dt;
  if (char.frameTimer >= IDLE_FRAME_DURATION_SEC) {
    char.frameTimer -= IDLE_FRAME_DURATION_SEC;
    char.frame = (char.frame + 1) % 2; // 2-frame idle blink
  }

  // Seat rest timer (stay seated for a while before wandering)
  if (char.seatTimer > 0) {
    char.seatTimer -= dt;
    return;
  }

  // Wander timer countdown
  char.wanderTimer -= dt;
  if (char.wanderTimer > 0) return;

  // Time to make a wander decision
  if (char.wanderCount >= char.wanderLimit) {
    // Done wandering, go back to seat
    if (char.seatId) {
      const seat = seats.get(char.seatId);
      if (seat) {
        const path = findPath(
          char.tileCol, char.tileRow,
          seat.col, seat.row,
          walkable, cols, rows,
        );
        if (path && path.length > 0) {
          char.path = path;
          char.state = CS.WALK;
          char.moveProgress = 0;
          char.frame = 0;
          char.frameTimer = 0;
          return;
        }
      }
    }
    // Reset wander cycle
    char.wanderCount = 0;
    char.wanderLimit = randInt(WANDER_MIN_MOVES, WANDER_MAX_MOVES);
    char.seatTimer = randBetween(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
    return;
  }

  // Pick a random walkable tile near seat (or current position if no seat)
  const centerCol = char.seatId
    ? (seats.get(char.seatId)?.col ?? char.tileCol)
    : char.tileCol;
  const centerRow = char.seatId
    ? (seats.get(char.seatId)?.row ?? char.tileRow)
    : char.tileRow;

  const target = getRandomWalkableInRadius(
    centerCol, centerRow, WANDER_RADIUS,
    walkable, cols, rows,
  );

  if (target) {
    const path = findPath(
      char.tileCol, char.tileRow,
      target.col, target.row,
      walkable, cols, rows,
    );
    if (path && path.length > 0) {
      char.path = path;
      char.state = CS.WALK;
      char.moveProgress = 0;
      char.frame = 0;
      char.frameTimer = 0;
      char.wanderCount++;
    }
  }

  // Reset wander timer regardless
  char.wanderTimer = randBetween(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
}

// ─────────────────────────────────────────────────────────────────────────────
// State: WALK (following path)
// ─────────────────────────────────────────────────────────────────────────────

function updateWalkState(
  char: Character,
  dt: number,
  seats: Map<string, Seat>,
  walkable: boolean[][],
  cols: number,
  rows: number,
): void {
  // If path is empty, we've arrived
  if (char.path.length === 0) {
    // Arrived — decide next state
    if (char.isActive) {
      transitionToWork(char, seats, walkable, cols, rows);
    } else {
      char.state = CS.IDLE;
      char.wanderTimer = randBetween(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      char.frame = 0;
      char.frameTimer = 0;

      // If we arrived at our seat, rest there
      if (char.seatId) {
        const seat = seats.get(char.seatId);
        if (seat && char.tileCol === seat.col && char.tileRow === seat.row) {
          char.seatTimer = randBetween(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
          char.dir = seat.facingDir;
          char.wanderCount = 0;
          char.wanderLimit = randInt(WANDER_MIN_MOVES, WANDER_MAX_MOVES);
        }
      }
    }
    return;
  }

  // Get next tile in path
  const nextTile = char.path[0];

  // Update facing direction
  char.dir = tileDirection(char.tileCol, char.tileRow, nextTile.col, nextTile.row);

  // Advance movement progress
  const pixelsPerFrame = WALK_SPEED_PX_PER_SEC * dt;
  char.moveProgress += pixelsPerFrame / TILE_SIZE;

  if (char.moveProgress >= 1.0) {
    // Arrived at next tile
    char.tileCol = nextTile.col;
    char.tileRow = nextTile.row;
    char.x = nextTile.col * TILE_SIZE + TILE_SIZE / 2;
    char.y = nextTile.row * TILE_SIZE + TILE_SIZE;
    char.moveProgress = 0;
    char.path.shift();
  } else {
    // Interpolate position
    const startX = char.tileCol * TILE_SIZE + TILE_SIZE / 2;
    const startY = char.tileRow * TILE_SIZE + TILE_SIZE;
    const endX = nextTile.col * TILE_SIZE + TILE_SIZE / 2;
    const endY = nextTile.row * TILE_SIZE + TILE_SIZE;
    char.x = startX + (endX - startX) * char.moveProgress;
    char.y = startY + (endY - startY) * char.moveProgress;
  }

  // Advance walk animation
  char.frameTimer += dt;
  if (char.frameTimer >= WALK_FRAME_DURATION_SEC) {
    char.frameTimer -= WALK_FRAME_DURATION_SEC;
    char.frame = (char.frame + 1) % 4; // 4-frame walk cycle
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transition character to work state (TYPE or READ) at their assigned seat.
 */
function transitionToWork(
  char: Character,
  seats: Map<string, Seat>,
  walkable: boolean[][],
  cols: number,
  rows: number,
): void {
  // Determine animation state from current tool
  const workState = getWorkStateForTool(char.currentTool);

  // If already at seat, just start working
  if (char.seatId) {
    const seat = seats.get(char.seatId);
    if (seat && char.tileCol === seat.col && char.tileRow === seat.row) {
      char.state = workState;
      char.dir = seat.facingDir;
      char.frame = 0;
      char.frameTimer = 0;
      return;
    }

    // Need to walk to seat
    if (seat) {
      const path = findPath(
        char.tileCol, char.tileRow,
        seat.col, seat.row,
        walkable, cols, rows,
      );
      if (path && path.length > 0) {
        char.path = path;
        char.state = CS.WALK;
        char.moveProgress = 0;
        char.frame = 0;
        char.frameTimer = 0;
        return;
      }
    }
  }

  // No seat or can't reach it — just play animation at current position
  char.state = workState;
  char.frame = 0;
  char.frameTimer = 0;
}

/**
 * Determine which work animation state to use for a tool.
 */
export function getWorkStateForTool(toolName: string | null): CharacterState {
  if (!toolName) return CS.TYPE;
  if (READ_TOOLS.has(toolName)) return CS.READ;
  if (TYPE_TOOLS.has(toolName)) return CS.TYPE;
  return CS.TYPE; // default to typing for unknown tools
}

/**
 * Send a character walking to a specific tile.
 */
export function walkCharacterTo(
  char: Character,
  targetCol: number,
  targetRow: number,
  walkable: boolean[][],
  cols: number,
  rows: number,
): boolean {
  const path = findPath(
    char.tileCol, char.tileRow,
    targetCol, targetRow,
    walkable, cols, rows,
  );
  if (!path || path.length === 0) return false;

  char.path = path;
  char.state = CS.WALK;
  char.moveProgress = 0;
  char.frame = 0;
  char.frameTimer = 0;
  return true;
}

/**
 * Start a matrix despawn effect on a character.
 */
export function startDespawnEffect(char: Character): void {
  char.matrixEffect = {
    phase: "despawning",
    timer: 0,
    columnSeeds: Array.from({ length: MATRIX_RAIN_COLUMNS }, () => Math.random()),
  };
}

/**
 * Check if a character's despawn effect has completed.
 */
export function isDespawnComplete(char: Character): boolean {
  return (
    char.matrixEffect?.phase === "despawning" &&
    char.matrixEffect.timer >= MATRIX_EFFECT_DURATION_SEC
  );
}
