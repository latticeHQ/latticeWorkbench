/**
 * useStageCanvas — React hook that creates a StageScene with multiple minions,
 * registers it with the global game loop, and manages character add/remove.
 *
 * Returns a ref to attach to a <canvas> element.
 */

import { useRef, useEffect } from "react";
import type { CharacterAppearance, CharPalette, DeskPalette, TimeOfDay } from "./sprites/types";
import { StageScene } from "./engine/stageScene";
import { gameLoop } from "./engine/gameLoop";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StageMinion {
  minionId: string;
  appearance: CharacterAppearance;
  charPalette: CharPalette;
  accentHex: string;
  isActive: boolean;
  isWaiting: boolean;
  isDone: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useStageCanvas(
  deskPalette: DeskPalette,
  timeOfDay: TimeOfDay,
  width: number,
  height: number,
  minions: StageMinion[],
): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<StageScene | null>(null);
  const prevMinionIdsRef = useRef<Set<string>>(new Set());

  // Create scene on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new StageScene(canvas, deskPalette, timeOfDay, width, height);
    sceneRef.current = scene;
    const unregister = gameLoop.register(scene);

    return () => {
      unregister();
      scene.dispose();
      sceneRef.current = null;
      prevMinionIdsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only

  // Resize when dimensions change
  useEffect(() => {
    sceneRef.current?.resize(width, height);
  }, [width, height]);

  // Sync desk palette + time of day
  useEffect(() => {
    sceneRef.current?.updateDeskPalette(deskPalette, timeOfDay);
  }, [deskPalette, timeOfDay]);

  // Sync minion list: add new, remove old, update state
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentIds = new Set(minions.map(m => m.minionId));
    const prevIds = prevMinionIdsRef.current;

    // Remove minions that left
    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        scene.removeCharacter(id);
      }
    }

    // Add new minions + update all states
    for (const m of minions) {
      if (!prevIds.has(m.minionId)) {
        scene.addCharacter(m.minionId, m.appearance, m.charPalette, m.accentHex);
      }
      scene.updateCharacterState(m.minionId, m.isActive, m.isWaiting, m.isDone);
      scene.updateCharacterPalette(m.minionId, m.charPalette, m.accentHex);
    }

    prevMinionIdsRef.current = currentIds;
  }, [minions]);

  return canvasRef;
}
