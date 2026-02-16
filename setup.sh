#!/bin/bash
# Reassemble and extract node_modules from split archive chunks.
# Run this after cloning/downloading the repo on a new system.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -d "node_modules" ]; then
  echo "node_modules already exists. Remove it first if you want to re-extract."
  echo "Touching sentinel file..."
  touch node_modules/.installed
  exit 0
fi

if [ ! -d "node_modules_archive" ]; then
  echo "Error: node_modules_archive directory not found."
  exit 1
fi

echo "Reassembling archive from chunks..."
cat node_modules_archive/node_modules.tar.gz.part_* > node_modules.tar.gz

echo "Extracting node_modules (this may take a moment)..."
tar xzf node_modules.tar.gz

echo "Marking dependencies as installed..."
touch node_modules/.installed

echo "Cleaning up archive file..."
rm -f node_modules.tar.gz

echo "Done! node_modules is ready. Run 'make dev' to start."
