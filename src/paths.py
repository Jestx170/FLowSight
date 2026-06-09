# =============================================================================
# src/paths.py — Central path resolution for FlowSight
#
# Anchors every file path to PROJECT_ROOT so the app works regardless of the
# current working directory or where modules are imported from.
#
# Layout:
#   <PROJECT_ROOT>/
#     data/      ← yolov8n.pt (shipped, read-only) + behavior_log.db (writable)
#     config/    ← bytetrack.yaml + *.example.json (shipped) + *_config.json (writable)
#     templates/ ← index.html
#     static/    ← css, js, assets
#
# Writable data (DB + the three *_config.json) is redirected to
# %PROGRAMDATA%\FlowSight when the app is installed under Program Files (Windows,
# read-only for standard users) or running as a PyInstaller bundle.  The shipped
# model and tracker config are always read from PROJECT_ROOT.
# =============================================================================
import os
import sys
import shutil
import logging
from pathlib import Path

log = logging.getLogger("flowsight.paths")

# PROJECT_ROOT = .../flowsight   (this file is .../flowsight/src/paths.py)
PROJECT_ROOT = Path(__file__).resolve().parents[1]

# ── Shipped (read-only) locations ─────────────────────────────────────────────
SHIPPED_DATA_DIR   = PROJECT_ROOT / "data"
SHIPPED_CONFIG_DIR = PROJECT_ROOT / "config"
TEMPLATES_DIR      = str(PROJECT_ROOT / "templates")
STATIC_DIR         = str(PROJECT_ROOT / "static")

MODEL_PATH = str(SHIPPED_DATA_DIR / "yolov8n.pt")        # ships with app
BYTETRACK  = str(SHIPPED_CONFIG_DIR / "bytetrack.yaml")  # ships with app


# ── Writable location (ProgramData when installed read-only) ──────────────────
def _in_program_files(p: Path) -> bool:
    pf  = os.environ.get("PROGRAMFILES", "C:\\Program Files")
    pfx = os.environ.get("PROGRAMFILES(X86)", "C:\\Program Files (x86)")
    s = str(p).lower()
    return s.startswith(pf.lower()) or s.startswith(pfx.lower())


if getattr(sys, "frozen", False) or _in_program_files(PROJECT_ROOT):
    _base      = Path(os.environ.get("PROGRAMDATA", "C:\\ProgramData")) / "FlowSight"
    DATA_DIR   = _base / "data"
    CONFIG_DIR = _base / "config"
else:
    DATA_DIR   = SHIPPED_DATA_DIR
    CONFIG_DIR = SHIPPED_CONFIG_DIR

DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH      = str(DATA_DIR / "behavior_log.db")
ZONES_CONFIG = str(CONFIG_DIR / "zones_config.json")
BEHS_CONFIG  = str(CONFIG_DIR / "behaviors_config.json")
BRAND_CONFIG = str(CONFIG_DIR / "brand_config.json")

LOG_FILE = str(DATA_DIR / "flowsight.log")


def seed_configs() -> None:
    """Copy <name>.example.json → <name>.json into CONFIG_DIR when missing.

    Lets a fresh install (or a read-only ProgramData target) start with working
    defaults that the user can then edit/save via the UI.
    """
    for name in ("zones_config", "behaviors_config", "brand_config"):
        dst = CONFIG_DIR / f"{name}.json"
        src = SHIPPED_CONFIG_DIR / f"{name}.example.json"
        if not dst.exists() and src.exists():
            try:
                shutil.copy2(src, dst)
                log.info("Seeded %s from %s", dst, src.name)
            except Exception as e:
                log.warning("Could not seed %s: %s", dst, e)
