/**
 * CSS box-shadow generator for character sprites.
 *
 * Converts a PixelEntry[] frame + CharPalette into a single CSS box-shadow
 * string. Each pixel becomes a `Xpx Ypx 0 #color` entry.
 */

import type { PixelEntry, CharPalette } from "./types";

/**
 * Build a CSS box-shadow string from a pixel frame + palette.
 *
 * @param frame   — array of [col, row, colorKey] pixel entries
 * @param palette — color map for all 11 character color slots
 * @returns       — CSS box-shadow value string
 */
export function buildCharShadow(
  frame: PixelEntry[],
  palette: CharPalette,
): string {
  return frame
    .map(([col, row, key]) => `${col}px ${row}px 0 ${palette[key]}`)
    .join(", ");
}
