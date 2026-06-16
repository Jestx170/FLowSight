# =============================================================================
# server.py — FlowSight Generic Retail AI  v1.1 (reviewed & fixed)
# =============================================================================
import sys, os, time, json, queue, threading, base64, sqlite3, logging, contextlib
from pathlib import Path

# ── Bootstrap: ensure PROJECT_ROOT is importable (supports -m and direct run) ─
from pathlib import Path as _Path
_ROOT = _Path(__file__).resolve().parents[2]   # src/api/server.py → PROJECT_ROOT
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# ── Path resolution (anchored to PROJECT_ROOT, CWD-independent) ────────────────
from src import paths
from src.paths import (
    DATA_DIR, CONFIG_DIR, DB_PATH, MODEL_PATH, BYTETRACK,
    ZONES_CONFIG, BEHS_CONFIG, BRAND_CONFIG, TEMPLATES_DIR, STATIC_DIR,
    REPORTS_DIR,
)
from src.utils.metrics_sql import VISITOR_KEY, INTERESTED_IN, PURCHASING_IN

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OPENCV_LOG_LEVEL", "SILENT")
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2, numpy as np
from flask import Flask, Response, jsonify, request

# ── Logging ───────────────────────────────────────────────────────────────────
log_handlers = [logging.StreamHandler()]
if getattr(sys, "frozen", False):
    log_handlers.append(logging.FileHandler(paths.LOG_FILE, encoding="utf-8"))
else:
    # Fix Windows terminal encoding
    if hasattr(sys.stdout, "reconfigure"):
        try: sys.stdout.reconfigure(encoding="utf-8")
        except Exception: pass

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=log_handlers)
log = logging.getLogger("flowsight")

# ── Config ────────────────────────────────────────────────────────────────────
CLOUD_MODE = os.environ.get("CLOUD_MODE", "0") == "1"

# Seed writable configs (CONFIG_DIR) from shipped *.example.json on first run so
# a standard (non-admin) user can save zone, behavior, and brand changes.
paths.seed_configs()

# Point the behavior engine's module-level config path at the writable copy so
# load_behaviors()/save_behaviors() (which read the module global) use CONFIG_DIR.
try:
    import src.engine.behavior_engine as _be
    _be.BEHAVIORS_CONFIG = BEHS_CONFIG
except Exception as _e:
    log.warning("Could not set behavior_engine config path: %s", _e)

TMPL_PATH      = os.path.join(TEMPLATES_DIR, "index.html")
VUE_TMPL_PATH  = os.path.join(TEMPLATES_DIR, "index_vue.html")  # Vue SPA, served at /v2 during migration
TZ         = int(os.environ.get("TZ_OFFSET", "7"))
MAX_ALERTS = 200

# ── Brand ─────────────────────────────────────────────────────────────────────
def load_brand() -> dict:
    try:
        with open(BRAND_CONFIG, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"name": "FlowSight", "tagline": "Retail Intelligence Platform",
                "color": "#6366f1"}

# ── Shared state (thread-safe reads, writes inside lock where needed) ─────────
_state_lock = threading.Lock()
state = {
    "running": False,
    "rtsp_url": "",
    "conf": 0.40,
    "anonymize": True,
    "dwell_interested": 25,
    "dwell_loitering": 90,
    "dwell_checkout_min": 5,
    "dwell_seating_waiting": 180,
    "gemini_api_key": "",
    "claude_api_key": "",
    # Multi-camera: list of camera configs
    "cameras": [
        {"id": "cam_0", "name": "Camera 1", "rtsp_url": "", "enabled": True}
    ],
}

frame_q    = queue.Queue(maxsize=3)
heat_frame: list = [None]
stop_evt   = threading.Event()
eng_thread = None  # kept for backward compat

# ── Multi-camera state ────────────────────────────────────────────────────────
_cam_frames:  dict = {}   # cam_id -> latest frame (numpy array)
_cam_threads: dict = {}   # cam_id -> threading.Thread
_cam_stops:   dict = {}   # cam_id -> threading.Event
_cam_status:  dict = {}   # cam_id -> {"running": bool, "msg": str}
_cam_huds:    dict = {}   # cam_id -> {"cust":int,"seller":int,"alert":int}
_cams_lock    = threading.Lock()

# CPU-only mode — GPU/CUDA intentionally disabled for stability across PCs
_DEVICE:   str   = "cpu"
_GPU_NAME: str   = ""
_GPU_VRAM: float = 0.0

def _detect_device() -> str:
    """Detect CUDA once and cache. Returns '0' (first GPU) or 'cpu'.

    Override with FLOWSIGHT_DEVICE=cpu|0|1… when needed (e.g. to benchmark
    CPU on a GPU machine). FP16 is enabled automatically on CUDA.
    """
    global _DEVICE, _GPU_NAME, _GPU_VRAM
    forced = os.environ.get("FLOWSIGHT_DEVICE", "").strip()
    if forced:
        _DEVICE = forced
        return _DEVICE
    try:
        import torch
        if torch.cuda.is_available():
            _DEVICE   = "0"
            _GPU_NAME = torch.cuda.get_device_name(0)
            _GPU_VRAM = torch.cuda.get_device_properties(0).total_memory / 1e9
            log.info("CUDA available: %s (%.1f GB) — GPU inference enabled",
                     _GPU_NAME, _GPU_VRAM)
            return _DEVICE
    except Exception as e:
        log.warning("CUDA probe failed (%s) — falling back to CPU", e)
    _DEVICE = "cpu"
    return _DEVICE

_detect_device()

# Each camera thread creates its own YOLO model instance (see camera_engine_loop).
# Sharing a single model with persist=True across threads corrupts ByteTrack
# internal state — this caused crashes on CPU where no inference lock existed.

hud_lock = threading.Lock()
hud      = {"running": False, "cust": 0, "seller": 0, "alert": 0}

alerts_lock = threading.Lock()
alerts      = []

app = Flask(__name__,
            template_folder=TEMPLATES_DIR,
            static_folder=STATIC_DIR,
            static_url_path="/static")

# ── DB helpers ────────────────────────────────────────────────────────────────
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    # synchronous=FULL: every committed transaction is fsync'd, so a power
    # loss or hard reset can never lose a row that was already committed
    # (WAL+NORMAL stays corruption-free but may roll back the last commits).
    conn.execute("PRAGMA synchronous=FULL")
    return conn

def ensure_db():
    conn = get_conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS events (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp     REAL    NOT NULL,
        cam_key       TEXT    NOT NULL DEFAULT 'cam_0',
        person_id     INTEGER NOT NULL,
        zone          TEXT    NOT NULL DEFAULT 'floor',
        zone_name     TEXT    NOT NULL DEFAULT '',
        behavior_id   TEXT    NOT NULL DEFAULT '',
        behavior_name TEXT    NOT NULL DEFAULT '',
        needs_staff   INTEGER NOT NULL DEFAULT 0,
        is_new_visit  INTEGER NOT NULL DEFAULT 1)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp)")
    # True concurrent-occupancy samples (one row per OCC_SAMPLE_SEC while
    # running). Peak/avg occupancy is computed from these instead of the
    # distinct-visitors-per-minute approximation, which overstated peak by
    # ~37% and average by ~49% under high visitor churn.
    conn.execute("""CREATE TABLE IF NOT EXISTS occupancy_snapshots (
        timestamp REAL    NOT NULL,
        total     INTEGER NOT NULL,
        zones     TEXT    NOT NULL DEFAULT '{}',
        cams      TEXT    NOT NULL DEFAULT '{}')""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_occ_ts ON occupancy_snapshots(timestamp)")
    migrations = [
        "ALTER TABLE events ADD COLUMN zone_name TEXT DEFAULT ''",
        "ALTER TABLE events ADD COLUMN behavior_id TEXT DEFAULT ''",
        "ALTER TABLE events ADD COLUMN behavior_name TEXT DEFAULT ''",
        "ALTER TABLE events ADD COLUMN is_new_visit INTEGER DEFAULT 1",
    ]
    for sql in migrations:
        try:
            conn.execute(sql)
        except sqlite3.OperationalError:
            pass  # column already exists
    try:
        conn.execute("""UPDATE events
            SET behavior_id=behavior, behavior_name=behavior
            WHERE behavior_id='' AND behavior IS NOT NULL""")
    except Exception:
        pass
    conn.commit()
    conn.close()

ensure_db()

# Load saved cameras from brand_config on startup
try:
    _saved = load_brand().get("cameras")
    if _saved and isinstance(_saved, list) and len(_saved) > 0:
        with _state_lock:
            state["cameras"] = _saved
            state["rtsp_url"] = _saved[0].get("rtsp_url", "")
        log.info("Loaded %d camera(s) from config", len(_saved))
except Exception as _e:
    log.warning("Could not load cameras from config: %s", _e)

def _today_str() -> str:
    import datetime
    return (datetime.datetime.utcnow() +
            datetime.timedelta(hours=TZ)).strftime("%Y-%m-%d")

def _dc() -> str:
    return f"date(datetime(timestamp,'unixepoch','+{TZ} hours'))"

def _day_range(date_str: str) -> tuple[float, float]:
    """UTC epoch range [t0, t1) covering local calendar date `date_str`.

    Used as `WHERE timestamp >= ? AND timestamp < ?` so queries hit the
    idx_ts index. The old `WHERE date(datetime(timestamp,...)) = ?` form
    computed a function per row, forcing a full-table scan — ~4 s per
    dashboard poll on one day of data and growing with table size.
    """
    import datetime
    d = datetime.datetime.strptime(date_str, "%Y-%m-%d").replace(
        tzinfo=datetime.timezone.utc)
    t0 = d.timestamp() - TZ * 3600
    return t0, t0 + 86400.0

# ── Stream ────────────────────────────────────────────────────────────────────
_last_frame: list = [None]   # mutable container avoids global keyword

@app.route("/api/jpeg")
def api_jpeg():
    try:
        frame = frame_q.get_nowait()
        _last_frame[0] = frame
    except queue.Empty:
        frame = _last_frame[0]
        if frame is None:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        return Response(b"", status=500)
    return Response(jpg.tobytes(), mimetype="image/jpeg",
                    headers={"Cache-Control": "no-cache, no-store",
                             "Pragma": "no-cache"})

def _mjpeg_generator(cam_id):
    """Generator that yields MJPEG frames for a given camera"""
    import time as _time
    boundary = b"--frame"
    while True:
        try:
            # Get frame for THIS camera only. Never fall back to _last_frame[0]
            # (the global last frame written by every camera) — doing so makes a
            # not-yet-ready camera display another camera's video.
            with _cams_lock:
                frame = _cam_frames.get(cam_id)
            if frame is None:
                # No frame of its own yet — show a "no signal" placeholder.
                frame = np.zeros((480, 640, 3), dtype=np.uint8)
                cv2.putText(frame, f"{cam_id}: connecting...", (20, 240),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2)

            ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                jpg_bytes = jpg.tobytes()
                yield (boundary + b"\r\n"
                       b"Content-Type: image/jpeg\r\n"
                       b"Content-Length: " + str(len(jpg_bytes)).encode() + b"\r\n"
                       b"\r\n" + jpg_bytes + b"\r\n")
            _time.sleep(0.033)  # ~30 FPS cap
        except GeneratorExit:
            # Client disconnected cleanly (tab switch, page navigation)
            log.debug("[MJPEG:%s] Client disconnected", cam_id)
            return
        except Exception as e:
            log.warning("[MJPEG:%s] Stream error: %s", cam_id, e)
            return

@app.route("/api/stream/<cam_id>")
def api_stream_cam(cam_id):
    """MJPEG stream for a specific camera — smooth real-time video"""
    return Response(
        _mjpeg_generator(cam_id),
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store",
                 "Pragma": "no-cache",
                 "Connection": "close"}
    )

@app.route("/api/stream")
def api_stream():
    """MJPEG stream for default camera (cam_0)"""
    return api_stream_cam("cam_0")

@app.route("/api/frame")
def api_frame():
    """Legacy single-camera frame — returns cam_0"""
    return api_frame_cam("cam_0")

@app.route("/api/frame/<cam_id>")
def api_frame_cam(cam_id):
    with _cams_lock:
        frame = _cam_frames.get(cam_id)
    if frame is None:
        # Per-camera request: don't borrow another camera's frame.
        return jsonify({"ok": False, "msg": "no frame yet"})
    h, w = frame.shape[:2]
    if w > 1280:
        scale = 1280 / w
        frame = cv2.resize(frame, (1280, int(h * scale)))
        h, w = frame.shape[:2]
    ok, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return jsonify({"ok": False, "msg": "encode failed"})
    return jsonify({"ok": True,
                    "image": base64.b64encode(jpg.tobytes()).decode(),
                    "width": w, "height": h})

# ── Camera CRUD ───────────────────────────────────────────────────────────────
@app.route("/api/cameras")
def api_cameras_get():
    with _state_lock:
        cams = state.get("cameras", [{"id":"cam_0","name":"Camera 1","rtsp_url":"","enabled":True}])
    with _cams_lock:
        statuses = dict(_cam_status)
    result = []
    for c in cams:
        cid = c["id"]
        result.append({**c,
            "running": statuses.get(cid, {}).get("running", False),
            "msg":     statuses.get(cid, {}).get("msg", "")})
    return jsonify({"ok": True, "cameras": result})

@app.route("/api/cameras/save", methods=["POST"])
def api_cameras_save():
    data = request.get_json() or {}
    cams = data.get("cameras", [])
    ids = set()
    for c in cams:
        if not c.get("id"):
            return jsonify({"ok": False, "msg": "Camera ID required"})
        if c["id"] in ids:
            return jsonify({"ok": False, "msg": f"Duplicate camera ID: {c['id']}"})
        ids.add(c["id"])
    with _state_lock:
        state["cameras"] = cams
        if cams:
            state["rtsp_url"] = cams[0].get("rtsp_url", "")
    save_settings_to_disk()
    return jsonify({"ok": True})

# ── Per-camera start/stop ─────────────────────────────────────────────────────
@app.route("/api/start", methods=["POST"])
def api_start():
    """Start all enabled cameras"""
    if CLOUD_MODE:
        return jsonify({"ok": False, "msg": "Cloud mode"})
    with _state_lock:
        cams = state.get("cameras", [])
        if not cams:
            rtsp = state.get("rtsp_url", "").strip()
            if rtsp:
                cams = [{"id":"cam_0","name":"Camera 1","rtsp_url":rtsp,"enabled":True}]
    started = []
    for cam in cams:
        if not cam.get("enabled", True): continue
        cid = cam["id"]
        with _cams_lock:
            t = _cam_threads.get(cid)
            if t and t.is_alive(): continue
            evt = threading.Event()
            _cam_stops[cid]  = evt
            _cam_status[cid] = {"running": False, "msg": "Starting..."}
        t = threading.Thread(target=camera_engine_loop,
                             args=(cam, evt), daemon=True, name=f"cam_{cid}")
        with _cams_lock:
            _cam_threads[cid] = t
        t.start()
        started.append(cid)
    with _state_lock:
        state["running"] = True
    stop_evt.clear()
    return jsonify({"ok": True, "started": started})

@app.route("/api/stop", methods=["POST"])
def api_stop():
    stop_evt.set()
    with _cams_lock:
        for evt in _cam_stops.values():
            evt.set()
    # Wait long enough for grab threads to exit their blocking cap.read().
    # READ_TIMEOUT_MSEC=3 s + grab join=5 s + inference cleanup ≤ 8 s total.
    for t in list(_cam_threads.values()):
        if t.is_alive():
            t.join(timeout=8.0)
        if t.is_alive():
            log.warning("[Stop] Thread %s still alive after 8 s join", t.name)
    with _cams_lock:
        _cam_threads.clear()
        _cam_stops.clear()
        _cam_frames.clear()
        for cid in list(_cam_status.keys()):
            _cam_status[cid] = {"running": False, "msg": "Stopped"}
    # Clear the last frame so the MJPEG stream shows a black frame
    # instead of a frozen snapshot when the camera is stopped.
    _last_frame[0] = None
    stop_evt.clear()   # reset for the next api_start call
    with _state_lock:
        state["running"] = False
    return jsonify({"ok": True})

@app.route("/api/start/<cam_id>", methods=["POST"])
def api_start_cam(cam_id):
    with _state_lock:
        cams = state.get("cameras", [])
    cam = next((c for c in cams if c["id"] == cam_id), None)
    if not cam:
        return jsonify({"ok": False, "msg": f"Camera {cam_id} not found"})
    with _cams_lock:
        t = _cam_threads.get(cam_id)
        if t and t.is_alive():
            return jsonify({"ok": False, "msg": "Already running"})
        evt = threading.Event()
        _cam_stops[cam_id]  = evt
        _cam_status[cam_id] = {"running": False, "msg": "Starting..."}
    t = threading.Thread(target=camera_engine_loop,
                         args=(cam, evt), daemon=True, name=f"cam_{cam_id}")
    with _cams_lock:
        _cam_threads[cam_id] = t
    t.start()
    with _state_lock:
        state["running"] = True
    return jsonify({"ok": True})

@app.route("/api/stop/<cam_id>", methods=["POST"])
def api_stop_cam(cam_id):
    with _cams_lock:
        evt = _cam_stops.get(cam_id)
    if evt:
        evt.set()
    with _cams_lock:
        t = _cam_threads.get(cam_id)
    if t and t.is_alive():
        t.join(timeout=8.0)   # matches grab(5s) + READ_TIMEOUT(3s) budget
    if t and t.is_alive():
        log.warning("[StopCam] Thread %s still alive after 8 s", cam_id)
    with _cams_lock:
        _cam_threads.pop(cam_id, None)
        _cam_stops.pop(cam_id, None)
        _cam_frames.pop(cam_id, None)
        _cam_status[cam_id] = {"running": False, "msg": "Stopped"}
    # Clear stale frame so MJPEG shows black not a frozen snapshot
    _last_frame[0] = None
    with _cams_lock:
        any_running = any(t.is_alive() for t in _cam_threads.values())
    if not any_running:
        with _state_lock:
            state["running"] = False
    return jsonify({"ok": True})

@app.route("/api/hud")
def api_hud():
    from collections import Counter
    with _cams_lock:
        huds = dict(_cam_huds)
    total_cust = sum(h.get("cust", 0) for h in huds.values())
    total_sell = sum(h.get("seller", 0) for h in huds.values())
    total_alrt = sum(h.get("alert", 0) for h in huds.values())
    merged_zones: Counter = Counter()
    for h in huds.values():
        merged_zones.update(h.get("zones", {}))
    with _state_lock:
        running = state.get("running", False)
    return jsonify({
        "running":  running,
        "cust":     total_cust,
        "seller":   total_sell,
        "alert":    total_alrt,
        "zones":    dict(merged_zones),
        "cams":     huds,
        "device":   "cuda" if _DEVICE != "cpu" else "cpu",
        "gpu_name": _GPU_NAME or None,
    })

# ── Legacy engine removed — see camera_engine_loop ──────────────────────────────

@app.route("/api/alerts")
def api_alerts():
    with alerts_lock:
        return jsonify(list(alerts[-50:]))

# ── Stats ─────────────────────────────────────────────────────────────────────
@app.route("/api/stats")
def api_stats():
    if not Path(DB_PATH).exists():
        return jsonify({"total": 0, "interested": 0, "purchasing": 0, "top_zone": "—"})
    today = _today_str()
    t0, t1 = _day_range(today)
    DAY = "timestamp>=? AND timestamp<?"
    try:
        conn = get_conn()
        def q(sql, p=()):
            return conn.execute(sql, p).fetchall()
        try:
            total = q(f"SELECT COUNT(*) FROM events WHERE is_new_visit=1 AND {DAY}", (t0, t1))[0][0]
        except Exception:
            total = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE {DAY}", (t0, t1))[0][0]
        if total == 0:
            total = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE {DAY}", (t0, t1))[0][0]
        inter = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE behavior_id IN {INTERESTED_IN} AND {DAY}", (t0, t1))[0][0]
        purch = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE behavior_id IN {PURCHASING_IN} AND {DAY}", (t0, t1))[0][0]
        top_z = q(f"SELECT zone_name, COUNT(*) n FROM events WHERE zone!='floor' AND {DAY} GROUP BY zone_name ORDER BY n DESC LIMIT 1", (t0, t1))
        conn.close()
        return jsonify({"total": total, "interested": inter, "purchasing": purch,
                        "top_zone": top_z[0][0] if top_z else "—"})
    except Exception as e:
        log.error("api_stats error: %s", e)
        return jsonify({"total": 0, "interested": 0, "purchasing": 0, "top_zone": "—"})

@app.route("/api/hourly")
def api_hourly():
    if not Path(DB_PATH).exists():
        return jsonify({"labels": [], "datasets": []})
    today  = _today_str()
    t0, t1 = _day_range(today)
    hf    = f"strftime('%H',datetime(timestamp,'unixepoch','+{TZ} hours'))"
    COLOR_MAP = ["#6366f1","#f59e0b","#22c55e","#ef4444",
                 "#a855f7","#14b8a6","#f97316","#3b82f6"]
    try:
        conn = get_conn()
        rows = conn.execute(
            f"SELECT {hf} hr, behavior_name, COUNT(*) n FROM events "
            f"WHERE timestamp>=? AND timestamp<? GROUP BY hr, behavior_name ORDER BY hr",
            (t0, t1)).fetchall()
        conn.close()
        labels  = [f"{h:02d}:00" for h in range(24)]
        beh_set = list(dict.fromkeys(r[1] for r in rows if r[1]))
        datasets = []
        for i, beh in enumerate(beh_set[:8]):
            data = [0] * 24
            for hr, b, n in rows:
                if b == beh and hr:
                    data[int(hr)] = n
            col = COLOR_MAP[i % len(COLOR_MAP)]
            datasets.append({"label": beh, "data": data,
                              "backgroundColor": col + "99",
                              "borderColor": col, "borderWidth": 1})
        return jsonify({"labels": labels, "datasets": datasets})
    except Exception as e:
        log.error("api_hourly error: %s", e)
        return jsonify({"labels": [], "datasets": []})

@app.route("/api/occupancy")
def api_occupancy():
    """Real-time occupancy + today's peak/average.

    live   — people currently being tracked (from the per-camera HUD), total,
             per-zone and per-camera. Reflects who is physically present now.
    today  — peak and average concurrent occupancy plus an hourly series.
             Occupancy history isn't stored as snapshots, so it's approximated
             from events: distinct visitors seen per 1-minute bucket ≈ how many
             were present that minute (tracked people log events continuously).
    """
    from collections import Counter
    # ── Live (from in-memory HUDs) ───────────────────────────────────────────
    with _cams_lock:
        huds = dict(_cam_huds)
    with _state_lock:
        running = state.get("running", False)
    live_total = sum(h.get("cust", 0) for h in huds.values())
    live_zones: Counter = Counter()
    for h in huds.values():
        live_zones.update(h.get("zones", {}))
    live_cams = {cid: h.get("cust", 0) for cid, h in huds.items()}

    # ── Today's peak / average / hourly series ────────────────────────────────
    # Primary source: occupancy_snapshots (true concurrent headcount sampled
    # every OCC_SAMPLE_SEC). Fallback for dates predating the snapshot table:
    # the legacy distinct-visitors-per-minute approximation (overstates under
    # churn — kept only for historical data).
    date = request.args.get("date", "") or _today_str()
    peak, peak_time, avg = 0, "—", 0.0
    series = [0] * 24
    if Path(DB_PATH).exists():
        try:
            t0, t1 = _day_range(date)
            conn = get_conn()
            mf = f"strftime('%H:%M',datetime(timestamp,'unixepoch','+{TZ} hours'))"
            hf = f"strftime('%H',datetime(timestamp,'unixepoch','+{TZ} hours'))"
            snaps = conn.execute(
                f"SELECT {mf} m, {hf} hr, total FROM occupancy_snapshots "
                f"WHERE timestamp>=? AND timestamp<? ORDER BY timestamp",
                (t0, t1)).fetchall()
            if snaps:
                counts = [r[2] for r in snaps]
                peak_idx  = max(range(len(snaps)), key=lambda i: snaps[i][2])
                peak      = snaps[peak_idx][2]
                peak_time = snaps[peak_idx][0]
                avg       = round(sum(counts) / len(counts), 1)
                for m, hr, c in snaps:
                    if hr is not None and c > series[int(hr)]:
                        series[int(hr)] = c
            else:
                rows = conn.execute(
                    f"SELECT {mf} m, {hf} hr, COUNT(DISTINCT {VISITOR_KEY}) c "
                    f"FROM events WHERE timestamp>=? AND timestamp<? "
                    f"GROUP BY m ORDER BY m", (t0, t1)).fetchall()
                if rows:
                    counts = [r[2] for r in rows]
                    peak_idx   = max(range(len(rows)), key=lambda i: rows[i][2])
                    peak       = rows[peak_idx][2]
                    peak_time  = rows[peak_idx][0]
                    avg        = round(sum(counts) / len(counts), 1)
                    # Hourly series = peak concurrent occupancy within each hour
                    # (more useful for staffing than an average of averages).
                    for m, hr, c in rows:
                        if hr is not None:
                            h = int(hr)
                            if c > series[h]:
                                series[h] = c
            conn.close()
        except Exception as e:
            log.error("api_occupancy error: %s", e)

    return jsonify({
        "ok": True,
        "running": running,
        "live": {"total": live_total, "zones": dict(live_zones), "cams": live_cams},
        "today": {
            "peak": peak, "peak_time": peak_time, "avg": avg,
            "labels": [f"{h:02d}:00" for h in range(24)],
            "series": series,
        },
    })

@app.route("/api/zones_activity")
def api_zones_activity():
    if not Path(DB_PATH).exists():
        return jsonify([])
    today  = _today_str()
    t0, t1 = _day_range(today)
    try:
        conn = get_conn()
        rows = conn.execute(
            f"SELECT zone_name, COUNT(*) n FROM events "
            f"WHERE zone!='floor' AND timestamp>=? AND timestamp<? "
            f"GROUP BY zone_name ORDER BY n DESC LIMIT 10",
            (t0, t1)).fetchall()
        conn.close()
        return jsonify([{"zone": r[0] or "unknown", "count": r[1]} for r in rows])
    except Exception as e:
        log.error("api_zones_activity error: %s", e)
        return jsonify([])

# ── Zones CRUD ────────────────────────────────────────────────────────────────
@app.route("/api/zones/load")
def api_zones_load():
    if not Path(ZONES_CONFIG).exists():
        return jsonify({"cam_0": {}})
    try:
        with open(ZONES_CONFIG, encoding="utf-8") as f:
            return jsonify(json.load(f))
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route("/api/zones/save", methods=["POST"])
def api_zones_save():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"ok": False, "msg": "Invalid JSON"}), 400
    try:
        # Always ensure _meta (authoring resolution) is written
        if not data.get("_meta"):
            try:
                if Path(ZONES_CONFIG).exists():
                    with open(ZONES_CONFIG, encoding="utf-8") as f:
                        existing = json.load(f)
                    if existing.get("_meta"):
                        data["_meta"] = existing["_meta"]
            except Exception:
                pass
            if not data.get("_meta"):
                data["_meta"] = {"w": 960, "h": 540}
        with open(ZONES_CONFIG, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route("/api/zones/delete", methods=["POST"])
def api_zones_delete():
    data    = request.get_json(silent=True) or {}
    zone_id = data.get("zone_id", "").strip()
    cam_key = data.get("cam", "cam_0")
    if not zone_id:
        return jsonify({"ok": False, "msg": "zone_id required"}), 400
    if not Path(ZONES_CONFIG).exists():
        return jsonify({"ok": False, "msg": "No zones config"}), 404
    try:
        with open(ZONES_CONFIG, encoding="utf-8") as f:
            cfg = json.load(f)
        cfg.get(cam_key, {}).pop(zone_id, None)
        with open(ZONES_CONFIG, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route("/api/zones/clear", methods=["POST"])
def api_zones_clear():
    cam_key = (request.get_json(silent=True) or {}).get("cam", "cam_0")
    try:
        cfg = {}
        if Path(ZONES_CONFIG).exists():
            with open(ZONES_CONFIG, encoding="utf-8") as f:
                cfg = json.load(f)
        cfg[cam_key] = {}
        with open(ZONES_CONFIG, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

# ── Behaviors CRUD ────────────────────────────────────────────────────────────
@app.route("/api/behaviors")
def api_behaviors_get():
    from src.engine.behavior_engine import load_behaviors
    return jsonify(load_behaviors())

@app.route("/api/behaviors/save", methods=["POST"])
def api_behaviors_save():
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({"ok": False, "msg": "Expected JSON array"}), 400
    from src.engine.behavior_engine import save_behaviors
    try:
        save_behaviors(data)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route("/api/behaviors/reset", methods=["POST"])
def api_behaviors_reset():
    from src.engine.behavior_engine import DEFAULT_BEHAVIORS, save_behaviors
    save_behaviors(DEFAULT_BEHAVIORS.copy())
    return jsonify({"ok": True})

# ── Brand ─────────────────────────────────────────────────────────────────────
@app.route("/translations.js")
def serve_translations():
    """Serve translations.js (kept for backward-compat; also at /static/js/)"""
    from flask import send_from_directory
    return send_from_directory(os.path.join(STATIC_DIR, "js"),
                               "translations.js", mimetype="application/javascript")


@app.route("/api/brand")
def api_brand():
    return jsonify(load_brand())



@app.route("/api/brand/save", methods=["POST"])
def api_brand_save():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "msg": "Invalid JSON"}), 400
    try:
        with open(BRAND_CONFIG, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

# ── Settings ──────────────────────────────────────────────────────────────────
SENSITIVE_KEYS = {"gemini_api_key", "claude_api_key"}

@app.route("/api/settings")
def api_settings():
    with _state_lock:
        # mask API keys in response
        safe = {k: ("***" if k in SENSITIVE_KEYS and v else v)
                for k, v in state.items()}
    return jsonify(safe)

@app.route("/api/settings", methods=["POST"])
def api_settings_post():
    data = request.get_json(silent=True) or {}
    with _state_lock:
        for k, v in data.items():
            if k in state:
                if k in SENSITIVE_KEYS and v == "***":
                    continue
                state[k] = v
    return jsonify({"ok": True})

def save_settings_to_disk():
    """Persist state cameras to brand_config for reload on restart"""
    try:
        with _state_lock:
            cams = state.get("cameras", [])
        cfg = load_brand()
        cfg["cameras"] = cams
        with open(BRAND_CONFIG, "w", encoding="utf-8") as f:
            import json as _json
            _json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log.warning("save_settings_to_disk error: %s", e)

# ── Reports ───────────────────────────────────────────────────────────────────
@app.route("/api/activity/summary")
def api_activity_summary():
    date = request.args.get("date", "")
    if not Path(DB_PATH).exists():
        return jsonify({"ok": True, "total": 0, "interested": 0, "alerts": 0, "top_zone": "—", "top_zone_count": 0})
    def q(sql, p=()):
        conn = get_conn(); rows = conn.execute(sql, p).fetchall(); conn.close(); return rows
    where, params = "1=1", []
    if date:
        import datetime
        try:
            d = datetime.date.fromisoformat(date)
            ts0 = datetime.datetime.combine(d, datetime.time.min).timestamp()
            ts1 = datetime.datetime.combine(d, datetime.time.max).timestamp()
            where = "timestamp BETWEEN ? AND ?"; params = [ts0, ts1]
        except Exception: pass
    total = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE {where}", params)[0][0]
    inter = q(f"""SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE {where}
        AND behavior_id IN {INTERESTED_IN}""", params)[0][0]
    # Distinct people who needed staff — not raw event rows. The v2 logger
    # heartbeats every 5 s while a person dwells in an alerting behaviour, so
    # COUNT(*) inflates one sustained alert into dozens of rows.
    alrt  = q(f"SELECT COUNT(DISTINCT {VISITOR_KEY}) FROM events WHERE {where} AND needs_staff=1", params)[0][0]
    top   = q(f"""SELECT zone_name, COUNT(*) n FROM events WHERE {where} AND zone_name!=''
        GROUP BY zone_name ORDER BY n DESC LIMIT 1""", params)
    zones = q(f"""SELECT zone_name, COUNT(DISTINCT {VISITOR_KEY}) FROM events
        WHERE {where} AND zone_name!='' GROUP BY zone_name ORDER BY 2 DESC""", params)
    return jsonify({"ok": True, "total": total, "interested": inter,
        "interested_pct": round(inter/total*100) if total else 0,
        "alerts": alrt, "top_zone": top[0][0] if top else "—",
        "top_zone_count": top[0][1] if top else 0,
        "zones": [{"zone": r[0], "visitors": r[1]} for r in zones]})

@app.route("/api/activity")
def api_activity():
    try:
        page     = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 50))
        date     = request.args.get("date", "")
        behavior = request.args.get("behavior", "")
        zone     = request.args.get("zone", "")
        alert    = request.args.get("alert", "")
        if not Path(DB_PATH).exists():
            return jsonify({"ok": True, "events": [], "total": 0, "pages": 0})
        def q(sql, p=()):
            conn = get_conn(); rows = conn.execute(sql, p).fetchall(); conn.close(); return rows
        where, params = ["1=1"], []
        if date:
            import datetime
            try:
                d = datetime.date.fromisoformat(date)
                ts0 = datetime.datetime.combine(d, datetime.time.min).timestamp()
                ts1 = datetime.datetime.combine(d, datetime.time.max).timestamp()
                where.append("timestamp BETWEEN ? AND ?"); params += [ts0, ts1]
            except Exception: pass
        if behavior: where.append("behavior_id=?"); params.append(behavior)
        if zone:     where.append("zone_name=?");   params.append(zone)
        if alert=="1": where.append("needs_staff=1")
        wsql = " AND ".join(where)
        total = q(f"SELECT COUNT(*) FROM events WHERE {wsql}", params)[0][0]
        pages = max(1, (total + per_page - 1) // per_page)
        offset = (page-1)*per_page
        rows = q(f"""SELECT id, timestamp, person_id, zone_name, behavior_id,
            behavior_name, needs_staff FROM events WHERE {wsql}
            ORDER BY timestamp DESC LIMIT ? OFFSET ?""", params+[per_page, offset])
        import datetime
        events = []
        for r in rows:
            ts = datetime.datetime.fromtimestamp(r[1])
            events.append({"id": r[0], "time": ts.strftime("%H:%M:%S"),
                "date": ts.strftime("%Y-%m-%d"), "person_id": r[2],
                "zone": r[3] or "—", "behavior_id": r[4],
                "behavior": r[5] or r[4] or "—", "alert": bool(r[6])})
        behaviors = [r[0] for r in q(f"SELECT DISTINCT behavior_id FROM events WHERE behavior_id!='' ORDER BY behavior_id")]
        zones_list = [r[0] for r in q(f"SELECT DISTINCT zone_name FROM events WHERE zone_name!='' ORDER BY zone_name")]
        return jsonify({"ok": True, "events": events, "total": total,
            "page": page, "pages": pages, "behaviors": behaviors, "zones": zones_list})
    except Exception as e:
        log.error("api_activity error: %s", e)
        return jsonify({"ok": False, "events": [], "total": 0, "pages": 0})

@app.route("/api/report/pdf")
def api_report_pdf():
    if not Path(DB_PATH).exists():
        return jsonify({"ok": False, "msg": "No database"}), 404
    import tempfile
    tmp = None
    try:
        from src.utils.report_pdf import build_pdf
        tmp = tempfile.mktemp(suffix=".pdf")
        build_pdf(DB_PATH, request.args.get("date"), tmp)
        with open(tmp, "rb") as f:
            data = f.read()
        return Response(data, mimetype="application/pdf",
                        headers={"Content-Disposition":
                                 "attachment; filename=flowsight_report.pdf"})
    except Exception as e:
        log.error("PDF report error: %s", e)
        return jsonify({"ok": False, "msg": str(e)}), 500
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass

@app.route("/api/report/html")
def api_report_html():
    return jsonify({"ok": False, "msg": "HTML export removed — use PDF export"}), 410

@app.route("/api/insight")
def api_insight():
    if not Path(DB_PATH).exists():
        return jsonify({"ok": False, "msg": "No database"}), 404

    try:
        from src.utils.ai_insight import get_ai_insight, insight_to_html
        with _state_lock:
            gemini_key = state.get("gemini_api_key", "") or os.environ.get("GEMINI_API_KEY", "")
            claude_key = state.get("claude_api_key", "") or os.environ.get("ANTHROPIC_API_KEY", "")
        result = get_ai_insight(DB_PATH, request.args.get("date"),
                                api_key=gemini_key or claude_key,
                                brand_name=load_brand().get("name", "this retail store"))
        return jsonify({"ok": result["ok"],
                        "html": insight_to_html(result.get("insight") or
                                                result.get("fallback", "")),
                        "source": result.get("source", "Auto")})
    except Exception as e:
        log.error("Insight error: %s", e)
        return jsonify({"ok": False, "msg": str(e)}), 500

# ── Heat map ────────────────────────────────────────────────────────────────
# Two parallel engines per camera, fed the same person positions every frame:
#   _heat_engines      — half_life_sec=20s. "Where is busy RIGHT NOW" — a spot
#                         a person left fades out in ~tens of seconds. Good for
#                         live floor-monitoring, useless for a long session: by
#                         the time you stop a 9am–7pm run almost everything has
#                         decayed away, so a same-day report off this engine
#                         would show near-zero everywhere.
#   _heat_engines_cum   — half_life_sec=0 (decay disabled). Pure cumulative
#                         footfall across the whole run — this is what the
#                         Reports page / "Stop & Save Report" reads, so a full
#                         business day still adds up to a meaningful map at
#                         the end instead of fading to nothing.
# Both reset together (api_heatmap_reset) since they represent the same
# tracking session; ?mode=cumulative on /jpeg and /zones reads the latter.
_heat_engines:     dict = {}   # cam_id -> HeatMapEngine (live, decaying)
_heat_engines_cum: dict = {}   # cam_id -> HeatMapEngine (cumulative, no decay)

def _pick_heat_engine(cam_id: str, mode: str):
    return (_heat_engines_cum if mode == "cumulative" else _heat_engines).get(cam_id)

@app.route("/api/heatmap/jpeg")
def api_heatmap_jpeg():
    cam_id = request.args.get("cam", "cam_0")
    mode   = request.args.get("mode", "live")
    engine = _pick_heat_engine(cam_id, mode)
    with _cams_lock:
        frame = _cam_frames.get(cam_id)
    if frame is None or engine is None:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.putText(frame, f"No heatmap data ({cam_id})", (40, 240),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (100,100,100), 2)
        _, jpg = cv2.imencode(".jpg", frame)
        return Response(jpg.tobytes(), mimetype="image/jpeg")
    alpha = float(request.args.get("alpha", 0.5))
    data  = engine.get_jpeg(frame, alpha=alpha)
    return Response(data, mimetype="image/jpeg",
                    headers={"Cache-Control":"no-cache,no-store"})

@app.route("/api/heatmap/reset", methods=["POST"])
def api_heatmap_reset():
    cam_id = (request.get_json(silent=True) or {}).get("cam", "cam_0")
    for d in (_heat_engines, _heat_engines_cum):
        engine = d.get(cam_id)
        if engine:
            engine.reset()
    return jsonify({"ok": True})

def _scaled_zone_polys(engine, cam_id: str) -> dict:
    """Zone polygons for cam_id, scaled into the heat engine's native pixel
    space and keyed for HeatMapEngine.get_top_zones / generate_report.

    Zone polygons are stored in the authoring resolution (zones_config _meta),
    but the heat map accumulates in the camera's native pixel space. Scale the
    polygons into native space before scoring, or the heat is sampled from the
    wrong region (e.g. only the top-left quadrant when native > authoring).

    Returns {zone_id: {"poly": ndarray, "name": str}}.
    """
    from src.engine.zones import ZoneManager
    zm    = ZoneManager(ZONES_CONFIG)
    polys = zm.get_polygons(cam_id)
    meta  = zm.get_meta(cam_id)
    aw, ah = zm.get_author_size()
    if aw > 0 and ah > 0:
        sx, sy = engine.w / aw, engine.h / ah
        polys = {zid: (poly.astype(float) * [sx, sy]).astype(np.int32)
                 for zid, poly in polys.items()}
    return {zid: {"poly": poly, "name": meta.get(zid, {}).get("name", zid)}
            for zid, poly in polys.items()}

@app.route("/api/heatmap/zones")
def api_heatmap_zones():
    cam_id = request.args.get("cam", "cam_0")
    mode   = request.args.get("mode", "live")
    engine = _pick_heat_engine(cam_id, mode)
    if engine is None:
        return jsonify([])
    scores = engine.get_top_zones(_scaled_zone_polys(engine, cam_id))
    # Ranked by mass (∝ people in zone); density exposed separately.
    return jsonify([{"zone_id": z["zone_id"], "name": z["name"],
                     "mass": round(z["mass"], 2),
                     "density": round(z["density"], 2)} for z in scores])

@app.route("/api/heatmap/report", methods=["POST"])
def api_heatmap_report():
    """Snapshot the current top zones to a timestamped JSON report on disk.

    Called when the user ends a session ("Stop & Save Report"). Reads the
    CUMULATIVE engine (no decay), not the live one — the live engine's heat
    fades out within tens of seconds of a spot emptying, so by the end of an
    hours-long session it reflects only the last moment, not the session as a
    whole. Mass/density here are full-session footfall instead.
    """
    cam_id = (request.get_json(silent=True) or {}).get("cam", "cam_0")
    engine = _heat_engines_cum.get(cam_id)
    if engine is None:
        return jsonify({"ok": False, "msg": f"No heatmap data ({cam_id})"}), 404
    with _cams_lock:
        frame = _cam_frames.get(cam_id)
    report = engine.generate_report(_scaled_zone_polys(engine, cam_id),
                                    out_dir=REPORTS_DIR, frame=frame)
    return jsonify({"ok": True, **report})

def _safe_report_path(name: str) -> Path | None:
    """Resolve a report filename to a path inside REPORTS_DIR, or None if the
    name is malformed / would escape the directory (path-traversal guard)."""
    if (Path(name).name != name
            or not name.startswith("heatmap_report_")
            or not name.endswith(".json")):
        return None
    p = Path(REPORTS_DIR) / name
    return p if p.is_file() else None

@app.route("/api/heatmap/reports")
def api_heatmap_reports():
    """List saved heat-map reports, newest first (summary only)."""
    out = []
    d = Path(REPORTS_DIR)
    if d.is_dir():
        for p in sorted(d.glob("heatmap_report_*.json"), reverse=True):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            zones = data.get("zones", [])
            out.append({
                "file": p.name,
                "generated_at": data.get("generated_at", ""),
                "zone_count": data.get("zone_count", len(zones)),
                "top_zone": zones[0]["name"] if zones else None,
            })
    return jsonify(out)

@app.route("/api/heatmap/reports/<name>")
def api_heatmap_report_detail(name):
    """Full content of a single saved report."""
    p = _safe_report_path(name)
    if p is None:
        return jsonify({"ok": False, "msg": "Report not found"}), 404
    return jsonify(json.loads(p.read_text(encoding="utf-8")))

@app.route("/api/heatmap/reports/<name>", methods=["DELETE"])
def api_heatmap_report_delete(name):
    """Delete a saved report and its snapshot image (if any)."""
    p = _safe_report_path(name)
    if p is None:
        return jsonify({"ok": False, "msg": "Report not found"}), 404
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    img_name = data.get("image")
    p.unlink()
    if img_name:
        img = _safe_report_image_path(img_name)
        if img is not None:
            try:
                img.unlink()
            except Exception:
                pass
    return jsonify({"ok": True})

def _safe_report_image_path(name: str) -> Path | None:
    """Same path-traversal guard as _safe_report_path, for the .jpg snapshot
    saved alongside a report (older reports predate the image and have none)."""
    if (Path(name).name != name
            or not name.startswith("heatmap_report_")
            or not name.endswith(".jpg")):
        return None
    p = Path(REPORTS_DIR) / name
    return p if p.is_file() else None

@app.route("/api/heatmap/reports/<name>/image")
def api_heatmap_report_image(name):
    """Colorized heat-map snapshot for a saved report (see generate_report)."""
    p = _safe_report_image_path(name)
    if p is None:
        return jsonify({"ok": False, "msg": "Image not found"}), 404
    return Response(p.read_bytes(), mimetype="image/jpeg",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})

@app.route("/api/data/clear", methods=["POST"])
def api_data_clear():
    """Wipe accumulated runtime/test data so the next test run starts clean:
    every row in behavior_log.db (events + occupancy snapshots), the
    in-memory alert feed, and every camera's live heat-map buffer.

    Saved heat-map session reports (Reports page) are deliberately left
    alone — those are exports you asked for, not test noise."""
    from src.utils.data_manager import DataManager
    deleted = DataManager(DB_PATH).delete_all_data()
    with alerts_lock:
        alerts.clear()
    for engine in _heat_engines.values():
        engine.reset()
    log.info("[DataClear] wiped %d events, %d occupancy rows; alerts + heatmaps reset",
             deleted.get("events", 0), deleted.get("occupancy", 0))
    return jsonify({"ok": True, **deleted})

# ── Demo Image ────────────────────────────────────────────────────────────────
import base64

@app.route("/api/demo/upload", methods=["POST"])
def api_demo_upload():
    """Upload image to use as demo feed instead of RTSP"""
    try:
        f = request.files.get("image")
        if not f:
            return jsonify({"ok": False, "msg": "No file"}), 400
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ('.jpg','.jpeg','.png','.bmp'):
            return jsonify({"ok": False, "msg": "Only JPG/PNG allowed"}), 400
        save_path = os.path.join(STATIC_DIR, "assets", "demo_image" + ext)
        f.save(save_path)
        # Store path in state
        with _state_lock:
            state["demo_image"] = save_path
        log.info("[Demo] Image uploaded: %s", save_path)
        return jsonify({"ok": True, "path": save_path})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route("/api/demo/clear", methods=["POST"])
def api_demo_clear():
    """Clear demo image — back to RTSP mode"""
    with _state_lock:
        state["demo_image"] = ""
    # Remove saved demo images
    for ext in ('.jpg','.jpeg','.png','.bmp'):
        p = os.path.join(STATIC_DIR, "assets", "demo_image" + ext)
        if os.path.exists(p):
            try: os.remove(p)
            except: pass
    log.info("[Demo] Demo image cleared")
    return jsonify({"ok": True})

@app.route("/api/demo/status")
def api_demo_status():
    with _state_lock:
        path = state.get("demo_image", "")
    return jsonify({"active": bool(path), "path": path})

@app.route("/api/push", methods=["POST"])
def api_push():
    secret = os.environ.get("PUSH_SECRET", "")
    if secret and request.headers.get("X-Push-Secret", "") != secret:
        return jsonify({"ok": False, "msg": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    if "hud" in data:
        with hud_lock:
            hud.update(data["hud"])
        with _state_lock:
            state["running"] = data["hud"].get("running", False)
    if "alerts" in data:
        with alerts_lock:
            alerts.extend(data["alerts"])
            del alerts[:-MAX_ALERTS]
    return jsonify({"ok": True})

# ── Web UI ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    """Serves the new frontend build (React/Vue SPA)."""
    try:
        with open(VUE_TMPL_PATH, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>FlowSight</h1><p>Frontend build not found. Run: docker compose build</p>", 500

# ── Detection engine ──────────────────────────────────────────────────────────
def _push_frame(frame: np.ndarray):
    """Non-blocking push — always keep latest frame, drop old ones."""
    _last_frame[0] = frame  # always update last frame
    # Drain queue and put latest
    while True:
        try: frame_q.get_nowait()
        except queue.Empty: break
    try: frame_q.put_nowait(frame)
    except queue.Full: pass

def camera_engine_loop(cam_cfg: dict, stop_event: threading.Event):
    """Per-camera engine loop — runs independently for each camera.

    Each camera thread owns its own YOLO model instance so ByteTrack internal
    state is fully isolated between cameras.  This prevents cross-camera track-ID
    contamination that would corrupt zone assignment in multi-camera setups.
    """
    cam_id   = cam_cfg.get("id", "cam_0")
    cam_name = cam_cfg.get("name", cam_id)
    rtsp     = cam_cfg.get("rtsp_url", "").strip()

    log.info("[Cam:%s] Starting — %s", cam_id, cam_name)

    def set_status(running, msg):
        with _cams_lock:
            _cam_status[cam_id] = {"running": running, "msg": msg}

    try:
        from src.engine.behavior_engine import BehaviorInferenceEngine
        from src.engine.tracker import PersonTracker
        from src.utils.logger import BehaviorLogger
        from src.utils.alert import check_alert
        from src.utils.dashboard import draw_overlay, draw_hud
        from src.engine.zones import ZoneManager
    except Exception as e:
        log.error("[Cam:%s] Import failed: %s", cam_id, e)
        set_status(False, f"Import error: {e}")
        return

    # ── Source resolution ─────────────────────────────────────────────────
    # `rtsp_url` normally holds an RTSP/HTTP camera URL, but for TESTING it may
    # instead point at a LOCAL VIDEO FILE (optionally prefixed `file://`). A
    # path that exists on disk is played on a loop and paced to its native frame
    # rate, so dwell-time behaviours (interest, loitering, waiting…) fire just as
    # they would with a live camera — no physical camera required.
    src = rtsp
    # Forgive a path pasted with wrapping quotes (e.g. a shell-escaped
    # "'/Volumes/My Clip.mp4'") — strip one matching quote pair, then file://.
    if len(src) >= 2 and src[0] in "'\"" and src[-1] == src[0]:
        src = src[1:-1].strip()
    if src.lower().startswith("file://"):
        src = src[7:]
    is_file = bool(src) and not src.lower().startswith(
        ("rtsp://", "http://", "https://", "rtmp://")) and os.path.isfile(src)

    if not rtsp:
        log.error("[Cam:%s] No source (RTSP URL or video file)", cam_id)
        set_status(False, "No source")
        return

    log.info("[Cam:%s] Connecting to %s: %s", cam_id,
             "video file" if is_file else "stream", src[:60])
    set_status(False, "Opening video file..." if is_file else "Connecting...")

    RECONNECT_INTERVAL = 5

    def _open_stream() -> "cv2.VideoCapture | None":
        """Open the capture, retrying every RECONNECT_INTERVAL until it
        succeeds or stop_event fires. A camera that is offline (at startup or
        mid-run) therefore recovers automatically as soon as it is reachable
        again, instead of staying down until a human presses start."""
        attempt = 0
        while not stop_event.is_set():
            c = cv2.VideoCapture(src, cv2.CAP_FFMPEG)
            if not is_file:
                c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                # Limit how long cap.read() blocks so the grab thread can exit
                # promptly when stop_event fires (matches grab_thread.join buffer).
                c.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10_000)   # 10 s to open
                c.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC,  3_000)   # 3 s per read
            if c.isOpened():
                return c
            c.release()
            attempt += 1
            log.warning("[Cam:%s] Cannot open stream (attempt %d) — retry in %ds",
                        cam_id, attempt, RECONNECT_INTERVAL)
            set_status(False, f"Reconnecting (attempt {attempt})...")
            if stop_event.wait(RECONNECT_INTERVAL):
                break
        return None

    cap = _open_stream()
    if cap is None:
        set_status(False, "Stopped")
        return

    log.info("[Cam:%s] Stream opened OK", cam_id)
    set_status(True, "Running")

    # Device: CUDA when available (detected once at startup), CPU otherwise.
    device   = _DEVICE
    use_half = device != "cpu"   # FP16 ~2x faster on RTX-class GPUs
    if device == "cpu":
        # CPU-only — limit OpenMP threads to avoid context-switch thrash
        # across cameras.
        try:
            import torch
            with _state_lock:
                num_cams = max(1, sum(
                    1 for c in state.get("cameras", [{"id": "cam_0"}])
                    if c.get("enabled", True)
                ))
            torch.set_num_threads(max(1, os.cpu_count() // num_cams))
            log.info("[Cam:%s] CPU mode — torch threads: %d", cam_id,
                     max(1, os.cpu_count() // num_cams))
            # Measured ceiling on an 8-core CPU is ~28-30 total inference fps;
            # beyond ~6 cameras per-camera fps falls under 5 and latency grows
            # unboundedly. Warn loudly instead of degrading silently.
            if num_cams > 6:
                log.warning("[Cam:%s] %d cameras enabled on CPU — exceeds the "
                            "~6-camera capacity of one CPU instance; expect <5 fps "
                            "per camera. Use a GPU or split cameras across instances.",
                            cam_id, num_cams)
        except Exception:
            pass
    else:
        log.info("[Cam:%s] GPU mode — %s (%.1f GB), FP16", cam_id,
                 _GPU_NAME, _GPU_VRAM)

    try:
        from ultralytics import YOLO
        model = YOLO(MODEL_PATH)
        log.info("[Cam:%s] YOLO loaded (device=%s)", cam_id, device)
    except Exception as e:
        log.error("[Cam:%s] YOLO load failed: %s", cam_id, e)
        set_status(False, f"YOLO error: {e}")
        cap.release()
        return

    # Resolve ByteTracker config — shipped tuned copy in config/
    bt_yaml = BYTETRACK
    log.info("[Cam:%s] Tracker config: %s", cam_id, bt_yaml)

    tracker  = PersonTracker()
    engine   = BehaviorInferenceEngine(ZONES_CONFIG, BEHS_CONFIG)
    logger   = BehaviorLogger(DB_PATH)
    zm       = ZoneManager(ZONES_CONFIG)
    aw, ah   = zm.get_author_size()
    from src.utils.heatmap import HeatMapEngine
    # Use actual frame resolution so person coordinates aren't clipped
    _fh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
    _fw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))  or 1280
    # half_life_sec=20: live crowd-density map — a vacated spot's heat halves
    # every 20 s (frame-rate independent), instead of lingering ~11 min as the
    # old frame-count decay did.
    _heat_engines[cam_id] = HeatMapEngine(width=_fw, height=_fh, half_life_sec=20.0)
    heat_eng = _heat_engines[cam_id]
    # half_life_sec=0: decay disabled — pure cumulative footfall for the whole
    # run, so an end-of-day "Stop & Save Report" still has something to show
    # (see the _heat_engines_cum comment above for why this is separate).
    _heat_engines_cum[cam_id] = HeatMapEngine(width=_fw, height=_fh, half_life_sec=0)
    heat_eng_cum = _heat_engines_cum[cam_id]

    import time as _time
    from collections import Counter

    CLEANUP_EVERY      = 150   # flush stale state every ~10 s at 15 fps
    NO_FRAME_TIMEOUT   = 15.0  # no new frame for this long => stream is dead
    fail_count = 0
    MAX_FAILS  = 30
    frame_no   = 0

    # ── Dedicated frame-grabber thread ────────────────────────────────────
    # Drains the RTSP buffer continuously so the inference loop always gets
    # the latest frame instead of a buffered one.  _frame_seq lets the main
    # loop tell a NEW frame from a stale one, so a stalled stream is detected
    # instead of re-running inference on the same image forever.
    _latest_frame = [None]
    _frame_seq    = [0]
    _frame_lock   = threading.Lock()
    _grab_stop    = threading.Event()

    # Video-file playback: pace the grabber to the clip's native fps so video
    # time tracks wall-clock time (dwell-based behaviours need realistic
    # timing), and loop back to frame 0 on EOF so it behaves like a continuous
    # camera instead of triggering the stream-lost reconnect path.
    _file_fps = (cap.get(cv2.CAP_PROP_FPS) or 0.0) if is_file else 0.0
    _frame_interval = (1.0 / _file_fps) if _file_fps > 0 else 0.04
    if is_file:
        log.info("[Cam:%s] Video file looping at %.1f fps", cam_id,
                 _file_fps if _file_fps > 0 else 25.0)

    def _grab_loop():
        nonlocal cap, fail_count
        while not _grab_stop.is_set() and not stop_event.is_set():
            t0 = _time.monotonic()
            ret, frame = cap.read()
            if ret:
                with _frame_lock:
                    _latest_frame[0] = frame
                    _frame_seq[0]   += 1
                fail_count = 0
            elif is_file:
                # End of clip — rewind and keep playing.
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
            else:
                fail_count += 1
                _time.sleep(0.01)
                continue
            if is_file:
                # Sleep the remainder of this frame's display time (interruptible).
                dt = _frame_interval - (_time.monotonic() - t0)
                if dt > 0:
                    _grab_stop.wait(dt)

    def _start_grabber():
        t = threading.Thread(target=_grab_loop, daemon=True,
                             name=f"grab_{cam_id}")
        t.start()
        return t

    grab_thread = _start_grabber()
    _time.sleep(0.5)   # give grabber time to fill the first frame

    # ── Main inference loop ───────────────────────────────────────────────
    last_seq    = 0
    last_new_ts = _time.monotonic()
    while not stop_event.is_set():
        with _frame_lock:
            frame = _latest_frame[0]
            seq   = _frame_seq[0]

        fresh = (seq != last_seq)
        if fresh:
            last_seq    = seq
            last_new_ts = _time.monotonic()

        # Nothing new to process — decide between waiting and reconnecting.
        # (Checked only when idle so a buffered frame is always processed
        # before any reconnect tears the grabber down.)
        if frame is None or not fresh:
            # Reconnect on persistent read failures OR a silently stalled
            # stream (opened but never delivering frames). _open_stream()
            # retries until the camera is reachable again or the user stops
            # it, so a single failed attempt can no longer leave the camera
            # down permanently.
            stalled = (_time.monotonic() - last_new_ts) > NO_FRAME_TIMEOUT
            if fail_count >= MAX_FAILS or stalled:
                log.warning("[Cam:%s] Stream lost (%s) — reconnecting", cam_id,
                            "read failures" if fail_count >= MAX_FAILS
                            else "no new frames for %.0fs" % NO_FRAME_TIMEOUT)
                set_status(False, "Reconnecting...")
                _grab_stop.set()
                grab_thread.join(timeout=5.0)
                cap.release()
                if stop_event.wait(RECONNECT_INTERVAL):
                    break
                cap = _open_stream()  # blocks, retrying, until opened or stopped
                if cap is None:
                    break             # stop requested during reconnect
                fail_count = 0
                with _frame_lock:
                    _latest_frame[0] = None
                _grab_stop.clear()
                grab_thread = _start_grabber()
                set_status(True, "Reconnected")
                last_new_ts = _time.monotonic()
                _time.sleep(0.5)
                continue
            # Stream still healthy — just wait for the grabber.
            _time.sleep(0.02)
            continue

        # Re-read settings on every iteration so UI changes take effect
        # immediately without restarting the camera.
        with _state_lock:
            conf = state.get("conf", 0.40)
            anon = state.get("anonymize", True)

        frame_no += 1
        fh, fw = frame.shape[:2]

        try:
            # ── Detection + tracking ──────────────────────────────────────
            # imgsz=1280: halves the downscale on 1080p cameras (3× → 1.5×),
            #             making distant/small people reliably detectable.
            # tracker=bt_yaml: uses the tuned track_buffer=300 (20 s) so
            #             occlusions up to 20 s are bridged without new IDs.
            # cam_key: namespaces trajectory keys to prevent state collision
            #          between cameras.
            # imgsz: user can override via settings; auto-select otherwise.
            # CPU: scale down with camera count to maintain ≥5fps per camera.
            with _state_lock:
                _imgsz = state.get("imgsz", 0)
                _ncams = max(1, sum(
                    1 for c in state.get("cameras", [{"id": "cam_0"}])
                    if c.get("enabled", True)
                ))
            if _imgsz <= 0:
                if device == "cpu":
                    # CPU: scale down with camera count to keep >=5 fps/cam
                    _imgsz = 1280 if _ncams <= 2 else (960 if _ncams <= 4 else 640)
                else:
                    # GPU: compute is cheap; the constraint is VRAM headroom
                    # for concurrent per-camera activations. 960 keeps small/
                    # distant people detectable at 18 cams within ~12 GB.
                    _imgsz = 1280 if _ncams <= 4 else 960

            # No lock needed — each camera has its own model instance so
            # ByteTrack state is fully isolated and concurrent calls are safe.
            results = model.track(
                source=frame,
                persist=True,
                conf=conf,
                classes=[0],
                imgsz=_imgsz,
                device=device,
                half=use_half,
                tracker=bt_yaml,
                verbose=False,
            )
            people = tracker.update(results[0], cam_key=cam_id) if results else []
            states: dict = {}   # keyed by state_key — draw_overlay/draw_hud expect dict
            polys  = zm.get_polygons(cam_id)
            meta   = zm.get_meta(cam_id)

            # ── Behaviour inference ───────────────────────────────────────
            # frame_w/frame_h are passed into infer() so zone polygons
            # (authored at 960×540) are scaled to native frame coordinates
            # before the point-in-polygon test.
            for person in people:
                st = engine.infer(person, cam_id, frame_w=fw, frame_h=fh)
                states[person["state_key"]] = st   # dict so draw_overlay.get() works
                zone_display = meta.get(st.zone, {}).get("name", st.zone)
                logger.log(st, cam_id, zone_display)
                if check_alert(st, cam_id):
                    import datetime as _dt
                    with alerts_lock:
                        alerts.append({
                            "time":        _dt.datetime.now().strftime("%H:%M:%S"),
                            "person":      str(st.person_id),
                            "zone":        zone_display,
                            "behavior":    st.behavior_name or st.behavior_id or "",
                            "behavior_id": st.behavior_id or "",
                        })
                        del alerts[:-MAX_ALERTS]
                # Debug: log zone + behavior every 30 frames so you can verify detection
                if frame_no % 30 == 0:
                    cx, cy = person["center"]
                    log.debug("[Cam:%s] id=%s center=(%d,%d) zone=%s cat=%s beh=%s dwell=%.1fs",
                              cam_id, person["id"], cx, cy, st.zone, st.zone_cat,
                              st.behavior_id, (time.monotonic() - st.dwell_start))

            # ── Periodic cleanup + live config reload ────────────────────
            if frame_no % CLEANUP_EVERY == 0:
                active = {p["state_key"] for p in people}
                tracker.cleanup(active)
                engine.cleanup_stale(active)
                from src.utils.alert import clear_stale_alerts
                clear_stale_alerts()
                # Reload behaviors and zones so UI changes take effect without restart
                engine.reload_behaviors()
                zm = ZoneManager(ZONES_CONFIG)
                aw, ah = zm.get_author_size()

            # ── Per-zone headcount ────────────────────────────────────────
            zone_counts = Counter(
                s.zone for s in states.values()
                if not s.is_staff and s.zone != "floor"
            )

            # ── Annotate display frame ────────────────────────────────────
            annotated = draw_overlay(frame.copy(), people, states, polys, meta, anon,
                                     author_w=aw, author_h=ah)
            annotated = draw_hud(annotated, cam_id, states)

            # ── Publish results ───────────────────────────────────────────
            with _cams_lock:
                _cam_frames[cam_id] = annotated
                _cam_huds[cam_id]   = {
                    "cust":   sum(1 for s in states.values() if not s.is_staff),
                    "seller": sum(1 for s in states.values() if s.is_staff),
                    "alert":  sum(1 for s in states.values() if s.needs_staff),
                    "zones":  dict(zone_counts),
                }
            _last_frame[0] = annotated

            # ── Heatmap update (pass person dicts, not PersonState) ───────
            heat_eng.update(people)
            heat_eng_cum.update(people)

        except Exception as e:
            log.error("[Cam:%s] inference error: %s", cam_id, e)
            with _cams_lock:
                # Never publish the raw frame — blur it so faces aren't shown
                _cam_frames[cam_id] = cv2.GaussianBlur(frame, (99, 99), 0)

    # Signal the grab thread and wait for it to finish.
    # Timeout = READ_TIMEOUT_MSEC (3 s) + 2 s buffer so cap.release() is
    # never called while grab is still inside cap.read().
    _grab_stop.set()
    grab_thread.join(timeout=5.0)
    if grab_thread.is_alive():
        log.warning("[Cam:%s] Grab thread still alive after 5 s — forcing cap release", cam_id)
    if cap is not None:
        cap.release()
    cap = None   # prevent any stale reference from reusing the handle
    logger.close()
    set_status(False, "Stopped")
    log.info("[Cam:%s] Stopped", cam_id)

# ── Entry point ───────────────────────────────────────────────────────────────
# Port is configurable so it can avoid conflicts (e.g. macOS AirPlay Receiver
# occupies :5000). Default stays 5000 for Windows/Docker.
PORT = int(os.environ.get("FLOWSIGHT_PORT", os.environ.get("PORT", "5000")))

OCC_SAMPLE_SEC = 15   # true-occupancy snapshot cadence (5,760 rows / 24 h)

def _occupancy_sampler_loop():
    """Record true concurrent occupancy every OCC_SAMPLE_SEC while running.

    One row per sample: total people now + per-zone + per-camera breakdown.
    This is the ground truth for /api/occupancy peak & average — unlike the
    legacy events-based approximation it cannot be inflated by visitor churn
    or track-ID fragmentation.
    """
    import time as _t
    while True:
        _t.sleep(OCC_SAMPLE_SEC)
        try:
            with _state_lock:
                running = state.get("running", False)
            if not running:
                continue
            with _cams_lock:
                huds = {cid: dict(h) for cid, h in _cam_huds.items()}
            if not huds:
                continue
            total = sum(h.get("cust", 0) for h in huds.values())
            from collections import Counter
            zones: Counter = Counter()
            for h in huds.values():
                zones.update(h.get("zones", {}))
            cams = {cid: h.get("cust", 0) for cid, h in huds.items()}
            conn = get_conn()
            conn.execute(
                "INSERT INTO occupancy_snapshots (timestamp,total,zones,cams) "
                "VALUES (?,?,?,?)",
                (time.time(), total, json.dumps(dict(zones)), json.dumps(cams)))
            conn.commit()
            conn.close()
        except Exception as e:
            log.error("[OccSampler] %s", e)


# ── Backup & durability ───────────────────────────────────────────────────────
BACKUP_INTERVAL_SEC = 3600   # rolling backup cadence (hourly)
BACKUP_KEEP_HOURLY  = 48     # ~2 days of hourly snapshots
BACKUP_KEEP_DAILY   = 7      # 1 week of daily snapshots


def _backup_dir() -> str:
    d = os.path.join(os.path.dirname(DB_PATH), "backups")
    os.makedirs(d, exist_ok=True)
    return d


def _backup_db(dst_path: str) -> bool:
    """Write a consistent snapshot of the live DB to dst_path.

    Uses the SQLite online-backup API (safe to run while the app is writing),
    folds the WAL in first so the snapshot is complete, and publishes via an
    atomic rename — a power loss mid-backup can never leave a half-written file
    (the previous good backup stays in place).
    """
    if not os.path.exists(DB_PATH):
        return False
    tmp = dst_path + ".tmp"
    src = dst = None
    try:
        src = sqlite3.connect(DB_PATH, timeout=30)
        # Make the main DB file self-contained before snapshotting.
        src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        dst = sqlite3.connect(tmp)
        src.backup(dst)
        dst.close(); dst = None
        src.close(); src = None
        os.replace(tmp, dst_path)   # atomic publish
        return True
    except Exception as e:
        log.error("[Backup] failed %s: %s", dst_path, e)
        for c in (src, dst):
            try:
                if c is not None: c.close()
            except Exception:
                pass
        try:
            if os.path.exists(tmp): os.remove(tmp)
        except Exception:
            pass
        return False


def _prune_backups(prefix: str, keep: int):
    d = _backup_dir()
    files = sorted(f for f in os.listdir(d)
                   if f.startswith(prefix) and f.endswith(".db"))
    for old in files[:-keep] if keep > 0 else files:
        try:
            os.remove(os.path.join(d, old))
        except Exception:
            pass


def _backup_loop():
    """Rolling hourly snapshot so the most data ever lost to a corrupt/lost DB
    file is ~1 hour. Takes one immediately on startup, then every hour."""
    import datetime as _dt, time as _t
    while True:
        try:
            stamp = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(_backup_dir(), f"auto_{stamp}.db")
            if _backup_db(path):
                _prune_backups("auto_", BACKUP_KEEP_HOURLY)
                log.info("[Backup] hourly snapshot %s", path)
        except Exception as e:
            log.error("[Backup] loop error: %s", e)
        _t.sleep(BACKUP_INTERVAL_SEC)


def _maintenance_loop():
    """Daily: PDPA cleanup + a dated daily backup. Runs at startup, then 00:05."""
    import datetime as _dt, time as _t
    from src.utils.data_manager import DataManager
    dm = DataManager()
    while True:
        try:
            dm.run_daily_cleanup()
            dpath = os.path.join(_backup_dir(),
                                 f"daily_{_dt.date.today().isoformat()}.db")
            if not os.path.exists(dpath) and _backup_db(dpath):
                _prune_backups("daily_", BACKUP_KEEP_DAILY)
                log.info("[Backup] daily snapshot %s", dpath)
        except Exception as _e:
            log.error("[Maintenance] %s", _e)
        _now = _dt.datetime.now()
        _next = (_now + _dt.timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        _t.sleep((_next - _now).total_seconds())


_shutdown_done = threading.Event()


def _graceful_shutdown(*_a):
    """Flush all in-flight data and fold the WAL into the DB before exit, so a
    clean reboot / service stop / Ctrl-C loses nothing. Idempotent."""
    if _shutdown_done.is_set():
        return
    _shutdown_done.set()
    log.info("[Shutdown] stopping cameras + flushing DB")
    try:
        stop_evt.set()
        with _cams_lock:
            stops   = list(_cam_stops.values())
            threads = list(_cam_threads.values())
        for e in stops:
            e.set()
        for t in threads:                 # each camera's finally calls logger.close()
            t.join(timeout=8.0)            # → final buffer drain to disk
    except Exception as e:
        log.error("[Shutdown] camera stop error: %s", e)
    try:
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.close()
        log.info("[Shutdown] WAL checkpoint complete")
    except Exception as e:
        log.error("[Shutdown] checkpoint error: %s", e)


if __name__ == "__main__":
    import signal, atexit

    brand = load_brand()
    print(f"\n{'='*52}")
    print(f"  {brand['name']} — {brand.get('tagline', '')}")
    print(f"  http://localhost:{PORT}")
    print(f"{'='*52}\n")

    # Fold any WAL left by a previous unclean exit back into the main DB file.
    try:
        _c = sqlite3.connect(DB_PATH, timeout=15)
        _c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        _c.close()
    except Exception as _e:
        log.warning("[Startup] WAL checkpoint skipped: %s", _e)

    # Flush + checkpoint on reboot / service stop / Ctrl-C.
    atexit.register(_graceful_shutdown)
    for _sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(_sig, lambda *a: (_graceful_shutdown(), sys.exit(0)))
        except Exception:
            pass

    threading.Thread(target=_maintenance_loop, daemon=True, name="maintenance").start()
    threading.Thread(target=_backup_loop,       daemon=True, name="backup").start()
    threading.Thread(target=_occupancy_sampler_loop, daemon=True, name="occ_sampler").start()

    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
