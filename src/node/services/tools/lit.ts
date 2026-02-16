/**
 * lit — Lattice Intelligence Tracker
 *
 * Git for intelligence. Records decisions, outcomes, and learnings as immutable,
 * searchable objects in an append-only JSONL graph.
 *
 * Actions:
 *   commit — record a decision with full context, outcome, and learning
 *   search — find relevant past decisions using BM25 scoring + temporal decay
 *   log    — view decision history with optional filters
 *
 * Storage:
 *   ~/.lattice/lit/decisions.jsonl  (append-only)
 *
 * Every decision is content-addressed (SHA-256 of task+learning+timestamp).
 * Temporal decay: score × 0.5^(age_days / HALF_LIFE_DAYS). Default half-life: 90 days.
 */

import * as path from "path";
import * as fsPromises from "fs/promises";
import * as crypto from "crypto";
import { tool } from "ai";

import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { log as logger } from "@/node/services/log";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HALF_LIFE_DAYS = 90;
const DEFAULT_LIMIT = 10;
const LIT_DIR = "lit";
const DECISIONS_FILE = "decisions.jsonl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Decision {
  id: string;
  timestamp: string;
  task: string;
  learning: string;
  outcome: "success" | "partial" | "failed" | "blocked" | "observation";
  confidence: number;
  domain?: string;
  context?: string;
  action_taken?: string;
  reasoning?: string;
  tags?: string[];
  artifacts?: string[];
  duration_ms?: number;
  agent?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLatticeHome(config: ToolConfiguration): string {
  if (!config.workspaceSessionDir) {
    throw new Error("lit requires workspaceSessionDir to resolve lattice home");
  }
  // workspaceSessionDir = <latticeHome>/sessions/<workspaceId>
  const sessionsDir = path.dirname(config.workspaceSessionDir);
  return path.dirname(sessionsDir);
}

function decisionsPath(latticeHome: string): string {
  return path.join(latticeHome, LIT_DIR, DECISIONS_FILE);
}

/** Content-addressed ID: SHA-256 of task+learning+timestamp. */
function hashDecision(task: string, learning: string, timestamp: string): string {
  return crypto.createHash("sha256").update(`${task}\n${learning}\n${timestamp}`).digest("hex");
}

/**
 * Read all decisions from the JSONL file.
 * Tolerates malformed lines (skips with warning).
 */
async function readDecisions(filePath: string): Promise<Decision[]> {
  let raw: string;
  try {
    raw = await fsPromises.readFile(filePath, "utf-8");
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // no decisions yet
    }
    throw e;
  }

  const decisions: Decision[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      decisions.push(JSON.parse(trimmed) as Decision);
    } catch {
      logger.warn("[lit] Skipping malformed JSONL line", { line: trimmed.slice(0, 120) });
    }
  }
  return decisions;
}

/** Append a single decision to the JSONL file (atomic line). */
async function appendDecision(filePath: string, decision: Decision): Promise<void> {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.appendFile(filePath, JSON.stringify(decision) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// BM25-lite search engine
// ---------------------------------------------------------------------------

/** Tokenize a string into lowercase words, stripping punctuation. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Build a searchable text blob from a decision. */
function decisionToText(d: Decision): string {
  return [d.task, d.learning, d.context, d.action_taken, d.reasoning, d.domain, ...(d.tags ?? [])]
    .filter(Boolean)
    .join(" ");
}

/**
 * BM25-lite scoring.
 * Simplified: TF × IDF, no document length normalization (not needed for short docs).
 */
function bm25Score(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
  let score = 0;
  const docFreqs = new Map<string, number>();
  for (const t of docTokens) {
    docFreqs.set(t, (docFreqs.get(t) ?? 0) + 1);
  }
  for (const qt of queryTokens) {
    const tf = docFreqs.get(qt) ?? 0;
    if (tf === 0) continue;
    const idfVal = idf.get(qt) ?? 1;
    // BM25 simplified: TF / (TF + 1) × IDF
    score += (tf / (tf + 1)) * idfVal;
  }
  return score;
}

/** Temporal decay: score × 0.5^(age_days / halfLife). */
function applyTemporalDecay(score: number, timestamp: string, now: number): number {
  const age = now - new Date(timestamp).getTime();
  const ageDays = Math.max(0, age / (1000 * 60 * 60 * 24));
  return score * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

interface SearchResult {
  decision: Decision;
  score: number;
}

function searchDecisions(
  decisions: Decision[],
  query: string,
  filters: {
    domain?: string;
    tags?: string[];
    agent?: string;
    since?: string;
  },
  limit: number,
  now: number
): SearchResult[] {
  // Apply filters first
  let filtered = decisions;

  if (filters.domain) {
    const d = filters.domain.toLowerCase();
    filtered = filtered.filter((dec) => dec.domain?.toLowerCase() === d);
  }
  if (filters.tags && filters.tags.length > 0) {
    const tagSet = new Set(filters.tags.map((t) => t.toLowerCase()));
    filtered = filtered.filter(
      (dec) => dec.tags?.some((t) => tagSet.has(t.toLowerCase())) ?? false
    );
  }
  if (filters.agent) {
    const a = filters.agent.toLowerCase();
    filtered = filtered.filter((dec) => dec.agent?.toLowerCase() === a);
  }
  if (filters.since) {
    const sinceMs = parseSince(filters.since);
    filtered = filtered.filter((dec) => new Date(dec.timestamp).getTime() >= sinceMs);
  }

  if (filtered.length === 0) return [];

  // Build IDF from corpus
  const N = filtered.length;
  const docFreq = new Map<string, number>();
  const docTokensList: string[][] = [];

  for (const dec of filtered) {
    const tokens = tokenize(decisionToText(dec));
    docTokensList.push(tokens);
    const seen = new Set<string>();
    for (const t of tokens) {
      if (!seen.has(t)) {
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
        seen.add(t);
      }
    }
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  // Score each decision
  const queryTokens = tokenize(query);
  const results: SearchResult[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const dec = filtered[i];
    let score = bm25Score(queryTokens, docTokensList[i], idf);

    // Boost by confidence
    score *= 0.5 + 0.5 * (dec.confidence ?? 0.5);

    // Apply temporal decay
    score = applyTemporalDecay(score, dec.timestamp, now);

    if (score > 0) {
      results.push({ decision: dec, score });
    }
  }

  // Sort by score descending, take top N
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/** Parse "since" param: ISO 8601 or relative ("7d", "30d", "90d"). */
function parseSince(since: string): number {
  const relativeMatch = since.match(/^(\d+)d$/);
  if (relativeMatch) {
    const days = parseInt(relativeMatch[1], 10);
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }
  const ts = new Date(since).getTime();
  if (isNaN(ts)) {
    throw new Error(`Invalid 'since' value: "${since}". Use ISO 8601 or relative like "7d", "30d".`);
  }
  return ts;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const createLitTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.lit.description,
    inputSchema: TOOL_DEFINITIONS.lit.schema,

    execute: async (args): Promise<unknown> => {
      const { action } = args;

      // =====================================================================
      // ACTION: commit
      // =====================================================================
      if (action === "commit") {
        const { task, learning, outcome, confidence } = args;

        if (!task || !learning) {
          return {
            success: false,
            error: "commit requires 'task' and 'learning' fields.",
          };
        }
        if (outcome === undefined) {
          return {
            success: false,
            error: "commit requires 'outcome' field (success|partial|failed|blocked|observation).",
          };
        }

        const latticeHome = getLatticeHome(config);
        const filePath = decisionsPath(latticeHome);
        const timestamp = new Date().toISOString();

        const decision: Decision = {
          id: hashDecision(task, learning, timestamp),
          timestamp,
          task,
          learning,
          outcome,
          confidence: confidence ?? 0.7,
          ...(args.domain ? { domain: args.domain } : {}),
          ...(args.context ? { context: args.context } : {}),
          ...(args.action_taken ? { action_taken: args.action_taken } : {}),
          ...(args.reasoning ? { reasoning: args.reasoning } : {}),
          ...(args.tags && args.tags.length > 0 ? { tags: args.tags } : {}),
          ...(args.artifacts && args.artifacts.length > 0 ? { artifacts: args.artifacts } : {}),
          ...(args.duration_ms ? { duration_ms: args.duration_ms } : {}),
          ...(args.agent ? { agent: args.agent } : {}),
        };

        try {
          await appendDecision(filePath, decision);
        } catch (e) {
          return {
            success: false,
            error: `Failed to commit decision: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        return {
          success: true,
          id: decision.id,
          timestamp: decision.timestamp,
          summary: `Committed: "${learning.slice(0, 100)}${learning.length > 100 ? "..." : ""}"`,
          hint: "This learning is now in the intelligence graph. Future lit search calls will find it.",
        };
      }

      // =====================================================================
      // ACTION: search
      // =====================================================================
      if (action === "search") {
        const { query } = args;

        if (!query) {
          return {
            success: false,
            error: "search requires 'query' field.",
          };
        }

        const latticeHome = getLatticeHome(config);
        const filePath = decisionsPath(latticeHome);

        let decisions: Decision[];
        try {
          decisions = await readDecisions(filePath);
        } catch (e) {
          return {
            success: false,
            error: `Failed to read intelligence graph: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        if (decisions.length === 0) {
          return {
            success: true,
            results: [],
            total_decisions: 0,
            hint: "Intelligence graph is empty. After completing tasks, use lit({action:\"commit\",...}) to start building knowledge.",
          };
        }

        const results = searchDecisions(
          decisions,
          query,
          {
            domain: args.domain,
            tags: args.tags,
            agent: args.agent,
            since: args.since,
          },
          args.limit ?? DEFAULT_LIMIT,
          Date.now()
        );

        return {
          success: true,
          results: results.map((r) => ({
            id: r.decision.id,
            score: Math.round(r.score * 1000) / 1000,
            task: r.decision.task,
            learning: r.decision.learning,
            outcome: r.decision.outcome,
            confidence: r.decision.confidence,
            domain: r.decision.domain,
            agent: r.decision.agent,
            tags: r.decision.tags,
            timestamp: r.decision.timestamp,
            context: r.decision.context,
            action_taken: r.decision.action_taken,
            reasoning: r.decision.reasoning,
          })),
          total_decisions: decisions.length,
          hint:
            results.length === 0
              ? `No matches for "${query}". Try broader terms or remove domain/tag filters.`
              : `Found ${results.length} relevant decision(s) from ${decisions.length} total. Use these learnings to inform your approach.`,
        };
      }

      // =====================================================================
      // ACTION: log
      // =====================================================================
      if (action === "log") {
        const latticeHome = getLatticeHome(config);
        const filePath = decisionsPath(latticeHome);

        let decisions: Decision[];
        try {
          decisions = await readDecisions(filePath);
        } catch (e) {
          return {
            success: false,
            error: `Failed to read intelligence graph: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        // Apply filters
        let filtered = decisions;

        if (args.domain) {
          const d = args.domain.toLowerCase();
          filtered = filtered.filter((dec) => dec.domain?.toLowerCase() === d);
        }
        if (args.tags && args.tags.length > 0) {
          const tagSet = new Set(args.tags.map((t: string) => t.toLowerCase()));
          filtered = filtered.filter(
            (dec) => dec.tags?.some((t) => tagSet.has(t.toLowerCase())) ?? false
          );
        }
        if (args.agent) {
          const a = args.agent.toLowerCase();
          filtered = filtered.filter((dec) => dec.agent?.toLowerCase() === a);
        }
        if (args.since) {
          try {
            const sinceMs = parseSince(args.since);
            filtered = filtered.filter((dec) => new Date(dec.timestamp).getTime() >= sinceMs);
          } catch (e) {
            return {
              success: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }

        // Most recent first
        filtered.reverse();

        const limit = args.limit ?? DEFAULT_LIMIT;
        const truncated = filtered.length > limit;
        const shown = filtered.slice(0, limit);

        // Compute summary stats
        const outcomes = { success: 0, partial: 0, failed: 0, blocked: 0, observation: 0 };
        for (const d of filtered) {
          if (d.outcome in outcomes) {
            outcomes[d.outcome as keyof typeof outcomes]++;
          }
        }

        const domains = new Set(filtered.map((d) => d.domain).filter(Boolean));
        const agents = new Set(filtered.map((d) => d.agent).filter(Boolean));

        return {
          success: true,
          decisions: shown.map((d) => ({
            id: d.id,
            timestamp: d.timestamp,
            task: d.task,
            learning: d.learning,
            outcome: d.outcome,
            confidence: d.confidence,
            domain: d.domain,
            agent: d.agent,
            tags: d.tags,
          })),
          total: filtered.length,
          shown: shown.length,
          truncated,
          stats: {
            outcomes,
            domains: [...domains],
            agents: [...agents],
          },
          hint:
            filtered.length === 0
              ? "No decisions match the filters. Broaden your query or remove filters."
              : `Showing ${shown.length} of ${filtered.length} decisions. ` +
                `Success rate: ${Math.round((outcomes.success / filtered.length) * 100)}%.`,
        };
      }

      return { success: false, error: `Unknown action: ${String(action)}` };
    },
  });
};
