import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * Resolve the path to the `latticeinference` Go binary.
 *
 * In development: dist/inference/bin/latticeinference-{os}-{arch} or dist/inference/bin/latticeinference
 * In packaged Electron: {app.asar.unpacked}/dist/inference/bin/latticeinference
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

  // Development: platform-specific or generic binary
  const candidates = [
    path.join(process.cwd(), "dist", "inference", "bin", `latticeinference-${goOs}-${goArch}`),
    path.join(process.cwd(), "dist", "inference", "bin", "latticeinference"),
    path.join(process.cwd(), "vendor", "latticeInference", "bin", "latticeinference"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error("latticeinference binary not found. Run 'make build-inferred' first.");
}
