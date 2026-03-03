import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execSync } from "child_process";
import { log } from "@/node/services/log";

/**
 * Resolve the path to the `latticeinference` Go binary.
 *
 * Search order:
 *   1. Packaged Electron (app.asar.unpacked)
 *   2. dist/inference/bin/ (dev build output)
 *   3. vendor/latticeInference/bin/
 *   4. ~/.lattice/bin/latticeinference
 *   5. Sibling latticeInference repo bin/ (development)
 *
 * If not found anywhere, attempts to auto-build from source if Go is installed
 * and the latticeInference source repo is available as a sibling directory.
 */
export function getInferredBinaryPath(appResourcesPath?: string): string {
  const platform = os.platform(); // 'darwin', 'linux', 'win32'
  const arch = os.arch(); // 'arm64', 'x64'

  const goOs = platform === "win32" ? "windows" : platform;
  const goArch = arch === "x64" ? "amd64" : arch;

  // Packaged Electron: single binary named 'latticeinference'
  if (appResourcesPath) {
    const packed = path.join(
      appResourcesPath,
      "app.asar.unpacked",
      "dist",
      "inference",
      "bin",
      "latticeinference"
    );
    if (fs.existsSync(packed)) return packed;
  }

  // Development: platform-specific or generic binary in dist/
  const candidates = [
    path.join(process.cwd(), "dist", "inference", "bin", `latticeinference-${goOs}-${goArch}`),
    path.join(process.cwd(), "dist", "inference", "bin", "latticeinference"),
    path.join(process.cwd(), "vendor", "latticeInference", "bin", "latticeinference"),
    // User-local install
    path.join(os.homedir(), ".lattice", "bin", "latticeinference"),
  ];

  // Sibling repo (development): check relative to cwd and common workspace layouts
  for (const sourceDir of findLatticeInferenceSourceDirs()) {
    candidates.push(path.join(sourceDir, "bin", "latticeinference"));
    candidates.push(path.join(sourceDir, "bin", `latticeinference-${goOs}-${goArch}`));
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Binary not found anywhere — attempt auto-build from source
  const built = tryAutoBuildBinary();
  if (built) return built;

  throw new Error(
    "latticeinference binary not found. Run 'make build-inferred' or install Go 1.21+ and ensure the latticeInference repo is a sibling directory."
  );
}

/**
 * Find candidate latticeInference source directories.
 * Checks common development layouts (sibling repo, monorepo, env var override).
 */
function findLatticeInferenceSourceDirs(): string[] {
  const dirs: string[] = [];

  // Env var override (highest priority)
  const envDir = process.env.LATTICE_INFERENCE_DIR;
  if (envDir && fs.existsSync(envDir)) {
    dirs.push(envDir);
  }

  // Sibling directory relative to cwd (e.g., ../latticeInference when in latticeWorkbench)
  const siblingFromCwd = path.resolve(process.cwd(), "..", "latticeInference");
  if (fs.existsSync(path.join(siblingFromCwd, "go.mod"))) {
    dirs.push(siblingFromCwd);
  }

  // For git worktrees: resolve via the main repo location
  // Worktree .git file contains: "gitdir: /path/to/main/.git/worktrees/<name>"
  try {
    const dotGit = path.join(process.cwd(), ".git");
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
      const gitContent = fs.readFileSync(dotGit, "utf-8").trim();
      const match = gitContent.match(/gitdir:\s*(.+)/);
      if (match) {
        // Resolve: .git/worktrees/<name> → main repo → parent → latticeInference
        const mainRepoDir = path.resolve(match[1], "..", "..");
        const siblingFromMain = path.resolve(mainRepoDir, "..", "latticeInference");
        if (fs.existsSync(path.join(siblingFromMain, "go.mod"))) {
          dirs.push(siblingFromMain);
        }
      }
    }
  } catch {
    // Ignore errors reading .git
  }

  return dirs;
}

/**
 * Attempt to build the latticeinference binary from source.
 * Returns the path to the built binary, or null if build failed.
 */
function tryAutoBuildBinary(): string | null {
  // Check if Go is installed
  let goPath: string;
  try {
    goPath = execSync("which go", { encoding: "utf-8", timeout: 5000 }).trim();
    if (!goPath) return null;
  } catch {
    log.info("[inference] Go not found — cannot auto-build latticeinference binary");
    return null;
  }

  // Find source directory
  const sourceDirs = findLatticeInferenceSourceDirs();
  if (sourceDirs.length === 0) {
    log.info("[inference] latticeInference source not found — cannot auto-build");
    return null;
  }

  const sourceDir = sourceDirs[0];
  const outputDir = path.join(process.cwd(), "dist", "inference", "bin");
  const outputPath = path.join(outputDir, "latticeinference");

  log.info(`[inference] Auto-building latticeinference from ${sourceDir}...`);

  try {
    fs.mkdirSync(outputDir, { recursive: true });

    execSync(
      `${goPath} build -ldflags "-s -w" -o ${outputPath} ./cmd/latticeinference`,
      {
        cwd: sourceDir,
        encoding: "utf-8",
        timeout: 120_000, // 2 min timeout for Go build
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    if (fs.existsSync(outputPath)) {
      log.info(`[inference] Auto-built latticeinference binary → ${outputPath}`);
      return outputPath;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[inference] Auto-build failed: ${msg}`);
  }

  return null;
}
