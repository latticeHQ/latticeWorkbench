/**
 * Reflexion Service — Episodic memory for autonomous agents.
 *
 * When the circuit breaker fires, the agent writes a structured reflection
 * ("why I'm stuck"). Reflections are persisted as JSONL in the minion's
 * session directory and re-injected on subsequent streams so the agent
 * learns from its own mistakes.
 *
 * Inspired by Reflexion (Shinn et al., NeurIPS 2023).
 */

import { promises as fsPromises } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReflectionTrigger = "soft_limit" | "revert" | "manual";

export interface Reflection {
  id: string;
  timestamp: number;
  trigger: ReflectionTrigger;
  phase: string | undefined;
  turnCount: number;
  content: string;
  resolved: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFLECTIONS_FILENAME = "reflections.jsonl";

/** Max total characters across all unresolved reflections in the injection block. */
const MAX_REFLECTION_BLOCK_CHARS = 2000;

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function reflectionsPath(sessionDir: string): string {
  return path.join(sessionDir, REFLECTIONS_FILENAME);
}

/**
 * Read all reflections from the JSONL file.
 * Returns an empty array if the file doesn't exist or is empty.
 */
export async function loadReflections(sessionDir: string): Promise<Reflection[]> {
  try {
    const raw = await fsPromises.readFile(reflectionsPath(sessionDir), "utf-8");
    if (!raw.trim()) return [];
    return raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Reflection);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Append a new reflection to the JSONL file.
 * Creates the file (and parent dirs) if it doesn't exist.
 */
export async function storeReflection(
  sessionDir: string,
  reflection: Reflection,
): Promise<void> {
  await fsPromises.mkdir(sessionDir, { recursive: true });
  await fsPromises.appendFile(
    reflectionsPath(sessionDir),
    JSON.stringify(reflection) + "\n",
    "utf-8",
  );
}

/**
 * Toggle the `resolved` flag for a specific reflection.
 * Rewrites the entire file — acceptable since reflections are few (<20 per session).
 */
export async function markResolved(
  sessionDir: string,
  reflectionId: string,
  resolved: boolean,
): Promise<void> {
  const reflections = await loadReflections(sessionDir);
  const updated = reflections.map((r) =>
    r.id === reflectionId ? { ...r, resolved } : r,
  );
  await fsPromises.writeFile(
    reflectionsPath(sessionDir),
    updated.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf-8",
  );
}

/**
 * Delete all reflections for a minion.
 */
export async function clearReflections(sessionDir: string): Promise<void> {
  try {
    await fsPromises.unlink(reflectionsPath(sessionDir));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// ---------------------------------------------------------------------------
// Reflection Parsing
// ---------------------------------------------------------------------------

/**
 * Extract reflection content from an agent response.
 * Looks for `<reflection>...</reflection>` XML tags.
 * Returns null if the agent didn't produce a reflection.
 */
export function parseReflectionFromResponse(text: string): string | null {
  const match = /<reflection>([\s\S]*?)<\/reflection>/.exec(text);
  if (!match) return null;
  const content = match[1].trim();
  return content.length > 0 ? content : null;
}

// ---------------------------------------------------------------------------
// System Prompt Injection
// ---------------------------------------------------------------------------

/**
 * Build a context block from unresolved reflections for injection
 * into the system prompt. Returns undefined if there are no unresolved
 * reflections.
 *
 * Caps total content at MAX_REFLECTION_BLOCK_CHARS to avoid
 * consuming too much context window.
 */
export function buildReflectionBlock(
  reflections: Reflection[],
): string | undefined {
  const unresolved = reflections.filter((r) => !r.resolved);
  if (unresolved.length === 0) return undefined;

  const header = [
    "=== EPISODIC MEMORY (past reflections — learn from these) ===",
    "Do NOT repeat approaches that previously failed.",
    "",
  ];

  const footer = ["", "=== END EPISODIC MEMORY ==="];

  let totalChars = 0;
  const entries: string[] = [];

  for (let i = 0; i < unresolved.length; i++) {
    const r = unresolved[i];
    const phaseStr = r.phase ? `, ${r.phase} phase` : "";
    const entry = [
      `### Reflection ${i + 1} (turn ${r.turnCount}${phaseStr}, triggered by ${r.trigger})`,
      r.content,
    ].join("\n");

    if (totalChars + entry.length > MAX_REFLECTION_BLOCK_CHARS && entries.length > 0) {
      break; // Cap reached, keep what we have
    }
    entries.push(entry);
    totalChars += entry.length;
  }

  if (entries.length === 0) return undefined;

  return [...header, ...entries, ...footer].join("\n");
}
