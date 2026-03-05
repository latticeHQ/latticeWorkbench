#!/usr/bin/env bash
# Sets up macOS code signing and notarization credentials.
# Works in both CI (writes to $GITHUB_ENV) and local (exports to shell).
#
# Usage: source ./scripts/setup-macos-signing.sh   # local
#        ./scripts/setup-macos-signing.sh           # CI (GITHUB_ENV)
#
# Required environment variables:
#   MACOS_CERTIFICATE          - Base64-encoded .p12 certificate
#   MACOS_CERTIFICATE_PWD      - Certificate password
#   AC_APIKEY_P8_BASE64        - Base64-encoded Apple API key (.p8)
#   AC_APIKEY_ID               - Apple API Key ID
#   AC_APIKEY_ISSUER_ID        - Apple API Issuer ID

set -euo pipefail

# Helper: set env var for both CI (GITHUB_ENV) and local (export)
set_env() {
  local key="$1" val="$2"
  export "$key=$val"
  if [ -n "${GITHUB_ENV:-}" ]; then
    echo "$key=$val" >> "$GITHUB_ENV"
  fi
}

# Setup code signing certificate
if [ -n "${MACOS_CERTIFICATE:-}" ]; then
  echo "Setting up code signing certificate..."
  echo "$MACOS_CERTIFICATE" | base64 -D >/tmp/certificate.p12
  set_env "CSC_LINK" "/tmp/certificate.p12"
  set_env "CSC_KEY_PASSWORD" "$MACOS_CERTIFICATE_PWD"
else
  echo "No code signing certificate provided — electron-builder will auto-detect from Keychain"
fi

# Setup notarization credentials
if [ -n "${AC_APIKEY_ID:-}" ]; then
  echo "Setting up notarization credentials..."
  echo "$AC_APIKEY_P8_BASE64" | base64 -D >/tmp/AuthKey.p8
  set_env "APPLE_API_KEY" "/tmp/AuthKey.p8"
  set_env "APPLE_API_KEY_ID" "$AC_APIKEY_ID"
  set_env "APPLE_API_ISSUER" "$AC_APIKEY_ISSUER_ID"
  echo "Notarization credentials configured"
else
  echo "No notarization credentials — build will not be notarized"
fi
