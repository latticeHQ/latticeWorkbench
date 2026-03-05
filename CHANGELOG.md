# Changelog

All notable changes to Lattice are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- macOS distribution: Developer ID signed + notarized via GitHub Releases
- Enhanced hardened runtime entitlements for autonomous agent capabilities

### Added
- GitHub Actions release workflow (macOS, Windows, Linux)
- Signing preflight checks in release script
- `.env.example` for signing/notarization credentials
- `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`

## [1.0.3] - 2026-03-04

### Fixed
- Bundle MCP servers for packaged Electron, fixing "Connection closed" error
- Eliminate terminal tab race conditions causing "missing session ID" error
- Correct asarUnpack globs for native modules and clean up imports
- MAS sandbox HOME and SHELL environment setup
- Terminal creation failures in MAS sandbox
- PATH enrichment for MAS sandbox environment
- Locale symlink handling in afterPack hook for Electron 38+

## [1.0.1] - 2026-03-03

### Added
- Local inference engine with auto-build from source
- Lattice Inference as first-class local LLM provider
- Local Inference model management UI in Settings
- Release script for building and publishing GitHub releases
- Animated SVG minion workbench with tool badges and thinking state

### Fixed
- TransformStream pattern for inference streaming ("text part not found" error)
- LatticeLanguageModel upgraded to V3 spec with auto-sync to provider config

### Changed
- Analytics moved from tab strip into Settings page

## [0.1.1] - 2026-02-22

### Fixed
- Stability improvements and bug fixes

## [0.1.0] - 2026-02-17

### Added
- Initial release of Lattice workbench
- Multi-platform Electron app (macOS, Windows, Linux)
- AI agent orchestration with multi-model support (Anthropic, OpenAI, Google, xAI, DeepSeek, Ollama, OpenRouter, Amazon Bedrock)
- Terminal integration with node-pty and Ghostty web renderer
- MCP (Model Context Protocol) server integration
- SSH remote runtime support
- DuckDB analytics engine
- Homebrew cask distribution
- Auto-updater via GitHub Releases
