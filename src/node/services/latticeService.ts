/**
 * Service for interacting with the Lattice CLI.
 * Used to create/manage Lattice minions as SSH targets for Lattice minions.
 */
import { shescape } from "@/node/runtime/streamUtils";
import { execAsync } from "@/node/utils/disposableExec";
import { log } from "@/node/services/log";
import { spawn, type ChildProcess } from "child_process";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import {
  LatticeMinionStatusSchema,
  type LatticeInfo,
  type LatticeListPresetsResult,
  type LatticeListTemplatesResult,
  type LatticeListMinionsResult,
  type LatticeLoginResult,
  type LatticeTemplate,
  type LatticePreset,
  type LatticeMinion,
  type LatticeMinionStatus,
  type LatticeWhoami,
} from "@/common/orpc/schemas/lattice";
import { getErrorMessage } from "@/common/utils/errors";

// Re-export types for consumers that import from this module

export interface LatticeApiSession {
  token: string;
  dispose: () => Promise<void>;
}
export type {
  LatticeInfo,
  LatticeListPresetsResult,
  LatticeListTemplatesResult,
  LatticeListMinionsResult,
  LatticeLoginResult,
  LatticeTemplate,
  LatticePreset,
  LatticeMinion,
  LatticeMinionStatus,
  LatticeWhoami,
};

/** Discriminated union for minion status check results */
export type MinionStatusResult =
  | { kind: "ok"; status: LatticeMinionStatus }
  | { kind: "not_found" }
  | { kind: "error"; error: string };

/**
 * Serialize a Lattice parameter default_value to string.
 * Preserves numeric/boolean/array values instead of coercing to "".
 */
function serializeParameterDefault(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Arrays/objects (e.g., list(string) type) → JSON
  return JSON.stringify(value);
}

// Minimum supported Lattice CLI version
const MIN_LATTICE_VERSION = "0.11.0";

/**
 * Normalize a version string for comparison.
 * Strips leading "v", dev suffixes like "-devel+hash", and build metadata.
 * Example: "v2.28.6+df47153" → "2.28.6"
 */
function normalizeVersion(v: string): string {
  return v
    .replace(/^v/i, "") // Strip leading v/V
    .split("-")[0] // Remove pre-release suffix
    .split("+")[0]; // Remove build metadata
}

/**
 * Compare two semver versions. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function compareVersions(a: string, b: string): number {
  const aParts = normalizeVersion(a).split(".").map(Number);
  const bParts = normalizeVersion(b).split(".").map(Number);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  return 0;
}

const SIGKILL_GRACE_PERIOD_MS = 5000;

function createGracefulTerminator(
  child: ChildProcess,
  options?: { sigkillAfterMs?: number }
): {
  terminate: () => void;
  cleanup: () => void;
} {
  const sigkillAfterMs = options?.sigkillAfterMs ?? SIGKILL_GRACE_PERIOD_MS;
  let sigkillTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSigkill = () => {
    if (sigkillTimer) return;
    sigkillTimer = setTimeout(() => {
      sigkillTimer = null;
      // Only attempt SIGKILL if the process still appears to be running.
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, sigkillAfterMs);
  };

  const terminate = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    scheduleSigkill();
  };

  const cleanup = () => {
    if (sigkillTimer) {
      clearTimeout(sigkillTimer);
      sigkillTimer = null;
    }
  };

  return { terminate, cleanup };
}

/**
 * Stream output from a lattice CLI command line by line.
 * Yields lines as they arrive from stdout/stderr.
 * Throws on non-zero exit with stderr content in the error message.
 *
 * @param args Command arguments (e.g., ["start", "-y", "my-ws"])
 * @param errorPrefix Prefix for error messages (e.g., "lattice start failed")
 * @param abortSignal Optional signal to cancel the command
 * @param abortMessage Message to throw when aborted
 */
async function* streamLatticeCommand(
  args: string[],
  errorPrefix: string,
  abortSignal?: AbortSignal,
  abortMessage = "Lattice command aborted"
): AsyncGenerator<string, void, unknown> {
  if (abortSignal?.aborted) {
    throw new Error(abortMessage);
  }

  // Yield the command we're about to run so it's visible in UI
  yield `$ lattice ${args.join(" ")}`;

  const child = spawn("lattice", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const terminator = createGracefulTerminator(child);

  const abortHandler = () => {
    terminator.terminate();
  };
  abortSignal?.addEventListener("abort", abortHandler);

  try {
    // Use an async queue to stream lines as they arrive
    const lineQueue: string[] = [];
    const stderrLines: string[] = [];
    let streamsDone = false;
    let resolveNext: (() => void) | null = null;

    const pushLine = (line: string) => {
      lineQueue.push(line);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    let pending = 2;
    const markDone = () => {
      pending--;
      if (pending === 0) {
        streamsDone = true;
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      }
    };

    const processStream = (stream: NodeJS.ReadableStream | null, isStderr: boolean) => {
      if (!stream) {
        markDone();
        return;
      }
      let buffer = "";
      stream.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) {
          const trimmed = line.trim();
          if (trimmed) {
            pushLine(trimmed);
            if (isStderr) stderrLines.push(trimmed);
          }
        }
      });
      stream.on("end", () => {
        if (buffer.trim()) {
          pushLine(buffer.trim());
          if (isStderr) stderrLines.push(buffer.trim());
        }
        markDone();
      });
      stream.on("error", markDone);
    };

    processStream(child.stdout, false);
    processStream(child.stderr, true);

    // Yield lines as they arrive
    while (!streamsDone || lineQueue.length > 0) {
      if (lineQueue.length > 0) {
        yield lineQueue.shift()!;
      } else if (!streamsDone) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
    }

    // Wait for process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", resolve);
      child.on("error", () => resolve(null));
    });

    if (abortSignal?.aborted) {
      throw new Error(abortMessage);
    }

    if (exitCode !== 0) {
      const errorDetail = stderrLines.length > 0 ? `: ${stderrLines.join(" | ")}` : "";
      throw new Error(`${errorPrefix} (exit ${String(exitCode)})${errorDetail}`);
    }
  } finally {
    terminator.cleanup();
    abortSignal?.removeEventListener("abort", abortHandler);
  }
}

interface LatticeCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: "timeout" | "aborted";
}

type InterpretedLatticeCommandResult =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: string; combined: string };

function interpretLatticeResult(result: LatticeCommandResult): InterpretedLatticeCommandResult {
  const combined = `${result.stderr}\n${result.stdout}`.trim();

  if (result.error) {
    return { ok: false, error: result.error, combined };
  }

  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: combined || `Exit code ${String(result.exitCode)}`,
      combined,
    };
  }

  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

function sanitizeLatticeCliErrorForUi(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unknown error";
  }

  const err = error as Partial<{ stderr: string; message: string }>;
  const raw = (err.stderr?.trim() ? err.stderr : err.message) ?? "";

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "Unknown error";
  }

  // Lattice often prints a generic "Encountered an error running..." line followed by
  // a more actionable "error: ..." line. Prefer the latter when present.
  const preferred =
    [...lines].reverse().find((line) => /^error:\s*/i.test(line)) ?? lines[lines.length - 1];

  return (
    preferred
      .replace(/^error:\s*/i, "")
      .slice(0, 200)
      .trim() || "Unknown error"
  );
}

export class LatticeService {
  // Ephemeral API sessions scoped to minion provisioning.
  // This keeps token reuse explicit without persisting anything to disk.
  private provisioningSessions = new Map<string, LatticeApiSession>();
  private cachedInfo: LatticeInfo | null = null;
  // Cache whoami results so later URL lookups can reuse the last CLI response.
  private cachedWhoami: LatticeWhoami | null = null;



  /**
   * Get Lattice CLI info. Caches result for the session.
   * Only checks CLI presence and version — auth state is separate (getWhoamiInfo).
   * Returns discriminated union: available | outdated | unavailable.
   */
  async getLatticeInfo(): Promise<LatticeInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    try {
      using proc = execAsync("lattice version -o json");
      const { stdout } = await proc.result;

      // Parse JSON output
      const data = JSON.parse(stdout) as { version?: string };
      const version = data.version;

      if (!version) {
        this.cachedInfo = {
          state: "unavailable",
          reason: { kind: "error", message: "Version output missing from CLI" },
        };
        return this.cachedInfo;
      }

      // Check minimum version
      if (compareVersions(version, MIN_LATTICE_VERSION) < 0) {
        log.debug(`Lattice CLI version ${version} is below minimum ${MIN_LATTICE_VERSION}`);
        this.cachedInfo = { state: "outdated", version, minVersion: MIN_LATTICE_VERSION };
        return this.cachedInfo;
      }

      this.cachedInfo = { state: "available", version };
      return this.cachedInfo;
    } catch (error) {
      log.debug("Lattice CLI not available", { error });
      this.cachedInfo = this.classifyLatticeError(error);
      return this.cachedInfo;
    }
  }

  /**
   * Classify an error from the Lattice CLI as missing or error with message.
   */
  private classifyLatticeError(error: unknown): LatticeInfo {
    // ENOENT or "command not found" = CLI not installed
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message = error.message.toLowerCase();
      if (
        code === "ENOENT" ||
        message.includes("command not found") ||
        message.includes("enoent")
      ) {
        return { state: "unavailable", reason: "missing" };
      }
      // Other errors: include sanitized message (single line, capped length)
      const sanitized = sanitizeLatticeCliErrorForUi(error);
      return {
        state: "unavailable",
        reason: { kind: "error", message: sanitized },
      };
    }
    return { state: "unavailable", reason: { kind: "error", message: "Unknown error" } };
  }

  /**
   * Create a short-lived Lattice API token for deployment endpoints.
   */
  private async createApiSession(tokenName: string): Promise<LatticeApiSession> {
    using tokenProc = execAsync(
      `lattice tokens create --lifetime 5m --name ${shescape.quote(tokenName)}`
    );
    const { stdout: token } = await tokenProc.result;
    const trimmed = token.trim();

    return {
      token: trimmed,
      dispose: async () => {
        try {
          using deleteProc = execAsync(`lattice tokens remove ${shescape.quote(tokenName)}`);
          await deleteProc.result;
        } catch {
          // Best-effort cleanup; token will expire in 5 minutes anyway.
          log.debug("Failed to delete temporary Lattice API token", { tokenName });
        }
      },
    };
  }

  private async withApiSession<T>(
    tokenName: string,
    fn: (session: LatticeApiSession) => Promise<T>
  ): Promise<T> {
    const session = await this.createApiSession(tokenName);
    try {
      return await fn(session);
    } finally {
      await session.dispose();
    }
  }

  async ensureProvisioningSession(minionName: string): Promise<LatticeApiSession> {
    const existing = this.provisioningSessions.get(minionName);
    if (existing) {
      return existing;
    }

    const tokenName = `lattice-${minionName}-${Date.now().toString(36)}`;
    const session = await this.createApiSession(tokenName);
    this.provisioningSessions.set(minionName, session);
    return session;
  }

  takeProvisioningSession(minionName: string): LatticeApiSession | undefined {
    const session = this.provisioningSessions.get(minionName);
    if (session) {
      this.provisioningSessions.delete(minionName);
    }
    return session;
  }

  async disposeProvisioningSession(minionName: string): Promise<void> {
    const session = this.provisioningSessions.get(minionName);
    if (!session) {
      return;
    }
    this.provisioningSessions.delete(minionName);
    await session.dispose();
  }

  private normalizeHostnameSuffix(raw: string | undefined): string {
    const cleaned = (raw ?? "").trim().replace(/^\./, "");
    return cleaned || "lattice";
  }

  async fetchDeploymentSshConfig(session?: LatticeApiSession): Promise<{ hostnameSuffix: string }> {
    const deploymentUrl = await this.getDeploymentUrl();
    const tokenName = `lattice-ssh-config-${Date.now().toString(36)}`;

    const run = async (api: LatticeApiSession) => {
      const url = new URL("/api/v2/deployment/ssh", deploymentUrl);
      const response = await fetch(url, {
        headers: { "Lattice-Session-Token": api.token },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch SSH config: ${response.status}`);
      }

      const data = (await response.json()) as { hostname_suffix?: string };
      return { hostnameSuffix: this.normalizeHostnameSuffix(data.hostname_suffix) };
    };

    return session ? run(session) : this.withApiSession(tokenName, run);
  }
  /**
   * Clear cached Lattice info. Used for testing.
   */
  clearCache(): void {
    this.cachedInfo = null;
    this.cachedWhoami = null;
  }

  /**
   * Get Lattice authentication identity via `lattice whoami`.
   * Parses output like: "Lattice is running at http://..., You're authenticated as admin !"
   * Returns authenticated state with username + URL, or unauthenticated with reason.
   * Caches result for the session. Call clearWhoamiCache() to force re-check.
   */
  async getWhoamiInfo(): Promise<LatticeWhoami> {
    if (this.cachedWhoami) {
      return this.cachedWhoami;
    }

    try {
      using proc = execAsync("lattice whoami");
      const { stdout } = await proc.result;

      // Parse URL from output: "Lattice is running at http://127.0.0.1:7080, You're authenticated..."
      const urlMatch = stdout.match(/running at (https?:\/\/[^\s,]+)/i);
      const deploymentUrl = urlMatch?.[1] ?? "";

      // Parse username: "You're authenticated as <username> !"
      const userMatch = stdout.match(/authenticated as (\S+)/i);
      if (userMatch?.[1]) {
        this.cachedWhoami = {
          state: "authenticated",
          username: userMatch[1].replace(/\s*!$/, ""),
          deploymentUrl,
        };
      } else {
        this.cachedWhoami = {
          state: "unauthenticated",
          reason: "Could not parse user identity from lattice whoami",
        };
      }

      return this.cachedWhoami;
    } catch (error) {
      log.debug("Lattice whoami failed", { error });

      // Classify the error
      const errorMessage =
        error instanceof Error
          ? error.message.split("\n")[0].slice(0, 200).trim()
          : "Unknown error";

      const lowerError = errorMessage.toLowerCase();

      const isNotInstalled =
        error instanceof Error &&
        ((error as NodeJS.ErrnoException).code === "ENOENT" ||
          lowerError.includes("command not found") ||
          lowerError.includes("enoent"));

      if (isNotInstalled) {
        // CLI not installed — don't block the app
        this.cachedWhoami = {
          state: "authenticated",
          username: "local",
          deploymentUrl: "",
        };
      } else {
        // CLI installed but not authenticated — could be no deployment configured,
        // wrong URL, or genuinely unauthenticated.
        const isNoDeployment =
          lowerError.includes("not a lattice instance") ||
          lowerError.includes("unexpected non-json response") ||
          lowerError.includes("is the url correct") ||
          lowerError.includes("econnrefused") ||
          lowerError.includes("missing build version header");

        this.cachedWhoami = {
          state: "unauthenticated",
          reason: isNoDeployment
            ? "No Lattice deployment configured. Enter your deployment URL to sign in."
            : `Not authenticated: ${errorMessage}`,
        };
      }

      return this.cachedWhoami;
    }
  }

  /**
   * Clear cached whoami info. Used when user re-authenticates.
   */
  clearWhoamiCache(): void {
    this.cachedWhoami = null;
  }

  /**
   * Authenticate with Lattice by piping a session token to `lattice login <url>`.
   *
   * Flow:
   * 1. User logs into the Lattice deployment in their browser
   * 2. Browser shows a session token
   * 3. User copies the token and pastes it into our modal
   * 4. We pipe the token to `lattice login <url>` via stdin
   *
   * Uses spawn with stdin pipe (not execAsync) because the CLI waits for
   * interactive token input on stdin.
   */
  async login(url: string, sessionToken: string): Promise<LatticeLoginResult> {
    if (!url.trim()) {
      return { success: false, message: "Deployment URL is required" };
    }
    if (!sessionToken.trim()) {
      return { success: false, message: "Session token is required" };
    }

    log.info("[Lattice] Authenticating with session token", { url });

    return new Promise((resolve) => {
      let resolved = false;
      const resolveOnce = (result: LatticeLoginResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const child = spawn("lattice", ["login", url], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += String(chunk);
      });

      // Write session token to stdin — the CLI is waiting for this after
      // printing "Paste your token:" (or opening the browser)
      child.stdin.write(sessionToken.trim() + "\n");
      child.stdin.end();

      child.on("close", (code) => {
        // Clear cache so next whoami check reflects new auth state
        this.clearWhoamiCache();
        this.clearCache();

        const output = (stdout + "\n" + stderr).trim();
        log.info("[Lattice] Login completed", { url, exitCode: code, output: output.slice(0, 200) });

        if (code === 0) {
          resolveOnce({ success: true, message: output || "Login completed" });
        } else {
          resolveOnce({ success: false, message: output || `Login failed (exit ${code})` });
        }
      });

      child.on("error", (err) => {
        log.warn("[Lattice] Login spawn error", { url, error: err.message });
        resolveOnce({ success: false, message: err.message });
      });

      // Timeout after 30s to avoid hanging forever
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolveOnce({ success: false, message: "Login timed out after 30 seconds" });
      }, 30_000);
    });
  }

  /**
   * Get the Lattice deployment URL via `lattice whoami`.
   * Parses text output like: "Lattice is running at http://127.0.0.1:7080, You're authenticated as admin !"
   * Throws if Lattice CLI is not configured/logged in.
   */
  private async getDeploymentUrl(): Promise<string> {
    const whoami = await this.getWhoamiInfo();
    if (whoami.state !== "authenticated" || !whoami.deploymentUrl) {
      throw new Error(
        whoami.state === "unauthenticated"
          ? whoami.reason
          : "Could not determine Lattice deployment URL"
      );
    }
    return whoami.deploymentUrl;
  }

  /**
   * Get the active template version ID for a template.
   * Throws if template not found.
   */
  private async getActiveTemplateVersionId(templateName: string, org?: string): Promise<string> {
    // Note: `lattice templates list` doesn't support --org flag, so we filter client-side
    using proc = execAsync("lattice templates list -o json");
    const { stdout } = await proc.result;

    if (!stdout.trim()) {
      throw new Error(`Template "${templateName}" not found (no templates exist)`);
    }

    const raw = JSON.parse(stdout) as Array<{
      Template: {
        name: string;
        organization_name: string;
        active_version_id: string;
      };
    }>;

    // Filter by name and optionally by org for disambiguation
    const template = raw.find(
      (t) => t.Template.name === templateName && (!org || t.Template.organization_name === org)
    );
    if (!template) {
      const orgSuffix = org ? ` in organization "${org}"` : "";
      throw new Error(`Template "${templateName}" not found${orgSuffix}`);
    }

    return template.Template.active_version_id;
  }

  /**
   * Get parameter names covered by a preset.
   * Returns empty set if preset not found (allows creation to proceed without preset params).
   *
   * Note: Lattice CLI doesn't have a `templates presets list` command.
   * Presets are fetched via API in listPresets(). This method uses the cached
   * preset data when available.
   */
  private async getPresetParamNames(
    _templateName: string,
    _presetName: string,
    _org?: string
  ): Promise<Set<string>> {
    // Presets are handled via API, not CLI. Return empty set as preset params
    // are applied by the server during minion creation when --preset is passed.
    return new Set();
  }

  /**
   * Parse rich parameter data from the Lattice API.
   * Filters out entries with missing/invalid names to avoid generating invalid --parameter flags.
   */
  private parseRichParameters(data: unknown): Array<{
    name: string;
    defaultValue: string;
    type: string;
    ephemeral: boolean;
    required: boolean;
  }> {
    if (!Array.isArray(data)) {
      throw new Error("Expected array of rich parameters");
    }
    return data
      .filter((p): p is Record<string, unknown> => {
        if (p === null || typeof p !== "object") return false;
        const obj = p as Record<string, unknown>;
        return typeof obj.name === "string" && obj.name !== "";
      })
      .map((p) => ({
        name: p.name as string,
        defaultValue: serializeParameterDefault(p.default_value),
        type: typeof p.type === "string" ? p.type : "string",
        ephemeral: Boolean(p.ephemeral),
        required: Boolean(p.required),
      }));
  }

  /**
   * Fetch template rich parameters from Lattice API.
   * Uses an optional API session to avoid generating multiple tokens.
   */
  private async getTemplateRichParameters(
    deploymentUrl: string,
    versionId: string,
    minionName: string,
    session?: LatticeApiSession
  ): Promise<
    Array<{
      name: string;
      defaultValue: string;
      type: string;
      ephemeral: boolean;
      required: boolean;
    }>
  > {
    const run = async (api: LatticeApiSession) => {
      const url = new URL(
        `/api/v2/templateversions/${versionId}/rich-parameters`,
        deploymentUrl
      ).toString();

      const response = await fetch(url, {
        headers: {
          "Lattice-Session-Token": api.token,
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch rich parameters: ${response.status} ${response.statusText}`
        );
      }

      const data: unknown = await response.json();
      return this.parseRichParameters(data);
    };

    const tokenName = `lattice-${minionName}`;
    return session ? run(session) : this.withApiSession(tokenName, run);
  }

  /**
   * Encode a parameter string for the Lattice CLI's --parameter flag.
   * The CLI uses CSV parsing, so values containing quotes or commas need escaping:
   * - Wrap the entire string in double quotes
   * - Escape internal double quotes as ""
   */
  private encodeParameterValue(nameValue: string): string {
    if (!nameValue.includes('"') && !nameValue.includes(",")) {
      return nameValue;
    }
    // CSV quoting: wrap in quotes, escape internal quotes as ""
    return `"${nameValue.replace(/"/g, '""')}"`;
  }

  /**
   * Compute extra --parameter flags needed for minion creation.
   * Filters to non-ephemeral params not covered by preset, using their defaults.
   * Values are passed through as-is (list(string) types expect JSON-encoded arrays).
   */
  computeExtraParams(
    allParams: Array<{
      name: string;
      defaultValue: string;
      type: string;
      ephemeral: boolean;
      required: boolean;
    }>,
    coveredByPreset: Set<string>
  ): Array<{ name: string; encoded: string }> {
    const extra: Array<{ name: string; encoded: string }> = [];

    for (const p of allParams) {
      // Skip ephemeral params
      if (p.ephemeral) continue;
      // Skip params covered by preset
      if (coveredByPreset.has(p.name)) continue;

      // Encode for CLI's CSV parser (escape quotes/commas)
      const encoded = this.encodeParameterValue(`${p.name}=${p.defaultValue}`);
      extra.push({ name: p.name, encoded });
    }

    return extra;
  }

  /**
   * Validate that all required params have values (either from preset or defaults).
   * Throws if any required param is missing a value.
   */
  validateRequiredParams(
    allParams: Array<{
      name: string;
      defaultValue: string;
      type: string;
      ephemeral: boolean;
      required: boolean;
    }>,
    coveredByPreset: Set<string>
  ): void {
    const missing: string[] = [];

    for (const p of allParams) {
      if (p.ephemeral) continue;
      if (p.required && !p.defaultValue && !coveredByPreset.has(p.name)) {
        missing.push(p.name);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Required template parameters missing values: ${missing.join(", ")}. ` +
          `Select a preset that provides these values or contact your template admin.`
      );
    }
  }

  /**
   * List available Lattice templates.
   */
  async listTemplates(): Promise<LatticeListTemplatesResult> {
    try {
      using proc = execAsync("lattice templates list -o json");
      const { stdout } = await proc.result;

      // Handle empty output (no templates)
      if (!stdout.trim()) {
        return { ok: true, templates: [] };
      }

      // CLI returns [{Template: {...}}, ...] wrapper structure
      const raw = JSON.parse(stdout) as Array<{
        Template: {
          name: string;
          display_name?: string;
          organization_name?: string;
        };
      }>;

      return {
        ok: true,
        templates: raw.map((entry) => ({
          name: entry.Template.name,
          displayName: entry.Template.display_name ?? entry.Template.name,
          organizationName: entry.Template.organization_name ?? "default",
        })),
      };
    } catch (error) {
      const message = sanitizeLatticeCliErrorForUi(error);
      // Surface CLI failures so the UI doesn't show "No templates" incorrectly.
      log.warn("Failed to list Lattice templates", { error });
      return { ok: false, error: message || "Unknown error" };
    }
  }

  /**
   * List presets for a template via Lattice API.
   *
   * Note: Lattice CLI doesn't have a `templates presets list` command.
   * We fetch presets via the REST API using a short-lived token.
   *
   * @param templateName - Template name
   * @param org - Organization name for disambiguation (optional)
   */
  async listPresets(templateName: string, org?: string): Promise<LatticeListPresetsResult> {
    try {
      // Get deployment URL and template version ID
      const deploymentUrl = await this.getDeploymentUrl();
      const versionId = await this.getActiveTemplateVersionId(templateName, org);

      // Create short-lived token for API access
      const tokenName = `lattice-presets-${Date.now()}`;
      using tokenProc = execAsync(
        `lattice tokens create --lifetime 5m --name ${shescape.quote(tokenName)}`
      );
      const { stdout: token } = await tokenProc.result;

      try {
        // Fetch presets via API
        const url = new URL(
          `/api/v2/templateversions/${versionId}/presets`,
          deploymentUrl
        ).toString();

        const response = await fetch(url, {
          headers: {
            "Lattice-Session-Token": token.trim(),
          },
        });

        if (!response.ok) {
          // 404 means no presets for this template - that's okay
          if (response.status === 404) {
            return { ok: true, presets: [] };
          }
          throw new Error(`Failed to fetch presets: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as Array<{
          id: string;
          name: string;
          description?: string;
          default?: boolean;
        }>;

        return {
          ok: true,
          presets: data.map((preset) => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            isDefault: preset.default ?? false,
          })),
        };
      } finally {
        // Clean up the token
        try {
          using deleteProc = execAsync(`lattice tokens remove ${shescape.quote(tokenName)}`);
          await deleteProc.result;
        } catch {
          // Best-effort cleanup; token will expire in 5 minutes anyway
          log.debug("Failed to delete temporary token", { tokenName });
        }
      }
    } catch (error) {
      const message = sanitizeLatticeCliErrorForUi(error);
      log.warn("Failed to list Lattice presets", { templateName, error });
      return { ok: false, error: message || "Unknown error" };
    }
  }

  /**
   * Check if a Lattice minion exists by name.
   *
   * Uses `lattice list --search name:<minion>` so we don't have to fetch all minions.
   * Note: Lattice's `--search` is prefix-based server-side, so we must exact-match locally.
   */
  async minionExists(minionName: string): Promise<boolean> {
    try {
      using proc = execAsync(
        `lattice list --search ${shescape.quote(`name:${minionName}`)} -o json`
      );
      const { stdout } = await proc.result;

      if (!stdout.trim()) {
        return false;
      }

      const minions = JSON.parse(stdout) as Array<{ name: string }>;
      return minions.some((w) => w.name === minionName);
    } catch (error) {
      // Best-effort: if Lattice isn't configured/logged in, treat as "doesn't exist" so we
      // don't block creation (later steps will fail with a more actionable error).
      log.debug("Failed to check if Lattice minion exists", { minionName, error });
      return false;
    }
  }

  /**
   * List Lattice minions (all statuses).
   */
  async listMinions(): Promise<LatticeListMinionsResult> {
    // Derive known statuses from schema to avoid duplication and prevent ORPC validation errors
    const KNOWN_STATUSES = new Set<string>(LatticeMinionStatusSchema.options);

    try {
      using proc = execAsync("lattice list -o json");
      const { stdout } = await proc.result;

      // Handle empty output (no minions)
      if (!stdout.trim()) {
        return { ok: true, minions: [] };
      }

      const minions = JSON.parse(stdout) as Array<{
        name: string;
        template_name: string;
        template_display_name: string;
        latest_build: {
          status: string;
        };
      }>;

      // Filter to known statuses to avoid ORPC schema validation failures
      return {
        ok: true,
        minions: minions
          .filter((w) => KNOWN_STATUSES.has(w.latest_build.status))
          .map((w) => ({
            name: w.name,
            templateName: w.template_name,
            templateDisplayName: w.template_display_name || w.template_name,
            status: w.latest_build.status as LatticeMinionStatus,
          })),
      };
    } catch (error) {
      const message = sanitizeLatticeCliErrorForUi(error);
      // Users reported seeing "No minions found" even when the CLI failed,
      // so surface an error state instead of silently returning an empty list.
      log.warn("Failed to list Lattice minions", { error });
      return { ok: false, error: message || "Unknown error" };
    }
  }

  /**
   * Run a `lattice` CLI command with timeout + optional cancellation.
   *
   * We use spawn (not execAsync) so ensureReady() can't hang forever on a stuck
   * Lattice CLI invocation.
   */
  private runLatticeCommand(
    args: string[],
    options: { timeoutMs: number; signal?: AbortSignal }
  ): Promise<LatticeCommandResult> {
    return new Promise((resolve) => {
      if (options.timeoutMs <= 0) {
        resolve({ exitCode: null, stdout: "", stderr: "", error: "timeout" });
        return;
      }

      if (options.signal?.aborted) {
        resolve({ exitCode: null, stdout: "", stderr: "", error: "aborted" });
        return;
      }

      const child = spawn("lattice", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let resolved = false;

      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const terminator = createGracefulTerminator(child);

      const resolveOnce = (result: LatticeCommandResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const cleanup = (cleanupOptions?: { keepSigkillTimer?: boolean }) => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (!cleanupOptions?.keepSigkillTimer) {
          terminator.cleanup();
        }
        child.removeListener("close", onClose);
        child.removeListener("error", onError);
        options.signal?.removeEventListener("abort", onAbort);
      };

      function onAbort() {
        terminator.terminate();
        // Keep SIGKILL escalation alive if SIGTERM doesn't work.
        cleanup({ keepSigkillTimer: true });
        resolveOnce({ exitCode: null, stdout, stderr, error: "aborted" });
      }

      function onError() {
        cleanup();
        resolveOnce({ exitCode: null, stdout, stderr });
      }

      function onClose(code: number | null) {
        cleanup();
        resolveOnce({ exitCode: code, stdout, stderr });
      }

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });

      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", onError);
      child.on("close", onClose);

      timeoutTimer = setTimeout(() => {
        terminator.terminate();

        // Keep SIGKILL escalation alive if SIGTERM doesn't work.
        // We still remove the abort listener to avoid leaking it beyond the call.
        options.signal?.removeEventListener("abort", onAbort);

        resolveOnce({ exitCode: null, stdout, stderr, error: "timeout" });
      }, options.timeoutMs);

      options.signal?.addEventListener("abort", onAbort);
    });
  }

  /**
   * Get minion status using control-plane query.
   *
   * Note: `lattice list --search 'name:X'` is prefix-based on the server,
   * so we must exact-match the minion name client-side.
   */
  async getMinionStatus(
    minionName: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<MinionStatusResult> {
    const timeoutMs = options?.timeoutMs ?? 10_000;

    try {
      const result = await this.runLatticeCommand(
        ["list", "--search", `name:${minionName}`, "-o", "json"],
        { timeoutMs, signal: options?.signal }
      );

      const interpreted = interpretLatticeResult(result);
      if (!interpreted.ok) {
        return { kind: "error", error: interpreted.error };
      }

      if (!interpreted.stdout.trim()) {
        return { kind: "not_found" };
      }

      const minions = JSON.parse(interpreted.stdout) as Array<{
        name: string;
        latest_build: { status: string };
      }>;

      // Exact match required (search is prefix-based)
      const match = minions.find((w) => w.name === minionName);
      if (!match) {
        return { kind: "not_found" };
      }

      // Validate status against known schema values
      const status = match.latest_build.status;
      const parsed = LatticeMinionStatusSchema.safeParse(status);
      if (!parsed.success) {
        log.warn("Unknown Lattice minion status", { minionName, status });
        return { kind: "error", error: `Unknown status: ${status}` };
      }

      return { kind: "ok", status: parsed.data };
    } catch (error) {
      const message = getErrorMessage(error);
      log.debug("Failed to get Lattice minion status", { minionName, error: message });
      return { kind: "error", error: message };
    }
  }

  /**
   * Start a Lattice minion.
   *
   * Uses spawn + timeout so callers don't hang forever on a stuck CLI invocation.
   */
  async startMinion(
    minionName: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Result<void>> {
    const timeoutMs = options?.timeoutMs ?? 60_000;

    try {
      const result = await this.runLatticeCommand(["start", minionName, "--yes"], {
        timeoutMs,
        signal: options?.signal,
      });

      const interpreted = interpretLatticeResult(result);
      if (!interpreted.ok) {
        return Err(interpreted.error);
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(message);
    }
  }

  /**
   * Stop a Lattice minion.
   *
   * Uses spawn + timeout so callers don't hang forever on a stuck CLI invocation.
   */
  async stopMinion(
    minionName: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Result<void>> {
    const timeoutMs = options?.timeoutMs ?? 60_000;

    try {
      const result = await this.runLatticeCommand(["stop", minionName, "--yes"], {
        timeoutMs,
        signal: options?.signal,
      });

      const interpreted = interpretLatticeResult(result);
      if (!interpreted.ok) {
        return Err(interpreted.error);
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(message);
    }
  }

  /**
   * Wait for Lattice minion startup scripts to complete.
   * Runs `lattice ssh <minion> --wait=yes -- true` and streams output.
   */
  async *waitForStartupScripts(
    minionName: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    log.debug("Waiting for Lattice startup scripts", { minionName });
    yield* streamLatticeCommand(
      ["ssh", minionName, "--wait=yes", "--", "true"],
      "lattice ssh --wait failed",
      abortSignal,
      "Lattice startup script wait aborted"
    );
  }

  /**
   * Create a new Lattice minion. Yields build log lines as they arrive.
   *
   * Pre-fetches template parameters and passes defaults via --parameter flags
   * to avoid interactive prompts during creation.
   *
   * @param name Minion name
   * @param template Template name
   * @param preset Optional preset name
   * @param abortSignal Optional signal to cancel minion creation
   * @param org Optional organization name for disambiguation
   * @param session Optional API session to reuse across deployment endpoints
   */
  async *createMinion(
    name: string,
    template: string,
    preset?: string,
    abortSignal?: AbortSignal,
    org?: string,
    session?: LatticeApiSession
  ): AsyncGenerator<string, void, unknown> {
    log.debug("Creating Lattice minion", { name, template, preset, org });

    if (abortSignal?.aborted) {
      throw new Error("Lattice minion creation aborted");
    }

    // 1. Get deployment URL
    const deploymentUrl = await this.getDeploymentUrl();

    // 2. Get active template version ID
    const versionId = await this.getActiveTemplateVersionId(template, org);

    // 3. Get parameter names covered by preset (if any)
    const coveredByPreset = preset
      ? await this.getPresetParamNames(template, preset, org)
      : new Set<string>();

    // 4. Fetch all template parameters from API
    const allParams = await this.getTemplateRichParameters(deploymentUrl, versionId, name, session);

    // 5. Validate required params have values
    this.validateRequiredParams(allParams, coveredByPreset);

    // 6. Compute extra --parameter flags for non-ephemeral params not in preset
    const extraParams = this.computeExtraParams(allParams, coveredByPreset);

    log.debug("Computed extra params for lattice create", {
      name,
      template,
      preset,
      org,
      extraParamCount: extraParams.length,
      extraParamNames: extraParams.map((p) => p.name),
    });

    // 7. Build and run single lattice create command
    const args = ["create", name, "-t", template, "--yes"];
    if (org) {
      args.push("--org", org);
    }
    if (preset) {
      args.push("--preset", preset);
    }
    for (const p of extraParams) {
      args.push("--parameter", p.encoded);
    }

    yield* streamLatticeCommand(
      args,
      "lattice create failed",
      abortSignal,
      "Lattice minion creation aborted"
    );
  }

  /** Promise-based sleep helper */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Delete a Lattice minion, retrying across transient build states.
   *
   * This is used for "cancel creation" because aborting the local `lattice create`
   * process does not guarantee the control-plane build is canceled.
   */
  async deleteMinionEventually(
    name: string,
    options?: {
      timeoutMs?: number;
      signal?: AbortSignal;
      /**
       * If true, treat an initial "not found" as inconclusive and keep polling.
       * This avoids races where `lattice create` finishes server-side after lattice aborts the CLI.
       */
      waitForExistence?: boolean;
      /**
       * When `waitForExistence` is true: if we only see "not found" for this many ms
       * without ever observing the minion exist, treat it as success and return early.
       * Defaults to `timeoutMs` (no separate short-circuit).
       */
      waitForExistenceTimeoutMs?: number;
    }
  ): Promise<Result<void>> {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const startTime = Date.now();

    // Safety: never delete Lattice minions lattice didn't create.
    // Lattice-created minions always use the lattice- prefix.
    if (!name.startsWith("lattice-")) {
      log.warn("Refusing to delete Lattice minion without lattice- prefix", { name });
      return Ok(undefined);
    }

    const isTimedOut = () => Date.now() - startTime > timeoutMs;
    const remainingMs = () => Math.max(0, timeoutMs - (Date.now() - startTime));

    const unstableStates = new Set<LatticeMinionStatus>([
      "starting",
      "pending",
      "stopping",
      "canceling",
    ]);

    let sawMinionExist = false;
    let lastError: string | undefined;
    let attempt = 0;

    while (!isTimedOut()) {
      if (options?.signal?.aborted) {
        return Err("Delete operation aborted");
      }

      const statusResult = await this.getMinionStatus(name, {
        timeoutMs: Math.min(remainingMs(), 10_000),
        signal: options?.signal,
      });

      if (statusResult.kind === "ok") {
        sawMinionExist = true;

        if (statusResult.status === "deleted" || statusResult.status === "deleting") {
          return Ok(undefined);
        }

        // If a build is transitioning (starting/stopping/etc), deletion may fail temporarily.
        // We'll keep polling + retrying the delete command.
        if (unstableStates.has(statusResult.status)) {
          log.debug("Lattice minion in transitional state; will retry delete", {
            name,
            status: statusResult.status,
          });
        }
      }

      if (statusResult.kind === "not_found") {
        if (options?.waitForExistence !== true) {
          return Ok(undefined);
        }

        // For cancel-init, avoid treating an initial not_found as success: `lattice create` may still
        // complete server-side after we abort the local CLI. Keep polling until we either observe
        // the minion exist (and then disappear), or we hit the existence-wait window.
        if (sawMinionExist) {
          return Ok(undefined);
        }

        // Short-circuit: if we've never seen the minion and the shorter existence-wait
        // window has elapsed, assume the server-side create never completed.
        const existenceTimeout = options?.waitForExistenceTimeoutMs ?? timeoutMs;
        if (Date.now() - startTime > existenceTimeout) {
          return Ok(undefined);
        }

        attempt++;
        const backoffMs = Math.min(2_000, 250 + attempt * 150);
        await this.sleep(backoffMs, options?.signal);
        continue;
      }

      if (statusResult.kind === "error") {
        // If status checks fail (auth/network), still attempt delete best-effort.
        lastError = statusResult.error;
      }

      const deleteAttempt = await this.runLatticeCommand(["delete", name, "--yes"], {
        timeoutMs: Math.min(remainingMs(), 20_000),
        signal: options?.signal,
      });

      const interpreted = interpretLatticeResult(deleteAttempt);
      if (!interpreted.ok) {
        lastError = interpreted.error;
      } else {
        // Successful delete is terminal; status polling is best-effort.
        lastError = undefined;
        return Ok(undefined);
      }

      attempt++;
      const backoffMs = Math.min(2_000, 250 + attempt * 150);
      await this.sleep(backoffMs, options?.signal);
    }

    if (options?.waitForExistence === true && !sawMinionExist && !lastError) {
      return Ok(undefined);
    }

    return Err(lastError ?? "Timed out deleting Lattice minion");
  }

  /**
   * Delete a Lattice minion.
   *
   * Safety: Only deletes minions with "lattice-" prefix to prevent accidentally
   * deleting user minions that weren't created by lattice.
   */
  async deleteMinion(name: string): Promise<void> {
    const result = await this.deleteMinionEventually(name, {
      timeoutMs: 30_000,
      waitForExistence: false,
    });

    if (!result.success) {
      throw new Error(result.error);
    }
  }

  /**
   * Ensure SSH config is set up for Lattice minions.
   * Run before every Lattice minion connection (idempotent).
   */
  async ensureSSHConfig(): Promise<void> {
    log.debug("Ensuring Lattice SSH config");
    using proc = execAsync("lattice config-ssh --yes");
    await proc.result;
  }
}

// Singleton instance
export const latticeService = new LatticeService();
