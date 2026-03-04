/**
 * electron-builder afterPack hook to fix locale symlinks in Electron Framework.
 *
 * Electron 38+ ships locale variant directories (_MASCULINE, _NEUTER, _FEMININE)
 * as symlinks. macOS codesign cannot handle these during MAS signing, failing with
 * "No such file or directory" errors.
 *
 * This script removes ALL symlinked lproj entries and any lproj dirs where
 * locale.pak is missing or broken.
 */
const fs = require("fs");
const path = require("path");

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

  let fixed = 0;

  function fixLocalesIn(dir) {
    if (!fs.existsSync(dir)) return;

    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }

    // Locale variant suffixes that Electron 38+ ships as symlinks or stubs.
    // codesign cannot handle these — remove unconditionally.
    const VARIANT_SUFFIXES = ["_FEMININE", "_MASCULINE", "_NEUTER"];

    for (const name of names) {
      const fullPath = path.join(dir, name);

      let lstat;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (name.endsWith(".lproj")) {
        // Remove ANY symlinked lproj — codesign can't handle them
        if (lstat.isSymbolicLink()) {
          fs.rmSync(fullPath, { force: true });
          fixed++;
          continue;
        }

        // Remove variant locale directories unconditionally — they contain
        // symlinked locale.pak files that codesign fails to sign.
        const baseName = name.replace(".lproj", "");
        if (VARIANT_SUFFIXES.some((s) => baseName.endsWith(s))) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          fixed++;
          continue;
        }

        // For real directories, check locale.pak exists and is a real file
        if (lstat.isDirectory()) {
          const pakPath = path.join(fullPath, "locale.pak");
          let pakOk = false;
          try {
            const pakLstat = fs.lstatSync(pakPath);
            // Reject symlinked locale.pak — codesign can't sign through symlinks
            pakOk = !pakLstat.isSymbolicLink();
          } catch {
            pakOk = false;
          }

          if (!pakOk) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            fixed++;
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

  if (fixed > 0) {
    console.log(
      `  • fix-mas-locales: Removed ${fixed} symlinked/broken locale entries`
    );
  } else {
    console.log("  • fix-mas-locales: No broken locales found");
  }
};
