/**
 * Validates minion name format
 * - Must be 1-64 characters long
 * - Can only contain: lowercase letters, digits, underscore, hyphen
 * - Pattern: [a-z0-9_-]{1,64}
 */
export function validateMinionName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: "Minion name cannot be empty" };
  }

  if (name.length > 64) {
    return { valid: false, error: "Minion name cannot exceed 64 characters" };
  }

  const validPattern = /^[a-z0-9_-]+$/;
  if (!validPattern.test(name)) {
    return {
      valid: false,
      // Minion names become folder names, git branches, and session directories,
      // so they need to be filesystem-safe across platforms.
      error:
        "Minion names can only contain lowercase letters, numbers, hyphens, and underscores",
    };
  }

  return { valid: true };
}
