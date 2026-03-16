/**
 * HuggingFace Model Downloader — ported from Go's registry/download.go.
 *
 * Downloads models from HuggingFace Hub with resume support.
 * Emits 'progress' events for UI integration.
 *
 * Prefers `huggingface-cli download` with HF_HUB_ENABLE_HF_TRANSFER=1
 * for massively faster downloads (multi-connection, Rust-based transfer).
 * Falls back to plain fetch() if the CLI is unavailable.
 */

import { EventEmitter } from "events";
import { spawn } from "child_process";
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
   * Tries `huggingface-cli download` with hf_transfer for max speed,
   * falls back to plain fetch() if CLI is unavailable.
   *
   * @param modelID - HuggingFace model ID, e.g. "mlx-community/Llama-3.2-3B-Instruct-4bit"
   * @param signal - Optional AbortSignal for cancellation
   * @returns Path to the downloaded model directory
   */
  async pull(modelID: string, signal?: AbortSignal): Promise<string> {
    const parts = modelID.split("/");
    if (parts.length !== 2) {
      throw new Error(`Invalid model ID: ${modelID} (expected: org/model-name)`);
    }

    const [org, model] = parts;
    const dirName = normalizeModelID(modelID);
    const modelDir = path.join(this.cacheDir, dirName);

    await fsp.mkdir(modelDir, { recursive: true });

    // Try fast path: huggingface-cli with hf_transfer
    const usedCli = await this.pullWithCli(modelID, modelDir, signal);

    if (!usedCli) {
      // Fallback: plain fetch download
      const files = await this.listHFFiles(org, model, signal);
      log.info(`[inference/download] downloading ${modelID}: ${files.length} files -> ${modelDir}`);
      for (const file of files) {
        if (signal?.aborted) throw new Error("Download cancelled");
        await this.downloadFile(org, model, file, modelDir, signal);
      }
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
      JSON.stringify(manifest, null, 2)
    );

    log.info(`[inference/download] completed ${modelID}`);
    return modelDir;
  }

  /**
   * Download using `huggingface-cli download` with hf_transfer enabled.
   * Returns true if successful, false if CLI is unavailable.
   */
  private async pullWithCli(
    modelID: string,
    destDir: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    // Check if huggingface-cli is available
    const cli = await this.findHfCli();
    if (!cli) return false;

    log.info(`[inference/download] using ${cli.cmd} with hf_transfer for ${modelID}`);

    return new Promise<boolean>((resolve, reject) => {
      const args = [
        ...cli.baseArgs,
        "download",
        modelID,
        "--local-dir", destDir,
        "--exclude", "*.md", "*.txt",
      ];

      const env = {
        ...process.env,
        HF_HUB_ENABLE_HF_TRANSFER: "1",
      };

      const proc = spawn(cli.cmd, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Parse progress from stderr (huggingface-cli outputs progress there)
      let lastProgressTime = 0;
      const parseProgress = (data: Buffer) => {
        const text = data.toString();
        // Parse lines like: "Downloading model-00001-of-00091.safetensors: 45%|████ | 1.89G/4.19G [00:12<00:14, 158MB/s]"
        const match = text.match(
          /Downloading\s+(\S+):\s+\d+%.*?\|\s*([\d.]+[KMGT]?B?)\/([\d.]+[KMGT]?B)/,
        );
        if (match) {
          const now = Date.now();
          // Throttle progress events to ~4/sec
          if (now - lastProgressTime < 250) return;
          lastProgressTime = now;
          this.emit("progress", {
            fileName: match[1],
            downloadedBytes: parseHumanBytes(match[2]),
            totalBytes: parseHumanBytes(match[3]),
          } satisfies DownloadProgress);
        }
      };

      proc.stderr?.on("data", parseProgress);
      proc.stdout?.on("data", parseProgress);

      if (signal) {
        const onAbort = () => {
          proc.kill("SIGTERM");
          reject(new Error("Download cancelled"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        proc.on("close", () => signal.removeEventListener("abort", onAbort));
      }

      proc.on("error", () => {
        // CLI not executable / not found
        resolve(false);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          log.warn(`[inference/download] huggingface-cli exited with code ${code}, falling back to fetch`);
          resolve(false);
        }
      });
    });
  }

  /**
   * Find huggingface-cli — tries the binary first, then python module.
   * Returns { cmd, args } for spawn, or null if unavailable.
   */
  private async findHfCli(): Promise<{ cmd: string; baseArgs: string[] } | null> {
    const { execSync } = await import("child_process");

    // Try huggingface-cli binary
    try {
      const result = execSync("which huggingface-cli", { encoding: "utf-8", timeout: 5000 }).trim();
      if (result) return { cmd: result, baseArgs: [] };
    } catch { /* not found */ }

    // Try python3 -m huggingface_hub.cli.cli
    try {
      execSync("python3 -c \"from huggingface_hub.cli.cli import main\"", { timeout: 5000 });
      return { cmd: "python3", baseArgs: ["-m", "huggingface_hub.cli.cli"] };
    } catch { /* module not available */ }

    return null;
  }

  /**
   * List files from HuggingFace API, filtering to essential files only.
   */
  private async listHFFiles(org: string, model: string, signal?: AbortSignal): Promise<HFFile[]> {
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
    const essential = (repoInfo.siblings ?? []).filter((f) => isEssentialFile(f.rfilename));

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
    signal?: AbortSignal
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

    // HTTP 416 = Range Not Satisfiable — file already fully downloaded
    if (resp.status === 416) {
      this.emit("progress", {
        fileName: file.rfilename,
        downloadedBytes: existingSize,
        totalBytes: existingSize,
      } satisfies DownloadProgress);
      return;
    }

    if (resp.status !== 200 && resp.status !== 206) {
      throw new Error(`HTTP ${resp.status} downloading ${file.rfilename}`);
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

/**
 * Parse human-readable byte strings from huggingface-cli progress output.
 * e.g. "1.89G" → 1890000000, "158MB" → 158000000, "4.19GB" → 4190000000
 */
function parseHumanBytes(s: string): number {
  const match = s.match(/^([\d.]+)\s*([KMGT])?i?B?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  const multipliers: Record<string, number> = {
    "": 1,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  };
  return Math.round(num * (multipliers[unit] ?? 1));
}
