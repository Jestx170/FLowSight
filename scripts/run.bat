@echo off
title FlowSight
REM Run from backend/ so the `src` package + templates/static/config/data resolve
cd /d "%~dp0..\backend"

REM Desktop entry point (opens app window via Chrome/Edge)
python -m src.api.app
if %ERRORLEVEL% NEQ 0 (
    REM fallback: plain Flask server (open http://localhost:5000 manually)
    python -m src.api.server
)
