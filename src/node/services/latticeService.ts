/**
 * Service for interacting with the Lattice CLI.
 * Used to create/manage Lattice workspaces as SSH targets for Lattice workspaces.
 */
import { shescape } from "@/node/runtime/streamUtils";
import { execAsync } from "@/node/utils/disposableExec";
import { log } from "@/node/services/log";
import { spawn, type ChildProcess } from "child_process";
import {
  LatticeWorkspaceStatusSchema,
  type LatticeInfo,
  type LatticeTemplate,
  type LatticePreset,
  type LatticeWorkspace,
  type LatticeWorkspaceStatus,
  type LatticeWhoami,
} from "@/common/orpc/schemas/lattice";

// Re-export types for consumers that import from this module
export type {
  LatticeInfo,
  LatticeTemplate,
  LatticePreset,
  LatticeWorkspace,
  LatticeWorkspaceStatus,
  LatticeWhoami,
};

/** Discriminated union for workspace status check results */
export type WorkspaceStatusResult =
  | { kind: "ok"; status: LatticeWorkspaceStatus }
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
const MIN_LATTICE_VERSION = "0.7.0";

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

export class LatticeService {
  private cachedInfo: LatticeInfo | null = null;
  private cachedWhoami: LatticeWhoami | null = null;

  /**
   * Get Lattice CLI info. Caches result for the session.
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
      const sanitized = error.message.split("\n")[0].slice(0, 200).trim();
      return {
        state: "unavailable",
        reason: { kind: "error", message: sanitized || "Unknown error" },
      };
    }
    return { state: "unavailable", reason: { kind: "error", message: "Unknown error" } };
  }

  /**
   * Clear cached Lattice info. Used for testing.
   */
  clearCache(): void {
    this.cachedInfo = null;
  }

  /**
   * Get the Lattice deployment URL via `lattice whoami`.
   * Parses text output like: "Lattice is running at http://127.0.0.1:7080, You're authenticated as admin !"
   * Throws if Lattice CLI is not configured/logged in.
   */
  private async getDeploymentUrl(): Promise<string> {
    using proc = execAsync("lattice whoami");
    const { stdout } = await proc.result;

    // Parse URL from output like: "Lattice is running at http://127.0.0.1:7080, You're authenticated..."
    const urlMatch = stdout.match(/running at (https?:\/\/[^\s,]+)/i);
    if (!urlMatch?.[1]) {
      throw new Error(`Could not determine Lattice deployment URL from whoami output: ${stdout}`);
    }
    return urlMatch[1];
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
    // are applied by the server during workspace creation when --preset is passed.
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
   * Creates a short-lived token, fetches params, then cleans up the token.
   */
  private async getTemplateRichParameters(
    deploymentUrl: string,
    versionId: string,
    workspaceName: string
  ): Promise<
    Array<{
      name: string;
      defaultValue: string;
      type: string;
      ephemeral: boolean;
      required: boolean;
    }>
  > {
    // Create short-lived token named after workspace (avoids keychain read issues)
    const tokenName = `lattice-${workspaceName}`;
    using tokenProc = execAsync(
      `lattice tokens create --lifetime 5m --name ${shescape.quote(tokenName)}`
    );
    const { stdout: token } = await tokenProc.result;

    try {
      const url = new URL(
        `/api/v2/templateversions/${versionId}/rich-parameters`,
        deploymentUrl
      ).toString();

      const response = await fetch(url, {
        headers: {
          "Lattice-Session-Token": token.trim(),
        },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch rich parameters: ${response.status} ${response.statusText}`
        );
      }

      const data: unknown = await response.json();
      return this.parseRichParameters(data);
    } finally {
      // Clean up the token by name
      try {
        using deleteProc = execAsync(`lattice tokens remove ${shescape.quote(tokenName)}`);
        await deleteProc.result;
      } catch {
        // Best-effort cleanup; token will expire in 5 minutes anyway
        log.debug("Failed to delete temporary token", { tokenName });
      }
    }
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
   * Compute extra --parameter flags needed for workspace creation.
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
  async listTemplates(): Promise<LatticeTemplate[]> {
    try {
      using proc = execAsync("lattice templates list -o json");
      const { stdout } = await proc.result;

      // Handle empty output (no templates)
      if (!stdout.trim()) {
        return [];
      }

      // CLI returns [{Template: {...}}, ...] wrapper structure
      const raw = JSON.parse(stdout) as Array<{
        Template: {
          name: string;
          display_name?: string;
          organization_name?: string;
        };
      }>;

      return raw.map((entry) => ({
        name: entry.Template.name,
        displayName: entry.Template.display_name ?? entry.Template.name,
        organizationName: entry.Template.organization_name ?? "default",
      }));
    } catch (error) {
      // Common user state: Lattice CLI installed but not configured/logged in.
      // Don't spam error logs for UI list calls.
      log.debug("Failed to list Lattice templates", { error });
      return [];
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
  async listPresets(templateName: string, org?: string): Promise<LatticePreset[]> {
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
            return [];
          }
          throw new Error(`Failed to fetch presets: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as Array<{
          id: string;
          name: string;
          description?: string;
          default?: boolean;
        }>;

        return data.map((preset) => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          isDefault: preset.default ?? false,
        }));
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
      log.debug("Failed to list Lattice presets (may not exist for template)", {
        templateName,
        error,
      });
      return [];
    }
  }

  /**
   * Check if a Lattice workspace exists by name.
   *
   * Uses `lattice list --search name:<workspace>` so we don't have to fetch all workspaces.
   * Note: Lattice's `--search` is prefix-based server-side, so we must exact-match locally.
   */
  async workspaceExists(workspaceName: string): Promise<boolean> {
    try {
      using proc = execAsync(
        `lattice list --search ${shescape.quote(`name:${workspaceName}`)} -o json`
      );
      const { stdout } = await proc.result;

      if (!stdout.trim()) {
        return false;
      }

      const workspaces = JSON.parse(stdout) as Array<{ name: string }>;
      return workspaces.some((w) => w.name === workspaceName);
    } catch (error) {
      // Best-effort: if Lattice isn't configured/logged in, treat as "doesn't exist" so we
      // don't block creation (later steps will fail with a more actionable error).
      log.debug("Failed to check if Lattice workspace exists", { workspaceName, error });
      return false;
    }
  }

  /**
   * List Lattice workspaces (all statuses).
   */
  async listWorkspaces(): Promise<LatticeWorkspace[]> {
    // Derive known statuses from schema to avoid duplication and prevent ORPC validation errors
    const KNOWN_STATUSES = new Set<string>(LatticeWorkspaceStatusSchema.options);

    try {
      using proc = execAsync("lattice list -o json");
      const { stdout } = await proc.result;

      // Handle empty output (no workspaces)
      if (!stdout.trim()) {
        return [];
      }

      const workspaces = JSON.parse(stdout) as Array<{
        name: string;
        template_name: string;
        template_display_name: string;
        latest_build: {
          status: string;
        };
      }>;

      // Filter to known statuses to avoid ORPC schema validation failures
      return workspaces
        .filter((w) => KNOWN_STATUSES.has(w.latest_build.status))
        .map((w) => ({
          name: w.name,
          templateName: w.template_name,
          templateDisplayName: w.template_display_name || w.template_name,
          status: w.latest_build.status as LatticeWorkspaceStatus,
        }));
    } catch (error) {
      // Common user state: Lattice CLI installed but not configured/logged in.
      // Don't spam error logs for UI list calls.
      log.debug("Failed to list Lattice workspaces", { error });
      return [];
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
   * Get workspace status using control-plane query.
   *
   * Note: `lattice list --search 'name:X'` is prefix-based on the server,
   * so we must exact-match the workspace name client-side.
   */
  async getWorkspaceStatus(
    workspaceName: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<WorkspaceStatusResult> {
    const timeoutMs = options?.timeoutMs ?? 10_000;

    try {
      const result = await this.runLatticeCommand(
        ["list", "--search", `name:${workspaceName}`, "-o", "json"],
        { timeoutMs, signal: options?.signal }
      );

      const interpreted = interpretLatticeResult(result);
      if (!interpreted.ok) {
        return { kind: "error", error: interpreted.error };
      }

      if (!interpreted.stdout.trim()) {
        return { kind: "not_found" };
      }

      const workspaces = JSON.parse(interpreted.stdout) as Array<{
        name: string;
        latest_build: { status: string };
      }>;

      // Exact match required (search is prefix-based)
      const match = workspaces.find((w) => w.name === workspaceName);
      if (!match) {
        return { kind: "not_found" };
      }

      // Validate status against known schema values
      const status = match.latest_build.status;
      const parsed = LatticeWorkspaceStatusSchema.safeParse(status);
      if (!parsed.success) {
        log.warn("Unknown Lattice workspace status", { workspaceName, status });
        return { kind: "error", error: `Unknown status: ${status}` };
      }

      return { kind: "ok", status: parsed.data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.debug("Failed to get Lattice workspace status", { workspaceName, error: message });
      return { kind: "error", error: message };
    }
  }

  /**
   * Wait for Lattice agent to be ready.
   * Unlike Lattice CLI, Lattice CLI doesn't support `ssh agent -- command` syntax.
   * Instead, we poll the agent status until it's "running" and healthy.
   */
  async *waitForStartupScripts(
    workspaceName: string,
    abortSignal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    log.debug("Waiting for Lattice agent to be ready", { workspaceName });
    yield `Waiting for agent "${workspaceName}" to be ready...`;

    const maxAttempts = 60; // 5 minutes with 5s interval
    const pollInterval = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (abortSignal?.aborted) {
        throw new Error("Lattice agent wait aborted");
      }

      const status = await this.getWorkspaceStatus(workspaceName, {
        timeoutMs: 10_000,
        signal: abortSignal,
      });

      if (status.kind === "ok" && status.status === "running") {
        yield `Agent "${workspaceName}" is running and ready.`;
        return;
      }

      if (status.kind === "not_found") {
        throw new Error(`Agent "${workspaceName}" not found`);
      }

      if (status.kind === "ok") {
        yield `Agent status: ${status.status} (waiting for "running"...)`;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for agent "${workspaceName}" to be ready`);
  }

  /**
   * Create a new Lattice agent. Yields build log lines as they arrive.
   *
   * Uses `lattice create` with `-y` to bypass interactive prompts.
   * Fetches template parameters via API and passes them with default values
   * using `--parameter "name=value"` to avoid interactive parameter prompts.
   *
   * Note: Lattice CLI does not support a `--preset` flag. Presets are a UI/API
   * feature - when creating via CLI, template defaults are used. The preset
   * parameter is kept for API compatibility but logged as informational only.
   *
   * @param name Agent name
   * @param template Template name
   * @param preset Optional preset name (informational only - CLI doesn't support presets)
   * @param abortSignal Optional signal to cancel agent creation
   * @param org Optional organization name for disambiguation
   */
  async *createWorkspace(
    name: string,
    template: string,
    preset?: string,
    abortSignal?: AbortSignal,
    org?: string
  ): AsyncGenerator<string, void, unknown> {
    // Log preset for debugging but note it's not used by CLI
    if (preset) {
      log.debug("Creating Lattice agent (preset ignored - CLI uses template defaults)", {
        name,
        template,
        preset,
        org,
      });
    } else {
      log.debug("Creating Lattice agent", { name, template, org });
    }

    if (abortSignal?.aborted) {
      throw new Error("Lattice agent creation aborted");
    }

    // Fetch template parameters to pass with default values
    // This avoids interactive prompts for required parameters
    yield "Fetching template parameters...";
    let parameterArgs: string[] = [];
    try {
      const deploymentUrl = await this.getDeploymentUrl();
      const versionId = await this.getActiveTemplateVersionId(template, org);
      const richParams = await this.getTemplateRichParameters(deploymentUrl, versionId, name);

      // Build --parameter flags for non-ephemeral parameters with default values
      for (const param of richParams) {
        if (param.ephemeral) continue; // Skip ephemeral params
        // Use default value if available, otherwise skip (let CLI prompt if truly required)
        if (param.defaultValue !== "") {
          const encoded = this.encodeParameterValue(`${param.name}=${param.defaultValue}`);
          parameterArgs.push("--parameter", encoded);
        }
      }
      log.debug("Resolved template parameters", { count: parameterArgs.length / 2 });
    } catch (error) {
      // If we can't fetch parameters, try creating anyway - CLI will prompt if needed
      log.warn("Failed to fetch template parameters, proceeding without", { error });
      yield "Warning: Could not fetch template parameters, CLI may prompt for values";
    }

    // Build lattice create command with -y to bypass prompts
    // Note: --preset flag does not exist in Lattice CLI - presets are API/UI only
    const args = ["create", name, "-t", template, "-y", ...parameterArgs];
    if (org) {
      args.push("--org", org);
    }

    yield* streamLatticeCommand(
      args,
      "lattice create failed",
      abortSignal,
      "Lattice agent creation aborted"
    );
  }

  /**
   * Delete a Lattice workspace.
   *
   * Safety: Only deletes workspaces with "lattice-" prefix to prevent accidentally
   * deleting user workspaces that weren't created by  lattice.
   */
  async deleteWorkspace(name: string): Promise<void> {
    if (!name.startsWith("lattice-")) {
      log.warn("Refusing to delete Lattice workspace without lattice- prefix", { name });
      return;
    }
    log.debug("Deleting Lattice workspace", { name });
    using proc = execAsync(`lattice delete ${shescape.quote(name)} --yes`);
    await proc.result;
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
        // wrong URL, or genuinely unauthenticated. Show the auth modal so user
        // can enter their deployment URL and login.
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
   *
   * @param url - The Lattice deployment URL (e.g., "https://orbitalclusters.com")
   * @param sessionToken - The session token from browser login
   */
  async login(url: string, sessionToken: string): Promise<{ success: boolean; message: string }> {
    if (!url.trim()) {
      return { success: false, message: "Deployment URL is required" };
    }
    if (!sessionToken.trim()) {
      return { success: false, message: "Session token is required" };
    }

    log.info("[Lattice] Authenticating with session token", { url });

    return new Promise((resolve) => {
      let resolved = false;
      const resolveOnce = (result: { success: boolean; message: string }) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const child = spawn("lattice", ["login", url], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
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
   * Ensure SSH config is set up for Lattice workspaces.
   * Run before every Lattice workspace connection (idempotent).
   */
  async ensureSSHConfig(): Promise<void> {
    log.debug("Ensuring Lattice SSH config");
    using proc = execAsync("lattice config-ssh --yes");
    await proc.result;
  }
}

// Singleton instance
export const latticeService = new LatticeService();
