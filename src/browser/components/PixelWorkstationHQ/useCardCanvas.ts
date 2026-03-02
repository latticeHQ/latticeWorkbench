/**
 * useCardCanvas — React hook that creates a CardScene, registers it with the
 * global game loop, and syncs React props imperatively.
 *
 * Returns a ref to attach to a <canvas> element.
 */

import { useRef, useEffect } from "react";
import type { CharacterAppearance, CharPalette, DeskPalette, TimeOfDay } from "./sprites/types";
import { CardScene } from "./engine/cardScene";
import { gameLoop } from "./engine/gameLoop";

export function useCardCanvas(
  appearance: CharacterAppearance,
  charPalette: CharPalette,
  deskPalette: DeskPalette,
  timeOfDay: TimeOfDay,
  accentHex: string,
  isActive: boolean,
  isWaiting: boolean,
  isDone: boolean,
): React.RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<CardScene | null>(null);

  // Create scene on mount, register with game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new CardScene(
      canvas, appearance, charPalette, deskPalette, timeOfDay, accentHex,
    );
    sceneRef.current = scene;
    const unregister = gameLoop.register(scene);

    return () => {
      unregister();
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — props synced via effects below

  // Sync agent state
  useEffect(() => {
    sceneRef.current?.updateState(isActive, isWaiting, isDone);
  }, [isActive, isWaiting, isDone]);

  // Sync palettes + time of day
  useEffect(() => {
    sceneRef.current?.updatePalettes(
      appearance, charPalette, deskPalette, timeOfDay, accentHex,
    );
  }, [appearance, charPalette, deskPalette, timeOfDay, accentHex]);

  return canvasRef;
}
