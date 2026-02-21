/**
 * InferenceSetupService — Guided setup wizard backend.
 *
 * Handles the full lifecycle of setting up the Python inference environment:
 *   1. Detect system Python (>= 3.10)
 *   2. Create a virtual environment at ~/.lattice/inference-venv/
 *   3. Install ML dependencies (mlx on Apple Silicon, llama-cpp-python on others)
 *   4. Verify the installation
 *   5. Restart the inference engine
 *
 * Streams progress events to the frontend via an async generator.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { getLatticeInferenceVenvDir } from "@/common/constants/paths";
import { checkPythonDependencies } from "./backendDetection";
import { createAsyncMessageQueue } from "@/common/utils/asyncMessageQueue";
import { log } from "@/node/services/log";
import type { InferenceService } from "./inferenceService";

// ─── Types ────────────────────────────────────────────────────────────

export interface InferenceSetupStatus {
  venvExists: boolean;
  venvPath: string;
  systemPythonFound: boolean;
  systemPythonPath: string | null;
  systemPythonVersion: string | null;
  pythonVersionOk: boolean;
  platform: "apple-silicon" | "other";
  requiredPackages: string[];
  depsInstalled: boolean;
  detectedBackend: string | null;
  inferenceAvailable: boolean;
  error: string | null;
}

export type SetupPhase =
  | "detecting-python"
  | "creating-venv"
  | "installing-deps"
  | "verifying"
  | "restarting-engine";

export type SetupStreamEvent =
  | { type: "phase"; phase: SetupPhase; message: string }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | {
      type: "result";
      success: boolean;
      message: string;
      backend?: string;
    };

// ─── Helpers ──────────────────────────────────────────────────────────

function isAppleSilicon(): boolean {
  return process.platform === "darwin" && process.arch === "arm64";
}

function getRequiredPackages(): string[] {
  return isAppleSilicon() ? ["mlx", "mlx-lm"] : ["llama-cpp-python"];
}

/**
 * Find system Python3 path (ignoring the managed venv).
 */
function findSystemPython(): string | null {
  for (const name of ["python3", "python"]) {
    try {
      const resolved = execSync(`which ${name}`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (resolved) return resolved;
    } catch {
      // Not found, continue
    }
  }
  return null;
}

/**
 * Get Python version string (e.g., "3.12.1") from a Python binary path.
 */
function getPythonVersion(pythonPath: string): string | null {
  try {
    const output = execSync(`${pythonPath} --version`, {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Output is "Python 3.12.1" — extract version part
    const match = output.match(/Python\s+(\d+\.\d+\.\d+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if a version string is >= 3.10.
 */
function isVersionOk(version: string | null): boolean {
  if (!version) return false;
  const parts = version.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  return major > 3 || (major === 3 && minor >= 10);
}

// ─── Service ──────────────────────────────────────────────────────────

export class InferenceSetupService {
  constructor(private inferenceService: InferenceService) {}

  /**
   * Pre-flight check: detect Python, check venv, check deps.
   * This is a synchronous (non-streaming) status snapshot.
   */
  async checkSetupStatus(): Promise<InferenceSetupStatus> {
    const venvPath = getLatticeInferenceVenvDir();
    const venvPython = path.join(venvPath, "bin", "python3");
    const venvExists = fs.existsSync(venvPython);

    const systemPythonPath = findSystemPython();
    const systemPythonVersion = systemPythonPath
      ? getPythonVersion(systemPythonPath)
      : null;
    const pythonVersionOk = isVersionOk(systemPythonVersion);

    const platform: "apple-silicon" | "other" = isAppleSilicon()
      ? "apple-silicon"
      : "other";
    const requiredPackages = getRequiredPackages();

    // Check if deps are installed in the venv (if it exists)
    let depsInstalled = false;
    let detectedBackend: string | null = null;
    if (venvExists) {
      try {
        const depCheck = await checkPythonDependencies(venvPython);
        depsInstalled = depCheck.available;
        detectedBackend = depCheck.backend;
      } catch {
        // Check failed, deps not installed
      }
    }

    let error: string | null = null;
    if (!systemPythonPath) {
      error =
        "Python 3 not found. Install Python 3.10+ from python.org or via Homebrew: brew install python@3.12";
    } else if (!pythonVersionOk) {
      error = `Found Python ${systemPythonVersion} but 3.10+ is required. Upgrade via python.org or Homebrew.`;
    }

    return {
      venvExists,
      venvPath,
      systemPythonFound: !!systemPythonPath,
      systemPythonPath,
      systemPythonVersion,
      pythonVersionOk,
      platform,
      requiredPackages,
      depsInstalled,
      detectedBackend,
      inferenceAvailable: this.inferenceService.isAvailable,
      error,
    };
  }

  /**
   * Run the full setup flow, streaming progress events.
   */
  async *runSetup(): AsyncGenerator<SetupStreamEvent> {
    const { push, iterate, end } = createAsyncMessageQueue<SetupStreamEvent>();

    // Run the setup in the background, pushing events to the queue
    void this.executeSetup(push, end);

    // Yield events from the queue as they arrive
    yield* iterate();
  }

  private async executeSetup(
    push: (event: SetupStreamEvent) => void,
    end: () => void
  ): Promise<void> {
    try {
      // ─── Phase 1: Detect Python ────────────────────────────────
      push({
        type: "phase",
        phase: "detecting-python",
        message: "Detecting Python installation...",
      });

      const systemPython = findSystemPython();
      if (!systemPython) {
        push({
          type: "result",
          success: false,
          message:
            "Python 3 not found on this system.\n\nInstall Python 3.10+ from python.org or via Homebrew:\n  brew install python@3.12",
        });
        end();
        return;
      }

      const version = getPythonVersion(systemPython);
      if (!isVersionOk(version)) {
        push({
          type: "result",
          success: false,
          message: `Found Python ${version ?? "unknown"} at ${systemPython}, but 3.10+ is required.\n\nUpgrade via python.org or Homebrew:\n  brew install python@3.12`,
        });
        end();
        return;
      }

      push({
        type: "stdout",
        data: `Found Python ${version} at ${systemPython}\n`,
      });

      // ─── Phase 2: Create venv ──────────────────────────────────
      const venvPath = getLatticeInferenceVenvDir();
      push({
        type: "phase",
        phase: "creating-venv",
        message: "Creating virtual environment...",
      });
      push({
        type: "stdout",
        data: `Creating venv at ${venvPath}\n`,
      });

      const venvOk = await this.spawnAndStream(
        systemPython,
        ["-m", "venv", venvPath],
        push,
        60_000 // 1 min timeout for venv creation
      );

      if (!venvOk) {
        push({
          type: "result",
          success: false,
          message:
            "Failed to create virtual environment.\n\nIf on Linux, you may need: sudo apt install python3-venv",
        });
        end();
        return;
      }

      push({ type: "stdout", data: "Virtual environment created.\n" });

      // ─── Phase 3: Install dependencies ─────────────────────────
      const packages = getRequiredPackages();
      const venvPip = path.join(venvPath, "bin", "pip");

      push({
        type: "phase",
        phase: "installing-deps",
        message: `Installing ${packages.join(", ")}...`,
      });
      push({
        type: "stdout",
        data: `\n$ pip install --no-cache-dir ${packages.join(" ")}\n\n`,
      });

      const installOk = await this.spawnAndStream(
        venvPip,
        ["install", "--no-cache-dir", ...packages],
        push,
        300_000 // 5 min timeout for pip install
      );

      if (!installOk) {
        push({
          type: "result",
          success: false,
          message:
            "Failed to install ML packages. Check the output above for errors.\n\nCommon issues:\n  - Network error: check your internet connection\n  - Disk full: ML packages need ~500MB-1GB\n  - Compilation error: ensure Xcode CLI tools are installed (xcode-select --install)",
        });
        end();
        return;
      }

      // ─── Phase 4: Verify ───────────────────────────────────────
      push({
        type: "phase",
        phase: "verifying",
        message: "Verifying installation...",
      });

      const venvPython = path.join(venvPath, "bin", "python3");
      const depCheck = await checkPythonDependencies(venvPython);

      if (!depCheck.available) {
        push({
          type: "result",
          success: false,
          message: `Packages installed but verification failed.\n\n${depCheck.error ?? "Import check failed — see output above."}`,
        });
        end();
        return;
      }

      push({
        type: "stdout",
        data: `Verified: ${depCheck.backend} backend is available.\n`,
      });

      // ─── Phase 5: Restart engine ───────────────────────────────
      push({
        type: "phase",
        phase: "restarting-engine",
        message: "Restarting inference engine...",
      });

      try {
        await this.inferenceService.dispose();
        await this.inferenceService.initialize();
        push({
          type: "stdout",
          data: "Inference engine restarted successfully.\n",
        });
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Unknown error";
        log.warn("[inference-setup] Engine restart failed", {
          error: errMsg,
        });
        push({
          type: "result",
          success: false,
          message: `Packages installed and verified, but the engine failed to restart.\n\n${errMsg}\n\nTry restarting the application.`,
        });
        end();
        return;
      }

      // ─── Done ──────────────────────────────────────────────────
      push({
        type: "result",
        success: true,
        message: "Inference engine is ready!",
        backend: depCheck.backend ?? undefined,
      });
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Unexpected error";
      log.error("[inference-setup] Setup failed", { error: errMsg });
      push({
        type: "result",
        success: false,
        message: `Setup failed unexpectedly: ${errMsg}`,
      });
    } finally {
      end();
    }
  }

  /**
   * Spawn a process and stream its stdout/stderr as events.
   * Returns true on exit code 0, false otherwise.
   */
  private spawnAndStream(
    command: string,
    args: string[],
    push: (event: SetupStreamEvent) => void,
    timeout: number
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const resolveOnce = (ok: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };

      const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1", // Disable Python output buffering
        },
      });

      child.stdout?.on("data", (data: Buffer) => {
        push({ type: "stdout", data: data.toString() });
      });

      child.stderr?.on("data", (data: Buffer) => {
        push({ type: "stderr", data: data.toString() });
      });

      child.on("close", (code) => {
        resolveOnce(code === 0);
      });

      child.on("error", (err) => {
        push({
          type: "stderr",
          data: `Process error: ${err.message}\n`,
        });
        resolveOnce(false);
      });

      // Timeout guard
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        push({
          type: "stderr",
          data: `Timed out after ${Math.round(timeout / 1000)}s\n`,
        });
        resolveOnce(false);
      }, timeout);
    });
  }
}
