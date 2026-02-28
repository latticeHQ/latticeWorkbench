/**
 * Cookie persistence — store/load/validate Google auth cookies.
 *
 * Cookies are stored in ~/.lattice/notebooklm/ with per-profile support.
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { REQUIRED_COOKIES, type AuthProfile } from "./types";

// ─── Storage paths ──────────────────────────────────────────────────────────

const STORAGE_ROOT = join(homedir(), ".lattice", "notebooklm");
const PROFILES_DIR = join(STORAGE_ROOT, "profiles");

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function profileDir(profileName: string): string {
  return join(PROFILES_DIR, profileName);
}

// ─── Cookie Validation ──────────────────────────────────────────────────────

/**
 * Validate that all required Google auth cookies are present.
 */
export function validateCookies(
  cookies: Record<string, string>,
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const name of REQUIRED_COOKIES) {
    if (!cookies[name]) {
      missing.push(name);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * Build a Cookie header string from a cookie dict.
 */
export function cookiesToHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Parse cookies from various formats (JSON array, cookie header string, dict).
 */
export function parseCookies(
  input: string | Record<string, string> | Array<{ name: string; value: string }>,
): Record<string, string> {
  if (Array.isArray(input)) {
    const cookies: Record<string, string> = {};
    for (const c of input) {
      if (c.name && c.value) cookies[c.name] = c.value;
    }
    return cookies;
  }

  if (typeof input === "object") {
    return { ...input };
  }

  // Try JSON parse first
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parseCookies(parsed);
    }
    if (typeof parsed === "object" && parsed !== null) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [String(k), String(v)]),
      );
    }
  } catch {
    // Not JSON — try cookie header format
  }

  // Parse "name=value; name=value" format
  const cookies: Record<string, string> = {};
  for (const item of input.split(";")) {
    const eq = item.indexOf("=");
    if (eq > 0) {
      cookies[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
    }
  }
  return cookies;
}

// ─── Profile Management ─────────────────────────────────────────────────────

/**
 * Save an auth profile to disk.
 */
export function saveProfile(profile: AuthProfile): void {
  const dir = profileDir(profile.name);
  ensureDir(dir);

  const cookiePath = join(dir, "cookies.json");
  const metaPath = join(dir, "metadata.json");

  writeFileSync(cookiePath, JSON.stringify(profile.cookies, null, 2));
  chmodSync(cookiePath, 0o600);

  const metadata = {
    email: profile.email,
    csrfToken: profile.csrfToken,
    sessionId: profile.sessionId,
    buildLabel: profile.buildLabel,
    extractedAt: profile.extractedAt,
  };
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  chmodSync(metaPath, 0o600);
}

/**
 * Load an auth profile from disk.
 */
export function loadProfile(profileName: string): AuthProfile | null {
  const dir = profileDir(profileName);
  const cookiePath = join(dir, "cookies.json");
  const metaPath = join(dir, "metadata.json");

  if (!existsSync(cookiePath)) return null;

  try {
    const cookies = JSON.parse(readFileSync(cookiePath, "utf-8"));
    let metadata: Record<string, unknown> = {};
    if (existsSync(metaPath)) {
      metadata = JSON.parse(readFileSync(metaPath, "utf-8"));
    }

    return {
      name: profileName,
      email: (metadata.email as string) ?? undefined,
      cookies,
      csrfToken: (metadata.csrfToken as string) ?? "",
      sessionId: (metadata.sessionId as string) ?? "",
      buildLabel: (metadata.buildLabel as string) ?? "",
      extractedAt: (metadata.extractedAt as string) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Load the default profile, or the first available profile.
 */
export function loadDefaultProfile(): AuthProfile | null {
  // Try "default" profile first
  const defaultProfile = loadProfile("default");
  if (defaultProfile) return defaultProfile;

  // Try legacy auth.json (flat file, no profiles)
  const legacyPath = join(STORAGE_ROOT, "auth.json");
  if (existsSync(legacyPath)) {
    try {
      const data = JSON.parse(readFileSync(legacyPath, "utf-8"));
      return {
        name: "default",
        cookies: data.cookies ?? {},
        csrfToken: data.csrf_token ?? data.csrfToken ?? "",
        sessionId: data.session_id ?? data.sessionId ?? "",
        buildLabel: data.build_label ?? data.buildLabel ?? "",
        extractedAt: data.extracted_at ?? data.extractedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  // Try first profile in profiles dir
  if (existsSync(PROFILES_DIR)) {
    try {
      const { readdirSync } = require("fs");
      const entries = readdirSync(PROFILES_DIR, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const profile = loadProfile(entry.name);
          if (profile) return profile;
        }
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * List all available profile names.
 */
export function listProfiles(): string[] {
  if (!existsSync(PROFILES_DIR)) return [];
  try {
    const { readdirSync } = require("fs");
    return (readdirSync(PROFILES_DIR, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>)
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
