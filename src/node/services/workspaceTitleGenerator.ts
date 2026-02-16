import { generateText } from "ai";
import type { AIService } from "./aiService";
import { log } from "./log";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import type { SendMessageError } from "@/common/types/errors";
import crypto from "crypto";
/**
 * CLI agent models preferred for name generation.
 * These must use the "agent-slug:model-id" format matching CLI_AGENT_DEFINITIONS.
 * The selection function tries each in order and uses the first one whose
 * CLI binary is detected on the system.
 */
const DEFAULT_NAME_GENERATION_MODELS = [
  "claude-code:claude-sonnet-4-5",
  "codex:gpt-4.1",
  "gemini:gemini-2.5-flash",
];

export interface WorkspaceIdentity {
  /** Codebase area with 4-char suffix (e.g., "sidebar-a1b2", "auth-k3m9") */
  name: string;
  /** Human-readable title (e.g., "Fix plan mode over SSH") */
  title: string;
}

/**
 * Find the first model from the list that the AIService can create.
 * Frontend is responsible for providing models in the correct format
 * based on user configuration.
 */
export async function findAvailableModel(
  aiService: AIService,
  models: string[]
): Promise<string | null> {
  for (const modelId of models) {
    const result = await aiService.createModel(modelId);
    if (result.success) {
      return modelId;
    }
  }
  return null;
}

/**
 * Select a model for name generation with intelligent fallback.
 *
 * Agent-only architecture: tries CLI agent models in priority order.
 * Each model uses the "agent-slug:model-id" format.
 *
 * Priority order:
 * 1. Try preferred CLI agent models (fast, cheap models)
 * 2. Try user's selected model (their workspace model)
 *
 * createModel() checks if the CLI agent binary is installed,
 * so only models with detected agents will succeed.
 */
export async function selectModelForNameGeneration(
  aiService: Pick<AIService, "createModel">,
  preferredModels: string[] = DEFAULT_NAME_GENERATION_MODELS,
  userModel?: string
): Promise<string | null> {
  // 1. Try preferred CLI agent models
  for (const modelId of preferredModels) {
    const result = await aiService.createModel(modelId);
    if (result.success) {
      return modelId;
    }
  }

  // 2. Try user's selected model (their workspace model)
  if (userModel) {
    const result = await aiService.createModel(userModel);
    if (result.success) {
      return userModel;
    }
  }

  // No CLI agents available for name generation
  return null;
}

// Crockford Base32 alphabet (excludes I, L, O, U to avoid confusion)
const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * Generate a 4-character random suffix using Crockford Base32.
 * Uses 20 bits of randomness (4 chars × 5 bits each).
 */
function generateNameSuffix(): string {
  const bytes = crypto.randomBytes(3); // 24 bits, we'll use 20
  const value = (bytes[0] << 12) | (bytes[1] << 4) | (bytes[2] >> 4);
  return (
    CROCKFORD_ALPHABET[(value >> 15) & 0x1f] +
    CROCKFORD_ALPHABET[(value >> 10) & 0x1f] +
    CROCKFORD_ALPHABET[(value >> 5) & 0x1f] +
    CROCKFORD_ALPHABET[value & 0x1f]
  );
}

/**
 * Generate workspace identity (name + title) using AI.
 * - name: Codebase area with 4-char suffix (e.g., "sidebar-a1b2")
 * - title: Human-readable description (e.g., "Fix plan mode over SSH")
 *
 * If AI cannot be used (e.g. missing credentials, unsupported provider, invalid model),
 * returns a SendMessageError so callers can surface the standard provider error UX.
 */
export async function generateWorkspaceIdentity(
  message: string,
  modelString: string,
  aiService: AIService
): Promise<Result<WorkspaceIdentity, SendMessageError>> {
  try {
    const modelResult = await aiService.createModel(modelString);
    if (!modelResult.success) {
      return Err(modelResult.error);
    }

    // CLI agents don't support structured output (generateObject), so we use
    // generateText with a JSON-requesting prompt and parse the response manually.
    const textResult = await generateText({
      model: modelResult.data,
      prompt: `Generate a workspace name and title for this development task. Respond ONLY with a JSON object, no other text.

Task: "${message}"

Requirements:
- name: The area of the codebase being worked on (1-2 words, git-safe: lowercase letters and hyphens only). Examples: "sidebar", "auth", "config", "api"
- title: A 2-5 word description in verb-noun format. Examples: "Fix plan mode", "Add user authentication"

Respond with ONLY this exact JSON format, no markdown, no explanation:
{"name": "area-name", "title": "Short Task Title"}`,
    });

    const text = textResult.text.trim();
    log.debug("Workspace identity raw response", { text: text.slice(0, 500) });

    // Extract JSON from response — handle markdown code fences, explanation text, etc.
    const parsed = extractJsonFromResponse(text);
    if (!parsed || !parsed.name || !parsed.title) {
      log.warn("Could not parse workspace identity from AI response", { text: text.slice(0, 500) });
      // Return a deterministic fallback based on the message
      return Ok(deterministicFallback(message));
    }

    const suffix = generateNameSuffix();
    const sanitizedName = sanitizeBranchName(parsed.name, 20);
    const nameWithSuffix = `${sanitizedName}-${suffix}`;

    return Ok({
      name: nameWithSuffix,
      title: parsed.title.trim(),
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    log.error("Failed to generate workspace identity with AI", error);

    // On any AI failure, return a deterministic fallback instead of an error.
    // This ensures workspace creation never blocks on AI availability.
    return Ok(deterministicFallback(message));
  }
}

/**
 * Extract a JSON object with `name` and `title` from AI response text.
 * Handles various formats: raw JSON, markdown fenced blocks, explanation + JSON.
 */
function extractJsonFromResponse(text: string): { name?: string; title?: string } | null {
  if (!text) return null;

  // Strip markdown code fences if present: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const cleanText = fenceMatch ? fenceMatch[1].trim() : text;

  // Try to find a JSON object
  const jsonMatch = cleanText.match(/\{[^{}]*"name"\s*:\s*"[^"]*"[^{}]*"title"\s*:\s*"[^"]*"[^{}]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as { name?: string; title?: string };
    } catch {
      // Fall through
    }
  }

  // More permissive: find any JSON-like object
  const anyJson = cleanText.match(/\{[\s\S]*?\}/);
  if (anyJson) {
    try {
      return JSON.parse(anyJson[0]) as { name?: string; title?: string };
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Generate a deterministic fallback workspace identity from the message.
 * Used when AI generation fails, so workspace creation never blocks.
 */
function deterministicFallback(message: string): WorkspaceIdentity {
  // Extract first meaningful word(s) for the name
  const words = message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  const namePart = words.slice(0, 2).join("-") || "workspace";
  const sanitizedName = sanitizeBranchName(namePart, 16);
  const suffix = generateNameSuffix();

  // Title: first 50 chars of message, cleaned up
  const title =
    message.length > 50
      ? message.slice(0, 47).trim() + "..."
      : message.trim() || "New workspace";

  return {
    name: `${sanitizedName}-${suffix}`,
    title,
  };
}

/**
 * @deprecated Use generateWorkspaceIdentity instead
 * Generate workspace name using AI (legacy function for backwards compatibility).
 */
export async function generateWorkspaceName(
  message: string,
  modelString: string,
  aiService: AIService
): Promise<Result<string, SendMessageError>> {
  const result = await generateWorkspaceIdentity(message, modelString, aiService);
  if (!result.success) {
    return result;
  }
  return Ok(result.data.name);
}

/**
 * Sanitize a string to be git-safe: lowercase, hyphens only, no leading/trailing hyphens.
 */
function sanitizeBranchName(name: string, maxLength: number): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .substring(0, maxLength);
}
