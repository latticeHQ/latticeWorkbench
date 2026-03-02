/**
 * WalkController — plain class managing per-character walking FSM.
 *
 * Extracted from the useCharacterWalk React hook. Driven by `update(dt)`
 * from the game loop instead of setInterval.
 *
 * State machine:
 *   seated ──(inactive timer)──→ idle_standing ──(wander timer)──→ walking
 *   walking ──(path empty)──→ idle_standing ──(wander limit)──→ walking(→seat) ──→ seated
 *   idle_standing/walking ──(agent active)──→ walking(→seat) ──→ seated
 */

import type { CharState } from "../sprites/types";
import {
  DESK_SEAT, MINI_TILE_PX,
  findPath, tileToPixel, getRandomWalkableTile,
} from "../tileGrid";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const WALK_SPEED = 12;          // pixel-space px/sec
const WANDER_PAUSE_MIN = 1.5;   // seconds
const WANDER_PAUSE_MAX = 6.0;
const WANDER_LIMIT_MIN = 2;
const WANDER_LIMIT_MAX = 4;
const SEAT_REST_MIN = 8;        // seconds
const SEAT_REST_MAX = 15;

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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type FSMState = "seated" | "walking" | "idle_standing";

interface Tile { col: number; row: number }

// ─────────────────────────────────────────────────────────────────────────────
// WalkController
// ─────────────────────────────────────────────────────────────────────────────

export class WalkController {
  // FSM state
  private fsm: FSMState = "seated";
  private tileCol: number;
  private tileRow: number;

  // Pixel-space position
  private _x: number;
  private _y: number;
  private _direction: "left" | "right" = "right";

  // Path following
  private path: Tile[] = [];
  private moveProgress = 0;
  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;

  // Wander state
  private wanderCount = 0;
  private wanderLimit: number;
  private timer = 0;

  // Animation frame tracking
  private _frameIndex = 0;
  private _frameTimer = 0;
  private _charState: CharState = "idle";

  // Agent state (set from outside)
  private _isActive = false;
  private _isWaiting = false;
  private _isDone = false;

  constructor() {
    this.tileCol = DESK_SEAT.col;
    this.tileRow = DESK_SEAT.row;
    const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
    this._x = pos.x;
    this._y = pos.y;
    this.wanderLimit = randInt(WANDER_LIMIT_MIN, WANDER_LIMIT_MAX);
  }

  // ── Setters for agent state ──

  setActive(v: boolean): void {
    if (this._isActive === v) return;
    const wasActive = this._isActive;
    this._isActive = v;
    // When agent becomes inactive and character is seated, set rest timer
    if (!v && wasActive && this.fsm === "seated") {
      this.timer = randRange(SEAT_REST_MIN, SEAT_REST_MAX);
    }
  }
  setWaiting(v: boolean): void { this._isWaiting = v; }
  setDone(v: boolean): void { this._isDone = v; }

  // ── Getters for rendering ──

  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get direction(): "left" | "right" { return this._direction; }
  get charState(): CharState { return this._charState; }
  get frameIndex(): number { return this._frameIndex; }

  // ── Derived char state ──

  private deriveCharState(): CharState {
    if (this.fsm === "walking") {
      return this._direction === "left" ? "walk_left" : "walk_right";
    }
    if (this.fsm === "seated") {
      if (this._isActive) return "typing";
      if (this._isWaiting) return "waiting";
      if (this._isDone) return "done";
      return "idle";
    }
    return "idle"; // idle_standing
  }

  // ── Path helpers ──

  private startPathTo(targetCol: number, targetRow: number): boolean {
    const path = findPath(this.tileCol, this.tileRow, targetCol, targetRow);
    if (path.length === 0) return false;

    const fromPos = tileToPixel(this.tileCol, this.tileRow);
    const toPos = tileToPixel(path[0].col, path[0].row);
    this.path = path;
    this.moveProgress = 0;
    this.fromX = fromPos.x;
    this.fromY = fromPos.y;
    this.toX = toPos.x;
    this.toY = toPos.y;
    this.fsm = "walking";

    if (path[0].col < this.tileCol) this._direction = "left";
    else if (path[0].col > this.tileCol) this._direction = "right";
    return true;
  }

  // ── Main update ──

  update(dt: number): void {
    const active = this._isActive;

    // ── SEATED ──
    if (this.fsm === "seated") {
      if (active) {
        this.updateAnimation(dt);
        return;
      }
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fsm = "idle_standing";
        this.timer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
        this.wanderCount = 0;
        this.wanderLimit = randInt(WANDER_LIMIT_MIN, WANDER_LIMIT_MAX);
      }
      this.updateAnimation(dt);
      return;
    }

    // ── If active while not seated, go back to seat ──
    if (active && this.fsm !== "walking") {
      if (this.tileCol === DESK_SEAT.col && this.tileRow === DESK_SEAT.row) {
        this.fsm = "seated";
        this.timer = 0;
        const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
        this._x = pos.x;
        this._y = pos.y;
      } else {
        this.startPathTo(DESK_SEAT.col, DESK_SEAT.row);
      }
    } else if (active && this.fsm === "walking") {
      const lastTile = this.path[this.path.length - 1];
      if (!lastTile || lastTile.col !== DESK_SEAT.col || lastTile.row !== DESK_SEAT.row) {
        this.startPathTo(DESK_SEAT.col, DESK_SEAT.row);
      }
    }

    // ── IDLE_STANDING ──
    if (this.fsm === "idle_standing") {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.wanderCount >= this.wanderLimit) {
          if (!this.startPathTo(DESK_SEAT.col, DESK_SEAT.row)) {
            this.fsm = "seated";
            this.timer = randRange(SEAT_REST_MIN, SEAT_REST_MAX);
          }
        } else {
          const target = getRandomWalkableTile(this.tileCol, this.tileRow);
          if (!this.startPathTo(target.col, target.row)) {
            this.timer = 0.5;
          }
        }
      }
      this.updateAnimation(dt);
      return;
    }

    // ── WALKING ──
    if (this.fsm === "walking") {
      if (this.path.length === 0) {
        const atSeat = this.tileCol === DESK_SEAT.col && this.tileRow === DESK_SEAT.row;
        if (atSeat || active) {
          this.fsm = "seated";
          this.timer = active ? 0 : randRange(SEAT_REST_MIN, SEAT_REST_MAX);
          const pos = tileToPixel(DESK_SEAT.col, DESK_SEAT.row);
          this._x = pos.x;
          this._y = pos.y;
        } else {
          this.fsm = "idle_standing";
          this.wanderCount++;
          this.timer = randRange(WANDER_PAUSE_MIN, WANDER_PAUSE_MAX);
        }
        this.updateAnimation(dt);
        return;
      }

      this.moveProgress += (WALK_SPEED / MINI_TILE_PX) * dt;

      if (this.moveProgress >= 1) {
        const nextTile = this.path.shift()!;
        this.tileCol = nextTile.col;
        this.tileRow = nextTile.row;
        const tilePos = tileToPixel(nextTile.col, nextTile.row);
        this._x = tilePos.x;
        this._y = tilePos.y;
        this.moveProgress = 0;

        if (this.path.length > 0) {
          this.fromX = tilePos.x;
          this.fromY = tilePos.y;
          const nextPos = tileToPixel(this.path[0].col, this.path[0].row);
          this.toX = nextPos.x;
          this.toY = nextPos.y;
          if (this.path[0].col < nextTile.col) this._direction = "left";
          else if (this.path[0].col > nextTile.col) this._direction = "right";
        }
      } else {
        this._x = lerp(this.fromX, this.toX, this.moveProgress);
        this._y = lerp(this.fromY, this.toY, this.moveProgress);
      }
    }

    this.updateAnimation(dt);
  }

  // ── Animation frame cycling ──

  private updateAnimation(dt: number): void {
    const newState = this.deriveCharState();
    if (newState !== this._charState) {
      this._charState = newState;
      this._frameIndex = 0;
      this._frameTimer = 0;
      return;
    }

    const interval = ANIM_INTERVALS[this._charState] / 1000; // to seconds
    this._frameTimer += dt;
    if (this._frameTimer >= interval) {
      this._frameTimer -= interval;
      this._frameIndex++;
      // Frame count will be checked at render time using the atlas
    }
  }
}

// Re-export ANIM_INTERVALS for external use
import { ANIM_INTERVALS } from "../sprites/characterFrames";
export { ANIM_INTERVALS };
