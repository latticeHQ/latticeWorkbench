import * as path from "path";
import * as jsonc from "jsonc-parser";
import assert from "@/common/utils/assert";
import type { MinionMCPOverrides } from "@/common/types/mcp";
import type { RuntimeConfig } from "@/common/types/runtime";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { Config } from "@/node/config";
import { type createRuntime } from "@/node/runtime/runtimeFactory";
import { createRuntimeForMinion } from "@/node/runtime/runtimeHelpers";
import { execBuffered, readFileString, writeFileString } from "@/node/utils/runtime/helpers";
import { log } from "@/node/services/log";
import { getErrorMessage } from "@/common/utils/errors";

const MCP_OVERRIDES_DIR = ".lattice";
const MCP_OVERRIDES_JSONC = "mcp.local.jsonc";
const MCP_OVERRIDES_JSON = "mcp.local.json";

const MCP_OVERRIDES_GITIGNORE_PATTERNS = [
  `${MCP_OVERRIDES_DIR}/${MCP_OVERRIDES_JSONC}`,
  `${MCP_OVERRIDES_DIR}/${MCP_OVERRIDES_JSON}`,
];

function joinForRuntime(runtimeConfig: RuntimeConfig | undefined, ...parts: string[]): string {
  assert(parts.length > 0, "joinForRuntime requires at least one path segment");

  // Remote runtimes run inside a POSIX shell (SSH host, Docker container), even if the user is
  // running lattice on Windows. Use POSIX joins so we don't accidentally introduce backslashes.
  const usePosix = runtimeConfig?.type === "ssh" || runtimeConfig?.type === "docker";
  return usePosix ? path.posix.join(...parts) : path.join(...parts);
}

function isAbsoluteForRuntime(runtimeConfig: RuntimeConfig | undefined, filePath: string): boolean {
  const usePosix = runtimeConfig?.type === "ssh" || runtimeConfig?.type === "docker";
  return usePosix ? path.posix.isAbsolute(filePath) : path.isAbsolute(filePath);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function normalizeMinionMcpOverrides(raw: unknown): MinionMCPOverrides {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const obj = raw as {
    disabledServers?: unknown;
    enabledServers?: unknown;
    toolAllowlist?: unknown;
  };

  const disabledServers = isStringArray(obj.disabledServers)
    ? [...new Set(obj.disabledServers.map((s) => s.trim()).filter(Boolean))]
    : undefined;

  const enabledServers = isStringArray(obj.enabledServers)
    ? [...new Set(obj.enabledServers.map((s) => s.trim()).filter(Boolean))]
    : undefined;

  let toolAllowlist: Record<string, string[]> | undefined;
  if (
    obj.toolAllowlist &&
    typeof obj.toolAllowlist === "object" &&
    !Array.isArray(obj.toolAllowlist)
  ) {
    const next: Record<string, string[]> = {};
    for (const [serverName, value] of Object.entries(
      obj.toolAllowlist as Record<string, unknown>
    )) {
      if (!serverName || typeof serverName !== "string") continue;
      if (!isStringArray(value)) continue;

      // Empty array is meaningful ("expose no tools"), so keep it.
      next[serverName] = [...new Set(value.map((t) => t.trim()).filter((t) => t.length > 0))];
    }

    if (Object.keys(next).length > 0) {
      toolAllowlist = next;
    }
  }

  const normalized: MinionMCPOverrides = {
    disabledServers: disabledServers && disabledServers.length > 0 ? disabledServers : undefined,
    enabledServers: enabledServers && enabledServers.length > 0 ? enabledServers : undefined,
    toolAllowlist,
  };

  // Drop empty object to keep persistence clean.
  if (!normalized.disabledServers && !normalized.enabledServers && !normalized.toolAllowlist) {
    return {};
  }

  return normalized;
}

function isEmptyOverrides(overrides: MinionMCPOverrides): boolean {
  return (
    (!overrides.disabledServers || overrides.disabledServers.length === 0) &&
    (!overrides.enabledServers || overrides.enabledServers.length === 0) &&
    (!overrides.toolAllowlist || Object.keys(overrides.toolAllowlist).length === 0)
  );
}

async function statIsFile(
  runtime: ReturnType<typeof createRuntime>,
  filePath: string
): Promise<boolean> {
  try {
    const stat = await runtime.stat(filePath);
    return !stat.isDirectory;
  } catch {
    return false;
  }
}

export class MinionMcpOverridesService {
  constructor(private readonly config: Config) {
    assert(config, "MinionMcpOverridesService requires a Config instance");
  }

  private async getMinionMetadata(minionId: string): Promise<FrontendMinionMetadata> {
    assert(typeof minionId === "string", "minionId must be a string");
    const trimmed = minionId.trim();
    assert(trimmed.length > 0, "minionId must not be empty");

    const all = await this.config.getAllMinionMetadata();
    const metadata = all.find((m) => m.id === trimmed);
    if (!metadata) {
      throw new Error(`Minion metadata not found for ${trimmed}`);
    }

    return metadata;
  }

  private getLegacyOverridesFromConfig(minionId: string): MinionMCPOverrides | undefined {
    const config = this.config.loadConfigOrDefault();

    for (const [_projectPath, projectConfig] of config.projects) {
      const minion = projectConfig.minions.find((w) => w.id === minionId);
      if (minion) {
        // NOTE: Legacy storage (PR #1180) wrote overrides into ~/.lattice/config.json.
        // We keep reading it here only to migrate into the minion-local file.
        return minion.mcp;
      }
    }

    return undefined;
  }

  private async clearLegacyOverridesInConfig(minionId: string): Promise<void> {
    await this.config.editConfig((config) => {
      for (const [_projectPath, projectConfig] of config.projects) {
        const minion = projectConfig.minions.find((w) => w.id === minionId);
        if (minion) {
          delete minion.mcp;
          return config;
        }
      }
      return config;
    });
  }

  private async getRuntimeAndMinionPath(minionId: string): Promise<{
    metadata: FrontendMinionMetadata;
    runtime: ReturnType<typeof createRuntime>;
    minionPath: string;
  }> {
    const metadata = await this.getMinionMetadata(minionId);

    const runtime = createRuntimeForMinion(metadata);

    // In-place minions (CLI/benchmarks) store the minion path directly by setting
    // metadata.projectPath === metadata.name.
    const isInPlace = metadata.projectPath === metadata.name;
    const minionPath = isInPlace
      ? metadata.projectPath
      : runtime.getMinionPath(metadata.projectPath, metadata.name);

    assert(
      typeof minionPath === "string" && minionPath.length > 0,
      "minionPath is required"
    );

    return { metadata, runtime, minionPath };
  }

  private getOverridesFilePaths(
    minionPath: string,
    runtimeConfig: RuntimeConfig | undefined
  ): {
    jsoncPath: string;
    jsonPath: string;
  } {
    assert(typeof minionPath === "string", "minionPath must be a string");

    return {
      jsoncPath: joinForRuntime(
        runtimeConfig,
        minionPath,
        MCP_OVERRIDES_DIR,
        MCP_OVERRIDES_JSONC
      ),
      jsonPath: joinForRuntime(runtimeConfig, minionPath, MCP_OVERRIDES_DIR, MCP_OVERRIDES_JSON),
    };
  }

  private async readOverridesFile(
    runtime: ReturnType<typeof createRuntime>,
    filePath: string
  ): Promise<unknown> {
    try {
      const raw = await readFileString(runtime, filePath);
      const errors: jsonc.ParseError[] = [];
      const parsed: unknown = jsonc.parse(raw, errors) as unknown;
      if (errors.length > 0) {
        log.warn("[MCP] Failed to parse minion MCP overrides (JSONC parse errors)", {
          filePath,
          errorCount: errors.length,
        });
        return {};
      }
      return parsed;
    } catch (error) {
      // Treat any read failure as "no overrides".
      log.debug("[MCP] Failed to read minion MCP overrides file", { filePath, error });
      return {};
    }
  }

  private async ensureOverridesDir(
    runtime: ReturnType<typeof createRuntime>,
    minionPath: string,
    runtimeConfig: RuntimeConfig | undefined
  ): Promise<void> {
    const overridesDirPath = joinForRuntime(runtimeConfig, minionPath, MCP_OVERRIDES_DIR);

    try {
      await runtime.ensureDir(overridesDirPath);
    } catch (err) {
      const msg = getErrorMessage(err);
      throw new Error(`Failed to create ${MCP_OVERRIDES_DIR} directory: ${msg}`);
    }
  }

  private async ensureOverridesGitignored(
    runtime: ReturnType<typeof createRuntime>,
    minionPath: string,
    runtimeConfig: RuntimeConfig | undefined
  ): Promise<void> {
    try {
      const isInsideGitResult = await execBuffered(runtime, "git rev-parse --is-inside-work-tree", {
        cwd: minionPath,
        timeout: 10,
      });
      if (isInsideGitResult.exitCode !== 0 || isInsideGitResult.stdout.trim() !== "true") {
        return;
      }

      const excludePathResult = await execBuffered(
        runtime,
        "git rev-parse --git-path info/exclude",
        {
          cwd: minionPath,
          timeout: 10,
        }
      );
      if (excludePathResult.exitCode !== 0) {
        return;
      }

      const excludeFilePathRaw = excludePathResult.stdout.trim();
      if (excludeFilePathRaw.length === 0) {
        return;
      }

      const excludeFilePath = isAbsoluteForRuntime(runtimeConfig, excludeFilePathRaw)
        ? excludeFilePathRaw
        : joinForRuntime(runtimeConfig, minionPath, excludeFilePathRaw);

      let existing = "";
      try {
        existing = await readFileString(runtime, excludeFilePath);
      } catch {
        // Missing exclude file is OK.
      }

      const existingPatterns = new Set(
        existing
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      );
      const missingPatterns = MCP_OVERRIDES_GITIGNORE_PATTERNS.filter(
        (pattern) => !existingPatterns.has(pattern)
      );
      if (missingPatterns.length === 0) {
        return;
      }

      const needsNewline = existing.length > 0 && !existing.endsWith("\n");
      const updated = existing + (needsNewline ? "\n" : "") + missingPatterns.join("\n") + "\n";

      await writeFileString(runtime, excludeFilePath, updated);
    } catch (error) {
      // Best-effort only; never fail a minion operation because git ignore couldn't be updated.
      log.debug("[MCP] Failed to add minion MCP overrides file to git exclude", {
        minionPath,
        error,
      });
    }
  }

  private async removeOverridesFile(
    runtime: ReturnType<typeof createRuntime>,
    minionPath: string
  ): Promise<void> {
    // Best-effort: remove both file names so we never leave conflicting sources behind.
    await execBuffered(
      runtime,
      `rm -f "${MCP_OVERRIDES_DIR}/${MCP_OVERRIDES_JSONC}" "${MCP_OVERRIDES_DIR}/${MCP_OVERRIDES_JSON}"`,
      {
        cwd: minionPath,
        timeout: 10,
      }
    );
  }

  /**
   * Read minion MCP overrides from <minion>/.lattice/mcp.local.jsonc.
   *
   * If the file doesn't exist, we fall back to legacy overrides stored in ~/.lattice/config.json
   * and migrate them into the minion-local file.
   */
  async getOverridesForMinion(minionId: string): Promise<MinionMCPOverrides> {
    const { metadata, runtime, minionPath } = await this.getRuntimeAndMinionPath(minionId);
    const { jsoncPath, jsonPath } = this.getOverridesFilePaths(
      minionPath,
      metadata.runtimeConfig
    );

    // Prefer JSONC, then JSON.
    const jsoncExists = await statIsFile(runtime, jsoncPath);
    if (jsoncExists) {
      const parsed = await this.readOverridesFile(runtime, jsoncPath);
      return normalizeMinionMcpOverrides(parsed);
    }

    const jsonExists = await statIsFile(runtime, jsonPath);
    if (jsonExists) {
      const parsed = await this.readOverridesFile(runtime, jsonPath);
      return normalizeMinionMcpOverrides(parsed);
    }

    // No minion-local file => try migrating legacy config.json storage.
    const legacy = this.getLegacyOverridesFromConfig(minionId);
    if (!legacy || isEmptyOverrides(legacy)) {
      return {};
    }

    const normalizedLegacy = normalizeMinionMcpOverrides(legacy);
    if (isEmptyOverrides(normalizedLegacy)) {
      return {};
    }

    try {
      await this.ensureOverridesDir(runtime, minionPath, metadata.runtimeConfig);
      await writeFileString(runtime, jsoncPath, JSON.stringify(normalizedLegacy, null, 2) + "\n");
      await this.ensureOverridesGitignored(runtime, minionPath, metadata.runtimeConfig);
      await this.clearLegacyOverridesInConfig(minionId);
      log.info("[MCP] Migrated minion MCP overrides from config.json", {
        minionId,
        filePath: jsoncPath,
      });
    } catch (error) {
      // Migration is best-effort; if it fails, still honor legacy overrides.
      log.warn("[MCP] Failed to migrate minion MCP overrides; using legacy config.json values", {
        minionId,
        error,
      });
    }

    return normalizedLegacy;
  }

  /**
   * Persist minion MCP overrides to <minion>/.lattice/mcp.local.jsonc.
   *
   * Empty overrides remove the minion-local file.
   */
  async setOverridesForMinion(
    minionId: string,
    overrides: MinionMCPOverrides
  ): Promise<void> {
    assert(overrides && typeof overrides === "object", "overrides must be an object");

    const { metadata, runtime, minionPath } = await this.getRuntimeAndMinionPath(minionId);
    const { jsoncPath } = this.getOverridesFilePaths(minionPath, metadata.runtimeConfig);

    const normalized = normalizeMinionMcpOverrides(overrides);

    // Always clear any legacy storage so we converge on the minion-local file.
    await this.clearLegacyOverridesInConfig(minionId);

    if (isEmptyOverrides(normalized)) {
      await this.removeOverridesFile(runtime, minionPath);
      return;
    }

    await this.ensureOverridesDir(runtime, minionPath, metadata.runtimeConfig);
    await writeFileString(runtime, jsoncPath, JSON.stringify(normalized, null, 2) + "\n");
    await this.ensureOverridesGitignored(runtime, minionPath, metadata.runtimeConfig);
  }
}
