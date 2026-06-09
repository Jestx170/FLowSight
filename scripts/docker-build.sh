#!/usr/bin/env bash
# =============================================================================
# docker-build.sh — Build the FlowSight image from a clean tar context.
#
# Use this instead of `docker compose build` when the project lives on a
# non-APFS volume (external USB/exFAT/NTFS drive). macOS writes AppleDouble
# `._*` sidecar files there, and Docker's build-context reader fails with
# "failed to xattr ._… : operation not permitted". Piping a tar context with
# COPYFILE_DISABLE=1 and excluding `._*` avoids the problem.
#
# On a normal internal (APFS) drive you can just use:  docker compose up --build
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ">> Cleaning macOS AppleDouble files…"
find . -name '._*' -delete 2>/dev/null || true

echo ">> Building flowsight:latest from tar context…"
COPYFILE_DISABLE=1 tar \
  --exclude='._*' \
  --exclude='./.git' \
  --exclude='./scripts/installer' \
  --exclude='./scripts/installer_output' \
  --exclude='./backend/data' \
  --exclude='./backend/config/zones_config.json' \
  --exclude='./backend/config/behaviors_config.json' \
  --exclude='./backend/config/brand_config.json' \
  --exclude='*.md' \
  -cf - . | docker build -t flowsight:latest -

echo ">> Done. Start it with:  docker compose up   (uses the prebuilt image)"
