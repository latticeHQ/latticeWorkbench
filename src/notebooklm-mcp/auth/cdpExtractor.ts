/**
 * Chrome DevTools Protocol (CDP) cookie extraction.
 *
 * Connects to Chrome via CDP WebSocket to extract Google auth cookies
 * without needing keychain access. Supports both connecting to an
 * existing Chrome instance and launching a new one.
 *
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import type { CdpTarget } from "./types";
import { parseCookies, validateCookies } from "./cookieManager";

// ─── Chrome Discovery ───────────────────────────────────────────────────────

/** Known Chrome paths by platform. */
function getChromePath(): string | null {
  const os = platform();
  const paths: string[] = [];

  if (os === "darwin") {
    paths.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else if (os === "linux") {
    paths.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  } else if (os === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env["ProgramFiles"] ?? "";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "";
    paths.push(
      join(localAppData, "Google/Chrome/Application/chrome.exe"),
      join(programFiles, "Google/Chrome/Application/chrome.exe"),
      join(programFilesX86, "Google/Chrome/Application/chrome.exe"),
    );
  }

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // Try `which` as fallback
  try {
    return execSync("which google-chrome || which chromium", {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

/** Find an available port for CDP. */
function findAvailablePort(start = 9222, end = 9231): number {
  // Simple approach: try ports sequentially
  for (let port = start; port <= end; port++) {
    try {
      execSync(`lsof -i :${port}`, { encoding: "utf-8" });
      // Port is in use — skip
    } catch {
      // lsof returns non-zero = port is free
      return port;
    }
  }
  throw new Error(`No available CDP port found in range ${start}-${end}`);
}

// ─── CDP Communication ──────────────────────────────────────────────────────

/**
 * Execute a CDP command via WebSocket.
 *
 * Connects to Chrome's WebSocket debugging protocol, sends a command,
 * and waits for the response.
 */
async function executeCdpCommand(
  wsUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  // Dynamic import for ws (WebSocket client)
  const { default: WebSocket } = await import("ws");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Math.floor(Math.random() * 1000000);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command timed out: ${method}`));
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) {
            reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
          } else {
            resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    });

    ws.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Get the WebSocket debugger URL from Chrome's /json/version endpoint.
 */
async function getDebuggerUrl(host: string, port: number): Promise<string> {
  const response = await fetch(`http://${host}:${port}/json/version`);
  if (!response.ok) {
    throw new Error(`Failed to connect to Chrome CDP at ${host}:${port}`);
  }
  const data = (await response.json()) as { webSocketDebuggerUrl: string };
  return data.webSocketDebuggerUrl;
}

// ─── Cookie Extraction ──────────────────────────────────────────────────────

/**
 * Extract all cookies from a running Chrome instance via CDP.
 */
export async function extractCookiesFromCdp(
  target: CdpTarget,
): Promise<Record<string, string>> {
  const wsUrl = target.wsUrl ?? (await getDebuggerUrl(target.host, target.port));

  const result = (await executeCdpCommand(wsUrl, "Network.getAllCookies")) as {
    cookies: Array<{ name: string; value: string; domain: string }>;
  };

  // Filter to Google auth cookies
  const googleCookies: Record<string, string> = {};
  for (const cookie of result.cookies) {
    if (
      cookie.domain.includes(".google.com") ||
      cookie.domain.includes("notebooklm.google.com")
    ) {
      googleCookies[cookie.name] = cookie.value;
    }
  }

  return googleCookies;
}

/**
 * Launch Chrome with remote debugging enabled and extract cookies
 * after the user logs in to Google.
 *
 * @param profileName - Chrome profile name for persistent login state
 * @param timeout - Max wait time for login (ms)
 */
export async function launchAndExtract(
  profileName = "default",
  timeout = 120_000,
): Promise<{
  cookies: Record<string, string>;
  email?: string;
}> {
  const chromePath = getChromePath();
  if (!chromePath) {
    throw new Error(
      "Chrome not found. Install Google Chrome or set the chrome path manually.",
    );
  }

  const port = findAvailablePort();
  const profileDir = join(
    homedir(),
    ".lattice",
    "notebooklm",
    "chrome-profiles",
    profileName,
  );

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://notebooklm.google.com",
  ];

  const chrome: ChildProcess = spawn(chromePath, args, {
    stdio: "ignore",
    detached: true,
  });
  chrome.unref();

  // Wait for Chrome to start
  await new Promise((r) => setTimeout(r, 3000));

  const deadline = Date.now() + timeout;

  try {
    while (Date.now() < deadline) {
      try {
        const cookies = await extractCookiesFromCdp({
          host: "127.0.0.1",
          port,
        });
        const validation = validateCookies(cookies);
        if (validation.valid) {
          return { cookies };
        }
      } catch {
        // Chrome not ready yet or user hasn't logged in
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timed out waiting for Google login");
  } finally {
    // Clean up Chrome process
    try {
      chrome.kill();
    } catch {
      // Already exited
    }
  }
}

/**
 * Try headless auth refresh using an existing Chrome profile.
 * This works if the user has previously logged in and Chrome saved the session.
 */
export async function headlessRefresh(
  profileName = "default",
): Promise<Record<string, string> | null> {
  const chromePath = getChromePath();
  if (!chromePath) return null;

  const port = findAvailablePort();
  const profileDir = join(
    homedir(),
    ".lattice",
    "notebooklm",
    "chrome-profiles",
    profileName,
  );

  if (!existsSync(profileDir)) return null;

  const chrome: ChildProcess = spawn(
    chromePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--disable-gpu",
      "https://notebooklm.google.com",
    ],
    { stdio: "ignore", detached: true },
  );
  chrome.unref();

  await new Promise((r) => setTimeout(r, 5000));

  try {
    const cookies = await extractCookiesFromCdp({
      host: "127.0.0.1",
      port,
    });
    const validation = validateCookies(cookies);
    return validation.valid ? cookies : null;
  } catch {
    return null;
  } finally {
    try {
      chrome.kill();
    } catch {
      // Already exited
    }
  }
}
