/**
 * Debug command to test git status parsing against actual minions.
 *
 * This reuses the EXACT same code path as production to ensure they stay in sync.
 *
 * Usage: bun debug git-status [minion-id]
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// Import production code - script and parser stay in sync
import { GIT_STATUS_SCRIPT, parseGitStatusScriptOutput } from "@/common/utils/git/gitStatus";
import { getLatticeSrcDir } from "@/common/constants/paths";

function findMinions(): Array<{ id: string; path: string }> {
  const minions: Array<{ id: string; path: string }> = [];
  const latticeSrcDir = getLatticeSrcDir();

  try {
    const projects = readdirSync(latticeSrcDir);
    for (const project of projects) {
      const projectPath = join(latticeSrcDir, project);
      if (!statSync(projectPath).isDirectory()) continue;

      const branches = readdirSync(projectPath);
      for (const branch of branches) {
        const minionPath = join(projectPath, branch);
        if (statSync(minionPath).isDirectory()) {
          minions.push({
            // NOTE: Using directory name as display ID for debug purposes only.
            // This is NOT how minion IDs are determined in production code.
            // Production minion IDs come from metadata.json in the session dir.
            id: branch,
            path: minionPath,
          });
        }
      }
    }
  } catch (err) {
    console.error("Failed to find minions:", err);
  }

  return minions;
}

function testGitStatus(minionId: string, minionPath: string) {
  console.log("\n" + "=".repeat(80));
  console.log(`Minion: ${minionId}`);
  console.log(`Path: ${minionPath}`);
  console.log("=".repeat(80));

  try {
    // Run the git status script
    const output = execSync(GIT_STATUS_SCRIPT, {
      cwd: minionPath,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    console.log("\n--- RAW OUTPUT ---");
    console.log(output);

    // Parse using production function
    const parsed = parseGitStatusScriptOutput(output);

    if (!parsed) {
      console.log("\n❌ FAILED: Could not parse script output");
      return;
    }

    const {
      primaryBranch,
      ahead,
      behind,
      dirtyCount,
      outgoingAdditions,
      outgoingDeletions,
      incomingAdditions,
      incomingDeletions,
    } = parsed;
    const dirty = dirtyCount > 0;

    console.log("\n--- PARSED RESULT ---");
    console.log(
      `✅ Success: { base: ${primaryBranch}, ahead: ${ahead}, behind: ${behind}, dirty: ${dirty}, outgoing: +${outgoingAdditions}/-${outgoingDeletions}, incoming: +${incomingAdditions}/-${incomingDeletions} }`
    );

    // Verify with git rev-list
    console.log("\n--- VERIFICATION (git rev-list) ---");
    try {
      const revList = execSync(`git rev-list --left-right --count HEAD...origin/${primaryBranch}`, {
        cwd: minionPath,
        encoding: "utf-8",
      }).trim();

      const [verifyAhead, verifyBehind] = revList.split(/\s+/).map((n) => parseInt(n, 10));
      console.log(`git rev-list: ahead=${verifyAhead}, behind=${verifyBehind}`);

      if (verifyAhead !== ahead || verifyBehind !== behind) {
        console.log("⚠️  WARNING: Mismatch between script output and rev-list!");
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.log("Could not verify with git rev-list:", error.message);
    }
  } catch (err: unknown) {
    const error = err as Error & { stderr?: string };
    console.log("\n❌ ERROR running git command:");
    console.log(error.message);
    if (error.stderr) {
      console.log("STDERR:", error.stderr);
    }
  }
}

export function gitStatusCommand(minionId?: string) {
  const latticeSrcDir = getLatticeSrcDir();
  console.log("🔍 Git Status Debug Tool");
  console.log("Finding minions in:", latticeSrcDir);
  console.log();

  const minions = findMinions();
  console.log(`Found ${minions.length} minions\n`);

  if (minions.length === 0) {
    console.log("No minions found! Check that ~/.lattice/src/ contains minion directories.");
    process.exit(1);
  }

  if (minionId) {
    // Test specific minion
    const minion = minions.find((w) => w.id === minionId);
    if (!minion) {
      console.error(`Minion "${minionId}" not found`);
      console.log("\nAvailable minions:");
      minions.forEach((w) => console.log(`  - ${w.id}`));
      process.exit(1);
    }
    testGitStatus(minion.id, minion.path);
  } else {
    // Test first 3 minions
    const toTest = minions.slice(0, 3);
    console.log(
      `Testing ${toTest.length} minions (use "bun debug git-status <id>" for specific minion)...\n`
    );

    for (const minion of toTest) {
      testGitStatus(minion.id, minion.path);
    }

    console.log("\n" + "=".repeat(80));
    console.log("Available minions:");
    minions.forEach((w) => console.log(`  - ${w.id}`));
  }

  console.log("\n" + "=".repeat(80));
  console.log("Done!");
}
