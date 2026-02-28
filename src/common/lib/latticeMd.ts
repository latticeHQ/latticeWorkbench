/**
 * lattice.md Client Library
 *
 * Thin wrapper around @latticeruntime/md-client for Lattice app integration.
 * Re-exports types and provides convenience functions with default base URL.
 */

import {
  upload,
  download,
  deleteFile,
  setExpiration,
  parseUrl,
  type FileInfo,
  type SignOptions,
  type SignatureEnvelope,
  type UploadResult,
} from "@latticeruntime/md-client";

// Re-export types from package
export type { FileInfo, SignOptions, SignatureEnvelope, UploadResult };

export const LATTICE_MD_BASE_URL = "https://lattice.md";
export const LATTICE_MD_HOST = "lattice.md";

function getLatticeMdUrlOverrideRaw(): string | undefined {
  // In Electron, we expose the env var via preload so the renderer doesn't need `process.env`.
  if (typeof window !== "undefined") {
    const fromPreload = window.api?.latticeMdUrlOverride;
    if (fromPreload && fromPreload.trim().length > 0) return fromPreload;

    // In dev-server browser mode (no Electron preload), Vite injects the env var into the bundle.
    const fromViteDefine = globalThis.__LATTICE_MD_URL_OVERRIDE__;
    if (fromViteDefine && fromViteDefine.trim().length > 0) return fromViteDefine;

    // Important: avoid falling back to `process.env` in the renderer bundle.
    return undefined;
  }

  // In Node (main process / tests), read directly from the environment.
  const fromEnv = globalThis.process?.env?.LATTICE_MD_URL_OVERRIDE;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;

  return undefined;
}

function normalizeLatticeMdBaseUrlOverride(raw: string): string | undefined {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Returns the effective lattice.md base URL.
 *
 * Supports a runtime override (via `LATTICE_MD_URL_OVERRIDE`) so we can test against staging/local lattice.md
 * deployments without rebuilding the renderer bundle.
 */
export function getLatticeMdBaseUrl(): string {
  const overrideRaw = getLatticeMdUrlOverrideRaw();
  const override = overrideRaw ? normalizeLatticeMdBaseUrlOverride(overrideRaw) : undefined;
  return override ?? LATTICE_MD_BASE_URL;
}

/**
 * Hosts that should be treated as lattice.md share links.
 *
 * Even when an override is set, we still allow the production host so existing share links keep
 * working.
 */
export function getLatticeMdAllowedHosts(): string[] {
  const hosts = new Set<string>();
  hosts.add(LATTICE_MD_HOST);

  try {
    hosts.add(new URL(getLatticeMdBaseUrl()).host);
  } catch {
    // Best-effort: getLatticeMdBaseUrl() should always be a valid URL.
  }

  return [...hosts];
}

// --- URL utilities ---

/**
 * Check if URL is a lattice.md share link with encryption key in fragment
 */
export function isLatticeMdUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return getLatticeMdAllowedHosts().includes(parsed.host) && parseUrl(url) !== null;
  } catch {
    return false;
  }
}

/**
 * Parse a lattice.md share URL to extract ID and key.
 *
 * Note: `parseUrl` does not validate the host; call `isLatticeMdUrl()` when validating user input.
 */
export function parseLatticeMdUrl(url: string): { id: string; key: string } | null {
  return parseUrl(url);
}

export interface UploadOptions {
  /** Expiration time (ISO date string or Date object) */
  expiresAt?: string | Date;
  /**
   * Precomputed signature envelope to embed in the encrypted payload.
   * Takes precedence over `sign`.
   */
  signature?: SignatureEnvelope;
  /** Sign options for native signing via lattice-md-client */
  sign?: SignOptions;
}

// --- Public API ---

/**
 * Upload content to lattice.md with end-to-end encryption.
 */
export async function uploadToLatticeMd(
  content: string,
  fileInfo: FileInfo,
  options: UploadOptions = {}
): Promise<UploadResult> {
  return upload(new TextEncoder().encode(content), fileInfo, {
    baseUrl: getLatticeMdBaseUrl(),
    expiresAt: options.expiresAt,
    signature: options.signature,
    sign: options.sign,
  });
}

/**
 * Delete a shared file from lattice.md.
 */
export async function deleteFromLatticeMd(id: string, mutateKey: string): Promise<void> {
  await deleteFile(id, mutateKey, { baseUrl: getLatticeMdBaseUrl() });
}

/**
 * Update expiration of a shared file on lattice.md.
 */
export async function updateLatticeMdExpiration(
  id: string,
  mutateKey: string,
  expiresAt: Date | string
): Promise<number | undefined> {
  const result = await setExpiration(id, mutateKey, expiresAt, { baseUrl: getLatticeMdBaseUrl() });
  return result.expiresAt;
}

// --- Download API ---

export interface DownloadResult {
  /** Decrypted content */
  content: string;
  /** File metadata (if available) */
  fileInfo?: FileInfo;
}

/**
 * Download and decrypt content from lattice.md.
 */
export async function downloadFromLatticeMd(
  id: string,
  keyMaterial: string,
  _signal?: AbortSignal,
  options?: {
    baseUrl?: string;
  }
): Promise<DownloadResult> {
  const result = await download(id, keyMaterial, {
    baseUrl: options?.baseUrl ?? getLatticeMdBaseUrl(),
  });
  return {
    content: new TextDecoder().decode(result.data),
    fileInfo: result.info,
  };
}
