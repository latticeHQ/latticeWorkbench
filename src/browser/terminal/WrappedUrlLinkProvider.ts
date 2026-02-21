/**
 * UrlLinkProvider — Complete replacement for ghostty-web's built-in
 * UrlRegexProvider that correctly handles URLs spanning wrapped lines.
 *
 * The built-in UrlRegexProvider only looks at single lines, so long URLs
 * (e.g. Google OAuth URLs) that wrap across multiple lines only open the
 * first line when clicked. This provider joins all lines in a wrapped group
 * into a single string before running the URL regex, so multi-line URLs are
 * detected as one clickable link.
 *
 * This provider handles BOTH single-line and multi-line URLs. It fully
 * replaces the built-in UrlRegexProvider (which is removed from the
 * LinkDetector's providers list in TerminalView.tsx).
 */

import type { Terminal } from "ghostty-web";

// Re-declare the minimal interfaces we need from ghostty-web's internal types.
// These match the ILink / ILinkProvider / IBufferCellPosition shapes.
interface LinkRange {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

interface Link {
  text: string;
  range: LinkRange;
  activate(event: MouseEvent): void;
  hover?(isHovered: boolean): void;
  dispose?(): void;
}

interface LinkProvider {
  provideLinks(y: number, callback: (links: Link[] | undefined) => void): void;
  dispose?(): void;
}

/**
 * URL regex supporting common protocols.
 * Must match the start somewhere in the concatenated text.
 */
const URL_REGEX =
  /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

/**
 * Trailing punctuation to strip from detected URLs (unlikely to be part of the URL).
 */
const TRAILING_CHARS = /[.,;:!?)>\]'"}]+$/;

/**
 * Read a single line from the terminal buffer as plain text.
 * Returns empty string if line doesn't exist.
 */
function getLineText(terminal: Terminal, y: number): string {
  const buf = terminal.buffer?.active;
  if (!buf) return "";
  const line = buf.getLine(y);
  if (!line) return "";
  return line.translateToString(true); // trim trailing whitespace
}

/**
 * Check if a line in the terminal buffer is a soft-wrapped continuation.
 */
function isLineWrapped(terminal: Terminal, y: number): boolean {
  const buf = terminal.buffer?.active;
  if (!buf) return false;
  const line = buf.getLine(y);
  return line?.isWrapped ?? false;
}

export class UrlLinkProvider implements LinkProvider {
  constructor(private readonly terminal: Terminal) {}

  provideLinks(y: number, callback: (links: Link[] | undefined) => void): void {
    const terminal = this.terminal;
    const buf = terminal.buffer?.active;
    if (!buf) {
      callback(undefined);
      return;
    }

    // Find the first line of this wrapped group (walk upward while isWrapped)
    let startY = y;
    while (startY > 0 && isLineWrapped(terminal, startY)) {
      startY--;
    }

    // Find the last line of this wrapped group (walk downward while next line isWrapped)
    let endY = startY;
    const maxY = buf.length - 1;
    while (endY < maxY && isLineWrapped(terminal, endY + 1)) {
      endY++;
    }

    // Join all lines in the wrapped group into one string, tracking line boundaries
    const lineBoundaries: { y: number; startOffset: number; length: number }[] = [];
    let joined = "";

    for (let row = startY; row <= endY; row++) {
      const text = getLineText(terminal, row);
      lineBoundaries.push({
        y: row,
        startOffset: joined.length,
        length: text.length,
      });
      joined += text;
    }

    // Find all URLs in the joined text
    URL_REGEX.lastIndex = 0;
    const links: Link[] = [];

    let match: RegExpExecArray | null;
    while ((match = URL_REGEX.exec(joined)) !== null) {
      let url = match[0];
      // Strip trailing punctuation
      url = url.replace(TRAILING_CHARS, "");

      if (url.length < 10) continue; // skip very short "URLs"

      const urlStart = match.index;
      const urlEnd = urlStart + url.length;

      // Map character offsets back to buffer coordinates
      let startPos: { x: number; y: number } | null = null;
      let endPos: { x: number; y: number } | null = null;

      for (const boundary of lineBoundaries) {
        const lineEnd = boundary.startOffset + boundary.length;

        // Find the line containing urlStart
        if (
          !startPos &&
          urlStart >= boundary.startOffset &&
          urlStart < lineEnd
        ) {
          startPos = {
            x: urlStart - boundary.startOffset + 1, // 1-based
            y: boundary.y,
          };
        }

        // Find the line containing urlEnd
        if (
          urlEnd > boundary.startOffset &&
          urlEnd <= lineEnd
        ) {
          endPos = {
            x: urlEnd - boundary.startOffset, // 1-based, inclusive
            y: boundary.y,
          };
        }
      }

      // If urlEnd is exactly at or past the last character, cap to last line
      if (!endPos && lineBoundaries.length > 0) {
        const last = lineBoundaries[lineBoundaries.length - 1]!;
        endPos = {
          x: last.length,
          y: last.y,
        };
      }

      if (!startPos || !endPos) continue;

      // Only include if the URL actually spans the requested row y
      // (so we don't return duplicates for rows not in the group)
      if (y < startPos.y || y > endPos.y) continue;

      const fullUrl = url;
      links.push({
        text: fullUrl,
        range: { start: startPos, end: endPos },
        activate: () => {
          window.open(fullUrl, "_blank", "noopener,noreferrer");
        },
      });
    }

    callback(links.length > 0 ? links : undefined);
  }

  dispose(): void {
    // No resources to clean up
  }
}

// Keep the old name as an alias for backward-compat imports
export { UrlLinkProvider as WrappedUrlLinkProvider };
