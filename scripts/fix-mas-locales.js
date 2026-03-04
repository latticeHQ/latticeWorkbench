/**
 * electron-builder afterPack hook to fix locale symlinks in Electron Framework.
 *
 * Electron 38+ ships locale variant directories (_MASCULINE, _NEUTER, _FEMININE)
 * as symlinks. macOS codesign cannot handle symlinks during MAS signing, failing
 * with "No such file or directory" errors.
 *
 * This script replaces symlinked .lproj directories with real copies of their
 * targets so codesign can sign them. Directories with missing/broken locale.pak
 * are removed entirely. Variant locale directories (_FEMININE, _MASCULINE,
 * _NEUTER) are removed unconditionally as they are always problematic.
 */
const fs = require("fs");
const path = require("path");

// Locale variant suffixes that Electron 38+ ships as symlinks or stubs.
// These are always problematic for codesign — remove unconditionally.
const VARIANT_SUFFIXES = ["_FEMININE", "_MASCULINE", "_NEUTER"];

/**
 * Recursively copy a directory from src to dest.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = async function (context) {
  if (context.electronPlatformName !== "mas") return;

  const appPath = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;
  const frameworksPath = path.join(
    appPath,
    `${appName}.app`,
    "Contents",
    "Frameworks"
  );

  if (!fs.existsSync(frameworksPath)) {
    console.log("  • fix-mas-locales: Frameworks path not found, skipping");
    return;
  }

  let replaced = 0;
  let removed = 0;

  function fixLocalesIn(dir) {
    if (!fs.existsSync(dir)) return;

    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const name of names) {
      const fullPath = path.join(dir, name);

      let lstat;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (name.endsWith(".lproj")) {
        // Remove variant locale directories unconditionally — they contain
        // symlinked locale.pak files that codesign fails to sign.
        const baseName = name.replace(".lproj", "");
        if (VARIANT_SUFFIXES.some((s) => baseName.endsWith(s))) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          removed++;
          continue;
        }

        if (lstat.isSymbolicLink()) {
          // Resolve symlink target and replace with real copy
          let targetPath;
          try {
            targetPath = fs.realpathSync(fullPath);
          } catch {
            // Broken symlink — remove it
            fs.rmSync(fullPath, { force: true });
            removed++;
            continue;
          }

          // Check if target is a valid directory with locale.pak
          let targetIsDir = false;
          let hasPak = false;
          try {
            targetIsDir = fs.statSync(targetPath).isDirectory();
          } catch {
            fs.rmSync(fullPath, { force: true });
            removed++;
            continue;
          }

          if (targetIsDir) {
            try {
              fs.statSync(path.join(targetPath, "locale.pak"));
              hasPak = true;
            } catch {
              hasPak = false;
            }
          }

          // Remove symlink, replace with real copy if valid
          fs.rmSync(fullPath, { force: true });
          if (targetIsDir && hasPak) {
            copyDirSync(targetPath, fullPath);
            replaced++;
          } else {
            removed++;
          }
          continue;
        }

        // For real directories, check locale.pak exists and is a real file
        if (lstat.isDirectory()) {
          const pakPath = path.join(fullPath, "locale.pak");
          let pakOk = false;
          try {
            const pakLstat = fs.lstatSync(pakPath);
            if (pakLstat.isSymbolicLink()) {
              // locale.pak itself is a symlink — replace with real copy
              let realPak;
              try {
                realPak = fs.realpathSync(pakPath);
                fs.rmSync(pakPath, { force: true });
                fs.copyFileSync(realPak, pakPath);
                replaced++;
                pakOk = true;
              } catch {
                // Broken symlink — remove the directory
                fs.rmSync(fullPath, { recursive: true, force: true });
                removed++;
                continue;
              }
            } else {
              pakOk = true;
            }
          } catch {
            pakOk = false;
          }

          if (!pakOk) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            removed++;
            continue;
          }
        }
      } else if (lstat.isDirectory()) {
        fixLocalesIn(fullPath);
      } else if (lstat.isSymbolicLink()) {
        // Follow valid symlinked directories for recursive traversal
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            fixLocalesIn(fullPath);
          }
        } catch {
          // Broken symlink to non-lproj, ignore
        }
      }
    }
  }

  fixLocalesIn(frameworksPath);

  // Also check the main Resources directory
  const resourcesPath = path.join(
    appPath,
    `${appName}.app`,
    "Contents",
    "Resources"
  );
  fixLocalesIn(resourcesPath);

  const parts = [];
  if (replaced > 0) parts.push(`replaced ${replaced} symlinks with copies`);
  if (removed > 0) parts.push(`removed ${removed} broken/variant entries`);

  if (parts.length > 0) {
    console.log(`  • fix-mas-locales: ${parts.join(", ")}`);
  } else {
    console.log("  • fix-mas-locales: No locale symlinks found");
  }
};
