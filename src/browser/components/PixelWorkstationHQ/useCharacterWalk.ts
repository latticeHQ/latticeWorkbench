/**
 * useCharacterWalk — React hook that manages per-card character walking FSM.
 *
 * Returns pixel-space position, direction, charState, and frame index so
 * PixelCharacter can render the character at the correct position with the
 * correct animation.
 *
 * State machine:
 *   seated ──(agent becomes inactive)──→ idle_standing ──(wander timer)──→ walking
 *   walking ──(path empty)──→ idle_standing ──(wander limit)──→ walking(→seat) ──→ seated
 *   idle_standing/walking ──(agent becomes active)──→ walking(→seat) ──→ seated
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { CharState } from "./pixelSprites";
import {
  DESK_SEAT, MINI_TILE_PX,
  findPath, tileToPixel, getRandomWalkableTile,
} from "./tileGrid";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Walk speed in pixel-space pixels per second. */
const WALK_SPEED = 12;

/** Pause range (seconds) between wander moves. */
const WANDER_PAUSE_MIN = 1.5;
const WANDER_PAUSE_MAX = 6.0;

/** Number of wander moves before returning to seat. */
const WANDER_LIMIT_MIN = 2;
const WANDER_LIMIT_MAX = 4;

/** Rest time at seat (seconds) before starting another wander cycle. */
const SEAT_REST_MIN = 8;
const SEAT_REST_MAX = 15;

/** Tick interval in ms. */
const TICK_MS = 16;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type FSMState = "seated" | "walking" | "idle_standing";

interface Tile {
  col: number;
  row: number;
}

interface WalkState {
  fsm: FSMState;
  /** Current tile position. */
  tileCol: number;
  tileRow: number;
  /** Current pixel-space position. */
  x: number;
  y: number;
  /** Direction for sprite rendering. */
  direction: "left" | "right";
  /** Path to follow (array of tiles, excluding current). */
  path: Tile[];
  /** Progress interpolating between current and next tile (0→1). */
  moveProgress: number;
  /** From/to pixel coords for current interpolation step. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Number of wander moves completed in current cycle. */
  wanderCount: number;
  /** Max wanders before returning to seat. */
  wanderLimit: number;
  /** Timer countdown (seconds) for pauses. */
  timer: number;
}

export interface CharacterWalkResult {
  /** Pixel-space x position (pre-scale). */
  x: number;
  /** Pixel-space y position (pre-scale). */
  y: number;
  direction: "left" | "right";
  charState: CharState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function initSeatState(): WalkState {
  const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
  return {
    fsm: "seated",
    tileCol: DESK_SEAT.col,
    tileRow: DESK_SEAT.row,
    x: pos.x,
    y: pos.y,
    direction: "right",
    path: [],
    moveProgress: 0,
    fromX: pos.x,
    fromY: pos.y,
    toX: pos.x,
    toY: pos.y,
    wanderCount: 0,
    wanderLimit: randInt(WANDER_LIMIT_MIN, WANDER_LIMIT_MAX),
    timer: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useCharacterWalk(
  isActive: boolean,
  isWaiting: boolean,
  isDone: boolean,
): CharacterWalkResult {
  const [result, setResult] = useState<CharacterWalkResult>(() => {
    const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
    return { x: pos.x, y: pos.y, direction: "right" as const, charState: "idle" };
  });

  // Mutable state ref — avoids re-renders on every tick
  const stateRef = useRef<WalkState>(initSeatState());
  const isActiveRef = useRef(isActive);
  const isWaitingRef = useRef(isWaiting);
  const isDoneRef = useRef(isDone);

  // Keep refs in sync
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { isWaitingRef.current = isWaiting; }, [isWaiting]);
  useEffect(() => { isDoneRef.current = isDone; }, [isDone]);

  // Derive charState from FSM state + agent props
  const deriveCharState = useCallback((): CharState => {
    const s = stateRef.current;
    if (s.fsm === "walking") {
      return s.direction === "left" ? "walk_left" : "walk_right";
    }
    if (s.fsm === "seated") {
      if (isActiveRef.current) return "typing";
      if (isWaitingRef.current) return "waiting";
      if (isDoneRef.current) return "done";
      return "idle";
    }
    // idle_standing
    return "idle";
  }, []);

  // Start walking to a target tile
  const startPathTo = useCallback((targetCol: number, targetRow: number) => {
    const s = stateRef.current;
    const path = findPath(s.tileCol, s.tileRow, targetCol, targetRow);
    if (path.length === 0) {
      // Can't find path or already there
      return false;
    }
    const fromPos = tileToPixel(s.tileCol, s.tileRow);
    const toPos = tileToPixel(path[0].col, path[0].row);
    s.path = path;
    s.moveProgress = 0;
    s.fromX = fromPos.x;
    s.fromY = fromPos.y;
    s.toX = toPos.x;
    s.toY = toPos.y;
    s.fsm = "walking";
    // Derive direction from first step
    if (path[0].col < s.tileCol) s.direction = "left";
    else if (path[0].col > s.tileCol) s.direction = "right";
    return true;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const s = stateRef.current;
      const dt = TICK_MS / 1000;
      const active = isActiveRef.current;

      // ── SEATED state ──
      if (s.fsm === "seated") {
        if (active) {
          // Stay seated, typing
          return;
        }
        // Not active — count down rest timer then stand up
        s.timer -= dt;
        if (s.timer <= 0) {
          s.fsm = "idle_standing";
          s.timer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
          s.wanderCount = 0;
          s.wanderLimit = randInt(WANDER_LIMIT_MIN, WANDER_LIMIT_MAX);
        }
        return;
      }

      // ── If agent becomes active while not seated, pathfind back to seat ──
      if (active && s.fsm !== "walking") {
        // Start walking to seat
        if (s.tileCol === DESK_SEAT.col && s.tileRow === DESK_SEAT.row) {
          s.fsm = "seated";
          s.timer = 0;
          const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
          s.x = pos.x;
          s.y = pos.y;
        } else {
          startPathTo(DESK_SEAT.col, DESK_SEAT.row);
        }
      } else if (active && s.fsm === "walking") {
        // Already walking — check if heading to seat
        const lastTile = s.path[s.path.length - 1];
        if (!lastTile || (lastTile.col !== DESK_SEAT.col || lastTile.row !== DESK_SEAT.row)) {
          // Re-route to seat
          startPathTo(DESK_SEAT.col, DESK_SEAT.row);
        }
      }

      // ── IDLE_STANDING state ──
      if (s.fsm === "idle_standing") {
        s.timer -= dt;
        if (s.timer <= 0) {
          if (s.wanderCount >= s.wanderLimit) {
            // Time to go back to seat
            if (!startPathTo(DESK_SEAT.col, DESK_SEAT.row)) {
              // Already at seat
              s.fsm = "seated";
              s.timer = randRange(SEAT_REST_MIN, SEAT_REST_MAX);
            }
          } else {
            // Pick random walkable tile and go there
            const target = getRandomWalkableTile(s.tileCol, s.tileRow);
            if (!startPathTo(target.col, target.row)) {
              // Failed path — try again next tick
              s.timer = 0.5;
            }
          }
        }
        return;
      }

      // ── WALKING state ──
      if (s.fsm === "walking") {
        if (s.path.length === 0) {
          // Arrived at destination
          const atSeat = s.tileCol === DESK_SEAT.col && s.tileRow === DESK_SEAT.row;
          if (atSeat || active) {
            s.fsm = "seated";
            s.timer = active ? 0 : randRange(SEAT_REST_MIN, SEAT_REST_MAX);
            const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
            s.x = pos.x;
            s.y = pos.y;
          } else {
            s.fsm = "idle_standing";
            s.wanderCount++;
            s.timer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
          }
          return;
        }

        // Interpolate movement toward next tile
        s.moveProgress += (WALK_SPEED / MINI_TILE_PX) * dt;

        if (s.moveProgress >= 1) {
          // Snap to next tile
          const nextTile = s.path.shift()!;
          s.tileCol = nextTile.col;
          s.tileRow = nextTile.row;
          const tilePos = tileToPixel(nextTile.col, nextTile.row);
          s.x = tilePos.x;
          s.y = tilePos.y;
          s.moveProgress = 0;

          // Set up next interpolation step if more path remains
          if (s.path.length > 0) {
            s.fromX = tilePos.x;
            s.fromY = tilePos.y;
            const nextPos = tileToPixel(s.path[0].col, s.path[0].row);
            s.toX = nextPos.x;
            s.toY = nextPos.y;
            // Update direction
            if (s.path[0].col < nextTile.col) s.direction = "left";
            else if (s.path[0].col > nextTile.col) s.direction = "right";
          }
        } else {
          // Smooth lerp
          s.x = lerp(s.fromX, s.toX, s.moveProgress);
          s.y = lerp(s.fromY, s.toY, s.moveProgress);
        }
      }
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [startPathTo]);

  // Publish render state at a lower frequency (every ~64ms ≈ 15fps for React)
  useEffect(() => {
    const publish = setInterval(() => {
      const s = stateRef.current;
      const cs = deriveCharState();
      setResult(prev => {
        if (prev.x === s.x && prev.y === s.y && prev.direction === s.direction && prev.charState === cs) {
          return prev; // No change — skip re-render
        }
        return { x: s.x, y: s.y, direction: s.direction, charState: cs };
      });
    }, 64);
    return () => clearInterval(publish);
  }, [deriveCharState]);

  // When agent becomes inactive, set initial rest timer so character doesn't
  // immediately stand up (gives a natural "finishing up" feel)
  useEffect(() => {
    if (!isActive && stateRef.current.fsm === "seated") {
      stateRef.current.timer = randRange(SEAT_REST_MIN, SEAT_REST_MAX);
    }
  }, [isActive]);

  return result;
}
