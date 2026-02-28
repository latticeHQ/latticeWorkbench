/**
 * Markdown-to-PNG renderer using Playwright's headless Chromium.
 *
 * Renders markdown content as a styled HTML page in a headless browser,
 * then captures it as a PNG image buffer. Used by InboxService to send
 * long agent responses as images in chat channels — the way humans
 * naturally share heavy data.
 *
 * Uses Playwright instead of Electron's BrowserWindow because Playwright
 * runs its own headless Chromium instance with no constraints on which
 * process context calls it. Electron's BrowserWindow only works from the
 * main process and has timing/sandbox constraints that caused silent failures.
 */
import { log } from "@/node/services/log";

/** Maximum image width in pixels. */
const MAX_WIDTH = 800;

/** Abort if rendering takes longer than this (ms). */
const RENDER_TIMEOUT_MS = 15_000;

/**
 * Render markdown text to a PNG image buffer.
 *
 * Launches a headless Chromium page via Playwright, loads styled HTML with
 * the markdown content, takes a full-page screenshot, and closes the browser.
 *
 * Returns null if rendering fails (caller should fall back to text/file).
 */
export async function renderMarkdownToImage(markdown: string): Promise<Buffer | null> {
  // Wrap entire render in a timeout so a stuck browser never blocks the inbox
  // response pipeline indefinitely.
  const result = await Promise.race([
    doRender(markdown),
    new Promise<null>((resolve) =>
      setTimeout(() => {
        log.warn("[markdownRenderer] Render timed out");
        resolve(null);
      }, RENDER_TIMEOUT_MS),
    ),
  ]);

  return result;
}

/**
 * Actual rendering logic — separated so we can race it against a timeout.
 *
 * Uses Playwright's headless Chromium: setContent → fullPage screenshot → done.
 * No Electron main process constraints — works from any async context.
 */
async function doRender(markdown: string): Promise<Buffer | null> {
  let phase = "init";

  // Dynamic import — Playwright is a devDependency that may not be available
  // in all environments. Fail gracefully if not installed.
  let chromium: typeof import("playwright").chromium;
  try {
    phase = "import";
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch {
    log.warn("[markdownRenderer] Playwright not available — cannot render images");
    return null;
  }

  let browser: import("playwright").Browser | null = null;

  try {
    phase = "launch";
    log.debug("[markdownRenderer] Launching headless Chromium via Playwright");
    browser = await chromium.launch({ headless: true });

    phase = "create-page";
    const page = await browser.newPage({
      viewport: { width: MAX_WIDTH, height: 600 },
    });

    phase = "build-html";
    const html = buildHtmlPage(markdown);

    // setContent loads HTML directly — no data: URL encoding needed.
    // waitUntil: "load" ensures all resources are ready before screenshot.
    phase = "set-content";
    log.debug("[markdownRenderer] Loading HTML content");
    await page.setContent(html, { waitUntil: "load" });

    // Get the actual content height for full-page capture
    phase = "measure-height";
    const contentHeight = await page.evaluate(() => document.body.scrollHeight);
    log.debug("[markdownRenderer] Content height:", { contentHeight });

    // Cap height to prevent absurdly tall images
    const finalHeight = Math.min(contentHeight + 20, 4096);
    await page.setViewportSize({ width: MAX_WIDTH, height: finalHeight });

    // Capture the page as PNG — fullPage ensures we get everything
    phase = "screenshot";
    log.debug("[markdownRenderer] Taking screenshot");
    const pngBuffer = await page.screenshot({
      type: "png",
      fullPage: true,
    });

    if (pngBuffer.length === 0) {
      log.error("[markdownRenderer] Screenshot returned empty buffer");
      return null;
    }

    log.info("[markdownRenderer] Rendered markdown to PNG", {
      width: MAX_WIDTH,
      height: finalHeight,
      bytes: pngBuffer.length,
    });

    return Buffer.from(pngBuffer);
  } catch (err) {
    // Phase-based logging so we know exactly where rendering failed
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    log.error("[markdownRenderer] Failed at phase:", { phase, message: msg, stack });
    return null;
  } finally {
    // Always clean up the browser
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Build a self-contained HTML page from markdown text.
 * Converts basic markdown to HTML inline (no external dependencies).
 * Uses a clean, dark-themed style matching Lattice's UI aesthetic.
 */
function buildHtmlPage(markdown: string): string {
  const htmlBody = markdownToHtml(markdown);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #e0e0e0;
    background: #1a1a2e;
    padding: 24px;
    max-width: ${MAX_WIDTH}px;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #fff;
    margin: 16px 0 8px;
    font-weight: 600;
  }
  h1 { font-size: 20px; }
  h2 { font-size: 18px; }
  h3 { font-size: 16px; }
  p { margin: 8px 0; }
  strong { color: #fff; }
  code {
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-size: 13px;
    background: #16213e;
    padding: 2px 6px;
    border-radius: 4px;
    color: #a8d8ea;
  }
  pre {
    background: #16213e;
    padding: 12px 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid #2a2a4a;
  }
  pre code {
    background: none;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }
  th {
    background: #16213e;
    color: #a8d8ea;
    font-weight: 600;
    text-align: left;
    padding: 8px 12px;
    border: 1px solid #2a2a4a;
  }
  td {
    padding: 6px 12px;
    border: 1px solid #2a2a4a;
    color: #ccc;
  }
  tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
  ul, ol { padding-left: 24px; margin: 8px 0; }
  li { margin: 4px 0; }
  hr {
    border: none;
    border-top: 1px solid #2a2a4a;
    margin: 16px 0;
  }
  a { color: #a8d8ea; text-decoration: none; }
  blockquote {
    border-left: 3px solid #a8d8ea;
    padding-left: 12px;
    color: #999;
    margin: 8px 0;
  }
  .watermark {
    text-align: right;
    color: #555;
    font-size: 11px;
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #2a2a4a;
  }
</style>
</head>
<body>
${htmlBody}
<div class="watermark">Lattice Agent</div>
</body>
</html>`;
}

/**
 * Lightweight markdown-to-HTML converter.
 * Handles the subset the agent actually produces: tables, headers,
 * code blocks, bold, italic, lists, links, horizontal rules.
 * Not a full Markdown parser — just enough for agent output.
 */
function markdownToHtml(md: string): string {
  let html = md;

  // Escape HTML entities in the source (prevent XSS from agent output)
  // SECURITY AUDIT: Agent output is treated as untrusted — all content
  // is escaped before rendering in the headless browser.
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (``` ... ```) — must be processed before inline formatting
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_m, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`,
  );

  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Tables — convert pipe-delimited markdown tables to HTML tables
  html = convertMarkdownTablesToHtmlTables(html);

  // Headers (# to ######)
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Bold (**text**)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic (*text*) — avoid matching ** which is already handled
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // Horizontal rules
  html = html.replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "<hr>");

  // Unordered lists (- item)
  html = html.replace(
    /(?:^[-*]\s+.+$\n?)+/gm,
    (block) => {
      const items = block.trim().split("\n").map((line) =>
        `<li>${line.replace(/^[-*]\s+/, "")}</li>`,
      );
      return `<ul>${items.join("")}</ul>`;
    },
  );

  // Ordered lists (1. item)
  html = html.replace(
    /(?:^\d+\.\s+.+$\n?)+/gm,
    (block) => {
      const items = block.trim().split("\n").map((line) =>
        `<li>${line.replace(/^\d+\.\s+/, "")}</li>`,
      );
      return `<ol>${items.join("")}</ol>`;
    },
  );

  // Paragraphs — wrap loose text lines
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  // Don't wrap block elements in <p> tags
  html = html.replace(/<p>(<(?:h[1-6]|pre|table|ul|ol|hr|blockquote)[^>]*>)/g, "$1");
  html = html.replace(/(<\/(?:h[1-6]|pre|table|ul|ol|hr|blockquote)>)<\/p>/g, "$1");

  return html;
}

/**
 * Convert markdown tables to HTML <table> elements within a larger text.
 */
function convertMarkdownTablesToHtmlTables(text: string): string {
  return text.replace(
    /(?:^\|.*\|$\n?)+/gm,
    (tableBlock) => {
      const lines = tableBlock.trim().split("\n");
      if (lines.length < 2) return tableBlock;

      const headerLine = lines[0];
      // Filter separator rows
      const dataLines = lines.slice(1).filter(
        (line) => !line.match(/^\|[\s\-:|]+\|$/),
      );

      const parseCells = (line: string) =>
        line.split("|").map((c) => c.trim()).filter(Boolean);

      const headers = parseCells(headerLine);

      let tableHtml = "<table><thead><tr>";
      tableHtml += headers.map((h) => `<th>${h}</th>`).join("");
      tableHtml += "</tr></thead><tbody>";

      for (const dataLine of dataLines) {
        const cells = parseCells(dataLine);
        tableHtml += "<tr>";
        tableHtml += cells.map((c) => `<td>${c}</td>`).join("");
        tableHtml += "</tr>";
      }

      tableHtml += "</tbody></table>";
      return tableHtml;
    },
  );
}
