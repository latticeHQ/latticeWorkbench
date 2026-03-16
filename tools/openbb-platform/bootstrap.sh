#!/usr/bin/env bash
# Bootstrap the OpenBB platform virtual environment.
# Creates .venv, installs dependencies, and registers all vendored packages.
# Idempotent — safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
SENTINEL="$SCRIPT_DIR/.bootstrap-complete"
MIN_PYTHON="3.10"

# --- Find Python >= 3.10 ---
find_python() {
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
      local ver
      ver="$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")"
      if python3 -c "
import sys
cur = tuple(int(x) for x in '$ver'.split('.'))
req = tuple(int(x) for x in '$MIN_PYTHON'.split('.'))
sys.exit(0 if cur >= req else 1)
" 2>/dev/null; then
        echo "$candidate"
        return
      fi
    fi
  done
  return 1
}

PYTHON="$(find_python)" || {
  echo "ERROR: Python >= $MIN_PYTHON is required but not found."
  echo "Install it with: brew install python@3.12  (macOS)"
  exit 1
}

echo "Using Python: $PYTHON ($($PYTHON --version))"

# --- Create venv if missing ---
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating virtual environment..."
  "$PYTHON" -m venv "$VENV_DIR"
fi

# Activate
source "$VENV_DIR/bin/activate"

# Upgrade pip
pip install --upgrade pip --quiet

# --- Install dependencies ---
if [ -d "$SCRIPT_DIR/wheelhouse" ]; then
  echo "Installing from wheelhouse (air-gap mode)..."
  pip install --no-index --find-links="$SCRIPT_DIR/wheelhouse" -r "$SCRIPT_DIR/requirements.txt" --quiet
else
  echo "Installing dependencies from PyPI..."
  pip install -r "$SCRIPT_DIR/requirements.txt" --quiet
fi

# --- Install vendored packages in editable mode ---
echo "Installing OpenBB core..."
pip install -e "$SCRIPT_DIR/core/" --quiet --no-deps

echo "Installing extensions..."
for ext_dir in "$SCRIPT_DIR"/extensions/*/; do
  ext="$(basename "$ext_dir")"
  if [ -f "$ext_dir/pyproject.toml" ]; then
    pip install -e "$ext_dir" --quiet --no-deps
    echo "  ✓ $ext"
  fi
done

echo "Installing providers..."
for prov_dir in "$SCRIPT_DIR"/providers/*/; do
  prov="$(basename "$prov_dir")"
  if [ -f "$prov_dir/pyproject.toml" ]; then
    pip install -e "$prov_dir" --quiet --no-deps
    echo "  ✓ $prov"
  fi
done

# --- Run OpenBB code generation ---
echo "Running OpenBB package builder..."
export OPENBB_AUTO_BUILD=true
"$VENV_DIR/bin/python" -c "from openbb_core.build import main; main()" 2>/dev/null || {
  echo "Warning: OpenBB build step had issues (may still work)"
}

# --- Write sentinel ---
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$SENTINEL"
echo ""
echo "✓ OpenBB platform bootstrapped successfully."
echo "  venv: $VENV_DIR"
echo "  To start the API: $VENV_DIR/bin/python $SCRIPT_DIR/launch_server.py"
