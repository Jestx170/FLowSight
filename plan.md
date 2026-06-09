# FlowSight — Refactoring Plan

> เอกสารแผนการ refactor (ยังไม่ลงมือแก้ไข) — ไว้ตรวจทานก่อนอนุมัติ
> ขอบเขต: ทำให้ repo เป็นมาตรฐาน สะอาด ดูแลง่าย โดย **ไม่ทำให้โค้ดพัง**
>
> **กติกาการทำงาน:** ทำ Phase 1 → 2 → 3 แล้ว **หยุดรอ "continue"** ก่อนทำ Phase 4–5
> Phase 1/2 จะรายงานสิ่งที่ลบ/แก้ แล้วรอยืนยันก่อนเริ่มย้ายโฟลเดอร์ (Phase 3)

---

## 0. สถานะปัจจุบัน (ตรวจสอบจริงแล้ว)

- โครงสร้างแบน: ไฟล์ `.py` 17 ไฟล์กองในโฟลเดอร์ `flowsight/` เดียว
- repo มี binary ปนเข้ามา (track อยู่ทั้งที่ `.gitignore` ระบุให้ ignore):
  `behavior_log.db` (9.9MB), `yolov8n.pt` (6.2MB), `installer_output/*.exe` (41MB),
  `installer/VC_redist.x64.exe` (24MB), `installer/python_embedded/` (Python runtime ทั้งตัว)
- มี dead code 3 จุด: `engine_loop()`, `detector.py`, `report.py`
- `main.py` เรียก `draw_overlay`/`draw_hud` ด้วย signature เก่า + มีบั๊ก `NameError`
- `index.html` 1693 บรรทัด (HTML+CSS+JS รวมไฟล์เดียว)
- ไฟล์ `._*` (AppleDouble ของ macOS) เกลื่อน เกิดจากก็อปลงไดรฟ์ภายนอก

**Import graph ภายใน (local modules):**

| ไฟล์ | import โมดูลภายใน |
|------|-------------------|
| `alert.py` | `behavior_engine` |
| `logger.py` | `behavior_engine` |
| `behavior_engine.py` | `zones` |
| `dashboard.py` | `zones` |
| `zone_setup.py` | `zones` |
| `app.py` | `server` |
| `main.py` | `tracker, behavior_engine, dashboard, alert, logger, zones, data_manager` |
| `report.py` | `ai_insight` *(ไฟล์นี้จะถูกลบใน Phase 2)* |
| `report_pdf.py` | `ai_insight` |
| `server.py` | `behavior_engine, report_pdf, ai_insight, zones, tracker, logger, alert, dashboard, heatmap` |

---

## ⭐ ข้อกำหนดหลัก: รองรับหลายกล้องพร้อมกัน (Multi-camera) — ข้ามทุก Phase

ระบบ**รองรับหลายกล้องอยู่แล้ว** และทุก Phase ต้อง**รักษาความสามารถนี้ไว้ ห้ามทำพัง**

**สถาปัตยกรรม multi-cam ปัจจุบัน (ตรวจสอบจริงแล้ว):**
- `/api/start` วนลูป `for cam in cams` สร้าง `threading.Thread(target=camera_engine_loop, ...)` **หนึ่ง thread ต่อกล้อง** (server.py:353-366)
- แต่ละ thread สร้าง **YOLO model + ByteTrack + tracker + heatmap เป็นของตัวเอง** (กัน track-ID ปนข้ามกล้องบน CPU)
- state แยกตาม cam_id: `_cam_threads`, `_cam_frames`, `_cam_stops`, `_cam_status`, `_cam_huds`
- start/stop รายตัวได้ (`/api/start/<cam_id>`, `/api/stop/<cam_id>`) หรือทั้งหมด
- แบ่ง CPU อัตโนมัติ: `torch.set_num_threads(cpu_count // num_cams)` + auto `imgsz` (1280→960→640 ตามจำนวนกล้อง) เพื่อคง ≥5fps/กล้อง
- `brand_config.json` ปัจจุบันมี **2 กล้องจริง** (cam_0, cam_1) เป็นกรณีทดสอบได้เลย

**ผลต่อแต่ละ Phase:**
- **Phase 2:** ตัวที่ลบ (`engine_loop`) คือ engine **เก่าแบบกล้องเดียว hardcode `"cam_0"`** — ลบแล้ว multi-cam ยังครบ (ตัวจริงคือ `camera_engine_loop`)
- **Phase 3-4:** path/import ต้องไม่ทำลาย per-thread model loading — `paths.MODEL_PATH` ต้องโหลดได้จากทุก thread; `ZoneManager`/configs อ่าน thread-safe
- **Phase 6 (Docker):** ต้องจัดสรร **CPU/RAM ให้พอสำหรับหลาย model พร้อมกัน** (ดู 6.2 + 6.6)
- **ทดสอบทุก Phase:** ยืนยันสตาร์ท 2 กล้องพร้อมกันแล้วทั้งคู่มีภาพใน `/api/stream/<cam_id>` และ `/api/hud` รวมยอดถูก

---

## Phase 1 — Git & Repository Cleanup
**เป้าหมาย:** เลิก track binary/db/config ที่ไม่ควรอยู่ใน git โดย**ไม่ลบไฟล์จริงบนดิสก์**

1. **ลบไฟล์ขยะ macOS AppleDouble** (เป็น metadata ไม่เกี่ยวกับโค้ด):
   ```bash
   find . -name '._*' -delete
   ```
   รวม `._FLowSight`, `._.git`, `._flowsight`, `._README.md` ฯลฯ

2. **เขียน `.gitignore` ใหม่** ให้ ignore เข้มงวด:
   ```gitignore
   # Python
   __pycache__/
   *.pyc
   *.pyo
   .env

   # Logs
   *.log

   # Models & data (binary)
   *.pt
   data/
   behavior_log.db

   # Runtime-generated configs
   zones_config.json
   behaviors_config.json
   brand_config.json

   # Installers & embedded runtime (build artifacts)
   installer/VC_redist.x64.exe
   installer/python_embedded/
   installer_output/

   # macOS
   ._*
   .DS_Store
   ```

3. **ใช้ .gitignore กับไฟล์ที่ track ไปแล้ว** (เอาออกจาก index แต่คงไฟล์บนดิสก์):
   ```bash
   git rm -r --cached .
   git add .
   git status   # ตรวจว่า binary/db หายจาก staging แล้ว
   ```
   ผลลัพธ์ที่คาดหวัง: `behavior_log.db`, `yolov8n.pt`, `*.exe`, `python_embedded/`, `*.json` configs จะหลุดจาก git tracking; โค้ด `.py`, `.md`, `.bat`, `.yaml`, `index.html`, `translations.js`, `assets/` ยังคงอยู่

> ⚠️ **หมายเหตุสำคัญ:** ขั้นตอนนี้แค่เลิก track ที่ commit **ถัดไป** — ไฟล์ binary ยังอยู่ใน *git history เดิม* (repo ยังบวมเวลา clone) การล้าง history จริง (`git filter-repo`/BFG) เป็นงานที่ rewrite history + ต้อง force-push กระทบ remote — **ไม่รวมในแผนนี้** จะถามแยกถ้าต้องการ
>
> ⚠️ Phase 1 ข้อ 2 ตัดสินใจ ignore `zones_config.json/behaviors_config.json/brand_config.json` ตามที่สั่ง — แต่ `brand_config.json` ปัจจุบันเก็บ "รายการกล้อง + RTSP credentials" ที่ผู้ใช้แก้ผ่าน UI ถ้า ignore ทั้งก้อน ต้องมีไฟล์ template (`*.example.json`) เป็นค่าเริ่มต้นให้ seed (ดู Phase 4) — **จุดนี้อยากให้ยืนยัน**

---

## Phase 2 — Dead Code Elimination

| # | ไฟล์ | สิ่งที่ทำ | หลักฐานว่าปลอดภัย |
|---|------|----------|-------------------|
| 1 | `server.py` | ลบฟังก์ชัน `engine_loop()` **บรรทัด 1243–1497** (~255 บรรทัด) | ตัวจริงที่ใช้คือ `camera_engine_loop()` (บรรทัด 967); `engine_loop` ไม่ถูกเรียกที่ไหนเลย (มีแค่ string ใน log) |
| 2 | `detector.py` | **ลบทั้งไฟล์** (คลาส `PersonDetector`) | `grep` ทั้งโปรเจกต์ไม่มีใคร `import detector`/ใช้ `PersonDetector`; detection จริงเรียก `model.track()` ตรงๆ |
| 3 | `report.py` | **ลบทั้งไฟล์** | ไม่มีใคร `import report`; `/api/report/html` คืน 410 (removed); ตัวที่ใช้จริงคือ `report_pdf.py` |
| 4 | `main.py` | แก้ signature mismatch + บั๊ก (รายละเอียดด้านล่าง) | เทียบกับ signature ปัจจุบันใน `dashboard.py` |

**รายละเอียด Phase 2.4 — แก้ `main.py`:**

`dashboard.py` ปัจจุบันมี signature:
```python
def draw_overlay(frame, persons, states, zones_poly, zones_meta,
                 anonymize=False, author_w=960, author_h=540)
def draw_hud(frame, cam_key, states)
```

แต่ `main.py` เรียกแบบเก่า/ผิด:
- บรรทัด 143: `draw_overlay(display, persons, states, zones_poly, anonymize=anonymize)` → **ขาด `zones_meta`**
- บรรทัด 144: `draw_hud(display, cam_key, states, is_paused=paused)` → **ส่ง `is_paused` เกิน** (ไม่มีใน signature)
- บรรทัด 287 (parallel worker): `draw_overlay(..., anonymize=anonymize)` → **`anonymize` เป็น `NameError`** (ไม่ได้ถูกส่งเข้า `_worker`)
- บรรทัด 288: `draw_hud(display, self.cam_key, states)` → ถูกต้องอยู่แล้ว

**วิธีแก้:**
1. ให้ `main.py` ดึง `zones_meta` จาก `zone_manager.get_meta(cam_key)` แล้วส่งเข้า `draw_overlay`
   (และส่ง `author_w/author_h` จาก `zone_manager.get_author_size()` เพื่อให้ scale โซนถูกต้อง)
2. เอา `is_paused=paused` ออกจาก `draw_hud` (บรรทัด 144)
3. แก้ parallel mode (`CamWorker`): เพิ่มพารามิเตอร์ `anonymize` ส่งผ่าน constructor → `_worker` → `run_parallel`
   หรือถ้าจะให้ง่ายและตรงเจตนาเดิม: ตั้ง `anonymize=False` ในขอบเขต `_worker` (parallel mode เดิมไม่รองรับ flag นี้)
   → **เสนอ:** ส่ง `anonymize` ผ่านให้ครบทั้งสาย (รักษาความสามารถ) เพราะ `run_parallel` มี access ถึง flag อยู่แล้ว

> หมายเหตุ: `main.py` เป็นโหมด dev/OpenCV ไม่ใช่ path ของผลิตภัณฑ์เว็บ แต่แก้ให้ถูกเพราะอยู่ในขอบเขตที่สั่ง

---

## Phase 3 — Structural Refactoring (โครงสร้างใหม่)

> ทำ Phase 3 = ย้ายไฟล์ + สร้างโฟลเดอร์ + ใส่ `__init__.py` เท่านั้น
> **ยังไม่แก้ import** (แก้ใน Phase 4) — ระหว่าง Phase 3 โค้ดจะ import พังชั่วคราว ถือว่าปกติ

**โครงสร้างเป้าหมาย:**
```
flowsight/                      ← project root
├── .gitignore
├── README.md
├── plan.md
├── requirements.txt
├── pyproject.toml              ← (เสนอเพิ่ม) ตั้ง package root + tooling
│
├── src/
│   ├── __init__.py
│   ├── engine/                 ← Core AI & tracking
│   │   ├── __init__.py
│   │   ├── tracker.py
│   │   ├── behavior_engine.py
│   │   ├── zones.py
│   │   └── detector.py         ← *ถ้า Phase 2 ตัดสินใจเก็บ (ค่าเริ่มต้น: ลบ → ไฟล์นี้จะไม่มี)*
│   ├── api/                    ← Web & routing
│   │   ├── __init__.py
│   │   ├── server.py
│   │   └── app.py
│   └── utils/                  ← Helpers & visuals
│       ├── __init__.py
│       ├── dashboard.py
│       ├── heatmap.py
│       ├── logger.py
│       ├── alert.py
│       ├── data_manager.py
│       ├── report_pdf.py
│       └── ai_insight.py
│
├── scripts/                    ← Tools & installers
│   ├── main.py
│   ├── zone_setup.py
│   ├── db_migrate.py
│   ├── vendor_tools.py
│   ├── FlowSight.bat
│   ├── run.bat
│   ├── build_installer.bat
│   ├── setup.iss
│   └── installer/              ← ทั้งโฟลเดอร์ (python_embedded, get-pip, redist, ...)
│
├── config/
│   ├── bytetrack.yaml
│   ├── zones_config.example.json
│   ├── behaviors_config.example.json
│   └── brand_config.example.json
│       └── (ไฟล์ *_config.json จริงถูก generate มาที่นี่ตอน runtime — git ignore)
│
├── templates/
│   └── index.html
│
├── static/
│   ├── css/
│   │   └── style.css           ← (Phase 5)
│   ├── js/
│   │   ├── app.js              ← (Phase 5)
│   │   └── translations.js     ← ย้ายมาจาก root
│   └── assets/
│       ├── icon.ico
│       └── icon.png
│
└── data/                       ← git ignore ทั้งโฟลเดอร์
    ├── yolov8n.pt
    └── behavior_log.db
```

**การย้าย (mapping):**

| เดิม | ปลายทาง |
|------|---------|
| `tracker.py, behavior_engine.py, zones.py` | `src/engine/` |
| `detector.py` | `src/engine/` *(ถ้าเก็บ)* |
| `server.py, app.py` | `src/api/` |
| `dashboard.py, heatmap.py, logger.py, alert.py, data_manager.py, report_pdf.py, ai_insight.py` | `src/utils/` |
| `main.py, zone_setup.py, db_migrate.py, vendor_tools.py, *.bat, setup.iss, installer/` | `scripts/` |
| `bytetrack.yaml` | `config/` |
| `*_config.json` (ปัจจุบัน) | คัดลอกเป็น `config/*.example.json` แล้วตัวจริงไป generate |
| `assets/` | `static/assets/` |
| `translations.js` | `static/js/` |
| `yolov8n.pt, behavior_log.db` | `data/` |

> ⚠️ ระวัง: `git mv` เพื่อรักษา history (ไม่ใช่ del+add) — สำหรับไฟล์ที่ยัง track อยู่

### 🛑 จุดหยุด — หลังจบ Phase 3 จะรายงานและรอ "continue"

---

## Phase 4 — Import Fixes & Path Resolution
*(ทำหลังได้รับ "continue")*

### 4.1 แก้ import เป็น absolute `src.*`
ทุกไฟล์ใน `src/` import กันด้วย path เต็ม เช่น:
```python
# เดิม
from zones import ZoneManager
from behavior_engine import PersonState
# ใหม่
from src.engine.zones import ZoneManager
from src.engine.behavior_engine import PersonState
```
ไฟล์ใน `scripts/` (เช่น `main.py`) import จาก `src.*` เช่นกัน และต้องรันแบบ module
(`python -m scripts.main ...`) หรือมี sys.path bootstrap ที่หัวไฟล์

จุดที่ต้องแก้ (จาก import graph):
- `src/utils/alert.py, logger.py` → `from src.engine.behavior_engine import ...`
- `src/engine/behavior_engine.py` → `from src.engine.zones import ...`
- `src/utils/dashboard.py` → `from src.engine.zones import ...`
- `src/utils/report_pdf.py` → `from src.utils.ai_insight import ...`
- `src/api/server.py` → แก้ทุก import (เยอะสุด ~15 จุด) ให้ชี้ `src.engine.*`, `src.utils.*`
- `src/api/app.py` → `from src.api.server import app`
- `scripts/main.py, scripts/zone_setup.py` → `from src.engine.*`, `from src.utils.*`

### 4.2 Path resolution กลาง (สำคัญสุด — จุดที่พังง่าย)
ปัญหา: เดิมโค้ดใช้ `os.path.dirname(__file__)` เป็น `APP_DIR` แล้วอ้างไฟล์แบบ relative
(`"yolov8n.pt"`, `"zones_config.json"`, `cv2.VideoCapture` cwd ฯลฯ) — พอย้ายไฟล์ลงโฟลเดอร์ลึก path จะเพี้ยนหมด

**ทางแก้:** สร้างโมดูลกลาง `src/paths.py` คำนวณ `PROJECT_ROOT` ครั้งเดียว:
```python
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]   # .../flowsight
DATA_DIR     = PROJECT_ROOT / "data"
CONFIG_DIR   = PROJECT_ROOT / "config"
TEMPLATES_DIR= PROJECT_ROOT / "templates"
STATIC_DIR   = PROJECT_ROOT / "static"

MODEL_PATH   = DATA_DIR   / "yolov8n.pt"
DB_PATH      = DATA_DIR   / "behavior_log.db"
BYTETRACK    = CONFIG_DIR / "bytetrack.yaml"
ZONES_CONFIG = CONFIG_DIR / "zones_config.json"
BEHS_CONFIG  = CONFIG_DIR / "behaviors_config.json"
BRAND_CONFIG = CONFIG_DIR / "brand_config.json"
```
จุดที่ต้องชี้ใหม่ (อ้างอิงตำแหน่งเดิม):

| สิ่งที่อ้าง | ไฟล์/บรรทัดเดิม | ชี้ไปที่ |
|-------------|-----------------|----------|
| `yolov8n.pt` | `server.py:78`, `main.py:31`, `detector.py:13` | `paths.MODEL_PATH` |
| `behavior_log.db` | `server.py:58`, `logger.py:27`, `data_manager.py:17`, `main.py:358`, `db_migrate.py:7` | `paths.DB_PATH` |
| `bytetrack.yaml` | `server.py:1044`, `main.py:122/262` | `paths.BYTETRACK` |
| `zones_config.json` | `zones.py:18`, `behavior_engine.py:89`, `server.py:75` | `paths.ZONES_CONFIG` |
| `behaviors_config.json` | `behavior_engine.py:19`, `server.py:76` | `paths.BEHS_CONFIG` |
| `brand_config.json` | `server.py:77`, `app.py:45` | `paths.BRAND_CONFIG` |
| Flask templates/static | `server.py:153` `Flask(__name__)`, `:88` `TMPL_PATH`, `:657` `translations.js`, `:900` `assets/` | `Flask(__name__, template_folder=paths.TEMPLATES_DIR, static_folder=paths.STATIC_DIR)` |

> ⚠️ **เก็บ logic ProgramData ไว้:** `server.py` เดิมมีตรรกะ "ถ้าติดตั้งใน Program Files (read-only) ให้เขียน config/db ไปที่ `C:\ProgramData\FlowSight`" — ตรรกะนี้สำคัญต่อการติดตั้งจริง จะ **ปรับให้ทำงานร่วมกับ `paths.py`** (เลือก DATA_DIR/CONFIG_DIR แบบ runtime) ไม่ใช่ลบทิ้ง
> ⚠️ `os.chdir(APP_DIR)` เดิม (server.py:13, app.py:12) จะถูกแทนด้วยการอ้าง path สัมบูรณ์ทั้งหมด ปลอดภัยกว่า
> ⚠️ Seed config: ตอน startup ถ้า `config/zones_config.json` ไม่มี ให้ก็อปจาก `config/zones_config.example.json`

### 4.3 ตรวจสอบ
- `python -c "import src.api.server"` ผ่านไม่มี ImportError
- รัน `python -m scripts.main <video>` และ `python -m src.api.app` ขึ้น server ได้
- ยิง `/api/hud`, `/api/zones/load`, `/api/stream/cam_0` ได้ปกติ

---

## Phase 5 — Frontend De-Monolithing
*(ทำหลัง Phase 4 ผ่าน)*

1. แยก `<style>...</style>` ทั้งหมดจาก `index.html` → `static/css/style.css`
2. แยก `<script>` logic (UI interaction, API polling, config) → `static/js/app.js`
   (ถ้าก้อนใหญ่/แยกหน้าได้ชัด อาจซอยเป็น `dashboard.js`, `zones.js`, `settings.js`)
3. ย้าย `translations.js` → `static/js/translations.js` (ทำใน Phase 3 แล้ว) ลิงก์ผ่าน `<script src="/static/js/translations.js">`
4. แก้ `index.html` ให้เหลือ markup + `<link rel="stylesheet" href="/static/css/style.css">` + `<script src="/static/js/app.js">`
5. ลบ route `/translations.js` พิเศษใน `server.py` (เพราะ Flask serve `/static/` ให้แล้ว) — หรือคง redirect ไว้ถ้ากลัว cache

> ⚠️ ความเสี่ยง: ถ้า JS เดิมพึ่ง inline template variable หรือ order การโหลด อาจต้องปรับ
> จะทำแบบ "ตัด → ลิงก์ → ทดสอบหน้าเว็บจริง" ทีละก้อน ไม่ใช่ตัดรวดเดียว

---

## Phase 6 — Docker (รันบน Mac / Apple Silicon ก่อน)
*(ทำหลัง Phase 5 — ตามที่ยืนยัน)*

**บริบทที่ยืนยันแล้ว:** เครื่องเป็น Apple Silicon (arm64), Docker 29.2.1, input = **กล้อง RTSP บน LAN**

### 6.0 ข้อจำกัด Docker-on-Mac (ออกแบบรอบไว้แล้ว)
- ❌ เข้าถึง USB webcam ของ Mac ไม่ได้ → **container รับเฉพาะ RTSP/network** (ตรงกับที่เลือก)
- ❌ `cv2.imshow` (`scripts/main.py`) เปิดหน้าต่างไม่ได้ → container รัน **เว็บแอปเท่านั้น** (`src/api/server.py`)
- ✅ RTSP บน LAN (เช่น `192.168.1.178`): container ออก network ผ่าน NAT ของ Docker Desktop ไปถึง LAN ได้ตามปกติ ตราบใดที่ Mac อยู่วงเดียวกับกล้อง — **ไม่ต้องใช้ `network_mode: host`** (ซึ่งบน Mac ก็ไม่ทำงานเต็มที่อยู่แล้ว) ใช้แค่ port mapping + outbound

### 6.1 ปรับ dependency ให้เหมาะกับ container
- เปลี่ยน `opencv-python` → **`opencv-python-headless`** สำหรับ build ใน Docker
  (ไม่ต้องมี GUI/libGL ในคอนเทนเนอร์ → image เล็กลง, deps น้อยลง)
  → ทำเป็น `requirements-docker.txt` แยก หรือใช้ extra; โหมด desktop (`main.py`) ยังใช้ `opencv-python` ปกติบนเครื่อง host
- pin เวอร์ชันให้ชัด (เลิกใช้ `>=` ลอยๆ) เพื่อ build ซ้ำได้เหมือนเดิม (reproducible)

### 6.2 ไฟล์ที่จะสร้าง (วางที่ project root)
```
flowsight/
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── .env.example          ← ตัวอย่าง env (API keys, TZ_OFFSET, CLOUD_MODE)
└── requirements-docker.txt
```

**`Dockerfile` (โครงร่าง):**
```dockerfile
FROM python:3.12-slim

# system deps สำหรับ ultralytics/opencv-headless + ffmpeg (ถอดรหัส RTSP/H264)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-docker.txt .
RUN pip install --no-cache-dir -r requirements-docker.txt

COPY src/ ./src/
COPY templates/ ./templates/
COPY static/ ./static/
COPY config/ ./config/
# yolov8n.pt + behavior_log.db อยู่ใน data/ (mount เป็น volume ตอนรัน ไม่ COPY)

ENV PYTHONUNBUFFERED=1 \
    KMP_DUPLICATE_LIB_OK=TRUE \
    OPENCV_FFMPEG_CAPTURE_OPTIONS="rtsp_transport;tcp"

EXPOSE 5000
# รัน Flask server ตรงๆ (ไม่ใช่ app.py ที่พยายามเปิด Chrome)
CMD ["python", "-m", "src.api.server"]
```

**`docker-compose.yml` (โครงร่าง):**
```yaml
services:
  flowsight:
    build: .
    image: flowsight:latest
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data          # db + yolov8n.pt persist
      - ./config:/app/config      # zones/behaviors/brand configs persist & แก้ได้
    env_file: .env
    restart: unless-stopped
    # ── Multi-camera: ต้องมี CPU/RAM พอสำหรับหลาย YOLO model พร้อมกัน ──
    cpus: "6.0"          # ~3 cores/กล้อง สำหรับ 2 กล้อง (ปรับตามจำนวนกล้อง)
    mem_limit: 4g        # แต่ละ model ~0.7-1GB + เฟรมบัฟเฟอร์
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:5000')"]
      interval: 30s
      timeout: 5s
      retries: 3
```
> ⚠️ **Docker Desktop (Mac) มี CPU/RAM cap ของ VM แยกต่างหาก** (Settings → Resources) — ต้องตั้งให้ ≥ ที่ compose ขอ ไม่งั้น container จะไม่ได้ core ครบ ทำให้ fps หลายกล้องตก

**`.dockerignore` (กัน image บวม):**
```
.git
data/*.db
scripts/installer/
installer_output/
**/__pycache__/
*.pt
*.log
._*
.DS_Store
```
> หมายเหตุ: `yolov8n.pt` ไม่ COPY เข้า image — จะให้ ultralytics ดาวน์โหลดเองตอน build/รันครั้งแรก หรือ mount ผ่าน `data/` (เลือกอย่างใดอย่างหนึ่ง; เสนอ mount ผ่าน data/ เพื่อไม่ต้องโหลดซ้ำ)

### 6.3 ประเด็น path/runtime ที่ต้องสอดคล้องกับ Phase 4
- `paths.py`: ใน container ไม่ได้อยู่ใน Program Files → `DATA_DIR=/app/data`, `CONFIG_DIR=/app/config` โดยอัตโนมัติ (ตรรกะ ProgramData เป็น Windows-only ไม่ trigger บน Linux)
- ต้องมั่นใจว่า server bind `0.0.0.0:5000` (ของเดิมใน `server.py` `__main__` ทำอยู่แล้ว) เพื่อให้เข้าถึงจาก browser บน Mac ได้
- รันแบบ **single process + threaded** (ห้ามใช้ gunicorn หลาย worker) เพราะ state กล้อง/เฟรม/HUD เก็บใน memory ร่วมกันต่อ process — หลาย worker จะทำให้ stream/HUD เพี้ยน
- seed config: ตอน start ถ้า `config/*.json` ยังไม่มี ให้ก็อปจาก `*.example.json` (ใช้ logic เดียวกับ Phase 4)

### 6.4 วิธีใช้งานบน Mac
```bash
cp .env.example .env          # ใส่ API key ถ้ามี (ไม่ใส่ก็ใช้ rule-based ได้)
docker compose up --build     # build + รัน
# เปิดเบราว์เซอร์ → http://localhost:5000
# ตั้งค่า RTSP URL ของกล้องผ่านหน้า Settings แล้วกด Start
```

### 6.5 ตรวจสอบ (acceptance)
- `docker compose up` ขึ้น healthy, เปิด `http://localhost:5000` เห็นหน้า UI
- ใส่ RTSP URL กล้องบน LAN → กด Start → เห็นภาพสด + กรอบตรวจจับใน `/api/stream/cam_0`
- **เพิ่มกล้องที่ 2 → Start ทั้งคู่ → ทั้ง `/api/stream/cam_0` และ `/api/stream/cam_1` มีภาพพร้อมกัน, `/api/hud` รวมยอด cust/seller/alert จาก 2 กล้องถูกต้อง**
- start/stop รายกล้องได้โดยอีกกล้องไม่หยุด
- restart container แล้ว zones/behaviors/db ยังอยู่ (volume ทำงาน)

### 6.6 Multi-camera — เรื่องประสิทธิภาพบน CPU/Docker
- หลาย model รัน inference พร้อมกันบน CPU = หนัก → โค้ดแบ่ง threads + ลด `imgsz` ตามจำนวนกล้องอยู่แล้ว
- ตั้งความคาดหวังจริง: บน Mac VM (CPU-only) ~2 กล้องได้ราว 5-10 fps/กล้อง ขึ้นกับ core ที่จัดสรร
- ปรับจูนได้: เพิ่ม `cpus`/cores ใน Docker Desktop, หรือ override `imgsz` ผ่าน Settings, หรือ stop กล้องที่ไม่ใช้
- ❌ ย้ำ: ยังคง **single process + threaded** — multi-cam อยู่ในรูป thread หลายตัวใน process เดียว (gunicorn หลาย worker จะแยก memory ทำให้ state กล้องพัง)

> 🔭 *เผื่ออนาคต (ไม่ทำตอนนี้):* `docker buildx` สร้าง multi-arch (arm64+amd64) เพื่อ deploy ขึ้นเซิร์ฟเวอร์ Linux/x86; ตอนนี้โฟกัส arm64 ให้รันบน Mac ก่อน

---

## สรุปความเสี่ยง & สิ่งที่อยากให้ยืนยันก่อนเริ่ม

| # | ประเด็น | ค่าเริ่มต้นที่เสนอ |
|---|---------|---------------------|
| A | git history ยังบวมจาก binary เดิม (Phase 1 ไม่ล้าง history) | ไม่ล้าง history ในรอบนี้ (ถามแยกถ้าต้องการ rewrite + force-push) |
| B | `*_config.json` ถูก ignore → ต้องมี `*.example.json` + seed ตอน startup | ทำ example + seed อัตโนมัติ |
| C | `detector.py` ลบทิ้ง (dead code) | ลบ (ถ้าอยากเก็บไว้เป็น API ทางเลือก บอกได้) |
| D | รันแอปเปลี่ยนวิธี: `python server.py` → `python -m src.api.app` (host) / `docker compose up` (container) | อัปเดต `.bat`/README ให้ตรง |
| E | ตรรกะ ProgramData (read-only install) | คงไว้ ผูกกับ `paths.py` |
| F | Docker = web app + RTSP เท่านั้น (Mac เข้า webcam/GUI ไม่ได้) | ยอมรับข้อจำกัด, รันเว็บแอป |
| G | Docker dep: `opencv-python` → `opencv-python-headless` | แยก `requirements-docker.txt` |

---

### ลำดับลงมือ (เมื่ออนุมัติ)
1. **Phase 1 + 2** → รายงานสิ่งที่ลบ/แก้ → **รอ "continue"**
2. **Phase 3** (ย้ายโฟลเดอร์) → **รอ "continue"** *(ตามที่สั่ง: หยุดหลัง Phase 3)*
3. **Phase 4 + 5** → refactor import/path + แยก frontend + ทดสอบ
4. **Phase 6** → Docker (รันบน Mac/arm64) + ทดสอบ `docker compose up`

*ยังไม่มีการแก้ไฟล์ใดๆ — รออนุมัติแผนนี้ก่อน*
