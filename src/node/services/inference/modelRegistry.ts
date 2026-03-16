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
   * List all fully-downloaded models in the cache.
   * Skips partially-downloaded models (no manifest + no weight files).
   */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const entries = await fsp.readdir(this.cacheDir, { withFileTypes: true });
      const models: ModelInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const modelPath = path.join(this.cacheDir, entry.name);
        try {
          // Skip incomplete downloads: must have a manifest or weight files
          if (!(await isCompleteModel(modelPath))) continue;
          const info = await this.inspectModel(modelPath);
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

    // Detect storage location from path
    const sl = detectStorageLocation(modelPath);
    info.storageLocation = sl.location;
    info.storageLabel = sl.label;

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
 * "mlx-community/Llama-3.2-3B-Instruct-4bit" -> "mlx-community--Llama-3.2-3B-Instruct-4bit"
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
 * Detect whether a model path is on local storage, NAS, or external drive.
 */
function detectStorageLocation(modelPath: string): {
  location: "local" | "nas" | "external";
  label: string;
} {
  const home = os.homedir();

  // NAS: mounted network volumes (macOS /Volumes/..., Linux /mnt/..., SMB/NFS mounts)
  if (
    modelPath.startsWith("/Volumes/") &&
    !modelPath.startsWith("/Volumes/Macintosh HD")
  ) {
    const volumeName = modelPath.split("/")[2] || "NAS";
    return { location: "nas", label: volumeName };
  }
  if (modelPath.startsWith("/mnt/") || modelPath.startsWith("/media/")) {
    const mountName = modelPath.split("/")[2] || "NAS";
    return { location: "nas", label: mountName };
  }
  // SMB/NFS paths
  if (modelPath.startsWith("//") || modelPath.startsWith("smb://") || modelPath.startsWith("nfs://")) {
    return { location: "nas", label: "Network Share" };
  }

  // Local: under home directory default cache
  if (modelPath.startsWith(path.join(home, ".lattice"))) {
    return { location: "local", label: "Local" };
  }

  // External: anything else on /Volumes (macOS external drive)
  if (modelPath.startsWith("/Volumes/")) {
    const volumeName = modelPath.split("/")[2] || "External";
    return { location: "external", label: volumeName };
  }

  return { location: "local", label: "Local" };
}

/** Weight file extensions that indicate a model is actually present. */
const WEIGHT_EXTENSIONS = [".safetensors", ".gguf", ".bin"];

/**
 * Check if a model directory contains a complete download.
 * A model is complete if it has:
 * - A .lattice-model.json manifest (written after successful pull), OR
 * - At least one weight file (.safetensors, .gguf, .bin)
 * This filters out half-downloaded models that only have config/vocab files.
 */
async function isCompleteModel(modelPath: string): Promise<boolean> {
  try {
    // Fast path: manifest exists = download completed
    await fsp.access(path.join(modelPath, ".lattice-model.json"));
    return true;
  } catch {
    // No manifest — check for weight files (models from other tools)
  }
  try {
    const entries = await fsp.readdir(modelPath);
    return entries.some((name) =>
      WEIGHT_EXTENSIONS.some((ext) => name.endsWith(ext)),
    );
  } catch {
    return false;
  }
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
