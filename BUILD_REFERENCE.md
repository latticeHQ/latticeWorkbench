# Lattice Workbench — Build & Release Reference

## 🔨 Build Commands

| Command | Description |
|---|---|
| `make build` | Build everything (renderer + main + preload + icons + static) |
| `make build-main` | Build main/node process (`dist/cli/index.js`, `dist/cli/api.mjs`) |
| `make build-renderer` | Build frontend with Vite |
| `make build-preload` | Build Electron preload script |
| `make build-icons` | Generate app icons (PNG + ICNS) from logo |
| `make build-inferred` | Build Go inference binary for current platform |
| `make build-static` | Copy static assets (splash, public, Python worker) |
| `make rebuild-native` | Rebuild native modules (node-pty) for Electron |
| `make version` | Generate `src/version.ts` from git info |

## 🖥️ Development

| Command | Description |
|---|---|
| `make dev` | Start Electron dev mode (Vite + tsgo watcher) |
| `make dev-server` | Server mode — backend `:3000` + frontend `:5173` with HMR |
| `make dev-desktop-sandbox` | Isolated Electron dev instance |
| `make dev-server-sandbox` | Isolated server dev instance |
| `make start` | Full build then launch Electron |

## 📦 Distribution (Local Builds)

| Command | Description |
|---|---|
| `make dist` | Build distributable (`electron-builder --publish never`) |
| `make dist-mac` | macOS x64 + arm64 |
| `make dist-mac-x64` | macOS x64 only |
| `make dist-mac-arm64` | macOS arm64 only |
| `make dist-win` | Windows NSIS installer |
| `make dist-linux` | Linux AppImage |
| `make install-mac-arm64` | Build arm64 + install to `/Applications` |

## 🚀 Release (CI/Publish)

| Command / Trigger | Description |
|---|---|
| `make dist-mac-release` | Build + publish macOS (`--publish always` to GitHub Releases) |
| GitHub Actions `release.yml` | Full release: macOS + Linux + Windows + VS Code ext + notifications |
| GitHub Actions `publish-npm.yml` | Publish to npm (push to `main` → `@next`, push tag `v*` → `@latest`) |
| `./scripts/bump_tag.sh` | Create a new git release tag |
| `./scripts/smoke-test.sh` | Smoke test the npm package (binary, API, server, oRPC) |

## 🔄 Auto-Update

| Config | Details |
|---|---|
| Package | `electron-updater@^6.6.2` |
| Service | `src/desktop/updater.ts` → `UpdaterService` |
| Auto-download | `false` (waits for user confirmation) |
| Install on quit | `true` |
| Provider | GitHub Releases |
| Debug mode | `DEBUG_UPDATER=true` or `DEBUG_UPDATER=fakeVersion:X.Y.Z` |
| States | `idle → checking → available → downloading → downloaded` |

## 🔐 Signing

| Platform | Method |
|---|---|
| macOS | Hardened runtime + Apple notarization (`setup-macos-signing.sh`) |
| Windows | EV code signing via jsign + GCP Cloud KMS (`sign-windows.js`) |
| npm | OIDC Trusted Publishing (no secrets needed) |

## 🧪 Testing

| Command | Description |
|---|---|
| `make test` | Run tests |
| `make test-watch` | Tests in watch mode |
| `make test-coverage` | Tests with coverage report |
| `make test-integration` | Integration tests |
| `make test-e2e` | End-to-end tests |
| `make smoke-test` | Smoke test npm package |

## ⚡ Quick Reference — Typical Workflows

| Task | Commands |
|---|---|
| **Dev (browser)** | `make dev-server` → open `localhost:5173` |
| **Dev (desktop)** | `make dev` |
| **Local macOS build** | `make build && make dist-mac-arm64` |
| **Install locally** | `make install-mac-arm64` |
| **Release** | Push tag `v*` → GitHub Actions handles everything |
| **npm publish** | Push to `main` → auto-publishes `@next`, push tag → publishes `@latest` |

## 🔑 Key Environment Variables

### CI/Release
| Variable | Purpose |
|---|---|
| `RELEASE_TAG` | Tag to release (set in release workflow) |
| `GH_TOKEN` | GitHub token for publishing releases |

### macOS Signing
| Variable | Purpose |
|---|---|
| `CSC_LINK` | Path to code signing certificate |
| `CSC_KEY_PASSWORD` | Certificate password |
| `APPLE_API_KEY` | Apple API key file path |
| `APPLE_API_KEY_ID` | Apple API Key ID |
| `APPLE_API_ISSUER` | Apple API Issuer ID |

### Windows Signing
| Variable | Purpose |
|---|---|
| `JSIGN_PATH` | Path to jsign JAR |
| `EV_KEYSTORE` | GCP Cloud KMS keystore URL |
| `EV_KEY` | Key alias |
| `EV_CERTIFICATE_PATH` | EV certificate path |
| `EV_TSA_URL` | Timestamp server URL |
| `GCLOUD_ACCESS_TOKEN` | GCP access token |

### Update/Debug
| Variable | Purpose |
|---|---|
| `DEBUG_UPDATER` | Enable dev update config (`true` or `fakeVersion:X.Y.Z`) |
| `NODE_ENV` | `development` / `production` |
