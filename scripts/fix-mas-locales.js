/**
 * electron-builder afterPack hook to fix broken locale entries in Electron Framework.
 *
 * Electron 38+ ships locale variant directories (_MASCULINE, _NEUTER, _FEMININE)
 * as symlinks that break during MAS packaging, causing codesign to fail
 * with "No such file or directory" errors.
 *
 * This script removes any lproj entries that are broken symlinks OR directories
 * where locale.pak is missing/broken.
 */
const fs = require("fs");
const path = require("path");

module.exports = async function (context) {
  if (context.electronPlatformName !== "mas") return;

  const appPath = context.appOutDir;
  const frameworksPath = path.join(appPath, "Lattice.app", "Contents", "Frameworks");

  if (!fs.existsSync(frameworksPath)) {
    console.log("  • fix-mas-locales: Frameworks path not found, skipping");
    return;
  }

  let fixed = 0;

  function fixLocalesIn(dir) {
    if (!fs.existsSync(dir)) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.name.endsWith(".lproj")) {
        // First check if the .lproj entry itself is a broken symlink.
        // dirent.isDirectory() returns false for broken symlinks, so we
        // must use lstatSync to detect them.
        let lstat;
        try {
          lstat = fs.lstatSync(fullPath);
        } catch {
          continue; // Can't stat at all, skip
        }

        if (lstat.isSymbolicLink()) {
          // It's a symlink — check if the target exists
          try {
            fs.statSync(fullPath);
          } catch {
            // Broken symlink — remove it
            fs.rmSync(fullPath, { force: true });
            fixed++;
            continue;
          }
        }

        // It's a real directory (or a valid symlink to a directory).
        // Check if locale.pak exists and is valid.
        if (lstat.isDirectory() || lstat.isSymbolicLink()) {
          const pakPath = path.join(fullPath, "locale.pak");
          let pakOk = false;
          try {
            // statSync follows symlinks — if locale.pak is a broken symlink this throws
            fs.statSync(pakPath);
            pakOk = true;
          } catch {
            pakOk = false;
          }

          if (!pakOk) {
            // locale.pak is missing or a broken symlink — remove the whole lproj
            fs.rmSync(fullPath, { recursive: true, force: true });
            fixed++;
            continue;
          }
        }
      } else if (entry.isDirectory()) {
        fixLocalesIn(fullPath);
      } else if (entry.isSymbolicLink()) {
        // Follow symlinked directories for recursive traversal
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fixLocalesIn(fullPath);
          }
        } catch {
          // Broken symlink to a non-lproj dir, ignore
        }
      }
    }
  }

  fixLocalesIn(frameworksPath);

  // Also check the main Resources directory
  const resourcesPath = path.join(
    appPath,
    "Lattice.app",
    "Contents",
    "Resources"
  );
  fixLocalesIn(resourcesPath);

  if (fixed > 0) {
    console.log(`  • fix-mas-locales: Removed ${fixed} broken locale entries`);
  } else {
    console.log("  • fix-mas-locales: No broken locales found");
  }
};
