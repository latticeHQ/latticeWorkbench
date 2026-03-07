/**
 * Color utility functions for the pixel office asset library.
 */

/** Parse a hex color string to RGB components. */
function parseHex(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Convert RGB to hex string. */
function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/** Darken a hex color by a percentage (0–100). */
export function darken(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - percent / 100;
  return toHex(r * f, g * f, b * f);
}

/** Lighten a hex color by a percentage (0–100). */
export function lighten(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const f = percent / 100;
  return toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}

/** Add a warm (orange) tint to a hex color. */
export function tintWarm(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    r + (255 - r) * amount,
    g + (200 - g) * amount * 0.5,
    b - b * amount * 0.3,
  );
}

/** Derive a brighter screen glow color from stage hex. */
export function deriveScreenColor(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    Math.min(255, r + 90),
    Math.min(255, g + 90),
    Math.min(255, b + 90),
  );
}
