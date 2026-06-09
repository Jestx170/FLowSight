#!/usr/bin/env bash
# =============================================================================
# run-native.sh — Run FlowSight natively on macOS (no Docker).
#
# Uses the venv on the internal disk (see setup-venv.sh) and serves on port
# 5001 by default, because macOS AirPlay Receiver occupies port 5000.
# Override with:  FLOWSIGHT_PORT=8080 scripts/run-native.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"   # `src` package + templates/static/config/data live here

VENV="${FLOWSIGHT_VENV:-$HOME/.venvs/flowsight}"
PORT="${FLOWSIGHT_PORT:-5001}"

if [ ! -x "$VENV/bin/python" ]; then
    echo "ERROR: venv not found at $VENV"
    echo "Run the one-time setup first:  scripts/setup-venv.sh"
    exit 1
fi

echo ">> FlowSight → http://localhost:$PORT   (Ctrl+C to stop)"
exec env FLOWSIGHT_PORT="$PORT" "$VENV/bin/python" -m src.api.server
