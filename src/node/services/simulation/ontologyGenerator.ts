/**
 * Ontology Generator — LLM-powered entity/relationship extraction.
 *
 * Analyzes seed documents and generates a structured ontology:
 * - Entity types (10 max, with mandatory Person/Organization fallbacks)
 * - Edge types (6-10 relationships between entity types)
 * - Attribute definitions per entity/edge type
 *
 * Ported from MiroFish's ontology_generator.py with full prompt fidelity.
 * Uses configurable model routing (defaults to Gemini 2.5 Pro for large context).
 */

import { log } from "@/node/services/log";
import type { LLMProvider } from "./simulationRuntime";
import type {
  Ontology,
  EdgeTypeDefinition,
  ModelRoutingConfig,
  Department,
} from "./types";
import {
  MAX_ENTITY_TYPES,
  MAX_EDGE_TYPES,
  RESERVED_ATTRIBUTE_NAMES,
  resolveModelRoute,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_INPUT_CHARS = 50_000;

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const ONTOLOGY_SYSTEM_PROMPT = `You are an expert ontology designer specializing in social simulation and multi-agent systems.

Your task is to analyze the provided text and simulation context, then generate a structured ontology that defines:
1. Entity types — the kinds of actors, organizations, and objects in this domain
2. Edge types — the relationships between entities
3. Attributes — properties that distinguish instances of each type

CRITICAL RULES:
- Generate EXACTLY 10 entity types (8 domain-specific + 2 mandatory fallbacks)
- The LAST TWO entity types MUST be "Person" and "Organization" as catch-all fallbacks
- Entity names must be PascalCase (e.g., "MiningEngineer", "GovernmentAgency")
- Edge names must be UPPER_SNAKE_CASE (e.g., "REPORTS_ON", "COLLABORATES_WITH")
- Generate 6-10 edge types
- Entities must represent REAL actors who can take actions in a simulation (not abstract concepts like "Trend" or "Emotion")
- Attribute names must be snake_case
- NEVER use these reserved attribute names: ${[...RESERVED_ATTRIBUTE_NAMES].join(", ")}
  - Use "full_name" instead of "name", "org_name" instead of "name"

OUTPUT FORMAT: Valid JSON matching this schema:
{
  "entity_types": [
    {
      "name": "string (PascalCase)",
      "description": "string (max 100 chars)",
      "attributes": [
        { "name": "string (snake_case)", "type": "text|number|boolean", "description": "string" }
      ],
      "examples": ["string", "string"]
    }
  ],
  "edge_types": [
    {
      "name": "string (UPPER_SNAKE_CASE)",
      "description": "string (max 100 chars)",
      "source_targets": [
        { "source": "EntityTypeName", "target": "EntityTypeName" }
      ],
      "attributes": []
    }
  ],
  "analysis_summary": "string — brief description of the domain and key dynamics"
}`;

// ---------------------------------------------------------------------------
// Department-Specific Guidance
// ---------------------------------------------------------------------------

const DEPARTMENT_GUIDANCE: Record<string, string> = {
  marketing: `Focus on entities that participate in online communities and content ecosystems:
- Content creators, influencers, journalists, brand advocates
- Industry analysts, competitors, target customers
- Community moderators, early adopters, skeptics
Relationships should capture influence, trust, competition, and information flow.`,

  engineering: `Focus on entities involved in technical decision-making:
- Engineers by specialty (frontend, backend, infra, security, ML)
- Architects, tech leads, engineering managers, PMs
- External vendors, open-source maintainers
Relationships should capture technical authority, mentorship, team structure, and expertise.`,

  sales: `Focus on entities in a B2B sales process:
- Decision makers (CTO, VP Eng, Director), budget holders (CFO, procurement)
- Technical evaluators, end users, champions
- Competitor sales teams, consultants, analysts
Relationships should capture buying authority, influence chains, and competitive dynamics.`,

  strategy: `Focus on entities in a market/competitive landscape:
- Competitors (by tier), regulators, investors, analysts
- Supply chain partners, distribution channels, trade associations
- Activist groups, media outlets, policy makers
Relationships should capture market power, regulatory influence, and strategic alliances.`,

  product: `Focus on entities in a product ecosystem:
- User segments (power users, new users, churned users, enterprise admins)
- Developer integrators, accessibility advocates
- Competitor products, app store reviewers
Relationships should capture user needs, pain points, feature dependencies, and migration paths.`,
};

// ---------------------------------------------------------------------------
// Main Generator
// ---------------------------------------------------------------------------

export interface OntologyGeneratorOptions {
  llm: LLMProvider;
  modelRouting: ModelRoutingConfig;
}

/**
 * Generate an ontology from seed text and simulation context.
 *
 * @param seedText - The combined text from uploaded seed documents
 * @param simulationDescription - User's description of what they want to simulate
 * @param department - Department context for specialized guidance
 * @param options - LLM provider and model routing config
 * @returns Validated ontology with entity types, edge types, and analysis
 */
export async function generateOntology(
  seedText: string,
  simulationDescription: string,
  department: Department | string,
  options: OntologyGeneratorOptions,
): Promise<Ontology> {
  const { llm, modelRouting } = options;
  const route = resolveModelRoute("ontology", modelRouting);

  // Truncate seed text if too long
  let truncatedText = seedText;
  if (seedText.length > MAX_INPUT_CHARS) {
    truncatedText = seedText.slice(0, MAX_INPUT_CHARS);
    truncatedText += `\n\n...(Original text: ${seedText.length} chars, truncated to first ${MAX_INPUT_CHARS})...`;
  }

  const departmentGuidance = DEPARTMENT_GUIDANCE[department] ?? DEPARTMENT_GUIDANCE.marketing;

  const userPrompt = `## Simulation Context
${simulationDescription}

## Department Guidance
${departmentGuidance}

## Seed Document Content
${truncatedText}

Generate the ontology JSON now. Remember:
- EXACTLY 10 entity types (last 2 must be Person and Organization)
- 6-10 edge types
- All entities must be actionable actors, NOT abstract concepts
- No reserved attribute names`;

  log.info(`[simulation:ontology] Generating ontology via ${route.provider}/${route.model}`);

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await llm.chat({
        provider: route.provider,
        model: route.model,
        systemPrompt: ONTOLOGY_SYSTEM_PROMPT,
        userPrompt,
        responseFormat: "json",
        temperature: 0.3,
      });

      const parsed = parseOntologyResponse(response);
      const validated = validateAndFixOntology(parsed);

      log.info(
        `[simulation:ontology] Generated ${validated.entityTypes.length} entity types, ` +
        `${validated.edgeTypes.length} edge types`,
      );

      return validated;
    } catch (err) {
      log.warn(`[simulation:ontology] Attempt ${attempts}/${maxAttempts} failed: ${err}`);
      if (attempts >= maxAttempts) {
        throw new Error(`Ontology generation failed after ${maxAttempts} attempts: ${err}`);
      }
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Ontology generation failed");
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseOntologyResponse(response: string): RawOntology {
  // Try direct JSON parse
  try {
    return JSON.parse(response);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try finding JSON object in response
    const braceStart = response.indexOf("{");
    const braceEnd = response.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(response.slice(braceStart, braceEnd + 1));
    }

    throw new Error("Could not parse ontology JSON from LLM response");
  }
}

interface RawOntology {
  entity_types?: Array<{
    name: string;
    description: string;
    attributes?: Array<{
      name: string;
      type: string;
      description: string;
    }>;
    examples?: string[];
  }>;
  edge_types?: Array<{
    name: string;
    description: string;
    source_targets?: Array<{ source: string; target: string }>;
    attributes?: Array<{
      name: string;
      type: string;
      description: string;
    }>;
  }>;
  analysis_summary?: string;
}

// ---------------------------------------------------------------------------
// Validation & Fixing
// ---------------------------------------------------------------------------

function validateAndFixOntology(raw: RawOntology): Ontology {
  let entityTypes = (raw.entity_types ?? []).map((et) => ({
    name: et.name,
    description: (et.description ?? "").slice(0, 100),
    attributes: (et.attributes ?? [])
      .filter((a) => !RESERVED_ATTRIBUTE_NAMES.has(a.name))
      .map((a) => ({
        name: a.name,
        type: normalizeAttributeType(a.type),
        description: a.description ?? "",
      })),
    examples: et.examples ?? [],
  }));

  let edgeTypes = (raw.edge_types ?? []).map((et) => ({
    name: et.name.toUpperCase().replace(/\s+/g, "_"),
    description: (et.description ?? "").slice(0, 100),
    sourceTargets: (et.source_targets ?? []).map((st) => ({
      source: st.source,
      target: st.target,
    })),
    attributes: (et.attributes ?? []).map((a) => ({
      name: a.name,
      type: normalizeAttributeType(a.type),
      description: a.description ?? "",
    })),
  }));

  // Ensure mandatory fallback types exist
  const hasPersonType = entityTypes.some(
    (et) => et.name.toLowerCase() === "person",
  );
  const hasOrgType = entityTypes.some(
    (et) => et.name.toLowerCase() === "organization",
  );

  if (!hasPersonType) {
    entityTypes.push({
      name: "Person",
      description: "Individual person — fallback for unclassified individuals",
      attributes: [
        { name: "full_name", type: "text", description: "Person's full name" },
        { name: "role", type: "text", description: "Primary role or profession" },
      ],
      examples: ["General community member", "Unaffiliated individual"],
    });
  }

  if (!hasOrgType) {
    entityTypes.push({
      name: "Organization",
      description: "Organization — fallback for unclassified groups and institutions",
      attributes: [
        { name: "org_name", type: "text", description: "Organization name" },
        { name: "org_type", type: "text", description: "Type of organization" },
      ],
      examples: ["Generic company", "Unclassified institution"],
    });
  }

  // Enforce limits
  if (entityTypes.length > MAX_ENTITY_TYPES) {
    // Keep Person and Organization, trim others
    const personIdx = entityTypes.findIndex((et) => et.name === "Person");
    const orgIdx = entityTypes.findIndex((et) => et.name === "Organization");
    const person = entityTypes[personIdx];
    const org = entityTypes[orgIdx];

    entityTypes = entityTypes
      .filter((et) => et.name !== "Person" && et.name !== "Organization")
      .slice(0, MAX_ENTITY_TYPES - 2);
    entityTypes.push(person, org);
  }

  if (edgeTypes.length > MAX_EDGE_TYPES) {
    edgeTypes = edgeTypes.slice(0, MAX_EDGE_TYPES);
  }

  // Ensure minimum edge types
  if (edgeTypes.length < 3) {
    const defaultEdges: EdgeTypeDefinition[] = [
      {
        name: "INTERACTS_WITH",
        description: "General interaction between entities",
        sourceTargets: [{ source: "Person", target: "Person" }],
        attributes: [],
      },
      {
        name: "BELONGS_TO",
        description: "Membership or affiliation",
        sourceTargets: [{ source: "Person", target: "Organization" }],
        attributes: [],
      },
      {
        name: "INFLUENCES",
        description: "Influence or impact relationship",
        sourceTargets: [{ source: "Person", target: "Person" }],
        attributes: [],
      },
    ];

    for (const edge of defaultEdges) {
      if (!edgeTypes.some((e) => e.name === edge.name)) {
        edgeTypes.push(edge);
        if (edgeTypes.length >= 6) break;
      }
    }
  }

  return {
    entityTypes,
    edgeTypes,
    analysisSummary: raw.analysis_summary ?? "",
  };
}

function normalizeAttributeType(type: string): "text" | "number" | "boolean" {
  const lower = type.toLowerCase();
  if (lower === "number" || lower === "int" || lower === "integer" || lower === "float") {
    return "number";
  }
  if (lower === "boolean" || lower === "bool") {
    return "boolean";
  }
  return "text";
}

// ---------------------------------------------------------------------------
// Text Processing (for chunked ingestion)
// ---------------------------------------------------------------------------

/**
 * Split text into overlapping chunks for knowledge graph ingestion.
 * Ported from MiroFish's TextProcessor.
 */
export function splitTextIntoChunks(
  text: string,
  chunkSize = 500,
  overlap = 50,
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }

  return chunks;
}
