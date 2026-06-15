# logger.py — FlowSight BehaviorLogger  v2.0
#
# v2.0 — write-load + latency fix (QA audit 2026-06):
#   v1.x logged EVERY tracked person on EVERY frame and flushed synchronously
#   inside the camera inference loop.  At the 18-camera target that is
#   ~200-470M rows/day (14-35 GB/day), and a locked DB stalled every camera
#   pipeline ~5 s per flush attempt.
#
#   v2.0 records a row only when the person's (zone, behavior) CHANGES, plus a
#   heartbeat row every HEARTBEAT_SEC while they stay put (so per-minute
#   occupancy/dwell queries still see everyone present).  ~98% fewer rows at
#   15 fps with identical schema, and all SQLite I/O happens on a background
#   writer thread — log() never blocks the inference loop, even when the DB
#   is locked.
import sqlite3, time, threading, logging
from src.engine.behavior_engine import PersonState
from src.paths import DB_PATH

log = logging.getLogger("flowsight.logger")

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     REAL    NOT NULL,
    cam_key       TEXT    NOT NULL DEFAULT 'cam_0',
    person_id     INTEGER NOT NULL,
    zone          TEXT    NOT NULL DEFAULT 'floor',
    zone_name     TEXT    NOT NULL DEFAULT '',
    behavior_id   TEXT    NOT NULL DEFAULT '',
    behavior_name TEXT    NOT NULL DEFAULT '',
    needs_staff   INTEGER NOT NULL DEFAULT 0,
    is_new_visit  INTEGER NOT NULL DEFAULT 1
)
"""
INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp)"


class BehaviorLogger:
    PERSON_COOLDOWN_SEC = 120   # gap that counts as a brand-new visit
    HEARTBEAT_SEC       = 5.0   # presence row while zone/behavior unchanged
    FLUSH_INTERVAL_SEC  = 1.0   # writer thread cadence
    MAX_BUFFER_ROWS     = 50_000  # hard cap if the DB stays unwritable

    def __init__(self, db_path: str = DB_PATH):
        self._db_path = db_path
        # Schema is created synchronously so the DB is ready before use;
        # all subsequent writes happen on the writer thread only.
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        # synchronous=FULL so a committed batch survives a power loss / hard
        # reset, not just an app/OS crash (WAL+NORMAL can roll back the last
        # commits on power loss).
        conn.execute("PRAGMA synchronous=FULL")
        conn.execute(CREATE_SQL)
        conn.execute(INDEX_SQL)
        conn.commit()
        conn.close()

        self._buf:  list = []
        self._buf_lock = threading.Lock()
        self._seen:     dict[str, float] = {}   # key -> ts of last recorded row
        self._last_rec: dict[str, tuple] = {}   # key -> (zone, behavior_id, ts)
        self._stop   = threading.Event()
        self._writer = threading.Thread(target=self._writer_loop, daemon=True,
                                        name="behavior_logger_writer")
        self._writer.start()
        log.info("[Logger] DB ready: %s", db_path)

    # ── Producer side (called from the camera inference loop) ────────────────

    def log(self, state: PersonState, cam_key: str = "cam_0",
            zone_name: str = "", video_ts: float | None = None):
        """Queue one observation. Non-blocking; rows are deduplicated so only
        state changes and HEARTBEAT_SEC presence ticks reach the database."""
        ts  = video_ts if video_ts is not None else time.time()
        key = f"{cam_key}_{state.person_id}"

        prev = self._last_rec.get(key)
        if prev is not None:
            p_zone, p_beh, p_ts = prev
            unchanged = (p_zone == state.zone and p_beh == state.behavior_id)
            if unchanged and (ts - p_ts) < self.HEARTBEAT_SEC:
                return   # nothing new to record
        self._last_rec[key] = (state.zone, state.behavior_id, ts)

        is_new = int(ts - self._seen.get(key, 0) > self.PERSON_COOLDOWN_SEC)
        self._seen[key] = ts
        row = (ts, cam_key, state.person_id,
               state.zone, zone_name or state.zone,
               state.behavior_id, state.behavior_name,
               int(state.needs_staff), is_new)
        with self._buf_lock:
            self._buf.append(row)
            if len(self._buf) > self.MAX_BUFFER_ROWS:
                dropped = len(self._buf) - self.MAX_BUFFER_ROWS
                del self._buf[:dropped]
                log.error("[Logger] buffer cap hit — dropped %d oldest rows "
                          "(DB unwritable?)", dropped)

    def _trim_state(self):
        """Drop per-person state older than 10 minutes to bound memory."""
        cutoff = time.time() - 600
        for d in (self._seen, self._last_rec):
            ts_of = (lambda v: v) if d is self._seen else (lambda v: v[2])
            stale = [k for k, v in d.items() if ts_of(v) < cutoff]
            for k in stale:
                del d[k]

    # ── Writer side (background thread owns the connection) ──────────────────

    def _writer_loop(self):
        conn = None
        while not self._stop.wait(self.FLUSH_INTERVAL_SEC):
            conn = self._flush(conn)
        self._flush(conn)            # final drain on close()
        if conn is not None:
            try: conn.close()
            except Exception: pass

    def _flush(self, conn):
        with self._buf_lock:
            if not self._buf:
                return conn
            rows = self._buf[:]
        try:
            if conn is None:
                conn = sqlite3.connect(self._db_path, timeout=5)
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute("PRAGMA synchronous=FULL")
            conn.executemany(
                "INSERT INTO events "
                "(timestamp,cam_key,person_id,zone,zone_name,"
                "behavior_id,behavior_name,needs_staff,is_new_visit) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                rows)
            conn.commit()
            with self._buf_lock:
                del self._buf[:len(rows)]
            self._trim_state()
        except Exception as e:
            log.error("DB flush error (%d rows buffered): %s", len(rows), e)
            try:
                if conn is not None: conn.close()
            except Exception:
                pass
            conn = None   # reconnect on next attempt
        return conn

    def close(self):
        self._stop.set()
        self._writer.join(timeout=10)
        if self._writer.is_alive():
            log.warning("[Logger] writer thread still alive after 10 s")
