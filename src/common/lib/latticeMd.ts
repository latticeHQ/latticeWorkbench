/**
 * openagent.md Client Library
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

export const LATTICE_MD_BASE_URL = "https://openagent.md";
export const LATTICE_MD_HOST = "openagent.md";

// --- URL utilities ---

/**
 * Check if URL is a openagent.md share link with encryption key in fragment
 */
export function isLatticeMdUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.host === LATTICE_MD_HOST && parseUrl(url) !== null;
  } catch {
    return false;
  }
}

/**
 * Parse openagent.md URL to extract ID and key
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
 * Upload content to openagent.md with end-to-end encryption.
 */
export async function uploadToLatticeMd(
  content: string,
  fileInfo: FileInfo,
  options: UploadOptions = {}
): Promise<UploadResult> {
  return upload(new TextEncoder().encode(content), fileInfo, {
    baseUrl: LATTICE_MD_BASE_URL,
    expiresAt: options.expiresAt,
    signature: options.signature,
    sign: options.sign,
  });
}

/**
 * Delete a shared file from openagent.md.
 */
export async function deleteFromLatticeMd(id: string, mutateKey: string): Promise<void> {
  await deleteFile(id, mutateKey, { baseUrl: LATTICE_MD_BASE_URL });
}

/**
 * Update expiration of a shared file on openagent.md.
 */
export async function updateLatticeMdExpiration(
  id: string,
  mutateKey: string,
  expiresAt: Date | string
): Promise<number | undefined> {
  const result = await setExpiration(id, mutateKey, expiresAt, { baseUrl: LATTICE_MD_BASE_URL });
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
 * Download and decrypt content from openagent.md.
 */
export async function downloadFromLatticeMd(
  id: string,
  keyMaterial: string,
  _signal?: AbortSignal
): Promise<DownloadResult> {
  const result = await download(id, keyMaterial, { baseUrl: LATTICE_MD_BASE_URL });
  return {
    content: new TextDecoder().decode(result.data),
    fileInfo: result.info,
  };
}
