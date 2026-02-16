/**
 * HuggingFace Model Downloader — ported from Go's registry/download.go.
 *
 * Downloads models from HuggingFace Hub with resume support.
 * Emits 'progress' events for UI integration.
 */

import { EventEmitter } from "events";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { normalizeModelID } from "./modelRegistry";
import type { DownloadProgress, HFFile, HFRepoInfo, ModelManifest } from "./types";
import { log } from "@/node/services/log";

/** File extensions to download (skip docs, licenses, etc.) */
const ESSENTIAL_EXTENSIONS = [
  ".safetensors",
  ".gguf",
  ".json",
  ".model",
  ".vocab",
  ".tiktoken",
  ".py",
];

function isEssentialFile(name: string): boolean {
  const lower = name.toLowerCase();
  // Skip docs
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return false;
  // Keep essential files
  return ESSENTIAL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface HfDownloaderEvents {
  progress: [progress: DownloadProgress];
}

export class HfDownloader extends EventEmitter {
  private cacheDir: string;

  constructor(cacheDir: string) {
    super();
    this.cacheDir = cacheDir;
  }

  /**
   * Download a model from HuggingFace Hub.
   *
   * @param modelID - HuggingFace model ID, e.g. "mlx-community/Llama-3.2-3B-Instruct-4bit"
   * @param signal - Optional AbortSignal for cancellation
   * @returns Path to the downloaded model directory
   */
  async pull(
    modelID: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const parts = modelID.split("/");
    if (parts.length !== 2) {
      throw new Error(
        `Invalid model ID: ${modelID} (expected: org/model-name)`,
      );
    }

    const [org, model] = parts;
    const dirName = normalizeModelID(modelID);
    const modelDir = path.join(this.cacheDir, dirName);

    await fsp.mkdir(modelDir, { recursive: true });

    // List files from HuggingFace API
    const files = await this.listHFFiles(org, model, signal);

    log.info(
      `[inference/download] downloading ${modelID}: ${files.length} files → ${modelDir}`,
    );

    // Download each file
    for (const file of files) {
      if (signal?.aborted) throw new Error("Download cancelled");
      await this.downloadFile(org, model, file, modelDir, signal);
    }

    // Write manifest
    const manifest: ModelManifest = {
      id: modelID,
      name: model,
      huggingface_repo: modelID,
      local_path: modelDir,
      pulled_at: new Date().toISOString(),
    };
    await fsp.writeFile(
      path.join(modelDir, ".lattice-model.json"),
      JSON.stringify(manifest, null, 2),
    );

    log.info(`[inference/download] completed ${modelID}`);
    return modelDir;
  }

  /**
   * List files from HuggingFace API, filtering to essential files only.
   */
  private async listHFFiles(
    org: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<HFFile[]> {
    const apiURL = `https://huggingface.co/api/models/${org}/${model}`;

    const headers: Record<string, string> = {};
    const hfToken = process.env.HF_TOKEN;
    if (hfToken) {
      headers["Authorization"] = `Bearer ${hfToken}`;
    }

    const resp = await fetch(apiURL, { headers, signal });

    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Access denied — set HF_TOKEN for gated models");
    }
    if (resp.status === 404) {
      throw new Error(`Model ${org}/${model} not found on HuggingFace`);
    }
    if (!resp.ok) {
      throw new Error(`HuggingFace API returned ${resp.status}`);
    }

    const repoInfo = (await resp.json()) as HFRepoInfo;
    const essential = (repoInfo.siblings ?? []).filter((f) =>
      isEssentialFile(f.rfilename),
    );

    if (essential.length === 0) {
      throw new Error(`No model files found in ${org}/${model}`);
    }

    return essential;
  }

  /**
   * Download a single file with resume support.
   */
  private async downloadFile(
    org: string,
    model: string,
    file: HFFile,
    destDir: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const destPath = path.join(destDir, file.rfilename);
    await fsp.mkdir(path.dirname(destPath), { recursive: true });

    // Resume support: check existing file size
    let existingSize = 0;
    try {
      const stat = await fsp.stat(destPath);
      existingSize = stat.size;
      if (file.size > 0 && existingSize >= file.size) {
        // Already complete
        this.emit("progress", {
          fileName: file.rfilename,
          downloadedBytes: existingSize,
          totalBytes: file.size,
        } satisfies DownloadProgress);
        return;
      }
    } catch {
      // File doesn't exist yet
    }

    const dlURL = `https://huggingface.co/${org}/${model}/resolve/main/${file.rfilename}`;
    const headers: Record<string, string> = {};
    const hfToken = process.env.HF_TOKEN;
    if (hfToken) {
      headers["Authorization"] = `Bearer ${hfToken}`;
    }
    if (existingSize > 0) {
      headers["Range"] = `bytes=${existingSize}-`;
    }

    const resp = await fetch(dlURL, { headers, signal });

    if (resp.status !== 200 && resp.status !== 206) {
      throw new Error(
        `HTTP ${resp.status} downloading ${file.rfilename}`,
      );
    }

    // Determine write mode
    const isResume = existingSize > 0 && resp.status === 206;
    const flags = isResume ? "a" : "w";
    if (!isResume) existingSize = 0;

    const fileHandle = await fsp.open(destPath, flags);
    const writeStream = fileHandle.createWriteStream();

    let downloaded = existingSize;
    const totalSize =
      file.size ||
      (resp.headers.get("content-length")
        ? Number(resp.headers.get("content-length")) + existingSize
        : 0);

    try {
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        writeStream.write(Buffer.from(value));
        downloaded += value.byteLength;

        this.emit("progress", {
          fileName: file.rfilename,
          downloadedBytes: downloaded,
          totalBytes: totalSize,
        } satisfies DownloadProgress);
      }
    } finally {
      writeStream.end();
      await fileHandle.close();
    }
  }
}
