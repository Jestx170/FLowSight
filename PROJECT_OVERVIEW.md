# FlowSight — สรุปโปรเจกต์ทั้งหมด

> เอกสารนี้สรุปว่า FlowSight คืออะไร, ทำงานอย่างไร, มีไฟล์อะไรบ้าง และแต่ละส่วนทำหน้าที่อะไร

---

## 0. โครงสร้างโปรเจกต์ — แก้ตรงไหน? (อ่านก่อนเริ่ม)

โปรเจกต์แยกชัดเป็น 2 ส่วน: **`backend/`** (Flask + AI) และ **`frontend/`** (React SPA, ธีม Odoo)

```
flowsight/
├─ backend/                    ★ ทุกอย่างฝั่งเซิร์ฟเวอร์ (Python/Flask)
│  ├─ src/                       Python package (รันด้วย `python -m src.api.server`)
│  │  ├─ api/server.py           ← Flask app + ~40 REST endpoints  (entry หลัก)
│  │  ├─ api/app.py              ← ตัวเปิดสำหรับ Windows/desktop (เรียก server + เปิดเบราว์เซอร์)
│  │  ├─ engine/                 ← AI: tracker.py, zones.py, behavior_engine.py
│  │  ├─ utils/                  ← dashboard, heatmap, report_pdf, alert, logger, metrics_sql, ...
│  │  └─ paths.py                ← จุดรวม path ทั้งหมด (PROJECT_ROOT = backend/)
│  ├─ templates/index_vue.html   ← React build — **เสิร์ฟที่ `/` แล้ว** (legacy index.html ถูกลบ)
│  ├─ static/js|css/             ← JS/CSS ของ legacy UI (เหลือค้าง — ไม่ได้ใช้แล้ว)
│  ├─ static/assets/             ← React build output + ไอคอน (icon.png = โลโก้)
│  ├─ config/                    ← *.json (zones/behaviors/brand) — แก้ผ่าน UI ได้
│  └─ data/                      ← yolov8n.pt (โมเดล) + behavior_log.db
│
├─ frontend/                   ★ React 19 + Vite + Tailwind + shadcn/ui (ธีม Odoo ม่วง)
│  ├─ src/pages/*.tsx            ← เนื้อหาแต่ละหน้า (Live/Dashboard/Zones/Behaviors/Heatmap/Settings)
│  ├─ src/api.ts                 ← ตัวเรียก REST API ทั้งหมด (relative /api)
│  ├─ src/i18n.ts                ← ข้อความ 2 ภาษา (en/th)
│  ├─ src/styles.css             ← theme tokens (Odoo: --primary #714B67)
│  ├─ src/App.tsx                ← navbar + routing
│  └─ vite.config.ts             ← base /static/ (prod) + dev proxy (/api → :5001)
│
├─ Dockerfile                  ← multi-stage: build React → ใส่ใน Python image (ARG TORCH_INDEX_URL เลือก CPU/CUDA torch)
├─ docker-compose.yml          ← รันปกติ (CPU image)
├─ docker-compose.gpu.yml      ← override สำหรับ GPU: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build`
├─ requirements*.txt           ← Python deps (.txt = native, -docker.txt = ใน container)
└─ scripts/                    ← run-native.sh, run.bat, main.py (โหมด OpenCV), zone_setup.py, db_migrate.py, installer, ...
```

**สรุปแก้ตรงไหน:**

| งาน | แก้ที่ | เห็นผล |
|---|---|---|
| logic/endpoint ฝั่งเซิร์ฟเวอร์ | `backend/src/...` | restart เซิร์ฟเวอร์ |
| AI / การตรวจจับพฤติกรรม | `backend/src/engine/` | restart |
| **หน้าเว็บ (React)** | `frontend/src/pages/*.tsx` | `npm run dev` (HMR ที่ :8080) |
| สี/ธีม | `frontend/src/styles.css` | HMR |

**รันโปรเจกต์:**
```bash
scripts/run-native.sh          # backend → http://localhost:5001
cd frontend && npm run dev     # React dev + HMR (:8080), proxy /api ไป :5001 อัตโนมัติ
```

> สถานะ UI: **cutover เสร็จแล้ว** — React app เสิร์ฟที่ `/` โดยตรง (legacy `templates/index.html` ถูกลบออก)
> dev ยังใช้ :8080 (HMR) เหมือนเดิม; prod ใช้ build ที่ฝังใน image (`templates/index_vue.html` + `static/assets/`)

---

## 1. ภาพรวม — FlowSight คืออะไร

**FlowSight** คือซอฟต์แวร์ **Retail Intelligence / วิเคราะห์พฤติกรรมลูกค้าด้วย AI แบบเรียลไทม์** ติดตั้งบน Windows
รับภาพจากกล้องวงจรปิด (IP camera ผ่าน RTSP) แล้วใช้ AI ตรวจจับคน ติดตามการเคลื่อนที่ และแปลความเป็น "พฤติกรรม"
เช่น กำลังเดินดูสินค้า, สนใจสินค้า (ยืนนาน), ยืนวนเวียน (loitering), ไปที่จุดชำระเงิน, รอนานเกินไป ฯลฯ
จากนั้นบันทึกลงฐานข้อมูล แล้วแสดงผลผ่าน **เว็บแดชบอร์ด** พร้อมกราฟ, heatmap, รายงาน PDF และ AI Insight

จุดขายหลัก:
- รันบนเครื่องลูกค้าเอง (on-premise) ข้อมูลไม่ออก cloud — รันบน **CPU ได้** (เพดาน ~6 กล้อง) และ **ตรวจจับ NVIDIA GPU อัตโนมัติ** (CUDA + FP16) เมื่อมี ทำให้รองรับกล้องได้มากขึ้น (ประเมิน ~18 กล้องบน RTX 3060) — override ได้ด้วย env `FLOWSIGHT_DEVICE=cpu|0|1`
- มีระบบ **เบลอใบหน้า (Face Anonymization)** เพื่อรองรับ PDPA — ไม่เก็บภาพ ไม่เก็บข้อมูลชีวมิติ เก็บแค่ "เหตุการณ์พฤติกรรม"
- รองรับ **หลายกล้องพร้อมกัน** (multi-camera)
- ปรับแต่งโซนและพฤติกรรมเองได้ผ่าน UI โดยไม่ต้องเขียนโค้ด

เดิมทีโปรเจกต์นี้ทำให้ร้านไวน์ชื่อ **"Wine O'Clock" (ขอนแก่น)** — ยังเห็นร่องรอยในโค้ด (prompt AI, comment) แต่ถูกปรับให้เป็นแพลตฟอร์มทั่วไป (retail/ร้านอาหาร/คาเฟ่/นิทรรศการ)

---

## 2. สถาปัตยกรรม — ทำงานยังไง

### Pipeline หลัก (ต่อ 1 เฟรมของกล้อง)

```
กล้อง RTSP
   │  (grab thread ดึงเฟรมล่าสุดตลอดเวลา กันบัฟเฟอร์ค้าง
   │   + frame-seq counter ตรวจ stream ค้าง + retry/reconnect ไม่จำกัดครั้ง)
   ▼
YOLOv8n  ──►  ตรวจจับ "คน" (COCO class 0) — CPU หรือ CUDA+FP16 (auto-detect)
   │
   ▼
ByteTrack  ──►  ให้ ID แต่ละคน + เก็บ trajectory (เส้นทางเดิน)
   │
   ▼
ZoneManager  ──►  จุดเท้าคนอยู่ในโซนไหน? (point-in-polygon)
   │
   ▼
BehaviorInferenceEngine  ──►  โซน + เวลายืน (dwell) + นิ่ง/เคลื่อนที่ ⇒ พฤติกรรม
   │
   ├──►  BehaviorLogger   →  บันทึกลง SQLite (เฉพาะตอน zone/behavior เปลี่ยน + heartbeat 5 วิ,
   │                          เขียนผ่าน background writer thread — ไม่ block pipeline)
   ├──►  check_alert      →  แจ้งเตือนเมื่อต้องให้พนักงานช่วย
   ├──►  draw_overlay     →  วาดกรอบ/ป้าย/เบลอหน้า ลงเฟรม
   └──►  HeatMapEngine    →  สะสมความหนาแน่นการเดิน
   │
   ▼
Flask server  ──►  ส่งภาพ MJPEG + JSON API  ──►  เว็บแดชบอร์ด (React SPA ที่ /)
```

นอก pipeline ยังมี **occupancy sampler thread** บันทึก headcount จริง (รวม/รายโซน/รายกล้อง)
ลงตาราง `occupancy_snapshots` ทุก 15 วินาที — `/api/occupancy` ใช้ตารางนี้เป็นหลัก
(peak/average แม่นกว่าการประมาณจาก events มาก)

### มี 2 วิธีรัน

1. **เว็บแอป (วิธีหลักของผลิตภัณฑ์)** — `app.py` → `server.py`
   - เปิด Flask ที่ `127.0.0.1:5000` (override ด้วย `FLOWSIGHT_PORT`; native บน Mac ใช้ 5001 เลี่ยง AirPlay) แล้วเด้ง Chrome/Edge แบบ `--app` (เหมือนแอป desktop)
   - แต่ละกล้องรันใน **thread แยก** (`camera_engine_loop`) มี YOLO model เป็นของตัวเอง
     (สำคัญ: แชร์ model เดียวกันข้าม thread ทำให้ ByteTrack state พังบน CPU)
   - ปรับ setting/zone/behavior ผ่าน UI แล้ว **มีผลทันทีโดยไม่ต้อง restart** (โหลด config ใหม่ทุก ~150 เฟรม)

2. **โหมด Desktop / OpenCV window (สำหรับทดสอบ/วิเคราะห์ไฟล์วิดีโอ)** — `scripts/main.py`
   - รันจาก command line ใส่ไฟล์วิดีโอ/webcam/RTSP ได้
   - มีโหมด sequential (ทีละกล้อง) และ `--parallel` (หลายหน้าต่างพร้อมกัน)
   - ดูภาพในหน้าต่าง OpenCV โดยตรง: `SPACE`=พัก `ENTER`=ถัดไป `R`=เล่นซ้ำ `Q`=ออก

---

## 3. ไฟล์ทั้งหมด — แต่ละไฟล์ทำอะไร

### โค้ดหลัก (backend/src)

| ไฟล์ | บรรทัด | หน้าที่ |
|------|-------|---------|
| `api/server.py` | 1527 | **หัวใจของเว็บแอป** — Flask server, REST API ทั้งหมด, loop ประมวลผลต่อกล้อง (`camera_engine_loop`) พร้อม `_open_stream()` retry ไม่จำกัด + ตรวจ stream ค้าง, occupancy sampler, CUDA auto-detect (`_detect_device()`), stream MJPEG, CRUD โซน/พฤติกรรม/แบรนด์, รายงาน, heatmap |
| `api/app.py` | 94 | Entry point ของ desktop app — สตาร์ท Flask ใน thread แล้วเปิด browser แบบ `--app` |
| `engine/tracker.py` | 54 | `PersonTracker` — รับผล `model.track()` แปลงเป็น dict ของคน + เก็บ trajectory, ตั้ง state_key = `cam_key + id` กัน ID ชนข้ามกล้อง |
| `engine/behavior_engine.py` | 257 | **สมองของระบบ** — แปลง (โซน + dwell time + นิ่ง/เคลื่อนที่) เป็นพฤติกรรม มี hysteresis 4 เฟรมกัน bbox สั่น, ความเร็วคิดแบบ normalize ตามขนาดเฟรม |
| `engine/zones.py` | 182 | `ZoneManager` — โหลดโซนจาก JSON, ทดสอบจุดอยู่ในโซนไหน (priority: staff>checkout>seating>...), scale พิกัดจาก resolution ที่วาด (960×540) ไปยัง resolution กล้องจริง, warning เมื่อถูกเรียกโดยไม่ส่ง frame size |
| `utils/logger.py` | 148 | `BehaviorLogger` v2 — บันทึกเฉพาะเมื่อ (zone, behavior) เปลี่ยน + heartbeat 5 วิ, เขียน SQLite ผ่าน background writer thread (`log()` ไม่แตะ DB เลย), cooldown 120 วิ นับ "ผู้เข้าชมใหม่" |
| `utils/metrics_sql.py` | 30 | SQL helper สำหรับ query metrics ของ dashboard |
| `utils/alert.py` | 31 | `check_alert` — ยิงแจ้งเตือนเมื่อพฤติกรรมต้องให้พนักงานช่วย มี cooldown 20 วิ/คน |
| `utils/dashboard.py` | 80 | วาด overlay ลงเฟรม: โซน, กรอบคน, ป้ายพฤติกรรม, เส้น trajectory, เบลอหน้า (anonymize), HUD นับจำนวน |
| `utils/heatmap.py` | 151 | `HeatMapEngine` — live crowd density: decay ตามเวลาจริง (half-life 20 วิ), heat ไม่ขึ้นกับ fps, `get_top_zones` จัดอันดับด้วย mass (∝ จำนวนคน) ไม่ใช่ density ต่อพิกเซล |
| `utils/data_manager.py` | 181 | จัดการข้อมูล/ความเป็นส่วนตัว — ลบ event + occupancy snapshot เกิน 30 วันอัตโนมัติ (PDPA), export สรุปแบบ anonymized |

### AI / รายงาน

| ไฟล์ | บรรทัด | หน้าที่ |
|------|-------|---------|
| `utils/ai_insight.py` | 276 | สรุปข้อมูลรายวันเป็นคำแนะนำเชิงธุรกิจ มี 3 โหมด: **Gemini** (ฟรี) → **Claude Haiku** (เสียเงิน) → **rule-based** (ออฟไลน์ 100%) |
| `utils/report_pdf.py` | 637 | สร้างรายงาน **PDF** มืออาชีพด้วย reportlab — ใช้โดยปุ่ม Export PDF ใน UI |

### Frontend (React — `frontend/`)

| ไฟล์ | หน้าที่ |
|------|---------|
| `src/pages/*.tsx` | หน้า Live, Dashboard, Zones, Behaviors, Heatmap, Settings |
| `src/api.ts` | ตัวเรียก REST API ทั้งหมด (relative `/api`) |
| `src/i18n.ts` | ข้อความ 2 ภาษา ไทย/อังกฤษ (TH/EN) |
| `src/styles.css` | theme tokens (Odoo: `--primary #714B67`) |
| `backend/templates/index_vue.html` + `backend/static/assets/` | React build ที่ถูก deploy — เสิร์ฟที่ `/` |

> legacy UI (`templates/index.html`, `static/js/app.js`, `translations.js`) ถูกถอดออกแล้ว — เหลือไฟล์ค้างใน `static/js|css` ที่ไม่ได้ใช้

### Config (`backend/config/`)

| ไฟล์ | หน้าที่ |
|------|---------|
| `brand_config.json` | ตั้งชื่อแบรนด์ + รายการกล้อง (RTSP URL) — แก้ผ่าน UI ได้ |
| `zones_config.json` | พิกัดโซนที่วาดไว้ต่อกล้อง (มี `_meta` บอก resolution ที่วาด 960×540) |
| `behaviors_config.json` | นิยามพฤติกรรมที่ตรวจจับ (โซน, action, threshold วินาที, สี, แจ้งเตือนไหม) |
| `bytetrack.yaml` | ค่าปรับจูน ByteTrack — สำคัญคือ `track_buffer: 300` (กันคนหลุด track นานถึง ~20 วิ ก่อนได้ ID ใหม่) |

### เครื่องมือ / ติดตั้ง / build (`scripts/`)

| ไฟล์ | หน้าที่ |
|------|---------|
| `main.py` | โหมดรันด้วยหน้าต่าง OpenCV (sequential / parallel) สำหรับไฟล์วิดีโอหรือ webcam |
| `zone_setup.py` | เครื่องมือวาดโซนแบบ interactive ด้วยเมาส์บนเฟรมกล้อง (โหมด CLI) |
| `db_migrate.py` | อัปเกรดสคีมาฐานข้อมูลเก่า (เพิ่มคอลัมน์ใหม่) |
| `vendor_tools.py` | เครื่องมือฝั่งผู้ขายสร้าง License key (อ้างถึง `license.py` — ⚠️ ไม่มีไฟล์นี้ในโปรเจกต์) |
| `run-native.sh` / `setup-venv.sh` | รัน native บน Mac/Linux (backend ที่ :5001) |
| `docker-build.sh` | build Docker image |
| `FlowSight.bat` / `run.bat` | สคริปต์เปิดแอปบน Windows (ใช้ Python ที่ฝังมากับ installer) |
| `build_installer.bat`, `setup.iss`, `BUILD_GUIDE.md` | สร้างไฟล์ติดตั้ง .exe ด้วย PyInstaller + Inno Setup |
| `installer/`, `installer_output/` | ไฟล์ติดตั้ง (Python ฝังตัว, get-pip, VC++ redist, `FlowSight_Setup_v1.0.exe`) |
| `backend/data/yolov8n.pt` | โมเดล YOLOv8 nano — อัปเกรดเป็น yolov8s/m ได้โดยวางไฟล์ `.pt` แทน (มี headroom บน GPU) |
| `requirements.txt` | dependency: flask, ultralytics, opencv-python, numpy, reportlab |

---

## 4. ระบบพฤติกรรม (Behavior) — หัวใจของผลิตภัณฑ์

แต่ละพฤติกรรมนิยามใน `behaviors_config.json` ด้วย 4 ตัวแปร:
- `zone` — โซนที่ใช้ได้ (`product`, `checkout`, `seating`, `staff`, `any`, `floor`)
- `action` — `dwell` (ยืนนาน), `moving` (เคลื่อนที่), `still` (นิ่ง), `presence` (อยู่ในโซน)
- `threshold` — วินาทีที่ต้องผ่านก่อน trigger
- `alert` — ต้องแจ้งเตือนพนักงานไหม

**ค่าปัจจุบันใน config:**

| พฤติกรรม | โซน | เงื่อนไข | แจ้งเตือน |
|----------|-----|---------|:---------:|
| Browsing | ทุกที่ | กำลังเดิน | – |
| In wine zone | product | อยู่ในโซนสินค้า | – |
| Looking for a wine | product | ยืน ≥ 20 วิ | – |
| High interest | product | ยืน ≥ 40 วิ | ✅ |
| Checkout | checkout | อยู่ ≥ 5 วิ | ✅ |
| Loitering | ทุกที่ | ยืน ≥ 300 วิ | ✅ |
| Waiting | seating | ยืน ≥ 20 วิ | ✅ |

ตรรกะเลือกพฤติกรรม (`_match_behavior`): ลำดับความสำคัญคือ **staff > threshold สูงสุดที่ผ่าน > โซนเจาะจง > 'any'**
เพื่อให้คนยืนในโซนสินค้าขึ้นเป็น "In wine zone" ทันที ไม่ใช่ "Moving"

---

## 5. ฐานข้อมูล

SQLite ไฟล์เดียว `behavior_log.db` มี 2 ตาราง:

**ตาราง `events`** — เหตุการณ์พฤติกรรม (v2: บันทึกเฉพาะตอน zone/behavior เปลี่ยน + heartbeat 5 วิ — ลดปริมาณเขียน ~98.7% จากเดิมที่เขียนทุกเฟรม):

| คอลัมน์ | ความหมาย |
|---------|----------|
| `timestamp` | เวลา (epoch) |
| `cam_key` | กล้องไหน |
| `person_id` | ID จาก tracker |
| `zone` / `zone_name` | โซน (id / ชื่อแสดง) |
| `behavior_id` / `behavior_name` | พฤติกรรม |
| `needs_staff` | ต้องให้พนักงานช่วยไหม (1/0) |
| `is_new_visit` | นับเป็นผู้เข้าชมใหม่ไหม (cooldown 120 วิ) |

**ตาราง `occupancy_snapshots`** — headcount จริง ณ ขณะนั้น (รวม + รายโซน + รายกล้อง) บันทึกโดย sampler thread ทุก 15 วินาที (~5,760 แถว/วัน) — เป็น ground truth ของ peak/average ใน `/api/occupancy`

> **ไม่มีการเก็บภาพหรือใบหน้า** — เก็บแค่ metadata พฤติกรรม + ลบอัตโนมัติเมื่อเกิน 30 วัน (PDPA-friendly) ทั้ง 2 ตาราง

---

## 6. REST API หลัก (server.py)

| Endpoint | หน้าที่ |
|----------|---------|
| `/api/stream/<cam_id>` | สตรีมวิดีโอสด (MJPEG) ของกล้องนั้น |
| `/api/start`, `/api/stop`, `/api/start/<id>`, `/api/stop/<id>` | เริ่ม/หยุดกล้อง |
| `/api/cameras`, `/api/cameras/save` | จัดการรายการกล้อง |
| `/api/hud` | สรุปสด: จำนวนลูกค้า/พนักงาน/alert/นับต่อโซน |
| `/api/stats`, `/api/hourly`, `/api/zones_activity` | สถิติแดชบอร์ด (วันนี้, รายชั่วโมง, ต่อโซน) — query เป็นช่วง epoch (`_day_range()`) ใช้ index ได้ |
| `/api/occupancy` | peak / average / timeline ของจำนวนคน — อ่านจาก `occupancy_snapshots` เป็นหลัก (fallback เป็น events สำหรับข้อมูลเก่า) |
| `/api/zones/*`, `/api/behaviors/*` | CRUD โซนและพฤติกรรม |
| `/api/activity`, `/api/activity/summary` | Activity Log + สรุป (มี filter วันที่/พฤติกรรม/โซน/alert) |
| `/api/report/pdf` | ดาวน์โหลดรายงาน PDF |
| `/api/insight` | AI Insight รายวัน |
| `/api/heatmap/*` | heatmap (ภาพ, reset, zone ที่ร้อนสุด) |
| `/api/alerts` | รายการแจ้งเตือนล่าสุด |

---

## 7. ข้อมูลเชิงลึกที่ระบบให้ (Insights)

ระบบแปลงภาพกล้องวงจรปิดเป็นข้อมูลพฤติกรรม (โดยไม่เก็บภาพ/ใบหน้า) แล้วสรุปเป็น insight 5 กลุ่ม:

### 7.1 จำนวนคนและความหนาแน่น (Occupancy)
- **People Now** — ตอนนี้มีลูกค้ากี่คน พนักงานกี่คน แยกรายโซน/รายกล้อง (`/api/hud`)
- **Peak / Average occupancy** — ช่วงไหนคนเยอะสุด เฉลี่ยกี่คน จาก headcount จริงที่ sample ทุก 15 วิ (`occupancy_snapshots`) ไม่ใช่ค่าประมาณ
- จำนวน **ผู้เข้าชมใหม่** ต่อวัน (cooldown 120 วิ กันนับซ้ำ)

### 7.2 พฤติกรรมลูกค้า (หัวใจของระบบ)
แปลง โซน + เวลายืน (dwell) + นิ่ง/เคลื่อนที่ เป็นพฤติกรรม:
- กำลังเดินดูของ (Browsing) / อยู่ในโซนสินค้า
- **สนใจสินค้า** (ยืนดู ≥ 20 วิ) → **สนใจมาก** (≥ 40 วิ — แจ้งเตือนให้พนักงานเข้าไปช่วยขาย)
- ไปจุดชำระเงิน (Checkout), **รอนานเกินไป** (Waiting), **ยืนวนเวียนผิดปกติ** (Loitering — มุมความปลอดภัย)
- threshold/โซน/การแจ้งเตือน ปรับเองได้ผ่าน UI (ดูหัวข้อ 4)

### 7.3 พื้นที่ร้อน-เย็น (Heatmap)
- โซนไหน**คนหนาแน่นที่สุดตอนนี้** (live density, decay half-life 20 วิ — ไม่ใช่ยอดสะสม)
- จัดอันดับ Top zones ตาม**จำนวนคนจริง** (mass) → เห็นว่ามุมไหนของร้านดึงคน มุมไหนเป็น dead zone

### 7.4 สถิติแดชบอร์ด + Conversion
- กราฟ**รายชั่วโมง** → รู้ peak hour ของร้าน
- กิจกรรม**ต่อโซน** เปรียบเทียบกันได้
- **Conversion funnel** (`ai_insight.py`): คนเข้าทั้งหมด → % สนใจสินค้า (ยืนดู >25 วิ) → % ถึง checkout (purchase rate)
- **Activity Log** ย้อนหลัง (filter วัน/พฤติกรรม/โซน/alert) + Export **รายงาน PDF**

### 7.5 AI Insight รายวัน — คำแนะนำเชิงธุรกิจ
สรุปข้อมูลทั้งวันเป็นคำแนะนำที่ลงมือทำได้ (3 ชั้น: Gemini → Claude Haiku → rule-based ออฟไลน์) เช่น:
- "Peak 18:00 (32 คน) — dinner crowd ควรจัด wine tasting / เตรียมพนักงานครบก่อน peak 15 นาที"
- "Conversion ต่ำ — โซน X คนดูเยอะแต่ไม่ถึง checkout ลองปรับราคา/จัดวาง"
- "Alert เยอะผิดปกติ (รอนาน) — ควรเพิ่มพนักงาน floor ช่วง peak"

> สรุป: ระบบตอบคำถามธุรกิจประเภท **"คนเข้าเท่าไร เข้าช่วงไหน ไปตรงไหน สนใจอะไร ซื้อจริงกี่ % ต้องวางพนักงานยังไง"** — แบบ real-time และย้อนหลัง 30 วัน

---

## 8. "ทำเพิ่มอะไร" — สิ่งที่พัฒนาเพิ่ม / จุดเด่นทางวิศวกรรม

จากร่องรอยในโค้ด (เวอร์ชันใน comment, จาก v1.0 → v1.2 / v2.0) มีการแก้/เพิ่มที่สำคัญดังนี้:

1. **Multi-camera แท้จริง** — เปลี่ยนจาก single engine มาเป็น thread ต่อกล้อง แต่ละกล้องมี YOLO model + ByteTrack เป็นของตัวเอง (กัน track-ID ปนข้ามกล้องบน CPU)
2. **CPU + GPU auto-detect** — เดิม CPU-only, ตอนนี้ `_detect_device()` ตรวจ CUDA ตอน start อัตโนมัติ (เจอ GPU ใช้ `device=0` + FP16, override ด้วย `FLOWSIGHT_DEVICE`), แบ่ง torch threads ตามจำนวนกล้อง + auto `imgsz` แยกตาม device (GPU: 1280/960, CPU: 1280/960/640) — `/api/hud` รายงาน device จริง
3. **Zone hysteresis (4 เฟรม)** + **velocity แบบ normalize ตามขนาดเฟรม** — แก้ปัญหา bbox สั่นทำให้ dwell clock รีเซ็ตและสถานะ "นิ่ง/เคลื่อนที่" กระพริบ (`behavior_engine.py` v1.2)
4. **Resolution scaling** — โซนวาดที่ 960×540 แต่ scale ไปเข้ากับ resolution กล้องจริงก่อนทดสอบจุดในโซน (`zones.py` v1.2) แก้ปัญหาโซนเพี้ยน
5. **Grab thread แยก** — ดึงเฟรมล่าสุดจาก RTSP ตลอดเวลา + reconnect อัตโนมัติเมื่อหลุด + timeout ป้องกัน thread ค้างตอน stop
6. **Live config reload** — แก้ setting/zone/behavior ผ่าน UI มีผลทันที ไม่ต้อง restart
7. **Face Anonymization** — เบลอหัวคน (Gaussian blur) ก่อนแสดง/บันทึก + ถ้า inference error จะ blur ทั้งเฟรมกันหน้าหลุด
8. **AI Insight 3 ชั้น** — Gemini → Claude → rule-based (ทำงานได้แม้ไม่มีเน็ต/ไม่มี API key)
9. **PDPA / Data retention** — ลบข้อมูลเก่าอัตโนมัติ, ไม่เก็บภาพ, export แบบ anonymized
10. **เก็บ config ใน ProgramData** — เมื่อติดตั้งใน Program Files (read-only) จะ seed config ไป `C:\ProgramData\FlowSight` ให้ user ทั่วไปแก้ไข/บันทึกได้
11. **Heatmap + รายงาน PDF + แดชบอร์ดสองภาษา (TH/EN)** + **License system** (ฝั่ง vendor)
12. **Installer สำเร็จรูป** — ฝัง Python embedded + PyInstaller + Inno Setup → `FlowSight_Setup_v1.0.exe`
13. **React cutover เสร็จ (มิ.ย. 2026)** — React SPA เสิร์ฟที่ `/` แทน legacy vanilla ทั้งหมด
14. **Docker GPU image** — `docker-compose.gpu.yml` override: build arg `TORCH_INDEX_URL` เลือก torch CUDA + reserve NVIDIA GPU ให้ container (Windows ใช้ Docker Desktop + WSL2 backend)

### QA audit & fix round (2026-06-11 — ดูรายละเอียดเต็มใน `QA_FIX_REPORT.md`)

ตรวจความพร้อม production สำหรับ crowd monitoring โดย **รันโค้ดจริงกับ synthetic ground truth** แล้วแก้ 7 จุด:

1. **Heatmap → live crowd density** — decay ตามเวลาจริง (half-life 20 วิ แทน ~11.5 นาที), heat ไม่ขึ้นกับ fps กล้อง
2. **Zombie camera หาย** — `_open_stream()` retry ไม่จำกัด, frame-seq ตรวจ stream ค้าง (>15 วิ → reconnect เอง), สถานะ "Reconnecting (attempt N)" ชัดเจน
3. **BehaviorLogger v2** — เขียน DB ลดลง 98.7%, ย้ายงาน SQLite ไป background thread (เดิม block pipeline 5.3 วิ/flush)
4. **Occupancy แม่นจริง** — ตาราง `occupancy_snapshots` + sampler 15 วิ (peak error 0.0%), query ทุก endpoint เปลี่ยนเป็นช่วง epoch → เร็วขึ้น 5–9 เท่า
5. **Heatmap ranking ตามจำนวนคน** (mass) ไม่ใช่ density ต่อพิกเซล — โซนใหญ่ 50 คนชนะโซนเล็ก 8 คนแล้ว
6. **GPU support** (ข้อ 2 ด้านบน) — เป้าหมายเครื่อง deploy จริง: Windows + i5-14600K + RTX 3060 12GB (~4 กล้อง ใช้สบาย, ประเมินรองรับถึง 18 กล้อง) — ⚠️ path GPU ยังไม่ได้วัดจริงบนเครื่องที่มี NVIDIA
7. **Zone guard** — warning เมื่อ `get_zone_and_cat()` ถูกเรียกโดยไม่ส่ง frame size (กัน bug เงียบ 61.5% misassignment)

---

## 9. ข้อสังเกต / สิ่งที่ควรระวัง

- ⚠️ **ตัวเลขประสิทธิภาพฝั่ง GPU เป็นการประเมิน ยังไม่ได้วัดจริง** — เครื่องที่ audit ไม่มี NVIDIA ต้องรัน stress test ซ้ำบนเครื่อง deploy จริง (Windows + RTX 3060)
- ⚠️ `scripts/vendor_tools.py` import จากโมดูล `license` (`get_hwid`, `generate_license`, `save_license`) แต่ **ไม่มีไฟล์ `license.py`** ในโปรเจกต์ — ระบบ License น่าจะถูกถอดออก/อยู่ที่อื่น
- ⚠️ `scripts/main.py` (โหมด OpenCV) ตามหลังเวอร์ชันเว็บ — โหมด parallel อ้างตัวแปร `anonymize` ที่ไม่ได้ส่งเข้ามา และเรียก `draw_overlay`/`draw_hud` ด้วย argument ไม่ตรง signature ปัจจุบัน
- 🔑 ใน `brand_config.json` มี **RTSP URL พร้อม username/password ของกล้องจริง** — เป็นข้อมูลลับ ควรระวังเวลา push ขึ้น repo สาธารณะ (มี `*.example.json` ให้ใช้แทน)
- `backend/static/js|css` (app.js, translations.js, style.css) เป็นซากของ legacy UI ที่ไม่ได้ถูกเสิร์ฟแล้ว — ลบได้เมื่อมั่นใจ

---

*สรุปจากการอ่านซอร์สโค้ด ณ 2026-06-08 — อัปเดตล่าสุด 2026-06-12 (React cutover, GPU support, QA fix round 2026-06-11)*
