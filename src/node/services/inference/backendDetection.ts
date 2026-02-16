/**
 * Backend detection utilities — ported from Go's worker/manager.go.
 *
 * Detects the best Python interpreter, inference backend, and worker script
 * location for the current platform and model.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

/**
 * Find the best Python interpreter.
 * Checks the Lattice inference venv first, then system Python.
 */
export function detectPython(): string {
  const home = os.homedir();
  const venvPython = path.join(home, ".lattice", "inference-venv", "bin", "python3");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  // Try system Python
  for (const name of ["python3", "python"]) {
    try {
      const resolved = execSync(`which ${name}`, { encoding: "utf-8" }).trim();
      if (resolved) return resolved;
    } catch {
      // Not found, continue
    }
  }

  return "python3"; // Fallback
}

/**
 * Detect the best inference backend for a given model directory.
 * - .gguf files → llamacpp
 * - Apple Silicon + .safetensors → mlx
 * - Otherwise → llamacpp
 */
export function detectBackend(modelPath: string): string {
  try {
    const entries = fs.readdirSync(modelPath);
    for (const entry of entries) {
      if (entry.endsWith(".gguf")) {
        return "llamacpp";
      }
    }
  } catch {
    // Can't read dir, default to llamacpp
  }

  if (process.platform === "darwin" && process.arch === "arm64") {
    return "mlx";
  }

  return "llamacpp";
}

/**
 * Detect the best distributed backend for multi-node inference.
 */
export function detectDistributedBackend(
  _modelPath: string,
  strategy?: string,
): string {
  if (strategy === "tensor") return "mlx_distributed";
  if (strategy === "pipeline") return "pipeline";

  // Auto: prefer tensor parallelism on Apple Silicon
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "mlx_distributed";
  }
  return "pipeline";
}

/**
 * Find the worker.py script.
 * Checks multiple candidate locations to work in both dev and production.
 */
export function findWorkerScript(appResourcesPath?: string): string {
  const candidates: string[] = [];

  // Electron production: asar-unpacked dist/ inside the app bundle
  if (appResourcesPath) {
    candidates.push(
      path.join(appResourcesPath, "app.asar.unpacked", "dist", "inference", "python", "worker.py"),
    );
  }

  // Electron production: process.resourcesPath (auto-set by Electron)
  if (process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, "app.asar.unpacked", "dist", "inference", "python", "worker.py"),
    );
  }

  // Development: relative to compiled JS output
  const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");
  // Submodule path (vendor/latticeInference/python/)
  candidates.push(
    path.join(projectRoot, "vendor", "latticeInference", "python", "worker.py"),
  );
  // Legacy path (resources/inference/python/) — backwards compat
  candidates.push(
    path.join(projectRoot, "resources", "inference", "python", "worker.py"),
  );
  // Built dist path (after build-static)
  candidates.push(
    path.join(projectRoot, "dist", "inference", "python", "worker.py"),
  );

  // Development: relative to cwd
  candidates.push(
    path.join(process.cwd(), "vendor", "latticeInference", "python", "worker.py"),
  );

  // Standard install location
  candidates.push(
    path.join(os.homedir(), ".lattice", "python", "worker.py"),
  );

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return path.resolve(c);
    }
  }

  // Fallback — will fail at runtime with a clear error
  return path.join(
    appResourcesPath ?? process.cwd(),
    "resources",
    "inference",
    "python",
    "worker.py",
  );
}

/**
 * Check if the Python environment has the required inference dependencies.
 */
export async function checkPythonDependencies(
  pythonPath: string,
): Promise<{ available: boolean; backend: string | null; error?: string }> {
  // Check MLX (Apple Silicon)
  if (process.platform === "darwin" && process.arch === "arm64") {
    try {
      execSync(`${pythonPath} -c "import mlx_lm; print('ok')"`, {
        encoding: "utf-8",
        timeout: 10000,
      });
      return { available: true, backend: "mlx" };
    } catch {
      // MLX not available, try llama.cpp
    }
  }

  // Check llama.cpp
  try {
    execSync(`${pythonPath} -c "import llama_cpp; print('ok')"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { available: true, backend: "llamacpp" };
  } catch {
    // Neither available
  }

  return {
    available: false,
    backend: null,
    error:
      "No inference backend found. Install MLX (Apple Silicon) or llama-cpp-python:\n" +
      "  pip install mlx mlx-lm          # Apple Silicon\n" +
      "  pip install llama-cpp-python     # NVIDIA/CPU",
  };
}
