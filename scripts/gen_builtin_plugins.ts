#!/usr/bin/env bun
/**
 * Generate built-in plugin pack registry.
 *
 * Usage:
 *   bun scripts/gen_builtin_plugins.ts         # write mode
 *   bun scripts/gen_builtin_plugins.ts check   # check mode
 *
 * This script writes:
 *   - src/node/services/pluginPacks/builtInPluginRegistry.generated.ts
 *
 * Source: src/node/builtinPlugins/_registry.json
 */

import * as fs from "fs";
import * as path from "path";
import * as prettier from "prettier";

const ARGS = new Set(process.argv.slice(2));
const MODE = ARGS.has("check") ? "check" : "write";

const PROJECT_ROOT = path.join(import.meta.dir, "..");
const REGISTRY_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "node",
  "builtinPlugins",
  "_registry.json"
);
const OUTPUT_PATH = path.join(
  PROJECT_ROOT,
  "src",
  "node",
  "services",
  "pluginPacks",
  "builtInPluginRegistry.generated.ts"
);

interface RegistryEntry {
  name: string;
  version: string;
  description: string;
  author: string;
  skills: string[];
  commands: string[];
  mcpServers: Record<string, { transport: string; url: string }>;
}

function generate(): string {
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(
      `Registry not found at ${REGISTRY_PATH}. Run 'bun scripts/convert_knowledge_plugins.ts' first.`
    );
  }

  const registry: Record<string, RegistryEntry> = JSON.parse(
    fs.readFileSync(REGISTRY_PATH, "utf-8")
  );

  // Read connectors content for each plugin
  const connectorsMap: Record<string, string> = {};
  const pluginsDir = path.dirname(REGISTRY_PATH);
  for (const [name] of Object.entries(registry)) {
    const connectorsPath = path.join(pluginsDir, name, "connectors.md");
    if (fs.existsSync(connectorsPath)) {
      connectorsMap[name] = fs.readFileSync(connectorsPath, "utf-8");
    }
  }

  let output = "";
  output += "// AUTO-GENERATED - DO NOT EDIT\n";
  output += "// Run: bun scripts/gen_builtin_plugins.ts\n";
  output += "// Source: src/node/builtinPlugins/_registry.json\n\n";

  output += "export interface PluginPackEntry {\n";
  output += "  name: string;\n";
  output += "  version: string;\n";
  output += "  description: string;\n";
  output += "  author: string;\n";
  output += "  skills: string[];\n";
  output += "  commands: string[];\n";
  output += "  mcpServers: Record<string, { transport: string; url: string }>;\n";
  output += "  connectors: string;\n";
  output += "}\n\n";

  output += "export const BUILTIN_PLUGIN_PACKS: Record<string, PluginPackEntry> = ";
  output += JSON.stringify(
    Object.fromEntries(
      Object.entries(registry).map(([name, entry]) => [
        name,
        {
          ...entry,
          connectors: connectorsMap[name] ?? "",
        },
      ])
    ),
    null,
    2
  );
  output += ";\n";

  return output;
}

async function main(): Promise<void> {
  const raw = generate();

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const prettierConfig = await prettier.resolveConfig(OUTPUT_PATH);
  const formatted = await prettier.format(raw, {
    ...prettierConfig,
    filepath: OUTPUT_PATH,
  });

  const current = fs.existsSync(OUTPUT_PATH)
    ? fs.readFileSync(OUTPUT_PATH, "utf-8")
    : null;
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
