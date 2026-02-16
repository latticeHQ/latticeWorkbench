import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, it, expect } from "bun:test";
import type { ToolCallOptions } from "ai";

import { AgentSkillReadToolResultSchema } from "@/common/utils/tools/toolDefinitions";
import { LATTICE_HELP_CHAT_WORKSPACE_ID } from "@/common/constants/latticeChat";
import { createAgentSkillReadTool } from "./agent_skill_read";
import { createTestToolConfig, TestTempDir } from "./testHelpers";

const mockToolCallOptions: ToolCallOptions = {
  toolCallId: "test-call-id",
  messages: [],
};

async function writeProjectSkill(workspacePath: string, name: string): Promise<void> {
  const skillDir = path.join(workspacePath, ".lattice", "skills", name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: test\n---\nBody\n`,
    "utf-8"
  );
}

describe("agent_skill_read (Chat with Lattice sandbox)", () => {
  it("allows reading built-in skills", async () => {
    using tempDir = new TestTempDir("test-agent-skill-read-lattice-chat");
    const baseConfig = createTestToolConfig(tempDir.path, {
      workspaceId: LATTICE_HELP_CHAT_WORKSPACE_ID,
    });

    const tool = createAgentSkillReadTool(baseConfig);

    const raw: unknown = await Promise.resolve(
      tool.execute!({ name: "lattice-docs" }, mockToolCallOptions)
    );

    const parsed = AgentSkillReadToolResultSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const result = parsed.data;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.skill.scope).toBe("built-in");
      expect(result.skill.frontmatter.name).toBe("lattice-docs");
    }
  });

  it("rejects project/global skills on disk", async () => {
    using tempDir = new TestTempDir("test-agent-skill-read-lattice-chat-reject");
    await writeProjectSkill(tempDir.path, "foo");

    const baseConfig = createTestToolConfig(tempDir.path, {
      workspaceId: LATTICE_HELP_CHAT_WORKSPACE_ID,
    });
    const tool = createAgentSkillReadTool(baseConfig);

    const raw: unknown = await Promise.resolve(tool.execute!({ name: "foo" }, mockToolCallOptions));

    const parsed = AgentSkillReadToolResultSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const result = parsed.data;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/only built-in skills/i);
    }
  });
});
