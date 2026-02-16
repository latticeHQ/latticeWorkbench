/**
 * Skills System — Reusable Agent Workflows (Anthropic-recommended pattern)
 *
 * Agents can save working code as reusable "skills" that other agents
 * (or the same agent later) can discover and execute. Each skill is a
 * folder containing:
 *
 *   skills/
 *   ├── deploy-to-prod/
 *   │   ├── SKILL.md          — Description, requirements, usage
 *   │   ├── index.ts          — The executable code
 *   │   └── metadata.json     — Tags, author, version, last used
 *   ├── run-test-suite/
 *   │   ├── SKILL.md
 *   │   ├── index.ts
 *   │   └── metadata.json
 *   └── ...
 *
 * Skills evolve over time — agents refine them based on outcomes.
 * The orchestrator builds a library of proven workflows.
 *
 * Reference: Anthropic's "Code execution with MCP" — Skills section
 */
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

// ── Types ────────────────────────────────────────────────────────────

interface SkillMetadata {
  name: string;
  description: string;
  tags: string[];
  author: string; // agent ID or "human"
  version: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
  requirements?: string[];
  inputSchema?: Record<string, string>; // param name → type
}

// ── Helpers ──────────────────────────────────────────────────────────

function getSkillsDir(): string {
  return path.join(os.homedir(), ".lattice", "skills");
}

function ensureSkillsDir(): string {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function listAllSkills(): Array<{ name: string; metadata: SkillMetadata; dir: string }> {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) return [];

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skills: Array<{ name: string; metadata: SkillMetadata; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(skillsDir, entry.name, "metadata.json");
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const raw = fs.readFileSync(metadataPath, "utf-8");
      const metadata = JSON.parse(raw) as SkillMetadata;
      skills.push({ name: entry.name, metadata, dir: path.join(skillsDir, entry.name) });
    } catch {
      // Skip corrupt skills
    }
  }

  return skills.sort((a, b) => b.metadata.useCount - a.metadata.useCount);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

// ── Register skills tools ────────────────────────────────────────────

export function registerSkillsTools(server: McpServer, client: WorkbenchClient): void {

  // ── Save a skill ───────────────────────────────────────────────────

  server.tool(
    "skills_save",
    `Save a reusable skill — code + instructions that any agent can discover and execute later.

A skill is a proven workflow that worked. Save it so you (or other agents) don't have to figure it out again.

Examples:
- "deploy-to-vercel" — code that builds and deploys
- "analyze-pr-diff" — code that reviews a PR and writes feedback
- "setup-nextjs-project" — scaffolding recipe
- "run-e2e-tests" — test execution with retry logic`,
    {
      name: z.string().describe("Skill name (slug-friendly, e.g., 'deploy-to-vercel')"),
      description: z.string().describe("What this skill does (1-2 sentences)"),
      code: z.string().describe("The TypeScript/JavaScript code that implements this skill"),
      instructions: z.string().optional().describe("SKILL.md content — usage instructions, requirements, examples"),
      tags: z.array(z.string()).optional().describe("Tags for discovery (e.g., ['deploy', 'vercel', 'nextjs'])"),
      author: z.string().optional().describe("Who created this (agent ID or 'human')"),
      requirements: z.array(z.string()).optional().describe("Prerequisites (e.g., ['vercel CLI installed', 'VERCEL_TOKEN set'])"),
      inputSchema: z.record(z.string(), z.string()).optional().describe("Input parameters: { paramName: 'type description' }"),
    },
    async ({ name, description, code, instructions, tags, author, requirements, inputSchema }) => {
      try {
        const skillsDir = ensureSkillsDir();
        const slug = slugify(name);
        const skillDir = path.join(skillsDir, slug);

        // Check if skill exists (update vs create)
        const isUpdate = fs.existsSync(skillDir);
        let version = 1;

        if (isUpdate) {
          try {
            const existing = JSON.parse(fs.readFileSync(path.join(skillDir, "metadata.json"), "utf-8")) as SkillMetadata;
            version = existing.version + 1;
          } catch {}
        }

        fs.mkdirSync(skillDir, { recursive: true });

        // Write code
        fs.writeFileSync(path.join(skillDir, "index.ts"), code, "utf-8");

        // Write SKILL.md
        const skillMd = instructions ?? `# ${name}\n\n${description}\n\n## Usage\n\nImport and call this skill from your agent code.\n\n## Tags\n\n${(tags ?? []).join(", ")}\n`;
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillMd, "utf-8");

        // Write metadata
        const now = Date.now();
        let existingCreatedAt = now;
        let existingUseCount = 0;
        if (isUpdate) {
          try {
            const existing = JSON.parse(fs.readFileSync(path.join(skillDir, "metadata.json"), "utf-8")) as SkillMetadata;
            existingCreatedAt = existing.createdAt;
            existingUseCount = existing.useCount;
          } catch {}
        }
        const metadata: SkillMetadata = {
          name: slug,
          description,
          tags: tags ?? [],
          author: author ?? "agent",
          version,
          createdAt: existingCreatedAt,
          updatedAt: now,
          useCount: existingUseCount,
          requirements,
          inputSchema,
        };
        fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: `${isUpdate ? "🔄 Updated" : "✅ Saved"} skill: "${slug}" (v${version})\n📁 ${skillDir}\n📝 ${code.length} bytes of code\n🏷️ Tags: ${(tags ?? []).join(", ") || "none"}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── List skills ────────────────────────────────────────────────────

  server.tool(
    "skills_list",
    "List all available skills. Sorted by usage count (most used first).",
    {
      tag: z.string().optional().describe("Filter by tag"),
      query: z.string().optional().describe("Search by name or description"),
    },
    async ({ tag, query }) => {
      let skills = listAllSkills();

      if (tag) {
        skills = skills.filter((s) => s.metadata.tags.includes(tag.toLowerCase()));
      }
      if (query) {
        const q = query.toLowerCase();
        skills = skills.filter((s) =>
          s.metadata.name.includes(q) ||
          s.metadata.description.toLowerCase().includes(q) ||
          s.metadata.tags.some((t) => t.includes(q))
        );
      }

      if (skills.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No skills found. Use skills_save to create your first skill." }],
        };
      }

      const lines: string[] = [];
      lines.push(`📚 Skills Library (${skills.length})\n`);

      for (const s of skills) {
        const lastUsed = s.metadata.lastUsedAt
          ? `${Math.round((Date.now() - s.metadata.lastUsedAt) / 3_600_000)}h ago`
          : "never";
        lines.push(`🔧 ${s.metadata.name} (v${s.metadata.version})`);
        lines.push(`   ${s.metadata.description}`);
        lines.push(`   Tags: ${s.metadata.tags.join(", ") || "none"} | Used: ${s.metadata.useCount}x | Last: ${lastUsed}`);
        if (s.metadata.requirements?.length) {
          lines.push(`   Requires: ${s.metadata.requirements.join(", ")}`);
        }
        lines.push("");
      }

      // Collect all unique tags
      const allTags = new Set<string>();
      for (const s of skills) {
        for (const t of s.metadata.tags) allTags.add(t);
      }
      if (allTags.size > 0) {
        lines.push(`🏷️ All tags: ${Array.from(allTags).sort().join(", ")}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );

  // ── Get skill code ─────────────────────────────────────────────────

  server.tool(
    "skills_get",
    "Read a skill's full code, instructions, and metadata. Use this to understand what a skill does before executing it.",
    {
      name: z.string().describe("Skill name (slug)"),
      part: z.enum(["all", "code", "instructions", "metadata"]).optional().describe("Which part to read (default: all)"),
    },
    async ({ name, part }) => {
      const slug = slugify(name);
      const skillDir = path.join(getSkillsDir(), slug);

      if (!fs.existsSync(skillDir)) {
        return {
          content: [{ type: "text" as const, text: `Skill "${slug}" not found.` }],
          isError: true,
        };
      }

      const sections: string[] = [];
      const readPart = part ?? "all";

      if (readPart === "all" || readPart === "metadata") {
        try {
          const metadata = fs.readFileSync(path.join(skillDir, "metadata.json"), "utf-8");
          sections.push(`── METADATA ──\n${metadata}`);
        } catch {}
      }

      if (readPart === "all" || readPart === "instructions") {
        try {
          const skillMd = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");
          sections.push(`── SKILL.md ──\n${skillMd}`);
        } catch {}
      }

      if (readPart === "all" || readPart === "code") {
        try {
          const code = fs.readFileSync(path.join(skillDir, "index.ts"), "utf-8");
          sections.push(`── CODE (index.ts) ──\n${code}`);
        } catch {}
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n\n") || "Skill directory exists but files are empty." }],
      };
    }
  );

  // ── Execute skill ──────────────────────────────────────────────────

  server.tool(
    "skills_execute",
    `Execute a saved skill in a workspace. Sends the skill's code as a task to the workspace agent.

The agent will receive the skill code and instructions, then execute it in the workspace context.`,
    {
      name: z.string().describe("Skill name (slug)"),
      workspaceId: z.string().describe("Workspace to execute in"),
      inputs: z.record(z.string(), z.string()).optional().describe("Input values to pass to the skill"),
      timeoutMs: z.number().optional().describe("Timeout (default: 180000)"),
    },
    async ({ name, workspaceId, inputs, timeoutMs }) => {
      const slug = slugify(name);
      const skillDir = path.join(getSkillsDir(), slug);

      if (!fs.existsSync(skillDir)) {
        return { content: [{ type: "text" as const, text: `Skill "${slug}" not found.` }], isError: true };
      }

      try {
        // Read skill files
        const code = fs.readFileSync(path.join(skillDir, "index.ts"), "utf-8");
        const metadataRaw = fs.readFileSync(path.join(skillDir, "metadata.json"), "utf-8");
        const metadata = JSON.parse(metadataRaw) as SkillMetadata;

        let instructions = "";
        try {
          instructions = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");
        } catch {}

        // Build the task message
        const inputStr = inputs
          ? `\n\n## Inputs\n${Object.entries(inputs).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`
          : "";

        const taskMessage = `[SKILL EXECUTION: ${metadata.name}]

## Description
${metadata.description}

${instructions ? `## Instructions\n${instructions}\n` : ""}${inputStr}

## Code
\`\`\`typescript
${code}
\`\`\`

Execute this skill code in the workspace. Follow the instructions and use the provided inputs. Report results clearly.`;

        // Get baseline for polling
        let baselineCount = 0;
        try {
          const replay = (await client.getFullReplay(workspaceId)) as unknown[];
          baselineCount = replay.length;
        } catch {}

        // Send to workspace
        const sendResult = await client.sendMessage(workspaceId, taskMessage);
        if (!sendResult.success) {
          return { content: [{ type: "text" as const, text: `Failed to dispatch skill: ${sendResult.error}` }], isError: true };
        }

        // Update usage stats
        metadata.lastUsedAt = Date.now();
        metadata.useCount++;
        fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

        // Poll for response
        const timeout = timeoutMs ?? 180_000;
        const response = await client.waitForResponse(workspaceId, baselineCount, timeout);

        return {
          content: [{
            type: "text" as const,
            text: `✅ Skill "${slug}" executed (v${metadata.version}, use #${metadata.useCount})\n\nResult:\n${response}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Delete skill ───────────────────────────────────────────────────

  server.tool(
    "skills_delete",
    "Delete a saved skill.",
    { name: z.string() },
    async ({ name }) => {
      const slug = slugify(name);
      const skillDir = path.join(getSkillsDir(), slug);

      if (!fs.existsSync(skillDir)) {
        return { content: [{ type: "text" as const, text: `Skill "${slug}" not found.` }], isError: true };
      }

      // Remove directory recursively
      fs.rmSync(skillDir, { recursive: true, force: true });

      return {
        content: [{ type: "text" as const, text: `🗑️ Skill "${slug}" deleted.` }],
      };
    }
  );

  // ── Fork/improve skill ─────────────────────────────────────────────

  server.tool(
    "skills_fork",
    "Fork an existing skill to create a variant. Copies the original and lets you modify it.",
    {
      sourceName: z.string().describe("Source skill to fork"),
      newName: z.string().describe("Name for the forked skill"),
      newDescription: z.string().optional().describe("Updated description"),
      newCode: z.string().optional().describe("Updated code (omit to copy original)"),
      newTags: z.array(z.string()).optional().describe("Updated tags"),
    },
    async ({ sourceName, newName, newDescription, newCode, newTags }) => {
      const sourceSlug = slugify(sourceName);
      const sourceDir = path.join(getSkillsDir(), sourceSlug);

      if (!fs.existsSync(sourceDir)) {
        return { content: [{ type: "text" as const, text: `Source skill "${sourceSlug}" not found.` }], isError: true };
      }

      try {
        const sourceMetadata = JSON.parse(
          fs.readFileSync(path.join(sourceDir, "metadata.json"), "utf-8")
        ) as SkillMetadata;

        const sourceCode = fs.readFileSync(path.join(sourceDir, "index.ts"), "utf-8");
        let sourceInstructions = "";
        try {
          sourceInstructions = fs.readFileSync(path.join(sourceDir, "SKILL.md"), "utf-8");
        } catch {}

        const newSlug = slugify(newName);
        const newDir = path.join(getSkillsDir(), newSlug);
        fs.mkdirSync(newDir, { recursive: true });

        // Write forked files
        fs.writeFileSync(path.join(newDir, "index.ts"), newCode ?? sourceCode, "utf-8");
        fs.writeFileSync(path.join(newDir, "SKILL.md"), sourceInstructions, "utf-8");

        const metadata: SkillMetadata = {
          name: newSlug,
          description: newDescription ?? sourceMetadata.description,
          tags: newTags ?? sourceMetadata.tags,
          author: `forked from ${sourceSlug}`,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          useCount: 0,
          requirements: sourceMetadata.requirements,
          inputSchema: sourceMetadata.inputSchema,
        };
        fs.writeFileSync(path.join(newDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: `🍴 Forked "${sourceSlug}" → "${newSlug}"\n📁 ${newDir}${newCode ? "\n✏️ Code updated" : "\n📋 Code copied as-is"}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Import skill from workspace ────────────────────────────────────

  server.tool(
    "skills_import_from_chat",
    "Extract and save a skill from a workspace's chat history. Useful when an agent figures out a workflow — capture it as a reusable skill.",
    {
      workspaceId: z.string().describe("Workspace to extract from"),
      name: z.string().describe("Skill name"),
      description: z.string().describe("What this skill does"),
      messageIndex: z.number().optional().describe("Index of the message containing the code (default: last assistant message)"),
      tags: z.array(z.string()).optional().describe("Tags"),
    },
    async ({ workspaceId, name, description, messageIndex, tags }) => {
      try {
        const replay = (await client.getFullReplay(workspaceId)) as Array<{
          role?: string;
          type?: string;
          content?: string;
          text?: string;
        }>;

        // Find the target message
        let targetMessage: string | undefined;

        if (messageIndex !== undefined) {
          const msg = replay[messageIndex];
          targetMessage = msg?.content ?? msg?.text;
        } else {
          // Last assistant message
          const assistantMsgs = replay.filter(
            (m) => m.role === "assistant" || m.type === "assistant"
          );
          if (assistantMsgs.length > 0) {
            const last = assistantMsgs[assistantMsgs.length - 1]!;
            targetMessage = last.content ?? last.text;
          }
        }

        if (!targetMessage) {
          return { content: [{ type: "text" as const, text: "No message found to extract code from." }], isError: true };
        }

        // Extract code blocks
        const codeBlocks: string[] = [];
        const regex = /```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/g;
        let match;
        while ((match = regex.exec(targetMessage)) !== null) {
          codeBlocks.push(match[1]!.trim());
        }

        if (codeBlocks.length === 0) {
          // No code blocks — use the whole message as instructions
          const slug = slugify(name);
          const skillDir = path.join(ensureSkillsDir(), slug);
          fs.mkdirSync(skillDir, { recursive: true });

          fs.writeFileSync(path.join(skillDir, "index.ts"), `// Extracted from workspace ${workspaceId}\n// No code blocks found — see SKILL.md for instructions\n`, "utf-8");
          fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}\n\n${description}\n\n## Extracted Instructions\n\n${targetMessage}`, "utf-8");

          const metadata: SkillMetadata = {
            name: slug, description, tags: tags ?? [],
            author: `extracted from ${workspaceId}`, version: 1,
            createdAt: Date.now(), updatedAt: Date.now(), useCount: 0,
          };
          fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

          return {
            content: [{ type: "text" as const, text: `✅ Saved skill "${slug}" (instructions only, no code blocks found)` }],
          };
        }

        // Save the extracted code
        const code = codeBlocks.join("\n\n// ---\n\n");
        const slug = slugify(name);
        const skillDir = path.join(ensureSkillsDir(), slug);
        fs.mkdirSync(skillDir, { recursive: true });

        fs.writeFileSync(path.join(skillDir, "index.ts"), code, "utf-8");
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${name}\n\n${description}\n\n## Source\n\nExtracted from workspace \`${workspaceId}\`\n\n## Code Blocks Found: ${codeBlocks.length}`, "utf-8");

        const metadata: SkillMetadata = {
          name: slug, description, tags: tags ?? [],
          author: `extracted from ${workspaceId}`, version: 1,
          createdAt: Date.now(), updatedAt: Date.now(), useCount: 0,
        };
        fs.writeFileSync(path.join(skillDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: `✅ Extracted skill "${slug}" from workspace ${workspaceId}\n   ${codeBlocks.length} code blocks (${code.length} bytes)\n   Tags: ${(tags ?? []).join(", ") || "none"}`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
