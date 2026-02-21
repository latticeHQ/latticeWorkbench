/**
 * Agent Bootstrap — Auto-install CLI agents on remote runtimes + runtime-aware detection.
 *
 * Two main capabilities:
 *
 * 1. **Bootstrap** (`bootstrapAgentsOnRemote`):
 *    During workspace init on SSH/Docker runtimes, detects which CLI agents the
 *    user has locally and installs them on the remote so `hire_employee` works.
 *    Includes `ensureInstallPrerequisites()` to install node/npm and curl on
 *    minimal Docker images (Debian, Alpine, RHEL, etc.).
 *
 * 2. **Runtime-aware detection** (`detectAgentsOnRuntime`):
 *    Probes a remote runtime to discover which CLI agents are actually available
 *    there. Used by the ORPC `cliAgents.detect` handler when a workspaceId is
 *    provided, so the "Hire an Employee" UI shows what's on the workspace runtime
 *    rather than the local host.
 *
 * Filtering:
 *   - Only "cli" category agents (skip "app" / "vscode-extension")
 *   - Install prerequisite tools (npm, curl, brew, uv) are checked before
 *     attempting installs — avoids "brew: command not found" on Linux Docker.
 *
 * Failures are non-fatal: logged but never block workspace init.
 */

import type { InitHookRuntime } from "./initHook";
import { createLineBufferedLoggers } from "./initHook";
import type { InitLogger } from "./Runtime";
import type { CliAgentDetectionService } from "@/node/services/cliAgentDetectionService";
import {
  CLI_AGENT_DEFINITIONS,
  CLI_AGENT_SLUGS,
  type CliAgentSlug,
  type CliAgentDefinition,
} from "@/common/constants/cliAgents";
import type { CliAgentDetectionResult } from "@/common/orpc/types";
import { streamToString } from "./streamUtils";
import { log } from "@/node/services/log";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the base command that an install command requires.
 * E.g., "npm install -g foo" → "npm", "curl -fsSL ... | bash" → "curl",
 * "brew tap ... && brew install ..." → "brew", "uv tool install ..." → "uv"
 */
function getInstallPrerequisite(installCommand: string): string | null {
  const trimmed = installCommand.trim();
  // First word is the command (or a env assignment like KEY=val cmd ...)
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    // Skip environment variable assignments (e.g., "KEY=value")
    if (part.includes("=") && !part.startsWith("/")) continue;
    // Return the base command name (strip path)
    return part.split("/").pop() ?? part;
  }
  return null;
}

/**
 * Simple shell quoting for a single argument.
 * Wraps in single quotes with proper escaping of embedded single quotes.
 */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Run a command on the runtime and return the exit code.
 * Returns -1 if the exec call itself throws.
 */
async function execExitCode(
  runtime: InitHookRuntime,
  command: string,
  timeout = 10
): Promise<number> {
  try {
    const stream = await runtime.exec(command, { cwd: "/tmp", timeout });
    return await stream.exitCode;
  } catch {
    return -1;
  }
}

/**
 * Run a command on the runtime and return trimmed stdout (empty on failure).
 */
async function execStdout(
  runtime: InitHookRuntime,
  command: string,
  timeout = 10
): Promise<string> {
  try {
    const stream = await runtime.exec(command, { cwd: "/tmp", timeout });
    const [exitCode, stdout] = await Promise.all([
      stream.exitCode,
      streamToString(stream.stdout),
    ]);
    if (exitCode === 0) return stdout.trim();
    return "";
  } catch {
    return "";
  }
}

// ─── Runtime-Aware Detection ─────────────────────────────────────────────────

/**
 * Detect CLI agents available on a remote runtime.
 *
 * Probes each CLI agent definition by running `which <binary>` and optionally
 * `<binary> --version` on the remote. Returns results in the same format as
 * `cliAgentDetectionService.detectAll()` so the frontend can use them
 * interchangeably.
 *
 * Used by the ORPC `cliAgents.detect` handler when a workspace has a remote
 * runtime (SSH/Docker), so the "Hire an Employee" UI shows what's actually
 * available in the workspace environment.
 *
 * @param runtime - Remote runtime with exec() capability
 * @param abortSignal - Optional abort signal for cancellation
 */
export async function detectAgentsOnRuntime(
  runtime: InitHookRuntime,
  abortSignal?: AbortSignal
): Promise<CliAgentDetectionResult[]> {
  const results: CliAgentDetectionResult[] = [];

  for (const slug of CLI_AGENT_SLUGS) {
    if (abortSignal?.aborted) break;

    const def = CLI_AGENT_DEFINITIONS[slug] as CliAgentDefinition;
    if (def.category !== "cli") continue;

    const result: CliAgentDetectionResult = {
      slug,
      displayName: def.displayName,
      description: def.description,
      detected: false,
      installUrl: def.installUrl,
      installCommand: def.installCommand,
      category: def.category,
      supportedModels: def.supportedModels ? [...def.supportedModels] : undefined,
    };

    // Check each binary name (first hit wins).
    // Use a login shell (`sh -l -c ...`) so user-installed paths like
    // ~/.local/bin, ~/bin, ~/.cargo/bin etc. are on PATH — without this,
    // agents like Claude Code (installed to ~/.local/bin) aren't found.
    for (const binaryName of def.binaryNames) {
      const binaryPath = await execStdout(
        runtime,
        `sh -l -c 'which ${binaryName}' 2>/dev/null`
      );
      if (binaryPath) {
        result.detected = true;
        result.binaryPath = binaryPath;

        // Best-effort version detection (also via login shell for PATH)
        const versionOutput = await execStdout(
          runtime,
          `sh -l -c '${binaryName} --version 2>/dev/null | head -1'`
        );
        if (versionOutput) {
          // Extract version-like substring (e.g., "claude 1.2.3" → "1.2.3")
          const versionMatch = versionOutput.match(/(\d+\.\d+[\w.-]*)/);
          if (versionMatch) {
            result.version = versionMatch[1];
          }
        }
        break;
      }
    }

    // For GitHub Copilot, check if `gh copilot` extension is installed
    if (def.ghExtension && !result.detected) {
      const ghExtList = await execStdout(runtime, "gh extension list 2>/dev/null");
      if (ghExtList.toLowerCase().includes(def.ghExtension.toLowerCase())) {
        result.detected = true;
        result.binaryPath = "gh";
      }
    }

    results.push(result);
  }

  // Sort: detected first, then alphabetical
  results.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return results;
}

// ─── Prerequisite Installation ───────────────────────────────────────────────

/** Package manager install commands for common Linux distros */
const PKG_INSTALL_COMMANDS: Record<string, { npm: string; curl: string }> = {
  "apt-get": {
    npm: "apt-get update -qq && apt-get install -y -qq nodejs npm",
    curl: "apt-get update -qq && apt-get install -y -qq curl",
  },
  apk: {
    npm: "apk add --no-cache nodejs npm",
    curl: "apk add --no-cache curl",
  },
  dnf: {
    npm: "dnf install -y nodejs npm",
    curl: "dnf install -y curl",
  },
  yum: {
    npm: "yum install -y nodejs npm",
    curl: "yum install -y curl",
  },
};

/**
 * Detect the package manager available on a remote Linux system.
 * Returns the package manager name or null if none found.
 */
async function detectPackageManager(
  runtime: InitHookRuntime
): Promise<string | null> {
  for (const pm of ["apt-get", "apk", "dnf", "yum"]) {
    const exitCode = await execExitCode(runtime, `which ${pm} 2>/dev/null`);
    if (exitCode === 0) return pm;
  }
  return null;
}

/**
 * Ensure basic install prerequisites (node/npm, curl) are available on the
 * remote runtime. On minimal Docker images these may be missing, which would
 * cause all agent installs to fail silently.
 *
 * Detects the Linux package manager (apt-get, apk, dnf, yum) and installs
 * missing tools. Covers Debian, Ubuntu, Alpine, CentOS, RHEL, Fedora.
 *
 * Non-fatal: if prerequisite install fails, agent installs depending on
 * that tool will also fail, but we log and continue.
 */
async function ensureInstallPrerequisites(
  runtime: InitHookRuntime,
  initLogger: InitLogger
): Promise<void> {
  // Check what's already available
  const hasNpm = (await execExitCode(runtime, "which npm 2>/dev/null")) === 0;
  const hasCurl = (await execExitCode(runtime, "which curl 2>/dev/null")) === 0;

  if (hasNpm && hasCurl) {
    log.debug("[agent-bootstrap] Prerequisites already available (npm, curl)");
    return;
  }

  const pkgManager = await detectPackageManager(runtime);
  if (!pkgManager) {
    log.debug("[agent-bootstrap] No known package manager found, skipping prerequisite install");
    return;
  }

  const commands = PKG_INSTALL_COMMANDS[pkgManager];
  if (!commands) return;

  if (!hasNpm) {
    log.info(`[agent-bootstrap] Installing nodejs/npm via ${pkgManager}`);
    initLogger.logStep(`Installing Node.js/npm via ${pkgManager}...`);
    try {
      const stream = await runtime.exec(
        `bash -c ${shellQuote(commands.npm)}`,
        { cwd: "/tmp", timeout: 120 }
      );
      const exitCode = await stream.exitCode;
      if (exitCode === 0) {
        log.info("[agent-bootstrap] nodejs/npm installed successfully");
      } else {
        log.warn("[agent-bootstrap] nodejs/npm install failed", { exitCode });
        initLogger.logStderr(`Node.js/npm install failed (exit ${exitCode})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("[agent-bootstrap] nodejs/npm install error", { error: msg });
    }
  }

  if (!hasCurl) {
    log.info(`[agent-bootstrap] Installing curl via ${pkgManager}`);
    initLogger.logStep(`Installing curl via ${pkgManager}...`);
    try {
      const stream = await runtime.exec(
        `bash -c ${shellQuote(commands.curl)}`,
        { cwd: "/tmp", timeout: 60 }
      );
      const exitCode = await stream.exitCode;
      if (exitCode === 0) {
        log.info("[agent-bootstrap] curl installed successfully");
      } else {
        log.warn("[agent-bootstrap] curl install failed", { exitCode });
        initLogger.logStderr(`curl install failed (exit ${exitCode})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("[agent-bootstrap] curl install error", { error: msg });
    }
  }
}

// ─── Bootstrap (Install Agents on Remote) ────────────────────────────────────

/**
 * Detect locally-installed CLI agents and install them on a remote runtime.
 *
 * Called during `runFullInit()` for SSH/Docker runtimes, between postCreateSetup
 * and initWorkspace. This ensures agents are available before the init hook runs
 * and before the user starts hiring employees.
 *
 * Steps:
 * 1. Ensure basic prerequisites (npm, curl) via package manager
 * 2. Detect which agents are installed locally
 * 3. Probe prerequisite tools on remote
 * 4. For each agent: check if already on remote, install if not
 *
 * @param runtime - Remote runtime with exec() capability
 * @param initLogger - Logger for streaming progress to the UI
 * @param cliAgentDetectionService - Local agent detection service
 * @param abortSignal - Optional abort signal for cancellation
 */
export async function bootstrapAgentsOnRemote(
  runtime: InitHookRuntime,
  initLogger: InitLogger,
  cliAgentDetectionService: CliAgentDetectionService,
  abortSignal?: AbortSignal
): Promise<void> {
  // 0. Ensure basic install prerequisites are available (npm, curl)
  try {
    await ensureInstallPrerequisites(runtime, initLogger);
  } catch (err) {
    // Non-fatal: log but continue — agent installs may still work
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[agent-bootstrap] Prerequisite install failed", { error: msg });
  }

  // 1. Detect which agents are installed locally
  const localAgents = await cliAgentDetectionService.detectAll();
  const toInstall = localAgents.filter(
    (a) => a.detected && a.installCommand && a.category === "cli"
  );

  if (toInstall.length === 0) {
    log.debug("[agent-bootstrap] No locally-installed CLI agents to bootstrap");
    return;
  }

  log.info(
    `[agent-bootstrap] Bootstrapping ${toInstall.length} agent(s) on remote: ${toInstall.map((a) => a.displayName).join(", ")}`
  );
  initLogger.logStep("Installing CLI agents on remote...");

  // 2. Probe which install tools are available on the remote (batch check)
  const prereqs = new Set<string>();
  for (const agent of toInstall) {
    const def = CLI_AGENT_DEFINITIONS[agent.slug as CliAgentSlug];
    if (def?.installCommand) {
      const prereq = getInstallPrerequisite(def.installCommand);
      if (prereq) prereqs.add(prereq);
    }
  }

  const availableTools = new Set<string>();
  for (const tool of prereqs) {
    const exitCode = await execExitCode(runtime, `which ${tool} 2>/dev/null`);
    if (exitCode === 0) {
      availableTools.add(tool);
    } else {
      log.debug(`[agent-bootstrap] Prerequisite "${tool}" not available on remote`);
    }
  }

  for (const agent of toInstall) {
    // Check abort signal between agents
    if (abortSignal?.aborted) {
      log.info("[agent-bootstrap] Aborted");
      break;
    }

    const def = CLI_AGENT_DEFINITIONS[agent.slug as CliAgentSlug];
    if (!def?.binaryNames?.[0] || !def.installCommand) continue;

    const primaryBinary = def.binaryNames[0];

    // 3. Skip if install prerequisite is missing on remote
    const prereq = getInstallPrerequisite(def.installCommand);
    if (prereq && !availableTools.has(prereq)) {
      log.debug(
        `[agent-bootstrap] Skipping ${agent.displayName}: "${prereq}" not on remote`
      );
      continue;
    }

    try {
      // 4. Check if the agent is already installed on the remote (login shell for PATH)
      const checkExitCode = await execExitCode(
        runtime,
        `sh -l -c 'which ${primaryBinary}' 2>/dev/null`
      );

      if (checkExitCode === 0) {
        log.debug(
          `[agent-bootstrap] ${agent.displayName} already on remote, skipping`
        );
        continue;
      }

      // 5. Install the agent on the remote
      initLogger.logStep(`Installing ${agent.displayName}...`);

      const installStream = await runtime.exec(
        `bash -l -c ${shellQuote(def.installCommand)}`,
        { cwd: "/tmp", timeout: 180, abortSignal }
      );

      // Stream output to initLogger using line-buffered loggers
      const loggers = createLineBufferedLoggers(initLogger);
      const decoder = new TextDecoder();
      const stdoutReader = installStream.stdout.getReader();
      const stderrReader = installStream.stderr.getReader();

      const readStdout = async () => {
        try {
          while (true) {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            loggers.stdout.append(decoder.decode(value, { stream: true }));
          }
          loggers.stdout.flush();
        } finally {
          stdoutReader.releaseLock();
        }
      };

      const readStderr = async () => {
        try {
          while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;
            loggers.stderr.append(decoder.decode(value, { stream: true }));
          }
          loggers.stderr.flush();
        } finally {
          stderrReader.releaseLock();
        }
      };

      const [exitCode] = await Promise.all([
        installStream.exitCode,
        readStdout(),
        readStderr(),
      ]);

      if (exitCode === 0) {
        initLogger.logStdout(`${agent.displayName} installed on remote`);
        log.info(`[agent-bootstrap] ${agent.displayName} installed successfully`);
      } else {
        initLogger.logStderr(
          `${agent.displayName} install failed (exit ${exitCode})`
        );
        log.warn(`[agent-bootstrap] ${agent.displayName} install failed`, {
          exitCode,
        });
      }
    } catch (err) {
      // Non-fatal — log and continue to next agent
      const msg = err instanceof Error ? err.message : String(err);
      initLogger.logStderr(
        `Failed to install ${agent.displayName}: ${msg}`
      );
      log.warn(`[agent-bootstrap] ${agent.displayName} error`, { error: msg });
    }
  }
}
