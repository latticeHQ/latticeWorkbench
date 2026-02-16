import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, test } from "bun:test";

import { SkillNameSchema } from "@/common/orpc/schemas";
import { LocalRuntime } from "@/node/runtime/LocalRuntime";
import { DisposableTempDir } from "@/node/services/tempDir";
import { discoverAgentSkills, readAgentSkill } from "./agentSkillsService";

async function writeSkill(root: string, name: string, description: string): Promise<void> {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  const content = `---
name: ${name}
description: ${description}
---
Body
`;
  await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");
}

describe("agentSkillsService", () => {
  test("project skills override global skills", async () => {
    using project = new DisposableTempDir("agent-skills-project");
    using global = new DisposableTempDir("agent-skills-global");

    const projectSkillsRoot = path.join(project.path, ".lattice", "skills");
    const globalSkillsRoot = global.path;

    await writeSkill(globalSkillsRoot, "foo", "from global");
    await writeSkill(projectSkillsRoot, "foo", "from project");
    await writeSkill(globalSkillsRoot, "bar", "global only");

    const roots = { projectRoot: projectSkillsRoot, globalRoot: globalSkillsRoot };
    const runtime = new LocalRuntime(project.path);

    // Pass empty enabledPlugins to exclude plugin pack skills (test focuses on precedence logic)
    const skills = await discoverAgentSkills(runtime, project.path, {
      roots,
      enabledPlugins: new Set(),
    });

    // Should include project/global skills plus core built-in skills (no plugin skills)
    const names = skills.map((s) => s.name);
    expect(names).toContain("bar");
    expect(names).toContain("foo");
    // Core built-in skills should always be present
    expect(names).toContain("init");
    expect(names).toContain("lattice-docs");
    // No plugin skills should appear (enabledPlugins is empty)
    expect(names.some((n) => n.startsWith("sales-"))).toBe(false);
    expect(names.some((n) => n.startsWith("marketing-"))).toBe(false);

    const foo = skills.find((s) => s.name === "foo");
    expect(foo).toBeDefined();
    expect(foo!.scope).toBe("project");
    expect(foo!.description).toBe("from project");

    const bar = skills.find((s) => s.name === "bar");
    expect(bar).toBeDefined();
    expect(bar!.scope).toBe("global");
  });

  test("readAgentSkill resolves project before global", async () => {
    using project = new DisposableTempDir("agent-skills-project");
    using global = new DisposableTempDir("agent-skills-global");

    const projectSkillsRoot = path.join(project.path, ".lattice", "skills");
    const globalSkillsRoot = global.path;

    await writeSkill(globalSkillsRoot, "foo", "from global");
    await writeSkill(projectSkillsRoot, "foo", "from project");

    const roots = { projectRoot: projectSkillsRoot, globalRoot: globalSkillsRoot };
    const runtime = new LocalRuntime(project.path);

    const name = SkillNameSchema.parse("foo");
    const resolved = await readAgentSkill(runtime, project.path, name, { roots });

    expect(resolved.package.scope).toBe("project");
    expect(resolved.package.frontmatter.description).toBe("from project");
  });

  test("readAgentSkill can read built-in skills", async () => {
    using project = new DisposableTempDir("agent-skills-project");
    using global = new DisposableTempDir("agent-skills-global");

    const projectSkillsRoot = path.join(project.path, ".lattice", "skills");
    const globalSkillsRoot = global.path;

    const roots = { projectRoot: projectSkillsRoot, globalRoot: globalSkillsRoot };
    const runtime = new LocalRuntime(project.path);

    const name = SkillNameSchema.parse("lattice-docs");
    const resolved = await readAgentSkill(runtime, project.path, name, { roots });

    expect(resolved.package.scope).toBe("built-in");
    expect(resolved.package.frontmatter.name).toBe("lattice-docs");
    expect(resolved.skillDir).toBe("<built-in:lattice-docs>");
  });

  test("project/global skills override built-in skills", async () => {
    using project = new DisposableTempDir("agent-skills-project");
    using global = new DisposableTempDir("agent-skills-global");

    const projectSkillsRoot = path.join(project.path, ".lattice", "skills");
    const globalSkillsRoot = global.path;

    // Override the built-in lattice-docs skill with a project-local version
    await writeSkill(projectSkillsRoot, "lattice-docs", "custom docs from project");

    const roots = { projectRoot: projectSkillsRoot, globalRoot: globalSkillsRoot };
    const runtime = new LocalRuntime(project.path);

    const skills = await discoverAgentSkills(runtime, project.path, {
      roots,
      enabledPlugins: new Set(),
    });
    const latticeDocs = skills.find((s) => s.name === "lattice-docs");

    expect(latticeDocs).toBeDefined();
    expect(latticeDocs!.scope).toBe("project");
    expect(latticeDocs!.description).toBe("custom docs from project");

    // readAgentSkill should also return the project version
    const name = SkillNameSchema.parse("lattice-docs");
    const resolved = await readAgentSkill(runtime, project.path, name, { roots });
    expect(resolved.package.scope).toBe("project");
  });
});
