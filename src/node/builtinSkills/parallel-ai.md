---
name: parallel-ai
description: Web research tools via Parallel AI — search, extract, research, discover entities, chat, batch, and monitor web changes.
---

# Parallel AI — Web Research Tools

7 tools for web research powered by [Parallel AI](https://parallel.ai). Requires `PARALLEL_API_KEY` in Settings → Integrations.

## Discovery Workflow

```
lattice_search_tools({ query: "parallel" })         → 7 tool summaries
file_read("src/mcp-server/sdk/parallel-ai.ts")      → full typed signatures
code_execution: lattice.parallel_search({ ... })     → execute via PTC sandbox
```

## Tools

| Tool | Description |
|------|-------------|
| `parallel_search` | Search the web — ranked results with URLs, titles, excerpts |
| `parallel_extract` | Extract clean text content from 1–5 URLs |
| `parallel_research` | Deep multi-source research report (30s–2min) |
| `parallel_findall` | Discover entities at web scale with citations |
| `parallel_chat` | Web-grounded Q&A with live citations |
| `parallel_batch` | Process up to 50 items in parallel |
| `parallel_monitor` | Create/check/list/delete web change monitors |

## Code Execution Examples

### Search + Extract workflow (context-efficient)
```js
// Search, then extract top results — intermediate data stays in sandbox
const search = await lattice.parallel_search({ query: "Rust async patterns 2025" });
const topUrls = search.results.slice(0, 3).map(r => r.url);
const pages = await lattice.parallel_extract({ urls: topUrls });
// Only return the extracted content, not the full search results
return pages.pages.map(p => ({ title: p.title, content: p.content.slice(0, 2000) }));
```

### Deep research with structured output
```js
const report = await lattice.parallel_research({
  query: "Compare Next.js vs Remix for enterprise applications",
  processor: "research",
  output_schema: "{ winner: string, pros: string[], cons: string[], recommendation: string }",
});
return { report: report.report, citations: report.citations };
```

### Entity discovery
```js
const companies = await lattice.parallel_findall({
  objective: "SaaS companies in developer tools with Series A+ funding",
  generator: "base",
  match_limit: 25,
});
return companies.candidates;
```

### Batch enrichment
```js
const enriched = await lattice.parallel_batch({
  items: ["Stripe", "Vercel", "Supabase", "PlanetScale"],
  processor: "base",
  output_schema: "{ founded: number, headquarters: string, employees: string, funding: string }",
});
return enriched.results;
```

### Web change monitoring
```js
// Create a monitor
const monitor = await lattice.parallel_monitor({
  action: "create",
  query: "new TypeScript releases",
  frequency: "1d",
});
return monitor;
```

## Notes

- All tools return `{ success: true, ... }` or `{ success: false, error: string }`
- Output is truncated to 512KB per tool call
- Research and batch operations take 30s–10min depending on tier
- Use `code_execution` for multi-step workflows to keep intermediate results in the sandbox
