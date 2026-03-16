/**
 * Agent Forge — deep persona generation with cognitive modeling.
 *
 * Creates high-fidelity agent profiles from knowledge graph entities:
 * - Detailed personality synthesis (age, MBTI, communication style)
 * - Belief system initialization (stances, core values, fears, goals)
 * - Memory seeding from historical data
 * - Tier assignment based on entity importance
 * - Activity scheduling per agent
 *
 * Ported from MiroFish's oasis_profile_generator.py with extensions
 * for cognitive modeling and multi-department support.
 *
 * Uses configurable model routing (defaults to Claude Sonnet for persona nuance).
 */

import { log } from "@/node/services/log";
import type { LLMProvider } from "./simulationRuntime";
import type {
  AgentProfile,
  AgentTier,
  BeliefSystem,
  GraphEntity,
  ModelRoutingConfig,
  StatisticalAgentProfile,
  DepartmentTemplate,
} from "./types";
import { resolveModelRoute } from "./types";
import type { GraphLayer } from "./graphLayer";

// ---------------------------------------------------------------------------
// Entity Classification
// ---------------------------------------------------------------------------

const INDIVIDUAL_ENTITY_TYPES = new Set([
  "student", "professor", "person", "publicfigure", "expert",
  "journalist", "activist", "engineer", "analyst", "executive",
  "researcher", "investor", "regulator", "developer", "designer",
  "manager", "director", "founder", "ceo", "cto", "user",
  "miningengineer", "geologist", "trader", "farmer",
]);

const GROUP_ENTITY_TYPES = new Set([
  "university", "company", "organization", "ngo", "mediaoutlet",
  "institution", "community", "agency", "association", "consortium",
  "government", "ministry", "committee", "board", "fund",
]);

// ---------------------------------------------------------------------------
// Persona Generation Prompt
// ---------------------------------------------------------------------------

const PERSONA_SYSTEM_PROMPT = `You are an expert at creating detailed, realistic character profiles for social simulation.

Given information about a real-world entity, create a deeply nuanced persona that captures:
- Personality and communication style
- Professional expertise and biases
- Beliefs, fears, and goals
- How they would behave in online discussions

The persona must feel like a REAL person, not a caricature. Include contradictions and nuance.

OUTPUT FORMAT: Valid JSON matching this schema:
{
  "name": "string — realistic full name",
  "username": "string — plausible username",
  "age": number,
  "gender": "string",
  "mbti": "string — 4 letter MBTI type",
  "country": "string",
  "profession": "string — specific job title",
  "bio": "string — 1-2 sentence public bio",
  "persona": "string — detailed personality description (200-400 words)",
  "communication_style": "string — how they write online",
  "current_mood": "string — current emotional state",
  "interested_topics": ["string", ...],
  "belief_stances": { "topic": number (-1.0 to 1.0), ... },
  "core_values": ["string", ...],
  "fears": ["string", ...],
  "goals": ["string", ...],
  "activity_level": number (0.0-1.0),
  "posts_per_hour": number,
  "comments_per_hour": number,
  "sentiment_bias": number (-1.0 to 1.0),
  "influence_weight": number (0.1-5.0)
}`;

// ---------------------------------------------------------------------------
// Main Forge
// ---------------------------------------------------------------------------

export interface AgentForgeOptions {
  llm: LLMProvider;
  modelRouting: ModelRoutingConfig;
  graphLayer: GraphLayer;
}

export interface ForgeProgress {
  current: number;
  total: number;
  agentName: string;
}

/**
 * Generate agent profiles from knowledge graph entities.
 *
 * @param entities - Entities extracted from the knowledge graph
 * @param template - Department template with archetype definitions
 * @param simulationContext - Description of the simulation scenario
 * @param options - LLM provider, model routing, graph layer
 * @param onProgress - Optional callback for real-time progress updates
 */
export async function forgeAgentProfiles(
  entities: GraphEntity[],
  template: DepartmentTemplate,
  simulationContext: string,
  options: AgentForgeOptions,
  onProgress?: (progress: ForgeProgress) => void,
): Promise<{
  agents: AgentProfile[];
  statisticalAgents: StatisticalAgentProfile[];
}> {
  const { llm, modelRouting, graphLayer } = options;
  const route = resolveModelRoute("persona_generation", modelRouting);

  log.info(`[simulation:forge] Forging ${entities.length} agent profiles via ${route.provider}/${route.model}`);

  // 1. Classify entities and assign tiers
  const tieredEntities = assignTiers(entities, template);

  // 2. Generate LLM-powered profiles in parallel batches
  const agents: AgentProfile[] = [];
  const batchSize = 5; // Parallel LLM calls per batch

  for (let i = 0; i < tieredEntities.length; i += batchSize) {
    const batch = tieredEntities.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async ({ entity, tier, archetype }) => {
        // Enrich entity with graph context
        const context = await getEntityContext(entity, graphLayer);

        // Generate profile via LLM
        const profile = await generateProfileWithLLM(
          entity,
          tier,
          archetype,
          context,
          simulationContext,
          llm,
          route,
        );

        onProgress?.({
          current: i + batch.indexOf({ entity, tier, archetype }) + 1,
          total: tieredEntities.length,
          agentName: profile.name,
        });

        return profile;
      }),
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        agents.push(result.value);
      } else {
        log.warn(`[simulation:forge] Profile generation failed: ${result.reason}`);
        // Generate rule-based fallback
        const fallbackEntity = batch[batchResults.indexOf(result)];
        if (fallbackEntity) {
          agents.push(
            generateRuleBasedProfile(fallbackEntity.entity, fallbackEntity.tier),
          );
        }
      }
    }
  }

  // 3. Generate statistical agents
  const statisticalAgents = generateStatisticalAgentProfiles(template);

  log.info(
    `[simulation:forge] Generated ${agents.length} LLM profiles + ` +
    `${statisticalAgents.length} statistical agents`,
  );

  return { agents, statisticalAgents };
}

// ---------------------------------------------------------------------------
// Tier Assignment
// ---------------------------------------------------------------------------

interface TieredEntity {
  entity: GraphEntity;
  tier: AgentTier;
  archetype: string;
}

function assignTiers(
  entities: GraphEntity[],
  template: DepartmentTemplate,
): TieredEntity[] {
  const result: TieredEntity[] = [];
  const archetypeCounters = new Map<string, number>();

  // Initialize counters
  for (const archetype of template.agentArchetypes) {
    archetypeCounters.set(archetype.name, 0);
  }

  for (const entity of entities) {
    // Find best matching archetype
    const archetype = findBestArchetype(entity, template);
    const currentCount = archetypeCounters.get(archetype.name) ?? 0;

    // Skip if archetype is full
    if (currentCount >= archetype.defaultCount) continue;

    archetypeCounters.set(archetype.name, currentCount + 1);

    result.push({
      entity,
      tier: archetype.tier,
      archetype: archetype.name,
    });
  }

  return result;
}

function findBestArchetype(
  entity: GraphEntity,
  template: DepartmentTemplate,
): DepartmentTemplate["agentArchetypes"][0] {
  const entityType = entity.type.toLowerCase();
  const isGroup = GROUP_ENTITY_TYPES.has(entityType);

  // Try to match entity type to archetype
  for (const archetype of template.agentArchetypes) {
    const archetypeLower = archetype.name.toLowerCase();

    // Direct type match
    if (entityType.includes(archetypeLower) || archetypeLower.includes(entityType)) {
      return archetype;
    }

    // Description-based match
    if (archetype.description.toLowerCase().includes(entityType)) {
      return archetype;
    }
  }

  // Default: assign based on individual vs group
  if (isGroup) {
    return template.agentArchetypes.find((a) => a.tier === 2) ?? template.agentArchetypes[0];
  }

  // Default to first available archetype
  return template.agentArchetypes[0];
}

// ---------------------------------------------------------------------------
// Entity Context Enrichment
// ---------------------------------------------------------------------------

async function getEntityContext(
  entity: GraphEntity,
  graphLayer: GraphLayer,
): Promise<string> {
  try {
    // Get related entities and edges
    const related = await graphLayer.getRelatedEntities(entity.uuid, 1);
    const edges = await graphLayer.getEdgesForEntity(entity.uuid);

    const parts: string[] = [];

    if (Object.keys(entity.attributes).length > 0) {
      parts.push(`Attributes: ${JSON.stringify(entity.attributes)}`);
    }

    if (related.length > 0) {
      parts.push(
        `Related to: ${related.map((r) => `${r.name} (${r.type})`).join(", ")}`,
      );
    }

    if (edges.length > 0) {
      parts.push(
        `Relationships: ${edges.map((e) => e.type).join(", ")}`,
      );
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// LLM-Powered Profile Generation
// ---------------------------------------------------------------------------

async function generateProfileWithLLM(
  entity: GraphEntity,
  tier: AgentTier,
  archetype: string,
  context: string,
  simulationContext: string,
  llm: LLMProvider,
  route: { provider: string; model: string },
): Promise<AgentProfile> {
  const entityType = entity.type.toLowerCase();
  const isIndividual = INDIVIDUAL_ENTITY_TYPES.has(entityType);

  const userPrompt = `## Entity Information
Name: ${entity.name}
Type: ${entity.type} (${isIndividual ? "individual person" : "group/organization"})
Archetype Role: ${archetype}
${context ? `\n## Additional Context\n${context}` : ""}

## Simulation Context
${simulationContext}

## Instructions
${isIndividual
    ? "Create a detailed individual persona for this person. They will participate in online forum discussions."
    : "Create a persona for a representative spokesperson of this organization. They will post on behalf of the organization in online forums."
  }

The agent's influence_weight should reflect their real-world importance:
- Journalists, executives, major institutions: 2.0-4.0
- Active professionals, analysts: 1.0-2.0
- General community members, students: 0.3-1.0

Generate the JSON profile now.`;

  const response = await llm.chat({
    provider: route.provider,
    model: route.model,
    systemPrompt: PERSONA_SYSTEM_PROMPT,
    userPrompt,
    responseFormat: "json",
    temperature: 0.3,
  });

  return parseProfileResponse(response, entity, tier);
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

function parseProfileResponse(
  response: string,
  entity: GraphEntity,
  tier: AgentTier,
): AgentProfile {
  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(response);
  } catch {
    // Try extracting JSON from code blocks
    const match = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      const braceStart = response.indexOf("{");
      const braceEnd = response.lastIndexOf("}");
      if (braceStart !== -1 && braceEnd > braceStart) {
        parsed = JSON.parse(response.slice(braceStart, braceEnd + 1));
      } else {
        throw new Error("Could not parse profile JSON");
      }
    }
  }

  const stances = (parsed.belief_stances as Record<string, number>) ?? {};

  const beliefSystem: BeliefSystem = {
    stances,
    coreValues: (parsed.core_values as string[]) ?? [],
    fears: (parsed.fears as string[]) ?? [],
    goals: (parsed.goals as string[]) ?? [],
  };

  return {
    id: `agent_${entity.uuid.slice(0, 8)}_${Date.now().toString(36)}`,
    name: (parsed.name as string) ?? entity.name,
    username: (parsed.username as string) ?? generateUsername(entity.name),
    bio: (parsed.bio as string) ?? "",
    persona: (parsed.persona as string) ?? "",
    tier,
    age: (parsed.age as number) ?? undefined,
    gender: (parsed.gender as string) ?? undefined,
    mbti: (parsed.mbti as string) ?? undefined,
    country: (parsed.country as string) ?? undefined,
    profession: (parsed.profession as string) ?? undefined,
    communicationStyle: (parsed.communication_style as string) ?? "Direct and factual",
    interestedTopics: (parsed.interested_topics as string[]) ?? [],
    currentMood: (parsed.current_mood as string) ?? "Neutral",
    beliefSystem,
    activityLevel: clamp((parsed.activity_level as number) ?? 0.5, 0.05, 1.0),
    postsPerHour: (parsed.posts_per_hour as number) ?? 0.5,
    commentsPerHour: (parsed.comments_per_hour as number) ?? 1.0,
    activeHours: generateActiveHours(parsed.activity_level as number ?? 0.5),
    responseDelayMin: 2,
    responseDelayMax: 30,
    sentimentBias: clamp((parsed.sentiment_bias as number) ?? 0, -1.0, 1.0),
    stance: inferStance(parsed.sentiment_bias as number ?? 0),
    influenceWeight: clamp((parsed.influence_weight as number) ?? 1.0, 0.1, 5.0),
    karma: Math.floor(Math.random() * 5000) + 100,
    sourceEntityUuid: entity.uuid,
    sourceEntityType: entity.type,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Rule-Based Fallback Profile
// ---------------------------------------------------------------------------

const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP",
];

function generateRuleBasedProfile(
  entity: GraphEntity,
  tier: AgentTier,
): AgentProfile {
  const entityType = entity.type.toLowerCase();
  const isIndividual = INDIVIDUAL_ENTITY_TYPES.has(entityType);

  return {
    id: `agent_${entity.uuid.slice(0, 8)}_${Date.now().toString(36)}`,
    name: entity.name,
    username: generateUsername(entity.name),
    bio: `${entity.type}: ${entity.name}`,
    persona: `A ${entityType} participating in online discussions. ${isIndividual ? "Has personal views and expertise." : "Represents organizational positions."}`,
    tier,
    age: isIndividual ? 25 + Math.floor(Math.random() * 40) : undefined,
    gender: undefined,
    mbti: MBTI_TYPES[Math.floor(Math.random() * MBTI_TYPES.length)],
    country: "United States",
    profession: entityType,
    communicationStyle: "Factual and measured",
    interestedTopics: [],
    currentMood: "Neutral",
    beliefSystem: {
      stances: {},
      coreValues: ["accuracy", "fairness"],
      fears: ["misinformation"],
      goals: ["contribute meaningfully"],
    },
    activityLevel: isIndividual ? 0.5 : 0.3,
    postsPerHour: isIndividual ? 0.5 : 0.2,
    commentsPerHour: isIndividual ? 1.0 : 0.5,
    activeHours: isIndividual ? [9, 10, 11, 18, 19, 20, 21] : [9, 10, 11, 12, 13, 14, 15, 16, 17],
    responseDelayMin: isIndividual ? 2 : 30,
    responseDelayMax: isIndividual ? 30 : 120,
    sentimentBias: 0,
    stance: "neutral",
    influenceWeight: isIndividual ? 1.0 : 2.0,
    karma: 1000,
    sourceEntityUuid: entity.uuid,
    sourceEntityType: entity.type,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Statistical Agent Generation
// ---------------------------------------------------------------------------

function generateStatisticalAgentProfiles(
  template: DepartmentTemplate,
): StatisticalAgentProfile[] {
  if (template.statisticalAgentCount === 0) return [];

  const profiles: StatisticalAgentProfile[] = [];
  const archetypes = ["supportive_lurker", "neutral_observer", "critical_reader"];

  for (let i = 0; i < template.statisticalAgentCount; i++) {
    const archetype = archetypes[i % archetypes.length];
    profiles.push({
      id: `stat_${i}_${Date.now().toString(36)}`,
      archetype,
      sentimentDistribution: archetype === "supportive_lurker"
        ? { positive: 0.6, neutral: 0.3, negative: 0.1 }
        : archetype === "critical_reader"
          ? { positive: 0.2, neutral: 0.3, negative: 0.5 }
          : { positive: 0.3, neutral: 0.5, negative: 0.2 },
      activityProbability: 0.05 + Math.random() * 0.1,
      preferredActions: [
        { action: "UPVOTE", weight: 0.5 },
        { action: "DOWNVOTE", weight: 0.2 },
        { action: "DO_NOTHING", weight: 0.3 },
      ],
    });
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUsername(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = Math.floor(Math.random() * 9999);
  return `${base}${suffix}`;
}

function generateActiveHours(activityLevel: number): number[] {
  if (activityLevel > 0.7) {
    return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  }
  if (activityLevel > 0.4) {
    return [9, 10, 11, 18, 19, 20, 21];
  }
  return [19, 20, 21];
}

function inferStance(sentimentBias: number): "supportive" | "opposing" | "neutral" | "observer" {
  if (sentimentBias > 0.3) return "supportive";
  if (sentimentBias < -0.3) return "opposing";
  if (Math.abs(sentimentBias) < 0.1) return "observer";
  return "neutral";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
