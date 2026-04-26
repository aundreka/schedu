#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$ROOT_DIR/generated/.benchmark-tmp"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

cd "$ROOT_DIR"

./node_modules/.bin/tsc \
  --pretty false \
  --module commonjs \
  --target es2020 \
  --lib es2020 \
  --skipLibCheck \
  --esModuleInterop \
  --outDir "$TMP_DIR" \
  scripts/scheduler-benchmark.ts \
  algorithm/buildBlocks.ts \
  algorithm/buildPacingPlan.ts \
  algorithm/buildSlots.ts \
  algorithm/placeBlocks.ts \
  algorithm/types.ts \
  algorithm/validatePlan.ts

node "$TMP_DIR/scripts/scheduler-benchmark.js"
