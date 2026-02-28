#!/usr/bin/env bun
/**
 * Generate built-in agent skills content.
 *
 * Usage:
 *   bun scripts/gen_builtin_skills.ts         # write mode
 *   bun scripts/gen_builtin_skills.ts check   # check mode
 *
 * This script writes:
 *   - src/node/services/agentSkills/builtInSkillContent.generated.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";

const ARGS = new Set(process.argv.slice(2));
const MODE = ARGS.has("check") ? "check" : "write";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const BUILTIN_SKILLS_DIR = path.join(PROJECT_ROOT, "src", "node", "builtinSkills");
const OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "node",
  "services",
  "agentSkills",
  "builtInSkillContent.generated.ts"
);

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function renderJoinedLines(lines: string[], indent: string): string {
  const innerIndent = indent + "  ";
  const rendered = lines.map((line) => `${innerIndent}${JSON.stringify(line)},`).join("\n");
  return `[\n${rendered}\n${indent}].join(\"\\n\")`;
}

function generate(): string {
  const skills = fs
    .readdirSync(BUILTIN_SKILLS_DIR)
    .filter((entry) => entry.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const fileMaps: Record<string, Record<string, string[]>> = {};

  for (const filename of skills) {
    const skillName = filename.slice(0, -3);
    const skillPath = path.join(BUILTIN_SKILLS_DIR, filename);

    const skillContent = normalizeNewlines(fs.readFileSync(skillPath, "utf-8"));

    const files: Record<string, string[]> = {
      "SKILL.md": skillContent.split("\n"),
    };

    fileMaps[skillName] = files;
  }

  let output = "";
  output += "// AUTO-GENERATED - DO NOT EDIT\n";
  output += "// Run: bun scripts/gen_builtin_skills.ts\n";
  output += "// Source: src/node/builtinSkills/*.md\n\n";
  output += "export const BUILTIN_SKILL_FILES: Record<string, Record<string, string>> = {\n";

  const sortedSkillNames = Object.keys(fileMaps).sort((a, b) => a.localeCompare(b));
  for (const skillName of sortedSkillNames) {
    output += `  ${JSON.stringify(skillName)}: {\n`;
    const files = fileMaps[skillName] ?? {};
    for (const filePath of Object.keys(files).sort((a, b) => a.localeCompare(b))) {
      output += `    ${JSON.stringify(filePath)}: ${renderJoinedLines(files[filePath]!, "    ")},\n`;
    }
    output += "  },\n";
  }

  output += "};\n";

  return output;
}

async function main(): Promise<void> {
  const raw = generate();

  const prettierConfig = await prettier.resolveConfig(OUTPUT_PATH);
  const formatted = await prettier.format(raw, {
    ...prettierConfig,
    filepath: OUTPUT_PATH,
  });

  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, "utf-8") : null;
  const outOfSync = current !== formatted;

  if (MODE === "check") {
    if (!outOfSync) {
      console.log(`✓ ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} is up-to-date`);
      return;
    }

    console.error(`✗ ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} is out of sync`);
    console.error("  Run 'make fmt' to regenerate.");
    process.exit(1);
  }

  if (outOfSync) {
    fs.writeFileSync(OUTPUT_PATH, formatted, "utf-8");
    console.log(`✓ Updated ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`);
  } else {
    console.log(`✓ ${path.relative(PROJECT_ROOT, OUTPUT_PATH)} is up-to-date`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
