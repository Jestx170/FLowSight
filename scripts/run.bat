@echo off
title FlowSight
REM Run from PROJECT_ROOT so the `src` package is importable
cd /d "%~dp0.."

REM Desktop entry point (opens app window via Chrome/Edge)
python -m src.api.app
if %ERRORLEVEL% NEQ 0 (
    REM fallback: plain Flask server (open http://localhost:5000 manually)
    python -m src.api.server
)
