@echo off
title FlowSight — Retail Intelligence
REM Run from PROJECT_ROOT so the `src` package is importable
cd /d "%~dp0.."

REM ── Always use bundled Python — never fall back to system Python ──────────────
REM Bundled interpreter ships at the app root (one level above scripts\)
set PYTHON=%~dp0..\python\python.exe

if not exist "%PYTHON%" (
    echo ERROR: Bundled Python not found.
    echo Please re-run the FlowSight installer.
    pause
    exit /b 1
)

REM ── Set environment ───────────────────────────────────────────────────────────
set PATH=%~dp0..\python;%~dp0..\python\Scripts;%PATH%
set PYTHONPATH=%~dp0..\python\Lib\site-packages
set KMP_DUPLICATE_LIB_OK=TRUE
set OPENCV_LOG_LEVEL=SILENT
set OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp

REM ── Launch app ────────────────────────────────────────────────────────────────
"%PYTHON%" -m src.api.app
