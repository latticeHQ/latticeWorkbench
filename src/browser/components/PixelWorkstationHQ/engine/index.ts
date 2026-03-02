/**
 * Canvas 2D rendering engine — barrel exports.
 */

export { gameLoop, type SceneSubscriber } from "./gameLoop";
export { getSpriteAtlas, clearSpriteCache, type SpriteAtlas } from "./spriteCache";
export { getDeskCanvas, clearDeskCache, type DeskRenderCache } from "./deskRenderer";
export { WalkController } from "./walkController";
export {
  drawWallPattern,
  drawFloorPattern,
  drawFloorLine,
  drawAmbientGlow,
  drawWoodFloor,
} from "./environmentRenderer";
export { CardScene } from "./cardScene";
export { CrewScene } from "./crewScene";
