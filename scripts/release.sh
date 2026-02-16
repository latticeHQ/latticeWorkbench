#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# release.sh — Build and publish a GitHub release in a single command
# =============================================================================
#
# Usage:
#   ./scripts/release.sh [OPTIONS]
#
# Options:
#   --minor          Bump minor version (0.15.0 -> 0.16.0) instead of patch (0.15.0 -> 0.15.1)
#   --major          Bump major version (0.15.0 -> 1.0.0)
#   --version X.Y.Z  Set exact version instead of bumping
#   --mac-only       Build macOS only (default: all platforms)
#   --win-only       Build Windows only
#   --linux-only     Build Linux only
#   --no-sign        Skip ad-hoc signing (macOS)
#   --draft          Create release as draft
#   --dry-run        Build everything but don't create GitHub release
#   --skip-build     Skip build step (use existing dist/)
#   --help           Show this help message
#
# Prerequisites:
#   - gh CLI authenticated (gh auth status)
#   - Node.js 20+, bun, jq installed
#   - For cross-platform: electron-builder handles this from macOS
#
# Examples:
#   ./scripts/release.sh                    # Patch bump, build all, release
#   ./scripts/release.sh --minor            # Minor bump, build all, release
#   ./scripts/release.sh --version 1.0.0    # Set v1.0.0, build all, release
#   ./scripts/release.sh --mac-only --draft # Patch bump, macOS only, draft release

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Defaults ──────────────────────────────────────────────────────────────────
BUMP_TYPE="patch"
EXACT_VERSION=""
PLATFORMS="all"
SIGN_MAC=true
DRAFT=false
DRY_RUN=false
SKIP_BUILD=false

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --minor)    BUMP_TYPE="minor"; shift ;;
    --major)    BUMP_TYPE="major"; shift ;;
    --version)  EXACT_VERSION="$2"; shift 2 ;;
    --mac-only) PLATFORMS="mac"; shift ;;
    --win-only) PLATFORMS="win"; shift ;;
    --linux-only) PLATFORMS="linux"; shift ;;
    --no-sign)  SIGN_MAC=false; shift ;;
    --draft)    DRAFT=true; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --help|-h)
      sed -n '3,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
info()  { echo "==> $*"; }
warn()  { echo "⚠  $*" >&2; }
error() { echo "ERROR: $*" >&2; exit 1; }

check_command() {
  command -v "$1" >/dev/null 2>&1 || error "$1 is required but not found. Install it first."
}

# ── Preflight checks ─────────────────────────────────────────────────────────
info "Running preflight checks..."
check_command node
check_command jq
check_command gh

if [[ "$DRY_RUN" == "false" ]]; then
  gh auth status >/dev/null 2>&1 || error "gh CLI not authenticated. Run: gh auth login"
fi

CURRENT_VERSION=$(jq -r '.version' package.json)
if [[ -z "$CURRENT_VERSION" || "$CURRENT_VERSION" == "null" ]]; then
  error "Could not read version from package.json"
fi

# ── Calculate new version ─────────────────────────────────────────────────────
if [[ -n "$EXACT_VERSION" ]]; then
  NEW_VERSION="$EXACT_VERSION"
else
  IFS='.' read -r V_MAJOR V_MINOR V_PATCH <<<"$CURRENT_VERSION"
  case "$BUMP_TYPE" in
    major) NEW_VERSION="$((V_MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${V_MAJOR}.$((V_MINOR + 1)).0" ;;
    patch) NEW_VERSION="${V_MAJOR}.${V_MINOR}.$((V_PATCH + 1))" ;;
  esac
fi

info "Version: $CURRENT_VERSION -> $NEW_VERSION"

# ── Update package.json version ──────────────────────────────────────────────
jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp
mv package.json.tmp package.json
info "Updated package.json to v$NEW_VERSION"

# ── Build ─────────────────────────────────────────────────────────────────────
BUN_OR_NPX="$(command -v bun >/dev/null 2>&1 && echo 'bun x' || echo 'npx')"

if [[ "$SKIP_BUILD" == "false" ]]; then
  info "Building application..."
  make build
else
  info "Skipping build (--skip-build)"
fi

# ── Clean previous release artifacts ─────────────────────────────────────────
info "Cleaning previous release artifacts..."
rm -rf release/

# ── Build distributables per platform ─────────────────────────────────────────
build_mac() {
  info "Building macOS distributables (x64 + arm64)..."
  $BUN_OR_NPX electron-builder --mac --x64 --publish never
  $BUN_OR_NPX electron-builder --mac --arm64 --publish never
}

build_win() {
  info "Building Windows distributables (x64 + arm64)..."
  $BUN_OR_NPX electron-builder --win --x64 --publish never
  $BUN_OR_NPX electron-builder --win --arm64 --publish never
}

build_linux() {
  info "Building Linux distributables (x64 + arm64)..."
  $BUN_OR_NPX electron-builder --linux --x64 --publish never
  $BUN_OR_NPX electron-builder --linux --arm64 --publish never
}

case "$PLATFORMS" in
  all)   build_mac; build_win; build_linux ;;
  mac)   build_mac ;;
  win)   build_win ;;
  linux) build_linux ;;
esac

# ── Ad-hoc sign macOS apps (unsigned local builds) ───────────────────────────
if [[ "$SIGN_MAC" == "true" && ("$PLATFORMS" == "all" || "$PLATFORMS" == "mac") ]]; then
  # Only ad-hoc sign if no real certificate was used
  if [[ -z "${CSC_LINK:-}" ]]; then
    info "Ad-hoc signing macOS apps (no Developer ID detected)..."

    for app_dir in release/mac-arm64 release/mac; do
      if [[ -d "$app_dir" ]]; then
        APP_PATH=$(find "$app_dir" -name "*.app" -maxdepth 1 | head -1)
        if [[ -n "$APP_PATH" ]]; then
          info "  Signing $APP_PATH..."
          codesign --force --deep --sign - "$APP_PATH"
        fi
      fi
    done

    # Rebuild DMGs with signed apps
    APP_NAME="Lattice"
    for arch in arm64 x64; do
      if [[ "$arch" == "arm64" ]]; then
        APP_DIR="release/mac-arm64"
      else
        APP_DIR="release/mac"
      fi

      DMG_PATH="release/${APP_NAME}-${NEW_VERSION}-${arch}.dmg"
      ZIP_PATH="release/${APP_NAME}-${NEW_VERSION}-${arch}.zip"
      APP_PATH="${APP_DIR}/${APP_NAME}.app"

      if [[ -d "$APP_PATH" ]]; then
        # Rebuild DMG
        if [[ -f "$DMG_PATH" ]]; then
          info "  Rebuilding $DMG_PATH with signed app..."
          rm -f "$DMG_PATH"
          hdiutil create -volname "$APP_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"
        fi

        # Rebuild zip
        if [[ -f "$ZIP_PATH" ]]; then
          info "  Rebuilding $ZIP_PATH with signed app..."
          rm -f "$ZIP_PATH"
          (cd "$APP_DIR" && zip -r -y "../../$ZIP_PATH" "${APP_NAME}.app")
        fi
      fi
    done

    info "Ad-hoc signing complete"
  else
    info "Developer ID certificate detected — skipping ad-hoc signing"
  fi
fi

# ── Collect release assets ────────────────────────────────────────────────────
info "Collecting release assets..."
ASSETS=()

for f in release/*.{dmg,zip,exe,AppImage,blockmap,yml}; do
  if [[ -f "$f" ]]; then
    ASSETS+=("$f")
  fi
done

if [[ ${#ASSETS[@]} -eq 0 ]]; then
  error "No release assets found in release/"
fi

info "Found ${#ASSETS[@]} assets:"
for a in "${ASSETS[@]}"; do
  SIZE=$(du -h "$a" | cut -f1)
  echo "    $SIZE  $(basename "$a")"
done

# ── Create GitHub release ─────────────────────────────────────────────────────
TAG="v${NEW_VERSION}"
REPO=$(jq -r '.build.publish.owner + "/" + .build.publish.repo' package.json)

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY RUN] Would create release $TAG on $REPO with ${#ASSETS[@]} assets"
  info "Done (dry run). Version in package.json is now $NEW_VERSION."
  exit 0
fi

info "Creating GitHub release $TAG on $REPO..."

DRAFT_FLAG=""
if [[ "$DRAFT" == "true" ]]; then
  DRAFT_FLAG="--draft"
fi

RELEASE_NOTES="## Lattice v${NEW_VERSION}

### Downloads

| Platform | Architecture | File |
|----------|-------------|------|"

# Build download table
for a in "${ASSETS[@]}"; do
  BASENAME=$(basename "$a")
  EXT="${BASENAME##*.}"
  case "$EXT" in
    dmg)      PLATFORM="macOS"; ;;
    zip)      PLATFORM="macOS"; ;;
    exe)      PLATFORM="Windows"; ;;
    AppImage) PLATFORM="Linux"; ;;
    *)        continue ;;  # skip blockmaps, yml
  esac

  if [[ "$BASENAME" == *"arm64"* ]]; then
    ARCH="Apple Silicon / ARM64"
  elif [[ "$BASENAME" == *"x64"* || "$BASENAME" == *"x86_64"* ]]; then
    ARCH="Intel x64"
  else
    ARCH="Universal"
  fi

  RELEASE_NOTES+="
| ${PLATFORM} | ${ARCH} | \`${BASENAME}\` |"
done

RELEASE_NOTES+="

### Notes
- **macOS**: If you see \"damaged\" warning, run: \`xattr -cr ~/Downloads/${APP_NAME}-${NEW_VERSION}-arm64.dmg\`
- **Windows**: Windows Defender SmartScreen may warn on first run (unsigned build). Click \"More info\" → \"Run anyway\".
- **Linux**: Make the AppImage executable: \`chmod +x ${APP_NAME}-${NEW_VERSION}-*.AppImage\`
"

gh release create "$TAG" \
  --repo "$REPO" \
  --title "Lattice v${NEW_VERSION}" \
  --notes "$(cat <<EOF
$RELEASE_NOTES
EOF
)" \
  $DRAFT_FLAG \
  "${ASSETS[@]}"

RELEASE_URL="https://github.com/${REPO}/releases/tag/${TAG}"
info "Release created: $RELEASE_URL"
info "Done! Lattice v${NEW_VERSION} released."
