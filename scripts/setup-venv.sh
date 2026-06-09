#!/usr/bin/env bash
# =============================================================================
# setup-venv.sh — One-time native setup for running FlowSight on macOS.
#
# IMPORTANT: the venv must live on an APFS disk (the internal drive), NOT on an
# exFAT/NTFS external drive. macOS writes AppleDouble `._*` sidecar files on
# exFAT, and those break pip/importlib package-metadata reading
# (UnicodeDecodeError). The project CODE can stay on the external drive; only
# the venv (interpreter + packages, ~1.1 GB) goes on the internal disk.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${FLOWSIGHT_VENV:-$HOME/.venvs/flowsight}"

echo ">> Creating venv at: $VENV  (internal/APFS disk)"
python3 -m venv "$VENV"

echo ">> Installing dependencies…"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$ROOT/requirements.txt"

echo ">> Done. Start FlowSight with:  scripts/run-native.sh"
