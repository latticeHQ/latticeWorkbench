/**
 * Pixel HQ Furniture Catalog
 *
 * Defines all available furniture types for the office layout.
 * Each entry specifies dimensions, sprite key, walkability,
 * and optional seat offsets for character placement.
 */

import type { FurnitureCatalogEntry } from "../engine/types";
import { Direction } from "../engine/types";

export const FURNITURE_CATALOG: FurnitureCatalogEntry[] = [
  {
    id: "desk",
    name: "Desk",
    width: 2,
    height: 1,
    spriteKey: "desk",
    solid: true,
    category: "office",
    seatOffsets: [{ col: 0, row: 1, dir: Direction.UP }],
  },
  {
    id: "chair",
    name: "Chair",
    width: 1,
    height: 1,
    spriteKey: "chair",
    solid: false,
    category: "office",
  },
  {
    id: "conf_table",
    name: "Conference Table",
    width: 3,
    height: 2,
    spriteKey: "conf_table",
    solid: true,
    category: "meeting",
    seatOffsets: [
      { col: -1, row: 0, dir: Direction.RIGHT },
      { col: 3, row: 0, dir: Direction.LEFT },
      { col: -1, row: 1, dir: Direction.RIGHT },
      { col: 3, row: 1, dir: Direction.LEFT },
      { col: 0, row: -1, dir: Direction.DOWN },
      { col: 1, row: -1, dir: Direction.DOWN },
      { col: 0, row: 2, dir: Direction.UP },
      { col: 1, row: 2, dir: Direction.UP },
    ],
  },
  {
    id: "server_rack",
    name: "Server Rack",
    width: 1,
    height: 2,
    spriteKey: "server_rack",
    solid: true,
    category: "tech",
    animatedFrames: 3,
  },
  {
    id: "couch",
    name: "Couch",
    width: 2,
    height: 1,
    spriteKey: "couch",
    solid: false,
    category: "lounge",
    seatOffsets: [
      { col: 0, row: 0, dir: Direction.DOWN },
      { col: 1, row: 0, dir: Direction.DOWN },
    ],
  },
  {
    id: "plant",
    name: "Plant",
    width: 1,
    height: 1,
    spriteKey: "plant",
    solid: true,
    category: "decor",
  },
  {
    id: "whiteboard",
    name: "Whiteboard",
    width: 2,
    height: 1,
    spriteKey: "whiteboard",
    solid: true,
    category: "office",
  },
  {
    id: "coffee",
    name: "Coffee Machine",
    width: 1,
    height: 1,
    spriteKey: "coffee",
    solid: true,
    category: "lounge",
    animatedFrames: 2,
  },
  {
    id: "water_cooler",
    name: "Water Cooler",
    width: 1,
    height: 1,
    spriteKey: "water_cooler",
    solid: true,
    category: "lounge",
  },
  {
    id: "bookshelf",
    name: "Bookshelf",
    width: 1,
    height: 2,
    spriteKey: "bookshelf",
    solid: true,
    category: "decor",
  },
];

export const FURNITURE_CATALOG_MAP = new Map(
  FURNITURE_CATALOG.map((e) => [e.id, e]),
);
