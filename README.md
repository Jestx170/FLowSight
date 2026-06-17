# FlowSight — Retail Intelligence Platform

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![YOLOv8](https://img.shields.io/badge/Ultralytics-YOLOv8-00CFFF)
![OpenCV](https://img.shields.io/badge/OpenCV-4.8+-5C3EE8?logo=opencv&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-Unspecified-lightgrey)

**FlowSight** is a self-hosted, privacy-aware retail analytics platform. It turns ordinary
RTSP/IP security cameras (or recorded video files) into actionable foot-traffic intelligence:
people detection and tracking, zone-based behavior classification, live occupancy, movement
heat maps, and daily PDF/AI reports — all served through a single Flask backend and a React
dashboard.

The computer-vision pipeline runs entirely on your own hardware (CPU by default, optional
NVIDIA GPU). No personally identifying data is stored — only anonymous track IDs, zones, and
behavior events — and data is auto-purged after a configurable retention window.

> ℹ️ The detection logic was originally prototyped for a wine/retail store (some inline
> comments and the `scripts/main.py` CLI still say "Wine AI"), but the engine is
> **generic retail** — zones and behaviors are fully configurable from the UI.

---

## Features

These features were verified against the source in this repository.

- 🎥 **Multi-camera support** — each camera runs in its own thread with an isolated YOLO/ByteTrack
  model instance (prevents cross-camera track-ID contamination). Cameras are added, named,
  enabled/disabled and started/stopped individually or all at once.
- 📡 **RTSP / IP camera ingestion** with automatic reconnection (retries every 5 s until reachable),
  TCP transport, and bounded read timeouts for clean shutdown.
- 📁 **Video-file playback mode** — point a "camera" at a local `.mp4` (optionally `file://`) to
  test dwell-time behaviors without a physical camera. Date can be parsed from the filename.
- 🧠 **Person detection & tracking** — Ultralytics YOLOv8 (`yolov8n.pt`, person class only) +
  ByteTrack for stable IDs across frames.
- 🚦 **Configurable zones** — draw polygon zones per camera (staff / product / checkout / seating /
  floor categories) in the UI; stored with authoring resolution and scaled to native pixels at runtime.
- 🏷️ **Configurable behaviors** — dwell/movement/presence rules per zone with thresholds, alert flags
  and colors (e.g. *Interested*, *Loitering*, *Checkout Ready*, *Waiting Too Long*, *Staff*).
  Zone-change hysteresis and resolution-normalized velocity reduce false transitions.
- 🔴 **Live MJPEG streaming** with per-camera annotated overlays and an on-frame HUD.
- 🙈 **Privacy / anonymization** — optional blurring of detected people in the overlay.
- 📊 **Real-time dashboard** — visitor counts, interested/purchasing funnel, hourly behavior chart,
  top zones, and live + historical occupancy (true concurrent-occupancy snapshots).
- 🔥 **Movement heat maps** — accumulated density overlay, per-zone mass/density scoring, and
  saved timestamped JSON heat-map reports.
- 🚨 **Staff-needed alerts** — behaviors flagged as alerting raise dashboard alerts.
- 📄 **PDF report export** (ReportLab) per day.
- 🤖 **AI Insight** — natural-language daily summary via Google Gemini → Claude → offline
  rule-based fallback (works with no API key).
- 🗄️ **Embedded SQLite storage** (WAL, `synchronous=FULL`) with hourly + daily rolling backups,
  graceful WAL checkpointing on shutdown, and crash recovery on startup.
- 🛡️ **PDPA-friendly data lifecycle** — no personal identifiers stored; events & occupancy
  snapshots auto-deleted after 30 days (configurable).
- 🐳 **Docker & Docker Compose** deployment (CPU image by default, NVIDIA GPU via override file).
- 🪟 **Windows native installer** assets (embedded Python + Inno Setup script) under `scripts/installer/`.

---

## Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Language** | Python 3.12, TypeScript |
| **Backend / API** | Flask 3.x (threaded, single process) |
| **Computer Vision** | Ultralytics YOLOv8, ByteTrack, OpenCV (`opencv-python` / `-headless` in Docker), NumPy, PyTorch (CPU or CUDA) |
| **Reporting** | ReportLab (PDF) |
| **AI Insight** | Google Gemini API, Anthropic Claude API, offline rule-based fallback |
| **Database** | SQLite (WAL mode) |
| **Frontend** | React 19, Vite 7, TypeScript, Tailwind CSS 4, Radix UI / shadcn-style components, Chart.js + react-chartjs-2, Recharts, lucide-react, sonner |
| **Build / Tooling** | Vite, ESLint, Prettier, Bun/npm |
| **Packaging** | Docker, Docker Compose, Inno Setup (Windows installer) |

---

## Architecture

FlowSight is a single Flask process that serves both the JSON API and the compiled React
single-page app, plus a set of background worker threads for the CV pipeline and maintenance.

```
                ┌─────────────────────── Flask process (server.py) ────────────────────────┐
 RTSP / video → │  Per-camera engine threads                                               │
   sources      │   ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐        │
                │   │  capture   │→ │ YOLOv8 +    │→ │ Zone /     │→ │ BehaviorLogger│──┐    │
                │   │ (OpenCV)   │  │ ByteTrack   │  │ Behavior   │  │  (SQLite)     │  │    │
                │   └────────────┘  └────────────┘  │ inference  │  └──────────────┘  │    │
                │                         │          └────────────┘                    │    │
                │                         ├─► HeatMapEngine (density)                  │    │
                │                         └─► overlay/HUD → MJPEG stream               ▼    │
                │   Background: hourly backup · daily maintenance/cleanup · occupancy sampler│
                │                                                                            │
                │  Flask routes  ── /api/* JSON ──┐                                          │
                │                 ── / (SPA) ─────┤◄──────── React dashboard (built to       │
                └─────────────────────────────────┘          templates/ + static/assets/) ──┘
                                                                          ▲
                                                              Browser (localhost:5000)
```

- **Frontend** — React SPA (hash-routed) built by Vite into `index.html` + `assets/`. In Docker
  the build is baked into `templates/index_vue.html` and `static/assets/`, and served at `/`.
- **Backend / API** — Flask app in [backend/src/api/server.py](backend/src/api/server.py) exposing
  `/api/*` endpoints and the MJPEG video streams.
- **Detection pipeline** — `camera_engine_loop` per camera: OpenCV capture → YOLOv8 person
  detection → ByteTrack IDs → `PersonTracker` → `BehaviorInferenceEngine` → `BehaviorLogger`.
- **Analytics pipeline** — SQL aggregation in [backend/src/utils/metrics_sql.py](backend/src/utils/metrics_sql.py)
  + occupancy snapshots, hourly series, zone activity, and AI insight.
- **Database** — SQLite at `data/behavior_log.db` (`events` + `occupancy_snapshots` tables).

The legacy desktop CLI ([scripts/main.py](scripts/main.py)) runs the same engine with OpenCV
windows (sequential or parallel) — useful for local testing with video files/webcams.

---

## Project Structure

```
flowsight/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── server.py          # Flask app, all /api routes, camera threads, backups
│   │   │   └── app.py
│   │   ├── engine/
│   │   │   ├── behavior_engine.py # zone + dwell/velocity behavior classification
│   │   │   ├── tracker.py         # PersonTracker (ByteTrack via ultralytics)
│   │   │   └── zones.py           # ZoneManager (polygon zones, scaling, hit-testing)
│   │   ├── utils/
│   │   │   ├── heatmap.py         # HeatMapEngine (density, zone scoring, reports)
│   │   │   ├── dashboard.py       # draw_overlay / draw_hud
│   │   │   ├── logger.py          # BehaviorLogger → SQLite
│   │   │   ├── alert.py           # staff-needed alerts
│   │   │   ├── data_manager.py    # PDPA retention / cleanup
│   │   │   ├── metrics_sql.py     # SQL fragments (visitor key, funnel sets)
│   │   │   ├── report_pdf.py      # ReportLab PDF builder
│   │   │   └── ai_insight.py      # Gemini / Claude / rule-based summary
│   │   └── paths.py               # central path resolution (CWD-independent)
│   ├── config/                    # bytetrack.yaml + *.example.json + writable *_config.json
│   ├── data/                      # yolov8n.pt (model), behavior_log.db, reports/, backups/
│   ├── static/                    # css/js/assets (icons + built SPA assets)
│   └── templates/                 # index_vue.html (built SPA), index.html
├── frontend/
│   └── src/
│       ├── pages/                 # Live, Dashboard, Zones, Behaviors, Heatmap, Reports, Settings
│       ├── components/ui/         # shadcn-style Radix UI components
│       ├── api.ts                 # fetch helpers + polling hooks
│       ├── router.tsx             # hash-based routing
│       └── App.tsx / main.tsx
├── scripts/
│   ├── main.py                    # desktop CLI (OpenCV windows)
│   ├── zone_setup.py              # interactive zone drawing
│   ├── db_migrate.py
│   ├── setup-venv.sh / run-native.sh
│   └── installer/                 # Windows embedded-Python + Inno Setup installer
├── Dockerfile
├── docker-compose.yml             # CPU deployment
├── docker-compose.gpu.yml         # NVIDIA GPU override
├── requirements.txt               # native deps
├── requirements-docker.txt        # container deps
└── .env.example
```

> Several Markdown design docs (`PROJECT_OVERVIEW.md`, `DEVELOPER_HANDOVER.md`, QA reports,
> `plan.md`, `VUE_MIGRATION_PLAN.md`) are also present and contain deeper internal notes.

---

## Installation

### Prerequisites

- **Python 3.12** (and `pip`)
- **Node.js 20+** (or **Bun**) to build the frontend
- **ffmpeg** for RTSP/H.264 decoding (bundled in the Docker image; install separately for native runs)
- *(Optional)* an NVIDIA GPU + driver for CUDA acceleration

### 1. Clone the repository

```bash
git clone <repository-url> flowsight
cd flowsight
```

### 2. Backend — Python environment

A helper script is provided for macOS (see note below about external drives):

```bash
./scripts/setup-venv.sh        # creates a venv on the internal/APFS disk
```

Or manually:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

> ⚠️ **macOS external drives:** the project can live on an exFAT/NTFS external drive, but the
> **virtualenv must live on an internal APFS disk** — macOS writes `._*` sidecar files on
> exFAT that break `pip`/package-metadata reads. See [scripts/setup-venv.sh](scripts/setup-venv.sh).

### 3. Frontend — build the SPA

```bash
cd frontend
npm install        # or: bun install
npm run build      # outputs dist/  →  copy index.html → backend/templates/index_vue.html
                   #                    copy assets/*   → backend/static/assets/
```

(The Docker build does this automatically; for native runs the Flask server serves whatever
build sits in `backend/templates/` + `backend/static/`.)

### 4. Model

The YOLOv8 nano model **ships in the repo** at `backend/data/yolov8n.pt` — no separate download
is required. To use a different/larger model, replace that file (the path is fixed in
[backend/src/paths.py](backend/src/paths.py)).

### 5. Configure environment variables

```bash
cp .env.example .env
# edit .env as needed (see Configuration)
```

---

## Configuration

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TZ_OFFSET` | `7` | Hours offset from UTC for daily stats/reports (Thailand = 7). |
| `CLOUD_MODE` | `0` | `1` disables the local camera engine (aggregator/cloud mode). |
| `GEMINI_API_KEY` | *(empty)* | Google Gemini key for AI Insight (tried first). |
| `ANTHROPIC_API_KEY` | *(empty)* | Anthropic Claude key for AI Insight (tried second). |
| `FLOWSIGHT_DEVICE` | *(auto)* | Force inference device: `cpu`, `0`, `1`… Overrides CUDA auto-detect. |
| `FLOWSIGHT_PORT` / `PORT` | `5000` | Port the Flask server binds. |
| `PUSH_SECRET` | *(empty)* | If set, required as `X-Push-Secret` header on `POST /api/push`. |
| `KMP_DUPLICATE_LIB_OK`, `OPENCV_LOG_LEVEL`, `OPENCV_FFMPEG_CAPTURE_OPTIONS` | preset | OpenCV/OpenMP runtime tuning (set automatically). |

### Configuration files (`backend/config/`)

The app seeds writable `*_config.json` from the shipped `*.example.json` on first run (so a
standard, non-admin user can save edits — on Windows these are redirected to
`%PROGRAMDATA%\FlowSight`).

| File | Description |
|------|-------------|
| `bytetrack.yaml` | ByteTrack tracker parameters (shipped, read-only). |
| `zones_config.json` | Per-camera polygon zones with `_meta` authoring resolution, category and color. |
| `behaviors_config.json` | Behavior rules (id, name, zone, action, threshold, alert, color). |
| `brand_config.json` | Brand name/tagline + saved camera list (RTSP URLs). |

Example camera entry (`brand_config.example.json`):

```json
{
  "name": "FlowSight",
  "tagline": "Retail Intelligence Platform",
  "cameras": [
    { "id": "cam_0", "name": "Camera 1", "rtsp_url": "rtsp://USER:PASS@CAMERA_IP/stream2", "enabled": true }
  ]
}
```

Example behavior rule:

```json
{ "id": "interested", "name": "Interested", "zone": "product", "action": "dwell", "threshold": 25, "alert": true, "color": "#f59e0b" }
```

---

## Running the Project

### Option A — Docker Compose (recommended)

CPU build:

```bash
cp .env.example .env          # optional
docker compose up --build
# host port 5001 maps to container 5000 — see note below
```

> **Note:** `docker-compose.yml` maps host **`5001` → container `5000`**. Open the URL that
> matches your mapping (the compose comment references `localhost:5000`; adjust if you change the port).

NVIDIA GPU build (requires host driver; on Windows use Docker Desktop + WSL2):

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Persistent volumes mount `backend/data` (model + DB + reports + backups) and `backend/config`
(editable configs) into the container.

### Option B — Local / native (Flask)

```bash
# from the repo root, with the venv active and frontend built into backend/
cd backend
python -m src.api.server
# → http://localhost:5000
```

A macOS helper is provided: `./scripts/run-native.sh`.

### Option C — Desktop CLI (OpenCV windows, no web UI)

```bash
python scripts/main.py video1.mp4 video2.mp4        # sequential
python scripts/main.py --parallel cam0.mp4 cam1.mp4 # parallel windows
python scripts/main.py 0                            # webcam
python scripts/main.py rtsp://...                   # IP camera
# Keys: SPACE=pause  ENTER=next  R=replay  Q=quit
```

### Option D — Windows installer

Prebuilt installer assets live in `scripts/installer/` (embedded Python + Inno Setup
`setup.iss`). See [scripts/installer/BUILD_INSTALLER.md](scripts/installer/BUILD_INSTALLER.md)
and [BUILD_GUIDE.md](BUILD_GUIDE.md).

---

## API Documentation

All endpoints are defined in [backend/src/api/server.py](backend/src/api/server.py). Base URL
is the server root (default `http://localhost:5000`). Responses are JSON unless noted.

### Streaming & frames

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stream` | MJPEG stream for default camera (`cam_0`). |
| GET | `/api/stream/<cam_id>` | MJPEG stream for a specific camera. |
| GET | `/api/jpeg` | Single latest JPEG frame (default camera). |
| GET | `/api/frame` · `/api/frame/<cam_id>` | Latest frame as base64 JSON (`{ok, image, width, height}`). |
| GET | `/api/heatmap/jpeg?cam=&alpha=` | Heat-map overlay JPEG for a camera. |

### Cameras & engine control

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/cameras` | — | List cameras with live running status. |
| POST | `/api/cameras/save` | `{cameras:[{id,name,rtsp_url,enabled}]}` | Save camera list (persisted to brand config). |
| POST | `/api/start` | — | Start all enabled cameras. Returns `{ok, started:[...]}`. |
| POST | `/api/stop` | — | Stop all cameras. |
| POST | `/api/start/<cam_id>` | — | Start one camera. |
| POST | `/api/stop/<cam_id>` | — | Stop one camera. |
| GET | `/api/hud` | — | Aggregate HUD: customers, staff, alerts, zones, per-cam, device. |

### Stats & analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | Today's totals: visitors, interested, purchasing, top zone. |
| GET | `/api/hourly` | Hourly behavior breakdown (Chart.js datasets). |
| GET | `/api/occupancy?date=` | Live + today's peak/avg/hourly occupancy series. |
| GET | `/api/zones_activity` | Top 10 zones by event count today. |
| GET | `/api/alerts` | Last 50 alerts. |
| GET | `/api/activity?page=&per_page=&date=&behavior=&zone=&alert=` | Paginated event log + filter lists. |
| GET | `/api/activity/summary?date=` | Day summary: totals, interested %, alerts, zones. |

### Zones

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/zones/load` | — | Load all zone polygons. |
| POST | `/api/zones/save` | zones JSON (with `_meta`) | Save zones. |
| POST | `/api/zones/delete` | `{zone_id, cam}` | Delete one zone. |
| POST | `/api/zones/clear` | `{cam}` | Clear all zones for a camera. |

### Behaviors

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/behaviors` | — | List behavior rules. |
| POST | `/api/behaviors/save` | `[{...rule}]` (array) | Save behavior rules. |
| POST | `/api/behaviors/reset` | — | Reset to defaults. |

### Brand & settings

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/api/brand` | — | Brand config (name, tagline, cameras). |
| POST | `/api/brand/save` | brand JSON | Save brand config. |
| GET | `/api/settings` | — | Runtime settings (API keys masked as `***`). |
| POST | `/api/settings` | partial settings | Update runtime settings. |

### Reports, insight & heat map

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/report/pdf?date=` | Download daily PDF report. |
| GET | `/api/report/html` | Removed — returns HTTP 410. |
| GET | `/api/insight?date=` | AI/rule-based daily insight (HTML). |
| POST | `/api/heatmap/reset` | Reset heat accumulation (`{cam}`). |
| GET | `/api/heatmap/zones?cam=` | Per-zone mass/density scores. |
| POST | `/api/heatmap/report` | Save current top-zone snapshot to disk (`{cam}`). |
| GET | `/api/heatmap/reports` | List saved heat-map reports. |
| GET | `/api/heatmap/reports/<name>` | Full content of one saved report (path-traversal guarded). |

### Demo & ingest

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/demo/upload` | Upload a JPG/PNG to use as a demo feed (multipart `image`). |
| POST | `/api/demo/clear` | Clear demo image (back to RTSP). |
| GET | `/api/demo/status` | Demo-mode status. |
| POST | `/api/push` | Ingest HUD/alerts from a remote node (requires `X-Push-Secret` if `PUSH_SECRET` set). |
| GET | `/` | Serves the React SPA. |

---

## Computer Vision Pipeline

Implemented across `backend/src/engine/` and `backend/src/utils/`.

1. **Model loading** — `YOLO(yolov8n.pt)`. CUDA is auto-detected once at startup and cached;
   set `FLOWSIGHT_DEVICE` to override. **Each camera thread creates its own model instance** so
   ByteTrack state never leaks between cameras.
2. **Detection** — `model.track(frame, classes=[0], conf=0.40, tracker=bytetrack.yaml, persist=True)`
   restricts to the *person* class. Confidence can auto-relax during busy daytime hours (CLI mode).
3. **Tracking** — ByteTrack (built into Ultralytics) assigns stable IDs; `PersonTracker` maintains
   per-ID history and periodic cleanup of stale tracks.
4. **Zone analytics** — `ZoneManager` hit-tests each person's foot point against polygon zones,
   scaling polygons from authoring resolution to native pixels. A 4-frame hysteresis prevents
   zone flicker from bbox jitter.
5. **Behavior inference** — `BehaviorInferenceEngine` matches each tracked person against the
   configured rules (dwell / moving / still / presence) using resolution-normalized velocity and
   per-zone dwell thresholds, emitting a behavior id/name and `needs_staff` flag.
6. **Counting & logging** — distinct-visitor and funnel counts (interested / purchasing) are
   computed in SQL; `BehaviorLogger` writes events to SQLite, heart-beating sustained behaviors.
7. **Occupancy** — a background sampler stores true concurrent-headcount snapshots
   (`occupancy_snapshots`) for accurate peak/average, falling back to a per-minute distinct-visitor
   approximation for older data.
8. **Heat map** — `HeatMapEngine` accumulates a decaying density buffer, renders a color overlay,
   ranks zones by mass and density, and exports timestamped JSON reports.
9. **Overlay/HUD** — `draw_overlay` / `draw_hud` annotate frames (with optional anonymization
   blur) before they're pushed to the MJPEG stream.

---

## Dashboard

The React SPA is hash-routed ([frontend/src/router.tsx](frontend/src/router.tsx)) with these pages:

- **Live** — real-time MJPEG video per camera with overlays, HUD counts and start/stop controls.
- **Dashboard** — visitor totals, interested/purchasing funnel, hourly behavior chart, top zones,
  live and historical occupancy.
- **Zones** — draw, edit and delete polygon zones per camera.
- **Behaviors** — create/edit behavior rules (thresholds, alerting, colors); reset to defaults.
- **Heatmap** — live density overlay, per-zone scores, and saved heat-map reports.
- **Reports** — day summary, paginated activity log with filters, PDF export and AI Insight.
- **Settings** — cameras (RTSP URLs), confidence, anonymization, dwell thresholds, brand and API keys.

---

## Performance

No formal benchmark numbers are published in the repository. The configured/observed operating
characteristics that **are** documented in code/config are:

- CPU-first design; CUDA/FP16 used automatically when an NVIDIA GPU is present.
- MJPEG stream capped at ~30 FPS; JPEG encode quality 70–80.
- `docker-compose.yml` provisions **6 CPUs / 4 GB RAM** as a guideline for **2 cameras**
  (~3 cores per camera; each YOLO model ~0.7–1 GB RAM).
- A SQL optimization replaced a per-row date function with indexed epoch-range queries, cutting a
  dashboard poll from **~4 s to sub-second** on one day of data (per inline comments).

Actual throughput depends heavily on resolution, camera count, and hardware — measure on your target machine.

---

## Dependencies

### Backend (`requirements.txt`)

| Package | Purpose |
|---------|---------|
| `flask` | Web server + JSON API + SPA hosting. |
| `ultralytics` | YOLOv8 detection + ByteTrack tracking. |
| `opencv-python` | Video capture, decoding, image ops, MJPEG encoding. |
| `numpy` | Array math for frames and heat maps. |
| `reportlab` | PDF report generation. |
| `torch` / `torchvision` | Inference backend (installed in Docker; CPU or CUDA flavor). |

*(Standard-library `sqlite3` provides the database; `requirements-docker.txt` pins the container set.)*

### Frontend (`frontend/package.json`)

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` (19) | UI framework. |
| `vite` (7) + `@vitejs/plugin-react` | Build/dev tooling. |
| `tailwindcss` (4) + `@tailwindcss/vite` | Styling. |
| `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge` | shadcn-style component primitives. |
| `chart.js` + `react-chartjs-2`, `recharts` | Charts. |
| `@tanstack/react-query` | Data fetching/caching. |
| `react-hook-form` + `zod` | Forms & validation. |
| `lucide-react`, `sonner`, `cmdk`, `date-fns` | Icons, toasts, command palette, dates. |

---

## Development

- **Run the SPA in dev mode:** `cd frontend && npm run dev` (Vite). Lint/format with
  `npm run lint` / `npm run format` (ESLint + Prettier configs are committed).
- **Backend dev:** run `python -m src.api.server` from `backend/`. All paths resolve relative to
  `PROJECT_ROOT` via [backend/src/paths.py](backend/src/paths.py), so the CWD doesn't matter.
- **Add an API endpoint:** add a route in [backend/src/api/server.py](backend/src/api/server.py)
  and a matching fetch helper in [frontend/src/api.ts](frontend/src/api.ts).
- **Add a behavior:** edit defaults in
  [backend/src/engine/behavior_engine.py](backend/src/engine/behavior_engine.py) or create rules
  via the UI / `POST /api/behaviors/save` (persisted to `behaviors_config.json`).
- **Add a zone category / behavior action:** extend `ZoneManager` and the `_match_behavior`
  logic in the engine.
- **DB migrations:** `events`/`occupancy_snapshots` tables are created and migrated idempotently
  in `ensure_db()`; see also [scripts/db_migrate.py](scripts/db_migrate.py).

**Conventions observed in the code:** module-level banner comments with version notes; central
path resolution (no hardcoded CWD paths); thread-safe shared state behind explicit locks;
per-camera model isolation; defensive `try/except` around all I/O routes returning
`{ok, msg}` JSON. Some inline comments are in Thai.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `Frontend build not found` on `/` | The SPA hasn't been built into `backend/templates/index_vue.html`. Run `npm run build` (or use Docker, which bakes it in). |
| Camera stuck on *"Reconnecting (attempt N)…"* | RTSP URL/credentials wrong or camera unreachable; the engine retries every 5 s automatically. Verify the URL and that `ffmpeg` is installed. |
| Camera shows *"connecting…"* placeholder forever | No frames yet for that camera — check the stream and that the camera is *enabled* and *started*. |
| `UnicodeDecodeError` from pip on macOS | Virtualenv is on an exFAT/NTFS external drive. Recreate it on an internal APFS disk (`scripts/setup-venv.sh`). |
| High CPU / dropped frames | Too many cameras per core. Raise `cpus`/`mem_limit` in compose and Docker Desktop resource limits, or use the GPU image. |
| AI Insight returns generic text | No/invalid `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` — the offline rule-based summary is used as fallback. |
| Can't open the UI on `:5000` | Compose maps host **5001**→container 5000. Use the mapped host port or change it in `docker-compose.yml`. |
| No detections | Confirm `backend/data/yolov8n.pt` exists and confidence isn't set too high in Settings. |

---

## Future Improvements

> These are **suggestions**, not existing features.

- Replace MJPEG polling with WebRTC/WebSocket streaming for lower latency and bandwidth.
- Add authentication / multi-user roles to the dashboard and API.
- Persist all runtime settings (confidence, dwell thresholds, API keys) to disk — several are
  currently in-memory only and reset on restart.
- Add automated tests (unit + integration) and CI; none are present in the repo.
- Support multi-worker/horizontally scaled deployment (currently single-process by design).
- Re-introduce CUDA in the default Docker image as an opt-in, plus model-size selection from the UI.
- Add export formats beyond PDF (CSV/Excel) and scheduled report delivery.
- Add a real license file and clarify usage terms.

---

## License

This repository currently does not specify a license. No `LICENSE` file was found, so all rights
are reserved by default. Add a license file to clarify permitted use.

---

## Authors

Detected from Git history:

- **Jestx170** — ploomjes1100@gmail.com
- **Keerati1709** — keeratipong.pae@gmail.com

---

*Generated from analysis of the repository source. If any detail looks out of date, regenerate
after pulling the latest changes.*
