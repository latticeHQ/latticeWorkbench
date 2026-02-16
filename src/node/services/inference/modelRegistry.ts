/**
 * Model Registry — ported from Go's registry/registry.go.
 *
 * Manages the local model cache at ~/.lattice/models/.
 * Lists, inspects, and deletes cached models.
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { ModelInfo, ModelManifest } from "./types";

/**
 * Default model cache directory.
 */
export function defaultCacheDir(): string {
  return path.join(os.homedir(), ".lattice", "models");
}

export class ModelRegistry {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? defaultCacheDir();
  }

  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Ensure the cache directory exists.
   */
  async initialize(): Promise<void> {
    await fsp.mkdir(this.cacheDir, { recursive: true });
  }

  /**
   * List all models in the cache.
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const entries = await fsp.readdir(this.cacheDir, { withFileTypes: true });
      const models: ModelInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const info = await this.inspectModel(path.join(this.cacheDir, entry.name));
          models.push(info);
        } catch {
          // Skip invalid model directories
        }
      }

      return models;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }

  /**
   * Look up a model by ID in the cache.
   * Tries exact match first, then partial match.
   */
  async getModel(id: string): Promise<ModelInfo | null> {
    // Direct path match
    const normalized = normalizeModelID(id);
    const modelPath = path.join(this.cacheDir, normalized);
    if (fs.existsSync(modelPath)) {
      return this.inspectModel(modelPath);
    }

    // Partial match search
    try {
      const entries = await fsp.readdir(this.cacheDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.toLowerCase().includes(id.toLowerCase())) {
          return this.inspectModel(path.join(this.cacheDir, entry.name));
        }
      }
    } catch {
      // Cache dir doesn't exist
    }

    return null;
  }

  /**
   * Inspect a model directory and return its metadata.
   */
  async inspectModel(modelPath: string): Promise<ModelInfo> {
    const stat = await fsp.stat(modelPath);
    if (!stat.isDirectory()) {
      throw new Error(`Model path is not a directory: ${modelPath}`);
    }

    const info: ModelInfo = {
      id: path.basename(modelPath),
      name: path.basename(modelPath),
      localPath: modelPath,
      format: "unknown",
      sizeBytes: 0,
    };

    // Read lattice manifest if present
    const manifestPath = path.join(modelPath, ".lattice-model.json");
    try {
      const data = await fsp.readFile(manifestPath, "utf-8");
      const manifest: ModelManifest = JSON.parse(data);
      if (manifest.id) info.id = manifest.id;
      if (manifest.name) info.name = manifest.name;
      if (manifest.huggingface_repo) info.huggingFaceRepo = manifest.huggingface_repo;
      if (manifest.parameter_count) info.parameterCount = manifest.parameter_count;
      if (manifest.quantization) info.quantization = manifest.quantization;
      if (manifest.pulled_at) info.pulledAt = manifest.pulled_at;
    } catch {
      // No manifest, use defaults
    }

    // Detect format and compute size
    info.format = await detectFormat(modelPath);
    info.sizeBytes = await calcDirSize(modelPath);

    return info;
  }

  /**
   * Delete a model from the cache.
   */
  async deleteModel(id: string): Promise<void> {
    const normalized = normalizeModelID(id);
    const modelPath = path.join(this.cacheDir, normalized);
    await fsp.rm(modelPath, { recursive: true, force: true });
  }
}

// ─── Utility functions ──────────────────────────────────────────────────

/**
 * Detect the model format from files in the directory.
 */
export async function detectFormat(
  modelPath: string
): Promise<"mlx" | "gguf" | "pytorch" | "unknown"> {
  try {
    const entries = await fsp.readdir(modelPath);
    for (const name of entries) {
      if (name.endsWith(".gguf")) return "gguf";
      if (name.endsWith(".safetensors")) return "mlx";
      if (name.endsWith(".bin")) return "pytorch";
    }
  } catch {
    // Can't read dir
  }
  return "unknown";
}

/**
 * Convert HuggingFace-style IDs to filesystem-safe names.
 * "mlx-community/Llama-3.2-3B-Instruct-4bit" → "mlx-community--Llama-3.2-3B-Instruct-4bit"
 */
export function normalizeModelID(id: string): string {
  return id.replace(/\//g, "--");
}

/**
 * Convert filesystem names back to HuggingFace IDs.
 */
export function denormalizeModelID(name: string): string {
  return name.replace("--", "/");
}

/**
 * Calculate total size of all files in a directory.
 */
async function calcDirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await calcDirSize(fullPath);
      } else {
        try {
          const stat = await fsp.stat(fullPath);
          total += stat.size;
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch {
    // Can't read dir
  }
  return total;
}
