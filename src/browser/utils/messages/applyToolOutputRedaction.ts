/**
 * Strip UI-only tool output and large binary data before sending to providers.
 * Produces a cloned array safe for sending to providers without touching persisted history/UI.
 *
 * Key redactions:
 * - ui_only fields (ask_user_question answers, diffs, etc.)
 * - Browser tool screenshot base64 data (replaced with short text summary).
 *   Only the MOST RECENT screenshot is kept; older ones are stripped to
 *   prevent context window overflow from accumulated screenshots.
 */
import type { LatticeMessage } from "@/common/types/message";
import { stripToolOutputUiOnly } from "@/common/utils/tools/toolOutputUiOnly";

/**
 * Detect if a tool output is a browser tool result containing a screenshot.
 * Our browser tool returns: { success: true, content_type: "screenshot", content: "base64...", url, title }
 * Wrapped in Vercel AI SDK as: { type: "json", value: { ... } }
 */
function isBrowserScreenshotOutput(output: unknown): boolean {
  const val = unwrapValue(output);
  if (!val || typeof val !== "object") return false;
  const rec = val as Record<string, unknown>;
  return (
    rec.content_type === "screenshot" && typeof rec.content === "string" && rec.success === true
  );
}

/**
 * Replace the base64 screenshot content with a short text description.
 * Keeps url and title so the agent still knows what page it was on.
 */
function redactBrowserScreenshot(output: unknown): unknown {
  const isWrapped = isJsonWrapped(output);
  const val = unwrapValue(output);
  if (!val || typeof val !== "object") return output;

  const rec = val as Record<string, unknown>;
  const contentLen = typeof rec.content === "string" ? rec.content.length : 0;
  const redacted = {
    ...rec,
    content_type: "text",
    content: `[Screenshot redacted (${Math.round(contentLen / 1000)}KB) — page: ${String(rec.url ?? "unknown")} — title: ${String(rec.title ?? "unknown")}. Use screenshot action again if you need to see the current state.]`,
  };

  return isWrapped ? { type: "json", value: redacted } : redacted;
}

function isJsonWrapped(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as Record<string, unknown>).type === "json" &&
    "value" in (output as Record<string, unknown>)
  );
}

function unwrapValue(output: unknown): unknown {
  if (isJsonWrapped(output)) {
    return (output as { type: string; value: unknown }).value;
  }
  return output;
}

/**
 * Check if a tool output contains large base64 data (> 50KB) that should be stripped.
 * This catches browser screenshots and any other tool that returns large binary blobs.
 */
function hasLargeBase64Content(output: unknown): boolean {
  const val = unwrapValue(output);
  if (!val || typeof val !== "object") return false;
  const rec = val as Record<string, unknown>;
  // Check if `content` field is a large string that looks like base64
  if (typeof rec.content === "string" && rec.content.length > 50_000) {
    return true;
  }
  return false;
}

/**
 * Replace any large content field with a truncation notice.
 */
function redactLargeContent(output: unknown): unknown {
  const isWrapped = isJsonWrapped(output);
  const val = unwrapValue(output);
  if (!val || typeof val !== "object") return output;

  const rec = val as Record<string, unknown>;
  if (typeof rec.content !== "string" || rec.content.length <= 50_000) return output;

  const redacted = {
    ...rec,
    content: `[Content redacted (${Math.round(rec.content.length / 1000)}KB) to save context. Use the tool again for fresh data.]`,
  };

  return isWrapped ? { type: "json", value: redacted } : redacted;
}

export function applyToolOutputRedaction(messages: LatticeMessage[]): LatticeMessage[] {
  // First pass: find the index of the last browser screenshot in the message list
  // so we can keep that one and redact all earlier ones.
  let lastScreenshotMsgIdx = -1;
  let lastScreenshotPartIdx = -1;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j];
      if (part.type === "dynamic-tool" && part.state === "output-available") {
        if (isBrowserScreenshotOutput(part.output)) {
          lastScreenshotMsgIdx = i;
          lastScreenshotPartIdx = j;
          break;
        }
      }
    }
    if (lastScreenshotMsgIdx >= 0) break;
  }

  // Second pass: apply redactions
  return messages.map((msg, msgIdx) => {
    if (msg.role !== "assistant") return msg;

    const newParts = msg.parts.map((part, partIdx) => {
      if (part.type !== "dynamic-tool") return part;
      if (part.state !== "output-available") return part;

      let output = part.output;

      // Step 1: Strip ui_only fields (existing behavior)
      output = stripToolOutputUiOnly(output);

      // Step 2: Redact browser screenshots (keep only the most recent one)
      if (isBrowserScreenshotOutput(output)) {
        const isLatest = msgIdx === lastScreenshotMsgIdx && partIdx === lastScreenshotPartIdx;
        if (!isLatest) {
          output = redactBrowserScreenshot(output);
        }
      }

      // Step 3: Redact any remaining large content (safety net for any tool)
      if (hasLargeBase64Content(output)) {
        output = redactLargeContent(output);
      }

      return { ...part, output };
    });

    return { ...msg, parts: newParts } satisfies LatticeMessage;
  });
}
