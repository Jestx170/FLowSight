# FlowSight — เอกสารส่งมอบงาน (Developer Handover)

> สำหรับ **Developer คนใหม่** ที่ต้องรับช่วงงานต่อ — อ่านเอกสารนี้แล้วต้องสามารถ
> setup เครื่อง, รันระบบ, build, แก้บั๊ก และพัฒนาต่อได้ **โดยไม่ต้องพึ่ง dev เดิม**
>
> เอกสารนี้เน้น "ลงมือทำ" (setup / build / แก้ปัญหา / checklist)
> ส่วน **สถาปัตยกรรมเชิงลึก** (pipeline AI, ฐานข้อมูล, รายไฟล์ทำอะไร) อ่านที่ [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)
>
> อัปเดต: 2026-06-15

---

## สารบัญ

1. [ระบบนี้คืออะไร (สรุป 1 นาที)](#1-ระบบนี้คืออะไร-สรุป-1-นาที)
2. [แผนที่โปรเจกต์ — แก้ตรงไหน](#2-แผนที่โปรเจกต์--แก้ตรงไหน)
3. [สิ่งที่ต้องมีก่อน (Prerequisites)](#3-สิ่งที่ต้องมีก่อน-prerequisites)
4. [Setup & รัน (Development)](#4-setup--รัน-development)
5. [Build & Deploy](#5-build--deploy)
6. [Workflow การพัฒนาต่อ](#6-workflow-การพัฒนาต่อ)
7. [Troubleshooting — ปัญหาที่เจอบ่อย](#7-troubleshooting--ปัญหาที่เจอบ่อย)
8. [ของที่ต้องรู้ / กับดัก (Gotchas)](#8-ของที่ต้องรู้--กับดัก-gotchas)
9. [Checklist การรับมอบงาน](#9-checklist-การรับมอบงาน)
10. [แผนที่เอกสารทั้งหมด](#10-แผนที่เอกสารทั้งหมด)

---

## 1. ระบบนี้คืออะไร (สรุป 1 นาที)

**FlowSight** = ซอฟต์แวร์วิเคราะห์พฤติกรรมลูกค้าด้วย AI แบบเรียลไทม์ (Retail Intelligence) ติดตั้งบนเครื่องลูกค้าเอง (on-premise)

- รับภาพจากกล้อง IP (RTSP) → **YOLOv8** ตรวจจับคน → **ByteTrack** ติดตาม → แปลงเป็น "พฤติกรรม" (เดินดูของ / สนใจสินค้า / รอนาน / loitering ฯลฯ)
- บันทึกลง **SQLite** แล้วแสดงผลผ่าน **เว็บแดชบอร์ด** (กราฟ, heatmap, รายงาน PDF, AI Insight)
- มี **เบลอใบหน้า** (PDPA) — ไม่เก็บภาพ ไม่เก็บข้อมูลชีวมิติ เก็บแค่ event พฤติกรรม
- รันบน **CPU ได้** และ **auto-detect NVIDIA GPU** (CUDA + FP16) เมื่อมี

**สถาปัตยกรรม 2 ส่วน:**

| ส่วน | เทคโนโลยี | รันยังไง |
|------|-----------|----------|
| **backend/** | Python 3.12 + Flask + Ultralytics (YOLO) + OpenCV | `python -m src.api.server` |
| **frontend/** | React 19 + Vite + TailwindCSS 4 + shadcn/ui | `npm run dev` (HMR) → build เป็น static เสิร์ฟผ่าน Flask |

> รายละเอียด pipeline, ฐานข้อมูล, REST API, ระบบพฤติกรรม → [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)

---

## 2. แผนที่โปรเจกต์ — แก้ตรงไหน

```
flowsight/
├─ backend/                       ★ ฝั่งเซิร์ฟเวอร์ (Python/Flask)
│  ├─ src/
│  │  ├─ api/server.py            ← หัวใจ: Flask + REST API ~40 endpoint + loop ต่อกล้อง  (entry หลัก)
│  │  ├─ api/app.py               ← entry ของ desktop app (เปิด server + เด้ง browser)
│  │  ├─ engine/                  ← AI: tracker.py, zones.py, behavior_engine.py
│  │  ├─ utils/                   ← dashboard, heatmap, report_pdf, ai_insight, alert, logger, ...
│  │  └─ paths.py                 ← จุดรวม path ทั้งหมด (PROJECT_ROOT = backend/)
│  ├─ templates/index_vue.html    ← React build (HTML) — เสิร์ฟที่ `/`
│  ├─ static/assets/              ← React build output (JS/CSS) + ไอคอน
│  ├─ config/*.json               ← zones / behaviors / brand (แก้ผ่าน UI ได้)
│  └─ data/                       ← yolov8n.pt (โมเดล) + behavior_log.db
│
├─ frontend/                      ★ React SPA (ธีม Odoo ม่วง #714B67)
│  ├─ src/pages/*.tsx             ← หน้า Live / Dashboard / Zones / Behaviors / Heatmap / Settings
│  ├─ src/api.ts                  ← เรียก REST API ทั้งหมด (relative /api)
│  ├─ src/i18n.ts                 ← ข้อความ 2 ภาษา (TH/EN)
│  ├─ src/styles.css              ← theme tokens
│  └─ vite.config.ts             ← base /static/ (prod) + dev proxy /api → :5001
│
├─ Dockerfile                     ← multi-stage: build React → ฝังใน Python image
├─ docker-compose.yml             ← รันปกติ (CPU)
├─ docker-compose.gpu.yml         ← override สำหรับ NVIDIA GPU
├─ requirements.txt               ← Python deps (native)
├─ requirements-docker.txt        ← Python deps (ใน container)
└─ scripts/                       ← run-native.sh, setup-venv.sh, main.py, build_installer.bat, ...
```

**สรุปแก้ตรงไหน:**

| งาน | แก้ที่ | เห็นผลโดย |
|---|---|---|
| Logic / endpoint ฝั่งเซิร์ฟเวอร์ | `backend/src/api/server.py` | restart backend |
| AI / การตรวจจับพฤติกรรม | `backend/src/engine/` | restart backend |
| หน้าเว็บ (React) | `frontend/src/pages/*.tsx` | HMR อัตโนมัติ (`npm run dev`) |
| สี / ธีม | `frontend/src/styles.css` | HMR |
| ข้อความ 2 ภาษา | `frontend/src/i18n.ts` | HMR |

---

## 3. สิ่งที่ต้องมีก่อน (Prerequisites)

| เครื่องมือ | เวอร์ชัน | ใช้ทำอะไร |
|-----------|---------|-----------|
| **Python** | 3.12 (Docker ใช้ 3.12, native ใช้ 3.10+ ได้) | backend |
| **Node.js** | 20+ | build/dev frontend (Docker ใช้ node:20) |
| **Docker Desktop** | ล่าสุด | รันแบบ container (ทางเลือก / production) |
| **git** | ล่าสุด | version control |
| (Windows GPU) **NVIDIA driver** | ล่าสุด | CUDA inference — ไม่ต้องลง CUDA toolkit (มากับ torch wheel) |
| (Windows installer) **Inno Setup** | ล่าสุด | สร้าง `.exe` installer |

> ⚠️ **macOS + external drive:** โปรเจกต์นี้วางอยู่บนไดรฟ์ภายนอก exFAT/NTFS ได้ **แต่ Python venv ห้ามอยู่บน exFAT/NTFS** — macOS เขียนไฟล์ sidecar `._*` (AppleDouble) ทำให้ pip/importlib อ่าน package metadata พัง (`UnicodeDecodeError`) — `setup-venv.sh` จึงวาง venv ไว้บนดิสก์ภายใน (APFS) ที่ `~/.venvs/flowsight`

---

## 4. Setup & รัน (Development)

มี 3 วิธี เลือกตาม OS / สถานการณ์:

### วิธี A — Native บน macOS / Linux (แนะนำสำหรับ dev บน Mac)

**ครั้งแรก (one-time):**
```bash
scripts/setup-venv.sh            # สร้าง venv ที่ ~/.venvs/flowsight (APFS) + ลง deps
```

**รัน backend:**
```bash
scripts/run-native.sh            # → http://localhost:5001
# override port:  FLOWSIGHT_PORT=8080 scripts/run-native.sh
```
> ใช้พอร์ต **5001** ไม่ใช่ 5000 เพราะ macOS AirPlay Receiver จองพอร์ต 5000

**รัน frontend (dev + HMR) — อีก terminal:**
```bash
cd frontend
npm install                      # ครั้งแรก
npm run dev                      # → http://localhost:8080  (proxy /api → :5001 ให้อัตโนมัติ)
```

เปิดเบราว์เซอร์ที่ **http://localhost:8080** เพื่อพัฒนา (โค้ด React อัปเดตสดด้วย HMR)

### วิธี B — Native บน Windows

```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd backend
python -m src.api.server          :: → http://localhost:5000
```
frontend dev เหมือนกัน (`cd frontend && npm install && npm run dev`) แต่ต้องชี้ proxy ไป :5000
(ปรับ target ใน [frontend/vite.config.ts](frontend/vite.config.ts#L23) ถ้าจำเป็น)

หรือใช้สคริปต์สำเร็จ: `scripts/run.bat` / `scripts/FlowSight.bat` (ใช้กับ Python ที่ฝังมากับ installer)

### วิธี C — Docker (เหมือน production)

```bash
cp .env.example .env             # ปรับ TZ_OFFSET, API keys ถ้าต้องการ
docker compose up --build        # → http://localhost:5001  (map จาก container :5000)
```

GPU (NVIDIA, เช่น Windows + RTX 3060):
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d
docker logs flowsight | grep CUDA     # Windows ใช้:  docker logs flowsight | findstr CUDA
# ต้องเห็น: "CUDA available: NVIDIA GeForce RTX 3060 (... GB)"
```

> Docker mount `backend/data` และ `backend/config` เป็น volume → โมเดล, DB, config ค้างอยู่นอก container

---

## 5. Build & Deploy

### 5.1 Build frontend → ฝังใน backend

ใน Docker ทำให้อัตโนมัติ (multi-stage build ใน [Dockerfile](Dockerfile)) แต่ถ้าจะ build เอง native:

```bash
cd frontend
npm run build                    # ได้ frontend/dist/
```
จากนั้น deploy ผลลัพธ์เข้า backend (Dockerfile ทำ 2 บรรทัดนี้ให้):
- `frontend/dist/assets/*`   → `backend/static/assets/`
- `frontend/dist/index.html` → `backend/templates/index_vue.html`

> Flask เสิร์ฟ `index_vue.html` ที่ `/` และ asset ที่ `/static/...`
> (vite `base` เป็น `/static/` ตอน production — ดู [vite.config.ts](frontend/vite.config.ts#L10))

### 5.2 Build Docker image

```bash
docker compose build             # หรือ:  bash scripts/docker-build.sh
```
Dockerfile เป็น multi-stage: (1) `node:20` build React → (2) `python:3.12-slim` runtime
เลือก torch CPU/GPU ด้วย build arg `TORCH_INDEX_URL` (default = CPU wheel)

### 5.3 Build Windows Installer (.exe)

ดูขั้นตอนเต็มใน [BUILD_GUIDE.md](BUILD_GUIDE.md) — สรุป:
1. ทดสอบก่อน: `python -m src.api.server`
2. `pip install pyinstaller pyarmor`
3. รัน `scripts/build_installer.bat` → ได้ `dist/FlowSight/FlowSight.exe`
4. เปิด `scripts/setup.iss` ด้วย Inno Setup → Compile → `installer_output/FlowSight_Setup_v1.0.exe`

> ⚠️ ระบบ License (`vendor_tools.py`) อ้างถึงโมดูล `license.py` ที่ **ไม่มีในโปรเจกต์** — ดูหัวข้อ [Gotchas](#8-ของที่ต้องรู้--กับดัก-gotchas)

---

## 6. Workflow การพัฒนาต่อ

1. **แตะ React UI** → แก้ `frontend/src/pages/*.tsx`, รัน `npm run dev`, ดูสดที่ :8080
2. **แตะ logic/endpoint** → แก้ `backend/src/`, restart `run-native.sh`
3. **เพิ่ม endpoint ใหม่** → เพิ่มใน `server.py` + เพิ่มตัวเรียกใน `frontend/src/api.ts`
4. **ปรับพฤติกรรมที่ตรวจจับ** → แก้ผ่าน UI (หน้า Behaviors) หรือ `backend/config/behaviors_config.json`
   logic การ match อยู่ใน `backend/src/engine/behavior_engine.py`
5. **อัปเกรดโมเดล** → วางไฟล์ `.pt` ใหม่แทน `backend/data/yolov8n.pt` (เช่น yolov8s/m เมื่อมี GPU headroom)

### เทสด้วยไฟล์วิดีโอ (แทนกล้องจริง)

ไม่ต้องมีกล้อง RTSP จริงก็เทสได้ — ช่อง **RTSP URL** ของกล้อง (หน้า Settings หรือ `brand_config.json`) รับ **path ไฟล์วิดีโอในเครื่อง** ได้ด้วย:

```jsonc
// backend/config/brand_config.json
{ "id": "cam_0", "name": "Test", "rtsp_url": "/path/to/test.mp4", "enabled": true }
// หรือใส่ผ่านหน้า Settings ของเว็บก็ได้ — ใช้ path เต็มจะชัวร์สุด (relative อิงจาก backend/)
// รองรับ prefix file:// ด้วย:  "file:///path/to/test.mp4"
```

พฤติกรรมเมื่อใส่ไฟล์วิดีโอ:
- ระบบตรวจว่าเป็นไฟล์ (มีอยู่จริง + ไม่ขึ้นต้นด้วย `rtsp://`/`http(s)://`/`rtmp://`) → เข้าโหมดไฟล์อัตโนมัติ
- **เล่นวน (loop)** ไม่รู้จบ เหมือนกล้องสด (จบไฟล์แล้วกรอกลับเฟรม 0)
- **เล่นตาม fps จริงของวิดีโอ** เพื่อให้พฤติกรรมที่อิงเวลา (สนใจ ≥ 20 วิ, loitering, รอนาน) trigger ได้สมจริงตามเวลานาฬิกา (ไม่ fast-forward)
- log จะขึ้น `Video file looping at NN.N fps`

> โค้ดอยู่ใน `camera_engine_loop` ([server.py](backend/src/api/server.py)) — ตัวแปร `is_file` + `_grab_loop` ส่วนที่ pace/loop

**ก่อน commit:**
```bash
cd frontend && npm run lint && npm run format    # ESLint + Prettier
```
> backend ยังไม่มี test suite / linter ตั้งค่าไว้ — ทดสอบด้วยการรันจริง (`python -m src.api.server` แล้วเช็คทุกหน้า)

**git:** branch หลักคือ `main`. commit เมื่อ feature เสร็จ; อย่า commit `backend/config/brand_config.json` (มี RTSP credential — ดู Gotchas)

---

## 7. Troubleshooting — ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|-------|------------------|
| **pip ลง deps แล้วพัง `UnicodeDecodeError`** บน Mac | venv อยู่บน exFAT/NTFS — ย้าย venv ไป APFS (`~/.venvs/`) ตามที่ `setup-venv.sh` ทำ |
| **พอร์ต 5000 ใช้ไม่ได้ / โดน AirPlay จับ** (Mac) | ใช้ 5001 (`run-native.sh` default) หรือปิด AirPlay Receiver ใน System Settings |
| **เปิด :8080 แล้ว API error / ภาพไม่ขึ้น** | backend ไม่ได้รัน หรือ proxy ชี้ผิดพอร์ต — เช็ค `run-native.sh` รันอยู่ + `vite.config.ts` proxy target ตรงพอร์ต backend |
| **กล้องขึ้น "Reconnecting (attempt N)" ตลอด** | RTSP URL / credential ผิด หรือกล้องเข้าไม่ถึง — เช็ค `brand_config.json`; ระบบ retry ไม่จำกัด (ตั้งใจ) |
| **stream ค้าง/freeze** | grab thread ตรวจ frame ค้าง >15 วิ แล้ว reconnect เอง — ถ้ายังค้าง เช็ค network/codec (ffmpeg) |
| **Docker: ภาพ/inference ช้า, กล้องหลุด** | container CPU/RAM ไม่พอ — เพิ่ม `cpus`/`mem_limit` ใน compose + Docker Desktop → Settings → Resources |
| **GPU ไม่ทำงานใน Docker** | host ต้องมี NVIDIA driver; Windows ต้องใช้ Docker Desktop + WSL2 backend; เช็ค `docker logs flowsight \| findstr CUDA` |
| **อยาก force device** | ตั้ง env `FLOWSIGHT_DEVICE=cpu` หรือ `=0` (GPU index) |
| **โซนที่วาดเพี้ยน/ตำแหน่งคนผิดโซน** | โซนวาดที่ 960×540 แล้ว scale ไป resolution กล้องจริง — ต้องส่ง frame size เข้า `get_zone_and_cat()` (มี warning เตือนถ้าลืม) |
| **DB schema เก่า / คอลัมน์ขาด** | รัน `python scripts/db_migrate.py` |
| **React build แล้วหน้าเว็บ asset 404** | vite `base` ต้องเป็น `/static/` ตอน production; เช็คว่า deploy `dist/assets` → `backend/static/assets` ครบ |

**ดู log:** native → console ที่รัน `run-native.sh` + ไฟล์ `flowsight.log` ใน DATA_DIR; Docker → `docker logs flowsight`

---

## 8. ของที่ต้องรู้ / กับดัก (Gotchas)

อ่านก่อนแก้ของเหล่านี้ — เคยทำคนพลาดมาแล้ว:

1. 🔑 **`backend/config/brand_config.json` มี RTSP URL + username/password ของกล้องจริง** — เป็นความลับ **อย่า push ขึ้น repo สาธารณะ** ใช้ `*.example.json` แทนเวลาแชร์
2. ⚠️ **ระบบ License ไม่สมบูรณ์** — `scripts/vendor_tools.py` import จาก `license.py` (`get_hwid`, `generate_license`, ...) แต่ **ไม่มีไฟล์นี้** ในโปรเจกต์ น่าจะถูกถอด/เก็บที่อื่น ถ้าต้องใช้ต้องสร้าง/ขอจาก dev เดิม
3. ⚠️ **ตัวเลขประสิทธิภาพ GPU ยังไม่ได้วัดจริง** — เครื่องที่ audit ไม่มี NVIDIA ต้อง stress test ซ้ำบนเครื่อง deploy จริง (Windows + RTX 3060)
4. **อย่าแชร์ YOLO model เดียวข้าม thread** — แต่ละกล้องต้องมี model + ByteTrack state ของตัวเอง (แชร์กันทำ track state พังบน CPU)
5. **อย่าเปลี่ยน Docker เป็น multi-worker WSGI** — state ของ multi-camera อยู่ใน process memory ตัวเดียว (threaded, single process เท่านั้น)
6. **Config writable redirect:** ถ้าติดตั้งใน Program Files หรือเป็น PyInstaller bundle → DB/config ไปอยู่ `C:\ProgramData\FlowSight` (ดู [paths.py](backend/src/paths.py)) อย่าไปหาใน install dir
7. **ซากไฟล์ legacy:** `backend/static/js|css/` (app.js, translations.js, style.css) เป็น UI เก่าที่ไม่ได้ใช้แล้ว (cutover เป็น React เสร็จ มิ.ย. 2026) — ลบได้เมื่อมั่นใจ
8. **`scripts/main.py` (โหมด OpenCV) ตามหลังเวอร์ชันเว็บ** — โหมด `--parallel` เรียก function ด้วย argument ไม่ตรง signature ปัจจุบัน อย่าใช้เป็น reference ของ pipeline จริง (ใช้ `server.py`)
9. **DB retention 30 วัน** — `data_manager.py` ลบ event/occupancy เกิน 30 วันอัตโนมัติ (PDPA) อย่าตกใจถ้าข้อมูลเก่าหาย

---

## 9. Checklist การรับมอบงาน

### A. เข้าถึง & เครื่องมือ
- [ ] ได้สิทธิ์ git repo + เช็ค `git log` / branch `main` แล้ว
- [ ] ติดตั้ง Python 3.12, Node 20+, Docker Desktop, git ครบ
- [ ] (ถ้า deploy Windows GPU) มี NVIDIA driver + Docker Desktop WSL2 / Inno Setup

### B. รันให้ขึ้นได้เอง
- [ ] `scripts/setup-venv.sh` สำเร็จ (Mac) / สร้าง venv + `pip install -r requirements.txt` สำเร็จ
- [ ] `scripts/run-native.sh` ขึ้น backend ที่ :5001 ได้
- [ ] `cd frontend && npm install && npm run dev` ขึ้น :8080 และเห็นหน้าเว็บ
- [ ] `docker compose up --build` ขึ้นได้ที่ :5001
- [ ] เปิดดูได้ครบทุกหน้า: Live / Dashboard / Zones / Behaviors / Heatmap / Settings

### C. เข้าใจระบบ
- [ ] อ่าน [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) เข้าใจ pipeline (YOLO → ByteTrack → Zone → Behavior → DB → UI)
- [ ] เข้าใจระบบพฤติกรรม (`behaviors_config.json` + `behavior_engine.py`)
- [ ] เข้าใจ schema ฐานข้อมูล (`events` + `occupancy_snapshots`)
- [ ] เข้าใจ REST API หลัก (`server.py` + `frontend/src/api.ts`)
- [ ] รู้ flow build: React `npm run build` → ฝังเข้า `backend/templates` + `static/assets`

### D. ความลับ & สภาพแวดล้อม
- [ ] ได้รับ `brand_config.json` จริง (RTSP credential กล้อง) จาก dev เดิม — เก็บนอก repo
- [ ] ได้ค่า `.env` จริง (TZ_OFFSET, GEMINI_API_KEY / ANTHROPIC_API_KEY ถ้ามี)
- [ ] รู้สถานะระบบ License (มี `license.py` ที่ไหน? ใครถือ?)
- [ ] รู้ข้อมูลเครื่อง deploy production จริง (spec, OS, GPU, ที่ตั้ง, การเข้าถึง)

### E. ทดสอบจริง (ก่อนรับเต็มตัว)
- [ ] ต่อกล้อง RTSP จริง 1 ตัว แล้วเห็น stream + การตรวจจับคน
- [ ] วาดโซน + ตั้งพฤติกรรม → เห็น event บันทึกลง DB
- [ ] Export รายงาน PDF ได้
- [ ] (ถ้ามี GPU) ยืนยัน CUDA ทำงาน (`docker logs ... | findstr CUDA`) + วัด throughput จริง
- [ ] แก้โค้ด React 1 จุด เห็น HMR อัปเดต + แก้ endpoint 1 จุด เห็นผลหลัง restart

### F. งานค้าง / ความเสี่ยงที่รับช่วงต่อ
- [ ] GPU performance ยังไม่ได้ benchmark จริง (ข้อ 3 ใน Gotchas)
- [ ] ระบบ License ไม่ครบไฟล์ (ข้อ 2 ใน Gotchas)
- [ ] ซากไฟล์ legacy UI ยังค้างใน `backend/static/js|css`
- [ ] backend ยังไม่มี automated test — พิจารณาเพิ่ม

---

## 10. แผนที่เอกสารทั้งหมด

| เอกสาร | เนื้อหา |
|--------|---------|
| **DEVELOPER_HANDOVER.md** (ไฟล์นี้) | setup / build / troubleshoot / checklist สำหรับ dev ใหม่ |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | สถาปัตยกรรมเชิงลึก, รายไฟล์, pipeline, DB, REST API, ระบบพฤติกรรม |
| [BUILD_GUIDE.md](BUILD_GUIDE.md) | ขั้นตอน build .exe + Inno Setup + ระบบ License (ฝั่ง vendor) |
| [README.md](README.md) | เนื้อหาการตลาด / product pitch (TH) — ไม่ใช่เอกสารเทคนิค |
| [VUE_MIGRATION_PLAN.md](VUE_MIGRATION_PLAN.md) | ประวัติการย้าย UI มาเป็น React/SPA |
| [QA_FIX_REPORT.md](QA_FIX_REPORT.md) | บันทึก QA round 2026-06-11 + 7 จุดที่แก้ |
| [QA_AUDIT_REPORT_2026-06-12.md](QA_AUDIT_REPORT_2026-06-12.md) | ผล audit ล่าสุด |
| [plan.md](plan.md) | แผนงาน/บันทึกการพัฒนาเดิม |

---

*หากติดปัญหาที่เอกสารนี้ไม่ครอบคลุม: ไล่อ่าน source code เริ่มจาก [backend/src/api/server.py](backend/src/api/server.py) (entry หลัก) และ [frontend/src/App.tsx](frontend/src/App.tsx) (routing) — ทั้งสองไฟล์มี comment อธิบายละเอียด*
