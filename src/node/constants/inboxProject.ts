import * as path from "path";

/**
 * Returns the on-disk projectPath for the dedicated Inboxes system project.
 * All channel adapter conversations (Telegram, WhatsApp, Slack, etc.) are
 * consolidated under this single project so they don't scatter across
 * user projects.
 *
 * Mirrors getLatticeHelpChatProjectPath — computed from the active lattice home dir
 * so tests and dev installs (LATTICE_ROOT) behave consistently.
 */
export function getInboxesProjectPath(latticeHome: string): string {
  return path.join(latticeHome, "system", "Inboxes");
}
