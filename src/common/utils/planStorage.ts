/**
 * Default lattice home directory for plan storage.
 * Uses tilde prefix for portability across local/remote runtimes.
 * Note: Plan files intentionally do NOT use the -dev suffix because they
 * should be accessible regardless of whether running dev or prod builds.
 *
 * Docker containers use /var/lattice instead (passed via latticeHome parameter).
 */
const DEFAULT_LATTICE_HOME = "~/.lattice";

/**
 * Get the plan file path for a minion.
 * Returns a path that works with the specified runtime's lattice home directory.
 *
 * Plan files are stored at: {latticeHome}/plans/{projectName}/{minionName}.md
 *
 * Minion names include a random suffix (e.g., "sidebar-a1b2") making them
 * globally unique with high probability. The project folder is for organization
 * and discoverability, not uniqueness.
 *
 * @param minionName - Human-readable minion name with suffix (e.g., "fix-plan-a1b2")
 * @param projectName - Project name extracted from project path (e.g., "lattice")
 * @param latticeHome - Lattice home directory (default: ~/.lattice, Docker uses /var/lattice)
 */
export function getPlanFilePath(
  minionName: string,
  projectName: string,
  latticeHome = DEFAULT_LATTICE_HOME
): string {
  return `${latticeHome}/plans/${projectName}/${minionName}.md`;
}

/**
 * Get the legacy plan file path (stored by minion ID).
 * Used for migration: when reading, check new path first, then fall back to legacy.
 * Note: Legacy paths are not used for Docker (no migration needed for new runtime).
 *
 * @param minionId - Stable minion identifier (e.g., "a1b2c3d4e5")
 */
export function getLegacyPlanFilePath(minionId: string): string {
  return `${DEFAULT_LATTICE_HOME}/plans/${minionId}.md`;
}
