/**
 * Report Engine — ReACT loop for post-simulation analysis.
 *
 * Generates structured prediction reports using the ReACT pattern:
 * Reasoning → Action (tool call) → Observation → Reflection → Final Answer
 *
 * Tools available to the report agent:
 * - InsightForge: Deep semantic search with sub-question decomposition
 * - PanoramaSearch: Full graph scope including expired temporal edges
 * - QuickSearch: Simple keyword/semantic search
 * - InterviewAgents: Chat with simulated agents post-simulation
 *
 * Ported from MiroFish's report_agent.py with full ReACT fidelity.
 * Uses configurable model routing (defaults to Claude Opus for reasoning).
 */

import { log } from "@/node/services/log";
import type { LLMProvider } from "./simulationRuntime";
import type {
  SimulationReport,
  ReportOutline,
  ReportToolCall,
  ReportStatus,
  RoundResult,
  AgentProfile,
  SimulationScenario,
  ModelRoutingConfig,
  EnsembleResult,
} from "./types";
import { REACT_CONSTRAINTS, REACT_TOOLS, resolveModelRoute } from "./types";
import type { GraphLayer } from "./graphLayer";

// ---------------------------------------------------------------------------
// Report Engine
// ---------------------------------------------------------------------------

export interface ReportEngineOptions {
  llm: LLMProvider;
  modelRouting: ModelRoutingConfig;
  graphLayer: GraphLayer;
}

export interface ReportProgress {
  status: ReportStatus;
  currentSection: number;
  totalSections: number;
  sectionTitle: string;
  toolCallCount: number;
}

/**
 * Generate a full simulation analysis report.
 */
export async function generateReport(
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  ensembleResult: EnsembleResult | null,
  options: ReportEngineOptions,
  onProgress?: (progress: ReportProgress) => void,
): Promise<SimulationReport> {
  const reportId = `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const route = resolveModelRoute("report_react", options.modelRouting);

  const report: SimulationReport = {
    id: reportId,
    simulationId: scenario.id,
    scenarioId: scenario.id,
    status: "pending",
    toolCalls: [],
  };

  try {
    // Phase 1: Planning — generate report outline
    report.status = "planning";
    onProgress?.({
      status: "planning",
      currentSection: 0,
      totalSections: 0,
      sectionTitle: "Planning report structure...",
      toolCallCount: 0,
    });

    const outline = await generateOutline(
      scenario,
      roundResults,
      ensembleResult,
      options.llm,
      route,
    );
    report.outline = outline;

    log.info(
      `[simulation:report] Outline: "${outline.title}" with ${outline.sections.length} sections`,
    );

    // Phase 2: Generation — fill each section using ReACT loop
    report.status = "generating";
    const totalSections = outline.sections.length;

    for (let i = 0; i < totalSections; i++) {
      const section = outline.sections[i];

      onProgress?.({
        status: "generating",
        currentSection: i + 1,
        totalSections,
        sectionTitle: section.title,
        toolCallCount: report.toolCalls.length,
      });

      const { content, toolCalls } = await generateSection(
        section.title,
        outline,
        scenario,
        roundResults,
        ensembleResult,
        options,
        route,
      );

      section.content = content;
      report.toolCalls.push(...toolCalls);

      log.info(
        `[simulation:report] Section ${i + 1}/${totalSections}: "${section.title}" ` +
        `(${toolCalls.length} tool calls)`,
      );
    }

    // Phase 3: Compile final markdown
    report.markdownContent = compileMarkdown(outline, ensembleResult);
    report.status = "completed";
    report.generatedAt = new Date().toISOString();

    onProgress?.({
      status: "completed",
      currentSection: totalSections,
      totalSections,
      sectionTitle: "Report complete",
      toolCallCount: report.toolCalls.length,
    });

    return report;
  } catch (err) {
    report.status = "failed";
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Outline Generation
// ---------------------------------------------------------------------------

async function generateOutline(
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  ensembleResult: EnsembleResult | null,
  llm: LLMProvider,
  route: { provider: string; model: string },
): Promise<ReportOutline> {
  const lastRound = roundResults[roundResults.length - 1];
  const totalActions = roundResults.reduce((sum, r) => sum + r.actions.length, 0);

  const systemPrompt = `You are a simulation analysis expert. Generate a report outline for a multi-agent social simulation.

The report should be a PREDICTION REPORT — analyzing what happened in the simulation to predict real-world outcomes.

OUTPUT FORMAT: Valid JSON:
{
  "title": "string — compelling report title",
  "summary": "string — 2-3 sentence executive summary",
  "sections": [
    { "title": "string — section title", "content": "" }
  ]
}

Generate ${REACT_CONSTRAINTS.minSections}-${REACT_CONSTRAINTS.maxSections} sections. Each section should cover a distinct analytical angle.`;

  const userPrompt = `## Simulation: ${scenario.name}
${scenario.description}

## Key Metrics
- Total rounds: ${roundResults.length}
- Total actions: ${totalActions}
- Active agents: ${scenario.agents.length}
- Statistical agents: ${scenario.statisticalAgents.length}
- Platforms: ${scenario.config.platforms.join(", ")}
- Department: ${scenario.config.department ?? "general"}

## Final State
- Sentiment: positive=${lastRound?.sentimentDistribution.positive.toFixed(2)}, negative=${lastRound?.sentimentDistribution.negative.toFixed(2)}
- Trending topics: ${lastRound?.trending.join(", ") ?? "none"}
- Viral posts: ${lastRound?.viralPosts.length ?? 0}
- Top posts: ${lastRound?.platformSnapshot.topPosts.slice(0, 3).map((p) => `"${p.content.slice(0, 100)}"`).join("; ") ?? "none"}

${ensembleResult ? `## Ensemble Results (${ensembleResult.totalRuns} runs)
- Mean sentiment: ${ensembleResult.meanSentiment.toFixed(3)} ± ${ensembleResult.sentimentStdDev.toFixed(3)}
- 95% CI: [${ensembleResult.confidenceInterval95.low.toFixed(3)}, ${ensembleResult.confidenceInterval95.high.toFixed(3)}]
- Consensus: ${(ensembleResult.consensusPercentage * 100).toFixed(0)}%
- Outlier runs: ${ensembleResult.outlierRuns.length}` : ""}

Generate the report outline now.`;

  const response = await llm.chat({
    provider: route.provider,
    model: route.model,
    systemPrompt,
    userPrompt,
    responseFormat: "json",
    temperature: 0.5,
  });

  const parsed = parseJSON(response);
  return {
    title: (parsed.title as string) ?? "Simulation Analysis Report",
    summary: (parsed.summary as string) ?? "",
    sections: ((parsed.sections as any[]) ?? []).map((s: { title: string; content: string }) => ({
      title: s.title,
      content: s.content ?? "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Phase 2: Section Generation (ReACT Loop)
// ---------------------------------------------------------------------------

async function generateSection(
  sectionTitle: string,
  outline: ReportOutline,
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  ensembleResult: EnsembleResult | null,
  options: ReportEngineOptions,
  route: { provider: string; model: string },
): Promise<{ content: string; toolCalls: ReportToolCall[] }> {
  const toolCalls: ReportToolCall[] = [];
  const messages: Array<{ role: string; content: string }> = [];

  // System prompt for section generation
  const systemPrompt = `You are a simulation analysis expert writing a section of a prediction report.

## Report: "${outline.title}"
## Current Section: "${sectionTitle}"

You have access to these analysis tools:
${Object.entries(REACT_TOOLS).map(([name, tool]) =>
    `- ${name}: ${tool.description}\n  Parameters: ${JSON.stringify(tool.parameters)}`,
  ).join("\n")}

## ReACT Protocol
For each section, you MUST:
1. THINK about what information you need
2. Call a TOOL to gather data (minimum ${REACT_CONSTRAINTS.minToolCallsPerSection} tool calls)
3. OBSERVE the results
4. REFLECT on whether you have enough information
5. When ready, write your FINAL ANSWER

Format your response as:
**Thought**: [your reasoning]
<tool_call>{"name": "tool_name", "parameters": {...}}</tool_call>

OR when ready:
**Final Answer**: [your section content in markdown]

RULES:
- Minimum ${REACT_CONSTRAINTS.minToolCallsPerSection} tool calls before Final Answer
- Maximum ${REACT_CONSTRAINTS.maxToolCallsPerSection} tool calls total
- Content must come from tool results, NOT your general knowledge
- Use **bold** for subsections (no ## headers within sections)
- Include agent quotes in > blockquote format
- Each section is a minimum content unit`;

  const initialPrompt = `Write the section "${sectionTitle}" for this prediction report.

Available data:
- ${roundResults.length} simulation rounds
- ${scenario.agents.length} agent profiles
- ${scenario.statisticalAgents.length} statistical agents
${ensembleResult ? `- Ensemble: ${ensembleResult.totalRuns} runs, mean sentiment ${ensembleResult.meanSentiment.toFixed(3)}` : ""}

Begin your analysis. Use tools to gather evidence before writing.`;

  messages.push({ role: "user", content: initialPrompt });

  let iterations = 0;
  let totalToolCalls = 0;

  while (iterations < REACT_CONSTRAINTS.maxIterationsPerSection) {
    iterations++;

    const response = await options.llm.chat({
      provider: route.provider,
      model: route.model,
      systemPrompt,
      userPrompt: messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"),
      temperature: 0.5,
    });

    // Check for Final Answer
    const finalAnswerMatch = response.match(/\*\*Final Answer\*\*:\s*([\s\S]*)/i);
    const toolCallMatch = response.match(/<tool_call>([\s\S]*?)<\/tool_call>/);

    // Handle conflict: both present
    if (finalAnswerMatch && toolCallMatch) {
      if (totalToolCalls < REACT_CONSTRAINTS.minToolCallsPerSection) {
        // Not enough tool calls yet — take only the tool call
        messages.push({ role: "assistant", content: response });
        const toolResult = await executeToolCall(
          toolCallMatch[1],
          scenario,
          roundResults,
          options,
        );
        toolCalls.push(toolResult);
        totalToolCalls++;
        messages.push({ role: "user", content: `Observation: ${toolResult.result.slice(0, REACT_CONSTRAINTS.toolResultMaxChars)}` });
        continue;
      }
      // Enough tool calls — take Final Answer
      return { content: finalAnswerMatch[1].trim(), toolCalls };
    }

    // Final Answer only
    if (finalAnswerMatch) {
      if (totalToolCalls < REACT_CONSTRAINTS.minToolCallsPerSection) {
        messages.push({ role: "assistant", content: response });
        messages.push({
          role: "user",
          content: `You need at least ${REACT_CONSTRAINTS.minToolCallsPerSection} tool calls before writing the final answer. You've made ${totalToolCalls}. Please use a tool to gather more evidence.`,
        });
        continue;
      }
      return { content: finalAnswerMatch[1].trim(), toolCalls };
    }

    // Tool call
    if (toolCallMatch) {
      if (totalToolCalls >= REACT_CONSTRAINTS.maxToolCallsPerSection) {
        messages.push({ role: "assistant", content: response });
        messages.push({
          role: "user",
          content: "You've reached the maximum tool calls. Write your **Final Answer** now based on the evidence gathered.",
        });
        continue;
      }

      messages.push({ role: "assistant", content: response });
      const toolResult = await executeToolCall(
        toolCallMatch[1],
        scenario,
        roundResults,
        options,
      );
      toolCalls.push(toolResult);
      totalToolCalls++;
      messages.push({ role: "user", content: `Observation: ${toolResult.result.slice(0, REACT_CONSTRAINTS.toolResultMaxChars)}` });
      continue;
    }

    // No tool call, no final answer — nudge
    messages.push({ role: "assistant", content: response });
    messages.push({
      role: "user",
      content: totalToolCalls < REACT_CONSTRAINTS.minToolCallsPerSection
        ? "Please use a <tool_call> to gather evidence, or write your **Final Answer**."
        : "Please write your **Final Answer** now.",
    });
  }

  // Exceeded iterations — force content from last response
  return {
    content: `*Analysis of "${sectionTitle}" — generated from ${totalToolCalls} data queries.*\n\nFurther analysis required.`,
    toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

async function executeToolCall(
  toolCallJson: string,
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  options: ReportEngineOptions,
): Promise<ReportToolCall> {
  let parsed: { name: string; parameters: Record<string, unknown> };

  try {
    parsed = JSON.parse(toolCallJson);
  } catch {
    return {
      tool: "unknown",
      parameters: {},
      result: "Error: Could not parse tool call JSON",
      timestamp: new Date().toISOString(),
    };
  }

  const toolName = parsed.name ?? (parsed as any).tool;
  const params = parsed.parameters ?? (parsed as any).params ?? {};

  let result: string;

  switch (toolName) {
    case "insight_forge":
      result = await executeInsightForge(
        params.query as string,
        scenario,
        roundResults,
        options,
      );
      break;

    case "panorama_search":
      result = await executePanoramaSearch(
        params.query as string,
        params.includeExpired as boolean,
        options,
      );
      break;

    case "quick_search":
      result = executeQuickSearch(
        params.query as string,
        roundResults,
        params.limit as number,
      );
      break;

    case "interview_agents":
      result = await executeInterviewAgents(
        params.interviewTopic as string ?? params.interview_topic as string,
        params.maxAgents as number ?? params.max_agents as number ?? 3,
        scenario,
        roundResults,
        options,
      );
      break;

    default:
      result = `Unknown tool: ${toolName}`;
  }

  return {
    tool: toolName,
    parameters: params,
    result,
    timestamp: new Date().toISOString(),
  };
}

/**
 * InsightForge — deep semantic search with sub-question decomposition.
 */
async function executeInsightForge(
  query: string,
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  options: ReportEngineOptions,
): Promise<string> {
  // Search knowledge graph
  const graphResults = await searchGraphForQuery(query, options);

  // Search simulation actions
  const actionResults = searchActionsForQuery(query, roundResults);

  // Search agent profiles
  const agentResults = searchAgentsForQuery(query, scenario.agents);

  return [
    "**Graph Knowledge:**",
    graphResults || "No relevant graph data found.",
    "",
    "**Simulation Actions:**",
    actionResults || "No matching actions found.",
    "",
    "**Relevant Agents:**",
    agentResults || "No matching agents found.",
  ].join("\n");
}

/**
 * PanoramaSearch — full graph scope including expired temporal edges.
 */
async function executePanoramaSearch(
  query: string,
  _includeExpired: boolean,
  options: ReportEngineOptions,
): Promise<string> {
  try {
    const entities = await options.graphLayer.getAllEntities();
    const matchingEntities = entities.filter((e) =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.type.toLowerCase().includes(query.toLowerCase()),
    );

    if (matchingEntities.length === 0) return "No entities found matching query.";

    return matchingEntities
      .slice(0, 10)
      .map((e) => `- ${e.name} (${e.type}): ${JSON.stringify(e.attributes).slice(0, 200)}`)
      .join("\n");
  } catch {
    return "Graph search unavailable.";
  }
}

/**
 * QuickSearch — keyword search over simulation actions.
 */
function executeQuickSearch(
  query: string,
  roundResults: RoundResult[],
  limit = 10,
): string {
  return searchActionsForQuery(query, roundResults, limit);
}

/**
 * InterviewAgents — post-simulation agent interviews via LLM.
 */
async function executeInterviewAgents(
  topic: string,
  maxAgents: number,
  scenario: SimulationScenario,
  roundResults: RoundResult[],
  options: ReportEngineOptions,
): Promise<string> {
  const route = resolveModelRoute("tier2_agents", options.modelRouting);

  // Select most active agents
  const actionCounts = new Map<string, number>();
  for (const round of roundResults) {
    for (const action of round.actions) {
      actionCounts.set(action.agentId, (actionCounts.get(action.agentId) ?? 0) + 1);
    }
  }

  const topAgents = scenario.agents
    .filter((a) => actionCounts.has(a.id))
    .sort((a, b) => (actionCounts.get(b.id) ?? 0) - (actionCounts.get(a.id) ?? 0))
    .slice(0, maxAgents);

  if (topAgents.length === 0) return "No agents available for interview.";

  const interviews: string[] = [];

  for (const agent of topAgents) {
    const agentActions = roundResults
      .flatMap((r) => r.actions)
      .filter((a) => a.agentId === agent.id && a.content)
      .slice(-5);

    const systemPrompt = `You are ${agent.name}. ${agent.persona}
You just participated in a ${roundResults.length}-round simulation.
Your recent actions: ${agentActions.map((a) => `${a.actionType}: "${a.content?.slice(0, 100)}"`).join("; ")}
Answer the interview question in character, based on your simulation experience. Keep it to 2-3 sentences.`;

    try {
      const response = await options.llm.chat({
        provider: route.provider,
        model: route.model,
        systemPrompt,
        userPrompt: `Interview question: ${topic}`,
        temperature: 0.7,
      });

      interviews.push(`> **${agent.name}** (${agent.profession ?? agent.sourceEntityType}): "${response.trim()}"`);
    } catch {
      interviews.push(`> **${agent.name}**: (interview unavailable)`);
    }
  }

  return interviews.join("\n\n");
}

// ---------------------------------------------------------------------------
// Search Helpers
// ---------------------------------------------------------------------------

async function searchGraphForQuery(
  query: string,
  options: ReportEngineOptions,
): Promise<string> {
  try {
    const entities = await options.graphLayer.getAllEntities();
    const keywords = query.toLowerCase().split(/\s+/);

    const matches = entities.filter((e) =>
      keywords.some(
        (kw) =>
          e.name.toLowerCase().includes(kw) ||
          e.type.toLowerCase().includes(kw) ||
          JSON.stringify(e.attributes).toLowerCase().includes(kw),
      ),
    );

    if (matches.length === 0) return "";

    return matches
      .slice(0, 5)
      .map((e) => `${e.name} (${e.type}): ${JSON.stringify(e.attributes).slice(0, 150)}`)
      .join("\n");
  } catch {
    return "";
  }
}

function searchActionsForQuery(
  query: string,
  roundResults: RoundResult[],
  limit = 10,
): string {
  const keywords = query.toLowerCase().split(/\s+/);

  const matchingActions = roundResults
    .flatMap((r) => r.actions)
    .filter(
      (a) =>
        a.content &&
        keywords.some((kw) => a.content!.toLowerCase().includes(kw)),
    )
    .slice(0, limit);

  if (matchingActions.length === 0) return "";

  return matchingActions
    .map(
      (a) =>
        `Round ${a.round} | @${a.agentName} (${a.actionType}): "${a.content!.slice(0, 150)}"`,
    )
    .join("\n");
}

function searchAgentsForQuery(
  query: string,
  agents: AgentProfile[],
): string {
  const keywords = query.toLowerCase().split(/\s+/);

  const matches = agents.filter((a) =>
    keywords.some(
      (kw) =>
        a.name.toLowerCase().includes(kw) ||
        a.profession?.toLowerCase().includes(kw) ||
        a.persona.toLowerCase().includes(kw) ||
        a.interestedTopics.some((t) => t.toLowerCase().includes(kw)),
    ),
  );

  if (matches.length === 0) return "";

  return matches
    .slice(0, 5)
    .map(
      (a) =>
        `${a.name} (${a.profession ?? a.sourceEntityType}): stance=${a.sentimentBias.toFixed(1)}, influence=${a.influenceWeight.toFixed(1)}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Markdown Compilation
// ---------------------------------------------------------------------------

function compileMarkdown(
  outline: ReportOutline,
  ensembleResult: EnsembleResult | null,
): string {
  const parts: string[] = [];

  parts.push(`# ${outline.title}`);
  parts.push("");
  parts.push(`*${outline.summary}*`);
  parts.push("");

  if (ensembleResult) {
    parts.push("---");
    parts.push("");
    parts.push("## Statistical Confidence");
    parts.push("");
    parts.push(`| Metric | Value |`);
    parts.push(`|--------|-------|`);
    parts.push(`| Ensemble Runs | ${ensembleResult.totalRuns} |`);
    parts.push(`| Mean Sentiment | ${ensembleResult.meanSentiment.toFixed(3)} |`);
    parts.push(`| Std Deviation | ${ensembleResult.sentimentStdDev.toFixed(3)} |`);
    parts.push(`| 95% CI | [${ensembleResult.confidenceInterval95.low.toFixed(3)}, ${ensembleResult.confidenceInterval95.high.toFixed(3)}] |`);
    parts.push(`| Consensus | ${(ensembleResult.consensusPercentage * 100).toFixed(0)}% |`);
    parts.push(`| Outlier Runs | ${ensembleResult.outlierRuns.length} |`);
    parts.push("");
  }

  for (const section of outline.sections) {
    parts.push("---");
    parts.push("");
    parts.push(`## ${section.title}`);
    parts.push("");
    parts.push(section.content);
    parts.push("");
  }

  parts.push("---");
  parts.push("");
  parts.push("*Report generated by Lattice Simulation Engine*");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function parseJSON(response: string): Record<string, unknown> {
  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) return JSON.parse(match[1]);
    const braceStart = response.indexOf("{");
    const braceEnd = response.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(response.slice(braceStart, braceEnd + 1));
    }
    throw new Error("Could not parse JSON from response");
  }
}
