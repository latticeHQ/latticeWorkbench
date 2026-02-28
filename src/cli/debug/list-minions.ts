import { defaultConfig } from "@/node/config";
import { PlatformPaths } from "@/common/utils/paths";
import * as fs from "fs";
import { getLatticeSessionsDir } from "@/common/constants/paths";

export function listMinionsCommand() {
  const config = defaultConfig.loadConfigOrDefault();

  console.log("\n=== Configuration Debug ===\n");
  console.log("Projects in config:", config.projects.size);

  for (const [projectPath, project] of config.projects) {
    const projectName = PlatformPaths.basename(projectPath);
    console.log(`\nProject: ${projectName}`);
    console.log(`  Path: ${projectPath}`);
    console.log(`  Minions: ${project.minions.length}`);

    for (const minion of project.minions) {
      const dirName = PlatformPaths.basename(minion.path);
      console.log(`    - Directory: ${dirName}`);
      if (minion.id) {
        console.log(`      ID: ${minion.id}`);
      }
      if (minion.name) {
        console.log(`      Name: ${minion.name}`);
      }
      console.log(`      Path: ${minion.path}`);
      console.log(`      Exists: ${fs.existsSync(minion.path)}`);
    }
  }

  console.log("\n=== Testing findMinion ===\n");

  // Test finding specific minions by ID
  const testCases = ["lattice-colors", "lattice-main", "lattice-fix", "lattice-markdown"];

  for (const minionId of testCases) {
    const result = defaultConfig.findMinion(minionId);
    console.log(`findMinion('${minionId}'):`);
    if (result) {
      console.log(`  Found: ${result.minionPath}`);
      console.log(`  Project: ${result.projectPath}`);
      console.log(`  Exists: ${fs.existsSync(result.minionPath)}`);
    } else {
      console.log(`  Not found!`);
    }
  }

  console.log("\n=== Sessions Directory ===\n");
  const sessionsDir = getLatticeSessionsDir();
  if (fs.existsSync(sessionsDir)) {
    const sessions = fs.readdirSync(sessionsDir);
    console.log(`Sessions in ${sessionsDir}:`);
    for (const session of sessions) {
      console.log(`  - ${session}`);
    }
  } else {
    console.log("Sessions directory does not exist");
  }
}
