/**
 * Agent Bootstrap — Auto-install CLI agents on remote runtimes.
 *
 * During workspace initialization on SSH/Docker runtimes, this module detects
 * which CLI agents are installed locally (via cliAgentDetectionService) and
 * installs them on the remote runtime so `hire_employee` works out of the box.
 *
 * Failures are non-fatal: logged but never block workspace init.
 */

import type { InitHookRuntime } from "./initHook";
import { createLineBufferedLoggers } from "./initHook";
import type { InitLogger } from "./Runtime";
import type { CliAgentDetectionService } from "@/node/services/cliAgentDetectionService";
import {
  CLI_AGENT_DEFINITIONS,
  type CliAgentSlug,
} from "@/common/constants/cliAgents";
import { log } from "@/node/services/log";

/**
 * Detect locally-installed CLI agents and install them on a remote runtime.
 *
 * Called during `runFullInit()` for SSH/Docker runtimes, between postCreateSetup
 * and initWorkspace. This ensures agents are available before the init hook runs
 * and before the user starts hiring employees.
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
  // 1. Detect which agents are installed locally
  const localAgents = await cliAgentDetectionService.detectAll();
  const toInstall = localAgents.filter(
    (a) => a.detected && a.installCommand
  );

  if (toInstall.length === 0) {
    log.debug("[agent-bootstrap] No locally-installed agents to bootstrap");
    return;
  }

  log.info(
    `[agent-bootstrap] Bootstrapping ${toInstall.length} agent(s) on remote: ${toInstall.map((a) => a.displayName).join(", ")}`
  );
  initLogger.logStep("Installing CLI agents on remote...");

  for (const agent of toInstall) {
    // Check abort signal between agents
    if (abortSignal?.aborted) {
      log.info("[agent-bootstrap] Aborted");
      break;
    }

    const def = CLI_AGENT_DEFINITIONS[agent.slug as CliAgentSlug];
    if (!def?.binaryNames?.[0] || !def.installCommand) continue;

    const primaryBinary = def.binaryNames[0];

    try {
      // 2. Check if the agent is already installed on the remote
      const checkStream = await runtime.exec(
        `which ${primaryBinary} 2>/dev/null`,
        { cwd: "/tmp", timeout: 10 }
      );
      const checkExitCode = await checkStream.exitCode;

      if (checkExitCode === 0) {
        log.debug(
          `[agent-bootstrap] ${agent.displayName} already on remote, skipping`
        );
        continue;
      }

      // 3. Install the agent on the remote
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

/**
 * Simple shell quoting for a single argument.
 * Wraps in single quotes with proper escaping of embedded single quotes.
 */
function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
