import { homedir } from "os";

/**
 * Get the real user home directory, bypassing MAS sandbox container redirect.
 *
 * In MAS sandbox, `os.homedir()` / `process.env.HOME` returns:
 *   ~/Library/Containers/<bundleId>/Data/
 *
 * This extracts the actual `/Users/<username>` path.
 * Outside MAS sandbox, returns the normal home directory unchanged.
 */
export function getRealHome(): string {
  const home = homedir();
  const containerMatch = home.match(/^(\/Users\/[^/]+)\/Library\/Containers\//);
  return containerMatch ? containerMatch[1] : home;
}
