"use strict";
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
Object.defineProperty(exports, "__esModule", { value: true });
exports.latticeService = exports.LatticeService = void 0;
exports.compareVersions = compareVersions;
/**
 * Service for interacting with the Lattice CLI.
 * Used to create/manage Lattice workspaces as SSH targets for Unix workspaces.
 */
const streamUtils_1 = require("../../node/runtime/streamUtils");
const disposableExec_1 = require("../../node/utils/disposableExec");
const log_1 = require("../../node/services/log");
const child_process_1 = require("child_process");
const lattice_1 = require("../../common/orpc/schemas/lattice");
/**
 * Serialize a Lattice parameter default_value to string.
 * Preserves numeric/boolean/array values instead of coercing to "".
 */
function serializeParameterDefault(value) {
    if (value == null)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
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
function normalizeVersion(v) {
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
function compareVersions(a, b) {
    const aParts = normalizeVersion(a).split(".").map(Number);
    const bParts = normalizeVersion(b).split(".").map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] ?? 0;
        const bPart = bParts[i] ?? 0;
        if (aPart !== bPart)
            return aPart - bPart;
    }
    return 0;
}
const SIGKILL_GRACE_PERIOD_MS = 5000;
function createGracefulTerminator(child, options) {
    const sigkillAfterMs = options?.sigkillAfterMs ?? SIGKILL_GRACE_PERIOD_MS;
    let sigkillTimer = null;
    const scheduleSigkill = () => {
        if (sigkillTimer)
            return;
        sigkillTimer = setTimeout(() => {
            sigkillTimer = null;
            // Only attempt SIGKILL if the process still appears to be running.
            if (child.exitCode === null && child.signalCode === null) {
                try {
                    child.kill("SIGKILL");
                }
                catch {
                    // ignore
                }
            }
        }, sigkillAfterMs);
    };
    const terminate = () => {
        try {
            child.kill("SIGTERM");
        }
        catch {
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
async function* streamLatticeCommand(args, errorPrefix, abortSignal, abortMessage = "Lattice command aborted") {
    if (abortSignal?.aborted) {
        throw new Error(abortMessage);
    }
    // Yield the command we're about to run so it's visible in UI
    yield `$ lattice ${args.join(" ")}`;
    const child = (0, child_process_1.spawn)("lattice", args, {
        stdio: ["ignore", "pipe", "pipe"],
    });
    const terminator = createGracefulTerminator(child);
    const abortHandler = () => {
        terminator.terminate();
    };
    abortSignal?.addEventListener("abort", abortHandler);
    try {
        // Use an async queue to stream lines as they arrive
        const lineQueue = [];
        const stderrLines = [];
        let streamsDone = false;
        let resolveNext = null;
        const pushLine = (line) => {
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
        const processStream = (stream, isStderr) => {
            if (!stream) {
                markDone();
                return;
            }
            let buffer = "";
            stream.on("data", (chunk) => {
                buffer += chunk.toString();
                const parts = buffer.split("\n");
                buffer = parts.pop() ?? "";
                for (const line of parts) {
                    const trimmed = line.trim();
                    if (trimmed) {
                        pushLine(trimmed);
                        if (isStderr)
                            stderrLines.push(trimmed);
                    }
                }
            });
            stream.on("end", () => {
                if (buffer.trim()) {
                    pushLine(buffer.trim());
                    if (isStderr)
                        stderrLines.push(buffer.trim());
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
                yield lineQueue.shift();
            }
            else if (!streamsDone) {
                await new Promise((resolve) => {
                    resolveNext = resolve;
                });
            }
        }
        // Wait for process to exit
        const exitCode = await new Promise((resolve) => {
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
    }
    finally {
        terminator.cleanup();
        abortSignal?.removeEventListener("abort", abortHandler);
    }
}
function interpretLatticeResult(result) {
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
class LatticeService {
    cachedInfo = null;
    /**
     * Get Lattice CLI info. Caches result for the session.
     * Returns discriminated union: available | outdated | unavailable.
     */
    async getLatticeInfo() {
        if (this.cachedInfo) {
            return this.cachedInfo;
        }
        try {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                const proc = __addDisposableResource(env_1, (0, disposableExec_1.execAsync)("lattice version --output=json"), false);
                const { stdout } = await proc.result;
                // Parse JSON output
                const data = JSON.parse(stdout);
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
                    log_1.log.debug(`Lattice CLI version ${version} is below minimum ${MIN_LATTICE_VERSION}`);
                    this.cachedInfo = { state: "outdated", version, minVersion: MIN_LATTICE_VERSION };
                    return this.cachedInfo;
                }
                this.cachedInfo = { state: "available", version };
                return this.cachedInfo;
            }
            catch (e_1) {
                env_1.error = e_1;
                env_1.hasError = true;
            }
            finally {
                __disposeResources(env_1);
            }
        }
        catch (error) {
            log_1.log.debug("Lattice CLI not available", { error });
            this.cachedInfo = this.classifyLatticeError(error);
            return this.cachedInfo;
        }
    }
    /**
     * Classify an error from the Lattice CLI as missing or error with message.
     */
    classifyLatticeError(error) {
        // ENOENT or "command not found" = CLI not installed
        if (error instanceof Error) {
            const code = error.code;
            const message = error.message.toLowerCase();
            if (code === "ENOENT" ||
                message.includes("command not found") ||
                message.includes("enoent")) {
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
    clearCache() {
        this.cachedInfo = null;
    }
    /**
     * Get the Lattice deployment URL via `lattice whoami`.
     * Throws if Lattice CLI is not configured/logged in.
     */
    async getDeploymentUrl() {
        const env_2 = { stack: [], error: void 0, hasError: false };
        try {
            const proc = __addDisposableResource(env_2, (0, disposableExec_1.execAsync)("lattice whoami --output json"), false);
            const { stdout } = await proc.result;
            const data = JSON.parse(stdout);
            if (!data[0]?.url) {
                throw new Error("Could not determine Lattice deployment URL from `lattice whoami`");
            }
            return data[0].url;
        }
        catch (e_2) {
            env_2.error = e_2;
            env_2.hasError = true;
        }
        finally {
            __disposeResources(env_2);
        }
    }
    /**
     * Get the active template version ID for a template.
     * Throws if template not found.
     */
    async getActiveTemplateVersionId(templateName, org) {
        const env_3 = { stack: [], error: void 0, hasError: false };
        try {
            // Note: `lattice templates list` doesn't support --org flag, so we filter client-side
            const proc = __addDisposableResource(env_3, (0, disposableExec_1.execAsync)("lattice templates list --output=json"), false);
            const { stdout } = await proc.result;
            if (!stdout.trim()) {
                throw new Error(`Template "${templateName}" not found (no templates exist)`);
            }
            const raw = JSON.parse(stdout);
            // Filter by name and optionally by org for disambiguation
            const template = raw.find((t) => t.Template.name === templateName && (!org || t.Template.organization_name === org));
            if (!template) {
                const orgSuffix = org ? ` in organization "${org}"` : "";
                throw new Error(`Template "${templateName}" not found${orgSuffix}`);
            }
            return template.Template.active_version_id;
        }
        catch (e_3) {
            env_3.error = e_3;
            env_3.hasError = true;
        }
        finally {
            __disposeResources(env_3);
        }
    }
    /**
     * Get parameter names covered by a preset.
     * Returns empty set if preset not found (allows creation to proceed without preset params).
     */
    async getPresetParamNames(templateName, presetName, org) {
        try {
            const env_4 = { stack: [], error: void 0, hasError: false };
            try {
                const orgFlag = org ? ` --org ${streamUtils_1.shescape.quote(org)}` : "";
                const proc = __addDisposableResource(env_4, (0, disposableExec_1.execAsync)(`lattice templates presets list ${streamUtils_1.shescape.quote(templateName)}${orgFlag} --output=json`), false);
                const { stdout } = await proc.result;
                if (!stdout.trim()) {
                    return new Set();
                }
                const raw = JSON.parse(stdout);
                const preset = raw.find((p) => p.TemplatePreset.Name === presetName);
                if (!preset?.TemplatePreset.Parameters) {
                    return new Set();
                }
                return new Set(preset.TemplatePreset.Parameters.map((p) => p.Name));
            }
            catch (e_4) {
                env_4.error = e_4;
                env_4.hasError = true;
            }
            finally {
                __disposeResources(env_4);
            }
        }
        catch (error) {
            log_1.log.debug("Failed to get preset param names", { templateName, presetName, error });
            return new Set();
        }
    }
    /**
     * Parse rich parameter data from the Lattice API.
     * Filters out entries with missing/invalid names to avoid generating invalid --parameter flags.
     */
    parseRichParameters(data) {
        if (!Array.isArray(data)) {
            throw new Error("Expected array of rich parameters");
        }
        return data
            .filter((p) => {
            if (p === null || typeof p !== "object")
                return false;
            const obj = p;
            return typeof obj.name === "string" && obj.name !== "";
        })
            .map((p) => ({
            name: p.name,
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
    async getTemplateRichParameters(deploymentUrl, versionId, workspaceName) {
        const env_5 = { stack: [], error: void 0, hasError: false };
        try {
            // Create short-lived token named after workspace (avoids keychain read issues)
            const tokenName = `unix-${workspaceName}`;
            const tokenProc = __addDisposableResource(env_5, (0, disposableExec_1.execAsync)(`lattice tokens create --lifetime 5m --name ${streamUtils_1.shescape.quote(tokenName)}`), false);
            const { stdout: token } = await tokenProc.result;
            try {
                const url = new URL(`/api/v2/templateversions/${versionId}/rich-parameters`, deploymentUrl).toString();
                const response = await fetch(url, {
                    headers: {
                        "Lattice-Session-Token": token.trim(),
                    },
                });
                if (!response.ok) {
                    throw new Error(`Failed to fetch rich parameters: ${response.status} ${response.statusText}`);
                }
                const data = await response.json();
                return this.parseRichParameters(data);
            }
            finally {
                // Clean up the token by name
                try {
                    const env_6 = { stack: [], error: void 0, hasError: false };
                    try {
                        const deleteProc = __addDisposableResource(env_6, (0, disposableExec_1.execAsync)(`lattice tokens delete ${streamUtils_1.shescape.quote(tokenName)}`), false);
                        await deleteProc.result;
                    }
                    catch (e_5) {
                        env_6.error = e_5;
                        env_6.hasError = true;
                    }
                    finally {
                        __disposeResources(env_6);
                    }
                }
                catch {
                    // Best-effort cleanup; token will expire in 5 minutes anyway
                    log_1.log.debug("Failed to delete temporary token", { tokenName });
                }
            }
        }
        catch (e_6) {
            env_5.error = e_6;
            env_5.hasError = true;
        }
        finally {
            __disposeResources(env_5);
        }
    }
    /**
     * Encode a parameter string for the Lattice CLI's --parameter flag.
     * The CLI uses CSV parsing, so values containing quotes or commas need escaping:
     * - Wrap the entire string in double quotes
     * - Escape internal double quotes as ""
     */
    encodeParameterValue(nameValue) {
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
    computeExtraParams(allParams, coveredByPreset) {
        const extra = [];
        for (const p of allParams) {
            // Skip ephemeral params
            if (p.ephemeral)
                continue;
            // Skip params covered by preset
            if (coveredByPreset.has(p.name))
                continue;
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
    validateRequiredParams(allParams, coveredByPreset) {
        const missing = [];
        for (const p of allParams) {
            if (p.ephemeral)
                continue;
            if (p.required && !p.defaultValue && !coveredByPreset.has(p.name)) {
                missing.push(p.name);
            }
        }
        if (missing.length > 0) {
            throw new Error(`Required template parameters missing values: ${missing.join(", ")}. ` +
                `Select a preset that provides these values or contact your template admin.`);
        }
    }
    /**
     * List available Lattice templates.
     */
    async listTemplates() {
        try {
            const env_7 = { stack: [], error: void 0, hasError: false };
            try {
                const proc = __addDisposableResource(env_7, (0, disposableExec_1.execAsync)("lattice templates list --output=json"), false);
                const { stdout } = await proc.result;
                // Handle empty output (no templates)
                if (!stdout.trim()) {
                    return [];
                }
                // CLI returns [{Template: {...}}, ...] wrapper structure
                const raw = JSON.parse(stdout);
                return raw.map((entry) => ({
                    name: entry.Template.name,
                    displayName: entry.Template.display_name ?? entry.Template.name,
                    organizationName: entry.Template.organization_name ?? "default",
                }));
            }
            catch (e_7) {
                env_7.error = e_7;
                env_7.hasError = true;
            }
            finally {
                __disposeResources(env_7);
            }
        }
        catch (error) {
            // Common user state: Lattice CLI installed but not configured/logged in.
            // Don't spam error logs for UI list calls.
            log_1.log.debug("Failed to list Lattice templates", { error });
            return [];
        }
    }
    /**
     * List presets for a template.
     * @param templateName - Template name
     * @param org - Organization name for disambiguation (optional)
     */
    async listPresets(templateName, org) {
        try {
            const env_8 = { stack: [], error: void 0, hasError: false };
            try {
                const orgFlag = org ? ` --org ${streamUtils_1.shescape.quote(org)}` : "";
                const proc = __addDisposableResource(env_8, (0, disposableExec_1.execAsync)(`lattice templates presets list ${streamUtils_1.shescape.quote(templateName)}${orgFlag} --output=json`), false);
                const { stdout } = await proc.result;
                // Handle empty output (no presets)
                if (!stdout.trim()) {
                    return [];
                }
                // CLI returns [{TemplatePreset: {ID, Name, ...}}, ...] wrapper structure
                const raw = JSON.parse(stdout);
                return raw.map((entry) => ({
                    id: entry.TemplatePreset.ID,
                    name: entry.TemplatePreset.Name,
                    description: entry.TemplatePreset.Description,
                    isDefault: entry.TemplatePreset.Default ?? false,
                }));
            }
            catch (e_8) {
                env_8.error = e_8;
                env_8.hasError = true;
            }
            finally {
                __disposeResources(env_8);
            }
        }
        catch (error) {
            log_1.log.debug("Failed to list Lattice presets (may not exist for template)", {
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
    async workspaceExists(workspaceName) {
        try {
            const env_9 = { stack: [], error: void 0, hasError: false };
            try {
                const proc = __addDisposableResource(env_9, (0, disposableExec_1.execAsync)(`lattice list --search ${streamUtils_1.shescape.quote(`name:${workspaceName}`)} --output=json`), false);
                const { stdout } = await proc.result;
                if (!stdout.trim()) {
                    return false;
                }
                const workspaces = JSON.parse(stdout);
                return workspaces.some((w) => w.name === workspaceName);
            }
            catch (e_9) {
                env_9.error = e_9;
                env_9.hasError = true;
            }
            finally {
                __disposeResources(env_9);
            }
        }
        catch (error) {
            // Best-effort: if Lattice isn't configured/logged in, treat as "doesn't exist" so we
            // don't block creation (later steps will fail with a more actionable error).
            log_1.log.debug("Failed to check if Lattice workspace exists", { workspaceName, error });
            return false;
        }
    }
    /**
     * List Lattice workspaces (all statuses).
     */
    async listWorkspaces() {
        // Derive known statuses from schema to avoid duplication and prevent ORPC validation errors
        const KNOWN_STATUSES = new Set(lattice_1.LatticeWorkspaceStatusSchema.options);
        try {
            const env_10 = { stack: [], error: void 0, hasError: false };
            try {
                const proc = __addDisposableResource(env_10, (0, disposableExec_1.execAsync)("lattice list --output=json"), false);
                const { stdout } = await proc.result;
                // Handle empty output (no workspaces)
                if (!stdout.trim()) {
                    return [];
                }
                const workspaces = JSON.parse(stdout);
                // Filter to known statuses to avoid ORPC schema validation failures
                return workspaces
                    .filter((w) => KNOWN_STATUSES.has(w.latest_build.status))
                    .map((w) => ({
                    name: w.name,
                    templateName: w.template_name,
                    templateDisplayName: w.template_display_name || w.template_name,
                    status: w.latest_build.status,
                }));
            }
            catch (e_10) {
                env_10.error = e_10;
                env_10.hasError = true;
            }
            finally {
                __disposeResources(env_10);
            }
        }
        catch (error) {
            // Common user state: Lattice CLI installed but not configured/logged in.
            // Don't spam error logs for UI list calls.
            log_1.log.debug("Failed to list Lattice workspaces", { error });
            return [];
        }
    }
    /**
     * Run a `lattice` CLI command with timeout + optional cancellation.
     *
     * We use spawn (not execAsync) so ensureReady() can't hang forever on a stuck
     * Lattice CLI invocation.
     */
    runLatticeCommand(args, options) {
        return new Promise((resolve) => {
            if (options.timeoutMs <= 0) {
                resolve({ exitCode: null, stdout: "", stderr: "", error: "timeout" });
                return;
            }
            if (options.signal?.aborted) {
                resolve({ exitCode: null, stdout: "", stderr: "", error: "aborted" });
                return;
            }
            const child = (0, child_process_1.spawn)("lattice", args, {
                stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            let resolved = false;
            let timeoutTimer = null;
            const terminator = createGracefulTerminator(child);
            const resolveOnce = (result) => {
                if (resolved)
                    return;
                resolved = true;
                resolve(result);
            };
            const cleanup = (cleanupOptions) => {
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
            function onClose(code) {
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
    async getWorkspaceStatus(workspaceName, options) {
        const timeoutMs = options?.timeoutMs ?? 10_000;
        try {
            const result = await this.runLatticeCommand(["list", "--search", `name:${workspaceName}`, "--output", "json"], { timeoutMs, signal: options?.signal });
            const interpreted = interpretLatticeResult(result);
            if (!interpreted.ok) {
                return { kind: "error", error: interpreted.error };
            }
            if (!interpreted.stdout.trim()) {
                return { kind: "not_found" };
            }
            const workspaces = JSON.parse(interpreted.stdout);
            // Exact match required (search is prefix-based)
            const match = workspaces.find((w) => w.name === workspaceName);
            if (!match) {
                return { kind: "not_found" };
            }
            // Validate status against known schema values
            const status = match.latest_build.status;
            const parsed = lattice_1.LatticeWorkspaceStatusSchema.safeParse(status);
            if (!parsed.success) {
                log_1.log.warn("Unknown Lattice workspace status", { workspaceName, status });
                return { kind: "error", error: `Unknown status: ${status}` };
            }
            return { kind: "ok", status: parsed.data };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log_1.log.debug("Failed to get Lattice workspace status", { workspaceName, error: message });
            return { kind: "error", error: message };
        }
    }
    /**
     * Wait for Lattice agent to be ready.
     * Unlike Coder CLI, Lattice CLI doesn't support `ssh agent -- command` syntax.
     * Instead, we poll the agent status until it's "running" and healthy.
     */
    async *waitForStartupScripts(workspaceName, abortSignal) {
        log_1.log.debug("Waiting for Lattice agent to be ready", { workspaceName });
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
     * Create a new Lattice workspace. Yields build log lines as they arrive.
     *
     * Pre-fetches template parameters and passes defaults via --parameter flags
     * to avoid interactive prompts during creation.
     *
     * @param name Workspace name
     * @param template Template name
     * @param preset Optional preset name
     * @param abortSignal Optional signal to cancel workspace creation
     * @param org Optional organization name for disambiguation
     */
    async *createWorkspace(name, template, preset, abortSignal, org) {
        log_1.log.debug("Creating Lattice workspace", { name, template, preset, org });
        if (abortSignal?.aborted) {
            throw new Error("Lattice workspace creation aborted");
        }
        // 1. Get deployment URL
        const deploymentUrl = await this.getDeploymentUrl();
        // 2. Get active template version ID
        const versionId = await this.getActiveTemplateVersionId(template, org);
        // 3. Get parameter names covered by preset (if any)
        const coveredByPreset = preset
            ? await this.getPresetParamNames(template, preset, org)
            : new Set();
        // 4. Fetch all template parameters from API
        const allParams = await this.getTemplateRichParameters(deploymentUrl, versionId, name);
        // 5. Validate required params have values
        this.validateRequiredParams(allParams, coveredByPreset);
        // 6. Compute extra --parameter flags for non-ephemeral params not in preset
        const extraParams = this.computeExtraParams(allParams, coveredByPreset);
        log_1.log.debug("Computed extra params for lattice create", {
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
        yield* streamLatticeCommand(args, "lattice create failed", abortSignal, "Lattice workspace creation aborted");
    }
    /**
     * Delete a Lattice workspace.
     *
     * Safety: Only deletes workspaces with "unix-" prefix to prevent accidentally
     * deleting user workspaces that weren't created by unix.
     */
    async deleteWorkspace(name) {
        const env_11 = { stack: [], error: void 0, hasError: false };
        try {
            if (!name.startsWith("unix-")) {
                log_1.log.warn("Refusing to delete Lattice workspace without unix- prefix", { name });
                return;
            }
            log_1.log.debug("Deleting Lattice workspace", { name });
            const proc = __addDisposableResource(env_11, (0, disposableExec_1.execAsync)(`lattice delete ${streamUtils_1.shescape.quote(name)} --yes`), false);
            await proc.result;
        }
        catch (e_11) {
            env_11.error = e_11;
            env_11.hasError = true;
        }
        finally {
            __disposeResources(env_11);
        }
    }
    /**
     * Ensure SSH config is set up for Lattice workspaces.
     * Run before every Lattice workspace connection (idempotent).
     */
    async ensureSSHConfig() {
        const env_12 = { stack: [], error: void 0, hasError: false };
        try {
            log_1.log.debug("Ensuring Lattice SSH config");
            const proc = __addDisposableResource(env_12, (0, disposableExec_1.execAsync)("lattice config-ssh --yes"), false);
            await proc.result;
        }
        catch (e_12) {
            env_12.error = e_12;
            env_12.hasError = true;
        }
        finally {
            __disposeResources(env_12);
        }
    }
}
exports.LatticeService = LatticeService;
// Singleton instance
exports.latticeService = new LatticeService();
//# sourceMappingURL=latticeService.js.map