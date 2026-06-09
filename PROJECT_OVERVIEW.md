# FlowSight — สรุปโปรเจกต์ทั้งหมด

> เอกสารนี้สรุปว่า FlowSight คืออะไร, ทำงานอย่างไร, มีไฟล์อะไรบ้าง และแต่ละส่วนทำหน้าที่อะไร
> (จัดทำจากการอ่านซอร์สโค้ดทั้งหมดในโฟลเดอร์ `flowsight/`)

---

## 1. ภาพรวม — FlowSight คืออะไร

**FlowSight** คือซอฟต์แวร์ **Retail Intelligence / วิเคราะห์พฤติกรรมลูกค้าด้วย AI แบบเรียลไทม์** ติดตั้งบน Windows
รับภาพจากกล้องวงจรปิด (IP camera ผ่าน RTSP) แล้วใช้ AI ตรวจจับคน ติดตามการเคลื่อนที่ และแปลความเป็น "พฤติกรรม"
เช่น กำลังเดินดูสินค้า, สนใจสินค้า (ยืนนาน), ยืนวนเวียน (loitering), ไปที่จุดชำระเงิน, รอนานเกินไป ฯลฯ
จากนั้นบันทึกลงฐานข้อมูล แล้วแสดงผลผ่าน **เว็บแดชบอร์ด** พร้อมกราฟ, heatmap, รายงาน PDF และ AI Insight

จุดขายหลัก:
- รันบนเครื่องลูกค้าเอง (on-premise) ข้อมูลไม่ออก cloud — **CPU-only** (ปิด GPU เพื่อความเสถียรข้ามเครื่อง)
- มีระบบ **เบลอใบหน้า (Face Anonymization)** เพื่อรองรับ PDPA — ไม่เก็บภาพ ไม่เก็บข้อมูลชีวมิติ เก็บแค่ "เหตุการณ์พฤติกรรม"
- รองรับ **หลายกล้องพร้อมกัน** (multi-camera)
- ปรับแต่งโซนและพฤติกรรมเองได้ผ่าน UI โดยไม่ต้องเขียนโค้ด

เดิมทีโปรเจกต์นี้ทำให้ร้านไวน์ชื่อ **"Wine O'Clock" (ขอนแก่น)** — ยังเห็นร่องรอยในโค้ด (prompt AI, comment) แต่ถูกปรับให้เป็นแพลตฟอร์มทั่วไป (retail/ร้านอาหาร/คาเฟ่/นิทรรศการ)

---

## 2. สถาปัตยกรรม — ทำงานยังไง

### Pipeline หลัก (ต่อ 1 เฟรมของกล้อง)

```
กล้อง RTSP
   │  (grab thread ดึงเฟรมล่าสุดตลอดเวลา กันบัฟเฟอร์ค้าง)
   ▼
YOLOv8n  ──►  ตรวจจับ "คน" (COCO class 0)
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
   ├──►  BehaviorLogger   →  บันทึกลง SQLite (behavior_log.db)
   ├──►  check_alert      →  แจ้งเตือนเมื่อต้องให้พนักงานช่วย
   ├──►  draw_overlay     →  วาดกรอบ/ป้าย/เบลอหน้า ลงเฟรม
   └──►  HeatMapEngine    →  สะสมความหนาแน่นการเดิน
   │
   ▼
Flask server  ──►  ส่งภาพ MJPEG + JSON API  ──►  เว็บแดชบอร์ด (index.html)
```

### มี 2 วิธีรัน

1. **เว็บแอป (วิธีหลักของผลิตภัณฑ์)** — `app.py` → `server.py`
   - เปิด Flask ที่ `127.0.0.1:5000` แล้วเด้ง Chrome/Edge แบบ `--app` (เหมือนแอป desktop)
   - แต่ละกล้องรันใน **thread แยก** (`camera_engine_loop`) มี YOLO model เป็นของตัวเอง
     (สำคัญ: แชร์ model เดียวกันข้าม thread ทำให้ ByteTrack state พังบน CPU)
   - ปรับ setting/zone/behavior ผ่าน UI แล้ว **มีผลทันทีโดยไม่ต้อง restart** (โหลด config ใหม่ทุก ~150 เฟรม)

2. **โหมด Desktop / OpenCV window (สำหรับทดสอบ/วิเคราะห์ไฟล์วิดีโอ)** — `main.py`
   - รันจาก command line ใส่ไฟล์วิดีโอ/webcam/RTSP ได้
   - มีโหมด sequential (ทีละกล้อง) และ `--parallel` (หลายหน้าต่างพร้อมกัน)
   - ดูภาพในหน้าต่าง OpenCV โดยตรง: `SPACE`=พัก `ENTER`=ถัดไป `R`=เล่นซ้ำ `Q`=ออก

---

## 3. ไฟล์ทั้งหมด — แต่ละไฟล์ทำอะไร

### โค้ดหลัก (Engine)

| ไฟล์ | บรรทัด | หน้าที่ |
|------|-------|---------|
| `server.py` | 1507 | **หัวใจของเว็บแอป** — Flask server, REST API ทั้งหมด, loop ประมวลผลต่อกล้อง (`camera_engine_loop`), จัดการ multi-camera, stream MJPEG, CRUD โซน/พฤติกรรม/แบรนด์, รายงาน, heatmap |
| `app.py` | 91 | Entry point ของ desktop app — สตาร์ท Flask ใน thread แล้วเปิด browser แบบ `--app` |
| `main.py` | 379 | โหมดรันด้วยหน้าต่าง OpenCV (sequential / parallel) สำหรับไฟล์วิดีโอหรือ webcam |
| `detector.py` | 39 | คลาส `PersonDetector` ครอบ YOLOv8n กรองเฉพาะคลาส "คน" (ใช้ในบาง path) |
| `tracker.py` | 54 | `PersonTracker` — รับผล `model.track()` แปลงเป็น dict ของคน + เก็บ trajectory, ตั้ง state_key = `cam_key + id` กัน ID ชนข้ามกล้อง |
| `behavior_engine.py` | 258 | **สมองของระบบ** — แปลง (โซน + dwell time + นิ่ง/เคลื่อนที่) เป็นพฤติกรรม มี hysteresis 4 เฟรมกัน bbox สั่น, ความเร็วคิดแบบ normalize ตามขนาดเฟรม |
| `zones.py` | 172 | `ZoneManager` — โหลดโซนจาก JSON, ทดสอบจุดอยู่ในโซนไหน (priority: staff>checkout>seating>...), scale พิกัดจาก resolution ที่วาด (960×540) ไปยัง resolution กล้องจริง |
| `logger.py` | 81 | `BehaviorLogger` — เขียน event ลง SQLite แบบ batch (flush ทุก 30 records), มี cooldown 120 วิ เพื่อนับ "ผู้เข้าชมใหม่" |
| `alert.py` | 31 | `check_alert` — ยิงแจ้งเตือนเมื่อพฤติกรรมต้องให้พนักงานช่วย มี cooldown 20 วิ/คน |
| `dashboard.py` | 81 | วาด overlay ลงเฟรม: โซน, กรอบคน, ป้ายพฤติกรรม, เส้น trajectory, เบลอหน้า (anonymize), HUD นับจำนวน |
| `heatmap.py` | 107 | `HeatMapEngine` — สะสมตำแหน่งคนเป็น heat map (มี decay), สร้าง overlay สีและหา zone ที่ร้อนสุด |
| `data_manager.py` | 172 | จัดการข้อมูล/ความเป็นส่วนตัว — ลบ event เกิน 30 วันอัตโนมัติ (PDPA), export สรุปแบบ anonymized |

### AI / รายงาน

| ไฟล์ | บรรทัด | หน้าที่ |
|------|-------|---------|
| `ai_insight.py` | 274 | สรุปข้อมูลรายวันเป็นคำแนะนำเชิงธุรกิจ มี 3 โหมด: **Gemini** (ฟรี) → **Claude Haiku** (เสียเงิน) → **rule-based** (ออฟไลน์ 100%) |
| `report.py` | 349 | สร้างรายงาน HTML จากฐานข้อมูล (CLI) |
| `report_pdf.py` | 635 | สร้างรายงาน **PDF** มืออาชีพด้วย reportlab — ใช้โดยปุ่ม Export PDF ใน UI |

### Frontend

| ไฟล์ | หน้าที่ |
|------|---------|
| `templates/index.html` | เว็บ UI ทั้งหมด (1693 บรรทัด) — หน้า Live, Dashboard, Zones, Behaviors, Heatmap, Settings |
| `translations.js` | ข้อความ 2 ภาษา ไทย/อังกฤษ (TH/EN) |
| `brand_config.json` | ตั้งชื่อแบรนด์ + รายการกล้อง (RTSP URL) — แก้ผ่าน UI ได้ |
| `zones_config.json` | พิกัดโซนที่วาดไว้ต่อกล้อง (มี `_meta` บอก resolution ที่วาด 960×540) |
| `behaviors_config.json` | นิยามพฤติกรรมที่ตรวจจับ (โซน, action, threshold วินาที, สี, แจ้งเตือนไหม) |
| `bytetrack.yaml` | ค่าปรับจูน ByteTrack — สำคัญคือ `track_buffer: 300` (กันคนหลุด track นานถึง ~20 วิ ก่อนได้ ID ใหม่) |

### เครื่องมือ / ติดตั้ง / build

| ไฟล์ | หน้าที่ |
|------|---------|
| `zone_setup.py` | เครื่องมือวาดโซนแบบ interactive ด้วยเมาส์บนเฟรมกล้อง (โหมด CLI) |
| `db_migrate.py` | อัปเกรดสคีมาฐานข้อมูลเก่า (เพิ่มคอลัมน์ใหม่) |
| `vendor_tools.py` | เครื่องมือฝั่งผู้ขายสร้าง License key (อ้างถึง `license.py` — ⚠️ ไม่มีไฟล์นี้ในโปรเจกต์) |
| `FlowSight.bat` / `run.bat` | สคริปต์เปิดแอป (ใช้ Python ที่ฝังมากับ installer) |
| `build_installer.bat`, `setup.iss`, `BUILD_GUIDE.md` | สร้างไฟล์ติดตั้ง .exe ด้วย PyInstaller + Inno Setup |
| `installer/`, `installer_output/` | ไฟล์ติดตั้ง (Python ฝังตัว, get-pip, VC++ redist, `FlowSight_Setup_v1.0.exe`) |
| `yolov8n.pt` | โมเดล YOLOv8 nano (น้ำหนักเบา รันบน CPU ได้) |
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

SQLite ไฟล์เดียว `behavior_log.db` ตาราง `events`:

| คอลัมน์ | ความหมาย |
|---------|----------|
| `timestamp` | เวลา (epoch) |
| `cam_key` | กล้องไหน |
| `person_id` | ID จาก tracker |
| `zone` / `zone_name` | โซน (id / ชื่อแสดง) |
| `behavior_id` / `behavior_name` | พฤติกรรม |
| `needs_staff` | ต้องให้พนักงานช่วยไหม (1/0) |
| `is_new_visit` | นับเป็นผู้เข้าชมใหม่ไหม (cooldown 120 วิ) |

> **ไม่มีการเก็บภาพหรือใบหน้า** — เก็บแค่ metadata พฤติกรรม + ลบอัตโนมัติเมื่อเกิน 30 วัน (PDPA-friendly)

---

## 6. REST API หลัก (server.py)

| Endpoint | หน้าที่ |
|----------|---------|
| `/api/stream/<cam_id>` | สตรีมวิดีโอสด (MJPEG) ของกล้องนั้น |
| `/api/start`, `/api/stop`, `/api/start/<id>`, `/api/stop/<id>` | เริ่ม/หยุดกล้อง |
| `/api/cameras`, `/api/cameras/save` | จัดการรายการกล้อง |
| `/api/hud` | สรุปสด: จำนวนลูกค้า/พนักงาน/alert/นับต่อโซน |
| `/api/stats`, `/api/hourly`, `/api/zones_activity` | สถิติแดชบอร์ด (วันนี้, รายชั่วโมง, ต่อโซน) |
| `/api/zones/*`, `/api/behaviors/*` | CRUD โซนและพฤติกรรม |
| `/api/activity`, `/api/activity/summary` | Activity Log + สรุป (มี filter วันที่/พฤติกรรม/โซน/alert) |
| `/api/report/pdf` | ดาวน์โหลดรายงาน PDF |
| `/api/insight` | AI Insight รายวัน |
| `/api/heatmap/*` | heatmap (ภาพ, reset, zone ที่ร้อนสุด) |
| `/api/alerts` | รายการแจ้งเตือนล่าสุด |

---

## 7. "ทำเพิ่มอะไร" — สิ่งที่พัฒนาเพิ่ม / จุดเด่นทางวิศวกรรม

จากร่องรอยในโค้ด (เวอร์ชันใน comment, จาก v1.0 → v1.2 / v2.0) มีการแก้/เพิ่มที่สำคัญดังนี้:

1. **Multi-camera แท้จริง** — เปลี่ยนจาก single engine มาเป็น thread ต่อกล้อง แต่ละกล้องมี YOLO model + ByteTrack เป็นของตัวเอง (กัน track-ID ปนข้ามกล้องบน CPU)
2. **CPU-only โดยตั้งใจ** — ปิด GPU/CUDA เพื่อความเสถียรข้ามเครื่องลูกค้า + แบ่ง torch threads ตามจำนวนกล้อง + auto `imgsz` (1280/960/640 ตามจำนวนกล้อง)
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

---

## 8. ข้อสังเกต / สิ่งที่ควรระวัง

- ⚠️ `vendor_tools.py` import จากโมดูล `license` (`get_hwid`, `generate_license`, `save_license`) แต่ **ไม่มีไฟล์ `license.py`** ในโปรเจกต์ — ระบบ License น่าจะถูกถอดออก/อยู่ที่อื่น
- ⚠️ `main.py` โหมด parallel (`CamWorker._worker`) อ้างตัวแปร `anonymize` ที่ไม่ได้ส่งเข้ามา (บรรทัด ~287) — น่าจะทำให้ NameError ถ้าใช้โหมดนี้ และ `draw_overlay`/`draw_hud` ใน `main.py` ถูกเรียกด้วยจำนวน argument ไม่ตรงกับ signature ปัจจุบันใน `dashboard.py` (ขาด `zones_meta`) — โหมด OpenCV นี้ดูจะตามหลังเวอร์ชันเว็บ
- 🔑 ใน `brand_config.json` มี **RTSP URL พร้อม username/password ของกล้องจริง** (`wineoclock2:123456789@...`) — เป็นข้อมูลลับ ควรระวังเวลา push ขึ้น repo สาธารณะ
- มีโค้ด engine 2 ชุดใน `server.py`: `camera_engine_loop` (ใหม่, multi-cam, ใช้งานจริง) และ `engine_loop` (เก่า, single-cam, ยังค้างอยู่)

---

*สรุปจากการอ่านซอร์สโค้ด ณ 2026-06-08*
