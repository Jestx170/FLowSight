# =============================================================================
# app.py — FlowSight Desktop/Windows entry point.
#
# This is a LAUNCHER, not the web app. It boots the Flask server (server.py) and
# opens the browser — used by scripts/run.bat & FlowSight.bat on Windows.
# The actual web app + all endpoints live in server.py. To run the server
# directly (native/Docker) use:  python -m src.api.server
# =============================================================================
import sys, os, threading, time, subprocess, webbrowser
from pathlib import Path

# Bootstrap: ensure PROJECT_ROOT importable (supports -m and direct run)
_ROOT = Path(__file__).resolve().parents[2]   # src/api/app.py → PROJECT_ROOT
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.paths import BRAND_CONFIG

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

# Configurable port — default 5000 (Windows/Docker); override on macOS to avoid
# the AirPlay Receiver which occupies :5000.
PORT = int(os.environ.get("FLOWSIGHT_PORT", os.environ.get("PORT", "5000")))

def start_flask():
    from src.api.server import app
    import logging
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    app.run(host="127.0.0.1", port=PORT,
            debug=False, threaded=True, use_reloader=False)

def wait_for_server(timeout=20) -> bool:
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}", timeout=1)
            return True
        except Exception:
            time.sleep(0.15)
    return False

def get_brand():
    try:
        import json
        with open(BRAND_CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"name": "FlowSight"}

def open_browser(url: str):
    browsers = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for browser in browsers:
        if os.path.exists(browser):
            subprocess.Popen([browser, f"--app={url}",
                              "--window-size=1360,820",
                              "--disable-extensions", "--no-first-run"])
            return True
    webbrowser.open(url)
    return False

def main():
    brand    = get_brand()
    app_name = brand.get("name", "FlowSight")

    t = threading.Thread(target=start_flask, daemon=True)
    t.start()

    print(f"Starting {app_name}...")
    if not wait_for_server():
        print("ERROR: Server failed to start")
        sys.exit(1)
    print(f"{app_name} ready")

    url = f"http://127.0.0.1:{PORT}"
    open_browser(url)

    print(f"\n{app_name} running at {url}")
    print("Press Ctrl+C to stop\n")
    try:
        t.join()
    except KeyboardInterrupt:
        print(f"\n{app_name} stopped")

if __name__ == "__main__":
    main()
