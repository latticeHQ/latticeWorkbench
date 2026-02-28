import * as path from "path";

/**
 * Returns the on-disk projectPath for the built-in Chat with Lattice system minion.
 *
 * Note: This must be computed from the active lattice home dir (Config.rootDir) so
 * tests and dev installs (LATTICE_ROOT) behave consistently.
 */
export function getLatticeHelpChatProjectPath(latticeHome: string): string {
  // Use a pretty basename for UI display (project name = basename of projectPath).
  return path.join(latticeHome, "system", "Lattice");
}
