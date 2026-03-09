/**
 * Lattice SDK — Parallel AI web research tools (7 functions)
 *
 * Web research: search, extract page content, deep research reports,
 * entity discovery, web-grounded chat, batch processing, web change monitoring.
 *
 * These tools call the Parallel AI API (https://parallel.ai) and require
 * a PARALLEL_API_KEY secret configured in Settings → Integrations.
 *
 * Usage via PTC code_execution:
 *   const results = await lattice.parallel_search({ query: "TypeScript best practices" });
 *   const pages = await lattice.parallel_extract({ urls: ["https://example.com"] });
 *
 * Or via direct tool calls after discovery:
 *   1. lattice_search_tools({ query: "parallel" })   → find tools
 *   2. file_read this file                            → read typed signatures
 *   3. Use tool directly or via code_execution
 */

// ── Search ──────────────────────────────────────────────────────────

/**
 * Search the web using Parallel AI. Returns ranked results with URLs, titles, and excerpts.
 *
 * @example
 *   const r = await lattice.parallel_search({ query: "best React state management 2025" });
 *   // r.results = [{ url, title, excerpt }, ...]
 *
 * @param query    - Natural language search query
 * @param num_results - Number of results (default: 10, max: 20)
 * @returns { success: true, results: Array<{ url, title, excerpt }>, query, total } | { success: false, error }
 */
export interface ParallelSearchInput {
  query: string;
  num_results?: number | null;
}

// ── Extract ─────────────────────────────────────────────────────────

/**
 * Extract and parse the main content from one or more URLs.
 * Returns clean, structured text — ideal for reading articles, blog posts, documentation.
 *
 * @example
 *   const r = await lattice.parallel_extract({ urls: ["https://example.com/blog"] });
 *   // r.pages = [{ url, title, content }, ...]
 *
 * @param urls - Array of URLs to extract content from (1–5)
 * @returns { success: true, pages: Array<{ url, title, content }> } | { success: false, error }
 */
export interface ParallelExtractInput {
  urls: string[];
}

// ── Research ────────────────────────────────────────────────────────

/**
 * Run a deep research task using Parallel AI. Searches, reads, and synthesizes
 * information across many sources to produce a comprehensive report.
 * Takes 30–120 seconds depending on processor tier.
 *
 * @example
 *   const r = await lattice.parallel_research({
 *     query: "Compare Next.js vs Remix for enterprise apps",
 *     processor: "research",
 *   });
 *   // r.report = "..." (comprehensive markdown report)
 *   // r.citations = [{ title, url }, ...]
 *
 * @param query       - Research question or topic
 * @param processor   - Tier: "base" | "core" | "research" | "ultra" (default: "research")
 * @param output_schema - Optional description of desired JSON output structure
 * @returns { success: true, report, output_type, citations } | { success: false, error }
 */
export interface ParallelResearchInput {
  query: string;
  processor?: "base" | "core" | "research" | "ultra" | null;
  output_schema?: string | null;
}

// ── FindAll ─────────────────────────────────────────────────────────

/**
 * Discover entities matching a natural language objective at web scale.
 * Finds matching companies, people, products, or any entity type.
 * Returns validated candidates with names, URLs, and citations.
 * Takes 30s–5min depending on generator tier.
 *
 * @example
 *   const r = await lattice.parallel_findall({
 *     objective: "SaaS companies in fintech with >100 employees",
 *     generator: "base",
 *     match_limit: 20,
 *   });
 *   // r.candidates = [{ name, url, match_status, citations }, ...]
 *
 * @param objective   - Natural language description of what entities to find
 * @param generator   - Tier: "preview" | "base" | "core" | "pro" (default: "preview")
 * @param match_limit - Max number of matching entities (default: 10, range: 5–100)
 * @returns { success: true, objective, candidates, total } | { success: false, error }
 */
export interface ParallelFindAllInput {
  objective: string;
  generator?: "preview" | "base" | "core" | "pro" | null;
  match_limit?: number | null;
}

// ── Chat ────────────────────────────────────────────────────────────

/**
 * Ask a question with live web-grounded answers using Parallel AI Chat.
 * Returns an AI-generated answer backed by real-time web citations.
 *
 * @example
 *   const r = await lattice.parallel_chat({
 *     message: "What are the latest features in TypeScript 5.8?",
 *     model: "base",
 *   });
 *   // r.answer = "..." (grounded AI response)
 *   // r.citations = [{ title, url }, ...]
 *
 * @param message          - Question or prompt to answer
 * @param model            - Tier: "speed" (~3s) | "lite" (~30s) | "base" (~60s) | "core" (~3min)
 * @param response_format  - Optional JSON schema description for structured output
 * @returns { success: true, answer, model, citations } | { success: false, error }
 */
export interface ParallelChatInput {
  message: string;
  model?: "speed" | "lite" | "base" | "core" | null;
  response_format?: string | null;
}

// ── Batch ───────────────────────────────────────────────────────────

/**
 * Process multiple items in parallel using Parallel AI Task Groups.
 * Each item is independently researched and processed. Ideal for batch lookups,
 * data enrichment, or processing lists of queries. Takes 1–10 minutes.
 *
 * @example
 *   const r = await lattice.parallel_batch({
 *     items: ["Apple Inc", "Google LLC", "Microsoft Corp"],
 *     processor: "base",
 *     output_schema: "{ founded: number, ceo: string, revenue: string }",
 *   });
 *   // r.results = [{ item, result, sources }, ...]
 *
 * @param items         - Array of items/queries to process (1–50)
 * @param processor     - Tier: "base" | "core" | "research" (default: "base")
 * @param output_schema - Optional description of desired JSON output format per item
 * @returns { success: true, results, total } | { success: false, error }
 */
export interface ParallelBatchInput {
  items: string[];
  processor?: "base" | "core" | "research" | null;
  output_schema?: string | null;
}

// ── Monitor ─────────────────────────────────────────────────────────

/**
 * Create and manage web change monitors using Parallel AI Monitor (alpha).
 * Monitors continuously track the web for changes relevant to a query.
 *
 * @example
 *   // Create a monitor
 *   const r = await lattice.parallel_monitor({
 *     action: "create",
 *     query: "new TypeScript releases",
 *     frequency: "1d",
 *   });
 *   // r.monitor_id = "mon_..."
 *
 *   // Check for events
 *   const events = await lattice.parallel_monitor({
 *     action: "check",
 *     monitor_id: "mon_...",
 *   });
 *
 *   // List all monitors
 *   const list = await lattice.parallel_monitor({ action: "list" });
 *
 *   // Delete a monitor
 *   await lattice.parallel_monitor({ action: "delete", monitor_id: "mon_..." });
 *
 * @param action     - "create" | "check" | "list" | "delete"
 * @param query      - Search query (required for "create")
 * @param frequency  - Check interval: "1h" | "1d" | "1w" (default: "1d", used with "create")
 * @param monitor_id - Monitor ID (required for "check" and "delete")
 * @returns Depends on action — see individual action docs above
 */
export interface ParallelMonitorInput {
  action: "create" | "check" | "list" | "delete";
  query?: string | null;
  frequency?: "1h" | "1d" | "1w" | null;
  monitor_id?: string | null;
}
