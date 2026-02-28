/**
 * Channel-specific response formatters.
 *
 * Agent responses arrive as standard Markdown (tables, headers, bold, code blocks, etc.).
 * Each channel has its own formatting dialect — Telegram uses its own Markdown subset,
 * Discord uses its own variant, Slack uses mrkdwn, and IRC/Signal want plain text.
 *
 * This module transforms the agent's raw Markdown into the best-fit format for each
 * channel before the adapter sends it. InboxService calls `formatForChannel()` in the
 * autoDispatch flow between getting the agent response and routing it to the adapter.
 */
import type { InboxChannelId } from "@/common/types/inbox";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Responses longer than this (after formatting) are rendered as PNG images
 * with a short summary caption. Keeps chat readable — heavy data goes into
 * a rendered image, just like humans share long content visually.
 */
const LONG_RESPONSE_THRESHOLD = 1500;

// ── Public API ───────────────────────────────────────────────────────────────

/** Result of formatting — inline text or image for long responses. */
export interface FormattedResponse {
  /** How to deliver: inline text or image (rendered from markdown) */
  mode: "text" | "image";
  /** The formatted text (for "text" mode — sent as message body) */
  body: string;
  /** The raw markdown (for "image" mode — rendered to PNG by markdownRenderer) */
  rawMarkdown?: string;
  /** Short summary caption (for "image" mode) */
  caption?: string;
}

/**
 * Format an agent response for a specific channel.
 * Returns inline text for short responses, or flags for image rendering
 * if the response is too long for readable chat display.
 */
export function formatForChannel(channel: InboxChannelId, text: string): FormattedResponse {
  const formatter = CHANNEL_FORMATTERS[channel];
  const formatted = formatter(text);

  if (formatted.length > LONG_RESPONSE_THRESHOLD) {
    return {
      mode: "image",
      body: formatted,
      rawMarkdown: text,
      caption: buildSummaryCaption(formatted),
    };
  }

  return { mode: "text", body: formatted };
}

/**
 * Build a short caption summarizing a long response.
 * Extracts the first meaningful line and appends a line count hint.
 */
function buildSummaryCaption(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const lineCount = lines.length;

  // Find first meaningful line (skip blank/divider lines)
  const firstLine = lines.find((l) =>
    l.trim().length > 0 && !l.match(/^[—\-=]+$/)
  ) ?? "Response attached";

  // Truncate first line if too long
  const preview = firstLine.length > 120
    ? firstLine.slice(0, 117) + "..."
    : firstLine;

  return `${preview}\n\n(${lineCount} lines — see attached image)`;
}

// ── Per-channel formatters ───────────────────────────────────────────────────

/**
 * Telegram: supports a subset of Markdown.
 * - Headers → bold text (Telegram has no native headers)
 * - Tables → vertical card lists (tables are unreadable on mobile)
 * - Horizontal rules → simple divider line
 * - Code blocks preserved (```lang ... ```)
 * - Inline code preserved (`code`)
 * - Bold/italic preserved (**bold** / *italic*)
 * - Lists preserved (- item / 1. item)
 */
function formatTelegram(text: string): string {
  let result = text;

  // Convert markdown tables to vertical card lists.
  // Tables are unreadable on phone screens even in monospace —
  // restructure as "label: value" cards instead.
  result = convertTablesToCardList(result);

  // Convert ### Header → *Header* (bold — Telegram's closest equivalent)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert horizontal rules (---, ***, ___) to a simple divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "————————");

  // Strip HTML tags that might appear in agent output (Telegram rejects them)
  result = result.replace(/<\/?[^>]+>/g, "");

  // Collapse excessive blank lines (card list can produce many)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Discord: rich Markdown support, very close to standard.
 * - Headers work natively (# ## ###)
 * - Tables → code blocks (Discord doesn't render tables)
 * - Code blocks, bold, italic, lists all work as-is
 */
function formatDiscord(text: string): string {
  let result = text;

  // Discord doesn't support markdown tables — convert to code blocks
  result = convertTablesToPreformatted(result);

  // Discord has a 2000 char message limit — handled by adapter chunking,
  // but we trim excessive whitespace to maximize content per message
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Slack: uses "mrkdwn" — its own Markdown-like syntax.
 * - *bold* (single asterisk, not double)
 * - _italic_ (underscore)
 * - `code` and ```code blocks```
 * - No # headers — use *bold* for crew titles
 * - Tables → preformatted blocks
 * - Links: <url|text> instead of [text](url)
 */
function formatSlack(text: string): string {
  let result = text;

  // Tables → preformatted
  result = convertTablesToPreformatted(result);

  // Headers → bold (Slack has no header syntax)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // **bold** → *bold* (Slack uses single asterisk)
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // [text](url) → <url|text> (Slack link format)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Horizontal rules → divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "—————");

  return result.trim();
}

/**
 * IRC: plain text only — strip all formatting.
 * IRC clients have no standard rich text support.
 */
function formatIrc(text: string): string {
  return stripToPlainText(text);
}

/**
 * Signal: plain text — no rich formatting support.
 */
function formatSignal(text: string): string {
  return stripToPlainText(text);
}

/**
 * iMessage: supports some basic formatting but inconsistently across clients.
 * Keep it simple — light formatting only.
 */
function formatImessage(text: string): string {
  let result = text;

  // Tables → vertical card lists (mobile-first)
  result = convertTablesToCardList(result);

  // Strip headers to plain bold-ish text (iMessage has no header rendering)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // Horizontal rules → simple divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "————————");

  return result.trim();
}

/**
 * WhatsApp: supports a subset of formatting.
 * - *bold* (single asterisk)
 * - _italic_ (underscore)
 * - ~strikethrough~ (tilde)
 * - ```monospace``` (triple backtick for blocks)
 * - `code` (single backtick for inline)
 * - No headers, no tables, no links
 */
function formatWhatsapp(text: string): string {
  let result = text;

  // Tables → vertical card lists (mobile-first, same as Telegram)
  result = convertTablesToCardList(result);

  // Headers → bold (WhatsApp has no headers)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // **bold** → *bold* (WhatsApp uses single asterisk)
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // [text](url) → text (url) — WhatsApp auto-links URLs
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Horizontal rules → divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "————————");

  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Google Chat: supports a subset of Markdown.
 * - *bold* and _italic_ work
 * - `code` and ```code blocks``` work
 * - No headers, tables via code blocks
 * - Links: auto-detected or [text](url)
 */
function formatGooglechat(text: string): string {
  let result = text;

  // Tables → code blocks
  result = convertTablesToPreformatted(result);

  // Headers → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // **bold** → *bold*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Horizontal rules → divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "—————");

  return result.trim();
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Convert Markdown tables to vertical "card" lists — ideal for mobile chat.
 *
 * Transforms:
 *   | Title           | Branch        | ID         |
 *   | --------------- | ------------- | ---------- |
 *   | Chat with Lattice   | chat-with-lattice | lattice-chat   |
 *   | Inbox Agent     | __inbox__     | 2a466659ce |
 *
 * Into:
 *   ◆ Chat with Lattice
 *     Branch: chat-with-lattice
 *     ID: lattice-chat
 *
 *   ◆ Inbox Agent
 *     Branch: __inbox__
 *     ID: 2a466659ce
 *
 * The first column becomes the card title (after ◆), remaining columns
 * become "Header: Value" lines. Much more readable on phone screens
 * than pipe-delimited tables or monospace blocks.
 */
function convertTablesToCardList(text: string): string {
  return text.replace(
    /(?:^[|].*$\n?)+/gm,
    (tableBlock) => {
      const lines = tableBlock.trim().split("\n");

      // Parse header row
      const headerLine = lines[0];
      if (!headerLine) return tableBlock;
      const headers = parsePipeCells(headerLine);
      if (headers.length === 0) return tableBlock;

      // Filter out separator rows (| --- | --- |) and header
      const dataLines = lines.slice(1).filter(
        (line) => !line.match(/^\|[\s\-:|]+\|$/),
      );

      if (dataLines.length === 0) return tableBlock;

      // Build card list
      const cards: string[] = [];
      for (const dataLine of dataLines) {
        const cells = parsePipeCells(dataLine);
        if (cells.length === 0) continue;

        // First cell = card title, rest = key-value pairs
        const title = cells[0];
        const fields: string[] = [];
        for (let i = 1; i < headers.length && i < cells.length; i++) {
          if (cells[i]) {
            fields.push(`  ${headers[i]}: ${cells[i]}`);
          }
        }

        cards.push(`◆ ${title}${fields.length > 0 ? "\n" + fields.join("\n") : ""}`);
      }

      return cards.join("\n\n");
    },
  );
}

/** Parse pipe-delimited cells from a markdown table row. */
function parsePipeCells(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

/**
 * Convert Markdown tables to preformatted code blocks.
 * Better for desktop-oriented channels (Discord, Slack) where
 * monospace rendering is decent and screens are wider.
 */
function convertTablesToPreformatted(text: string): string {
  // Match a block of lines that start with | (a Markdown table)
  return text.replace(
    /(?:^[|].*$\n?)+/gm,
    (tableBlock) => {
      // Strip the separator row (| --- | --- |) for cleaner output
      const lines = tableBlock.trim().split("\n");
      const filtered = lines.filter((line) => !line.match(/^\|[\s\-:|]+\|$/));
      return "```\n" + filtered.join("\n") + "\n```";
    },
  );
}

/**
 * Strip all Markdown formatting to plain text.
 * Used for channels with no rich text support (IRC, Signal).
 */
function stripToPlainText(text: string): string {
  let result = text;

  // Tables → card lists first (before stripping other formatting)
  result = convertTablesToCardList(result);

  // Code blocks → preserve content, strip fences
  result = result.replace(/```\w*\n([\s\S]*?)```/g, "$1");

  // Inline code → preserve content
  result = result.replace(/`([^`]+)`/g, "$1");

  // Headers → plain text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // Bold/italic → plain text
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");

  // Links → "text (url)"
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  // Horizontal rules → divider
  result = result.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "--------");

  // HTML tags
  result = result.replace(/<\/?[^>]+>/g, "");

  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

// ── Formatter registry ───────────────────────────────────────────────────────

/**
 * Exhaustive map of channel → formatter function.
 * Using Record<InboxChannelId, ...> ensures compile-time errors if a new
 * channel is added without a corresponding formatter.
 */
const CHANNEL_FORMATTERS: Record<InboxChannelId, (text: string) => string> = {
  telegram: formatTelegram,
  whatsapp: formatWhatsapp,
  discord: formatDiscord,
  slack: formatSlack,
  irc: formatIrc,
  signal: formatSignal,
  imessage: formatImessage,
  googlechat: formatGooglechat,
};
