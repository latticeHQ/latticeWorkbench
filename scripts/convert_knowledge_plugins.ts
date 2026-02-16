#!/usr/bin/env bun
/**
 * Convert Anthropic's knowledge-work-plugins into Lattice Workbench built-in plugin format.
 *
 * Usage:
 *   bun scripts/convert_knowledge_plugins.ts [source-dir]
 *
 * Reads from the cloned knowledge-work-plugins repo and writes converted content
 * into src/node/builtinPlugins/.
 *
 * Each plugin's commands become skills (prefixed with plugin name), and each
 * plugin's skills are copied with metadata injection.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const DEFAULT_SOURCE = path.join(PROJECT_ROOT, "..", "knowledge-work-plugins-temp");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "src", "node", "builtinPlugins");

const sourceDir = process.argv[2] || DEFAULT_SOURCE;

if (!fs.existsSync(sourceDir)) {
  console.error(`Source directory not found: ${sourceDir}`);
  console.error("Clone https://github.com/anthropics/knowledge-work-plugins first.");
  process.exit(1);
}

// Plugin directories to process (skip hidden files, README, LICENSE)
const SKIP_ENTRIES = new Set(["README.md", "LICENSE", ".git", ".claude-plugin"]);

interface PluginMeta {
  name: string;
  version: string;
  description: string;
  author: string;
}

interface McpServerEntry {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  recommendedCategories?: string[];
}

function normalizeNewlines(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseYamlFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const normalized = normalizeNewlines(content);
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r")) {
    return { frontmatter: null, body: normalized };
  }

  const lines = normalized.split("\n");
  const endIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === "---");
  if (endIndex === -1) {
    return { frontmatter: null, body: normalized };
  }

  const yamlText = lines.slice(1, endIndex).join("\n");
  try {
    const parsed = yaml.parse(yamlText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { frontmatter: null, body: normalized };
    }
    const body = lines.slice(endIndex + 1).join("\n");
    return { frontmatter: parsed as Record<string, unknown>, body };
  } catch {
    return { frontmatter: null, body: normalized };
  }
}

function toKebabCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSkillFrontmatter(opts: {
  name: string;
  description: string;
  plugin: string;
  type: "command" | "skill";
  pluginVersion: string;
  argumentHint?: string;
}): string {
  const lines = ["---"];
  lines.push(`name: ${opts.name}`);

  // Use YAML block scalar for multi-line descriptions
  const desc = opts.description.trim();
  if (desc.includes("\n")) {
    lines.push("description: |");
    for (const line of desc.split("\n")) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push(`description: ${yamlScalar(desc)}`);
  }

  lines.push("metadata:");
  lines.push(`  plugin: ${opts.plugin}`);
  lines.push(`  type: ${opts.type}`);
  lines.push(`  plugin-version: "${opts.pluginVersion}"`);
  if (opts.argumentHint) {
    lines.push(`  argument-hint: ${yamlScalar(opts.argumentHint)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function yamlScalar(value: string): string {
  // If value contains special chars, quote it
  if (
    value.includes(":") ||
    value.includes("#") ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes("\n") ||
    value.startsWith("{") ||
    value.startsWith("[") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    value.startsWith("!") ||
    value.startsWith("|") ||
    value.startsWith(">") ||
    value.startsWith("%") ||
    value.startsWith("@") ||
    value.startsWith("`")
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function copyDirectoryRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readPluginMeta(pluginDir: string): PluginMeta | null {
  const pluginJsonPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(pluginJsonPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(pluginJsonPath, "utf-8"));
    return {
      name: raw.name ?? path.basename(pluginDir),
      version: raw.version ?? "1.0.0",
      description: raw.description ?? "",
      author: raw.author?.name ?? "Anthropic",
    };
  } catch {
    return null;
  }
}

function readMcpConfig(pluginDir: string): McpConfig {
  const mcpPath = path.join(pluginDir, ".mcp.json");
  if (!fs.existsSync(mcpPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(mcpPath, "utf-8")) as McpConfig;
  } catch {
    return {};
  }
}

function readConnectors(pluginDir: string): string {
  const connectorsPath = path.join(pluginDir, "CONNECTORS.md");
  if (!fs.existsSync(connectorsPath)) return "";

  return normalizeNewlines(fs.readFileSync(connectorsPath, "utf-8"));
}

interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  skills: string[];
  commands: string[];
  mcpServers: Record<string, { transport: string; url: string }>;
}

function convertCommand(
  pluginName: string,
  pluginVersion: string,
  commandFilePath: string,
  outputDir: string
): string | null {
  const basename = path.basename(commandFilePath, ".md");
  const skillName = `${pluginName}-${toKebabCase(basename)}`;

  // Validate skill name length
  if (skillName.length > 64) {
    console.warn(`  Warning: skill name too long (${skillName.length} chars), truncating: ${skillName}`);
    return null;
  }

  const rawContent = normalizeNewlines(fs.readFileSync(commandFilePath, "utf-8"));
  const { frontmatter, body } = parseYamlFrontmatter(rawContent);

  const description = (frontmatter?.description as string) ?? `${basename} command`;
  const argumentHint = frontmatter?.["argument-hint"] as string | undefined;

  const newFrontmatter = buildSkillFrontmatter({
    name: skillName,
    description,
    plugin: pluginName,
    type: "command",
    pluginVersion,
    argumentHint,
  });

  const skillDir = path.join(outputDir, "commands", skillName);
  fs.mkdirSync(skillDir, { recursive: true });

  const skillContent = `${newFrontmatter}\n${body}`;
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillContent, "utf-8");

  return skillName;
}

function convertSkill(
  pluginName: string,
  pluginVersion: string,
  skillSourceDir: string,
  outputDir: string
): string | null {
  const originalName = path.basename(skillSourceDir);
  const skillName = `${pluginName}-${toKebabCase(originalName)}`;

  if (skillName.length > 64) {
    console.warn(`  Warning: skill name too long (${skillName.length} chars), truncating: ${skillName}`);
    return null;
  }

  const skillMdPath = path.join(skillSourceDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    console.warn(`  Warning: no SKILL.md in ${skillSourceDir}, skipping`);
    return null;
  }

  const rawContent = normalizeNewlines(fs.readFileSync(skillMdPath, "utf-8"));
  const { frontmatter, body } = parseYamlFrontmatter(rawContent);

  const description =
    (frontmatter?.description as string) ?? `${originalName} skill`;

  const newFrontmatter = buildSkillFrontmatter({
    name: skillName,
    description,
    plugin: pluginName,
    type: "skill",
    pluginVersion,
  });

  const destDir = path.join(outputDir, "skills", skillName);
  fs.mkdirSync(destDir, { recursive: true });

  const skillContent = `${newFrontmatter}\n${body}`;
  fs.writeFileSync(path.join(destDir, "SKILL.md"), skillContent, "utf-8");

  // Copy references/, scripts/, examples/ subdirectories
  for (const subdir of ["references", "scripts", "examples"]) {
    const subdirPath = path.join(skillSourceDir, subdir);
    if (fs.existsSync(subdirPath)) {
      copyDirectoryRecursive(subdirPath, path.join(destDir, subdir));
    }
  }

  return skillName;
}

function convertPlugin(pluginDirName: string): RegistryEntry | null {
  const pluginDir = path.join(sourceDir, pluginDirName);
  if (!fs.statSync(pluginDir).isDirectory()) return null;

  const meta = readPluginMeta(pluginDir);
  if (!meta) {
    console.warn(`  Skipping ${pluginDirName}: no plugin.json found`);
    return null;
  }

  console.log(`Converting plugin: ${meta.name} (v${meta.version})`);

  const outputPluginDir = path.join(OUTPUT_DIR, meta.name);

  // Clean existing output for this plugin
  if (fs.existsSync(outputPluginDir)) {
    fs.rmSync(outputPluginDir, { recursive: true });
  }
  fs.mkdirSync(outputPluginDir, { recursive: true });

  const commands: string[] = [];
  const skills: string[] = [];

  // Convert commands
  const commandsDir = path.join(pluginDir, "commands");
  if (fs.existsSync(commandsDir)) {
    const commandFiles = fs
      .readdirSync(commandsDir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const cmdFile of commandFiles) {
      const cmdPath = path.join(commandsDir, cmdFile);
      const skillName = convertCommand(meta.name, meta.version, cmdPath, outputPluginDir);
      if (skillName) {
        commands.push(skillName);
        console.log(`  Command: ${cmdFile} -> ${skillName}`);
      }
    }
  }

  // Convert skills
  const skillsDir = path.join(pluginDir, "skills");
  if (fs.existsSync(skillsDir)) {
    const skillDirs = fs
      .readdirSync(skillsDir)
      .filter((d) => {
        const fullPath = path.join(skillsDir, d);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort();

    for (const skillDirName of skillDirs) {
      const skillSourcePath = path.join(skillsDir, skillDirName);
      const skillName = convertSkill(meta.name, meta.version, skillSourcePath, outputPluginDir);
      if (skillName) {
        skills.push(skillName);
        console.log(`  Skill: ${skillDirName} -> ${skillName}`);
      }
    }
  }

  // Copy MCP config
  const mcpConfig = readMcpConfig(pluginDir);
  const mcpServers: Record<string, { transport: string; url: string }> = {};
  if (mcpConfig.mcpServers) {
    for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
      mcpServers[name] = {
        transport: server.type ?? "http",
        url: server.url ?? "",
      };
    }
    fs.writeFileSync(
      path.join(outputPluginDir, "mcp.json"),
      JSON.stringify({ mcpServers: mcpServers }, null, 2),
      "utf-8"
    );
  }

  // Copy connectors
  const connectors = readConnectors(pluginDir);
  if (connectors) {
    fs.writeFileSync(path.join(outputPluginDir, "connectors.md"), connectors, "utf-8");
  }

  return {
    name: meta.name,
    version: meta.version,
    description: meta.description,
    author: meta.author,
    skills: [...commands, ...skills],
    commands,
    mcpServers,
  };
}

function main(): void {
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log("");

  const pluginDirs = fs
    .readdirSync(sourceDir)
    .filter((entry) => {
      if (SKIP_ENTRIES.has(entry) || entry.startsWith(".")) return false;
      const fullPath = path.join(sourceDir, entry);
      return fs.statSync(fullPath).isDirectory();
    })
    .sort();

  const registry: Record<string, RegistryEntry> = {};

  for (const pluginDirName of pluginDirs) {
    const entry = convertPlugin(pluginDirName);
    if (entry) {
      registry[entry.name] = entry;
    }
    console.log("");
  }

  // Write registry
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "_registry.json"),
    JSON.stringify(registry, null, 2),
    "utf-8"
  );

  // Summary
  const totalCommands = Object.values(registry).reduce((sum, e) => sum + e.commands.length, 0);
  const totalSkills = Object.values(registry).reduce(
    (sum, e) => sum + e.skills.length - e.commands.length,
    0
  );
  console.log("=== Summary ===");
  console.log(`Plugins: ${Object.keys(registry).length}`);
  console.log(`Commands converted to skills: ${totalCommands}`);
  console.log(`Skills copied: ${totalSkills}`);
  console.log(`Total skill entries: ${totalCommands + totalSkills}`);
  console.log(`Registry written to: ${path.join(OUTPUT_DIR, "_registry.json")}`);
}

main();
