# FlowSight — QA Audit & Fix Report

**วันที่:** 11 มิถุนายน 2026
**ขอบเขต:** ตรวจสอบความพร้อม production สำหรับงาน crowd monitoring (เป้าหมาย 18 กล้อง, 40–60 คน/กล้อง) ครบ 7 Phase พร้อมแก้ไขปัญหาที่พบตามลำดับความรุนแรง
**วิธีทดสอบ:** รันโค้ด production จริงทุกตัว (ZoneManager, HeatMapEngine, PersonTracker, BehaviorInferenceEngine, BYTETracker + `bytetrack.yaml` จริง, YOLO จริง, `camera_engine_loop` จริง) ด้วย synthetic ground truth — ไม่ใช่การ review โค้ดอย่างเดียว ทุก fix มีการรัน verify ซ้ำหลังแก้

---

## 1. สรุปผลการตรวจ (ก่อนแก้)

| ด้าน | คะแนนก่อนแก้ | ปัญหาหลัก |
|---|---|---|
| Zone Accuracy | 9/10 | แม่นยำมาก (error <0.6% ทุก resolution) |
| Heatmap Accuracy | 5/10 | heat ค้าง ~11 นาทีหลังคนออก, ranking ผิดเมื่อโซนขนาดต่างกัน |
| Occupancy Accuracy | 6/10 | peak +37% / avg +49% เมื่อคนหมุนเวียนเร็ว |
| Tracking Quality | 7/10 | แกนแข็งแรง, ID บวม 15–50% ตอนแออัด |
| Detection Accuracy | 5/10* | จำกัดด้วย yolov8n@CPU — *ต้อง validate ด้วย footage จริง |
| Scalability | 2/10 | 18 กล้อง = latency 4–30 วินาที, เพดาน ~6 กล้อง/เครื่อง CPU |
| Reliability | 3/10 | กล้องหลุดแล้วไม่ฟื้นเอง (zombie camera) 2 รูปแบบ |

---

## 2. รายการแก้ไขทั้งหมด

### Fix 1 — Heatmap: เปลี่ยนจาก cumulative footfall เป็น live crowd density
**ไฟล์:** `backend/src/utils/heatmap.py`, `backend/src/api/server.py`

**ปัญหาที่วัดได้:** decay แบบนับเฟรม (`×0.998 ทุก 30 เฟรม`) ให้ half-life ~11.5 นาที — โซนที่คนออกไปหมดแล้ว 80 วินาที ยังเหลือ heat 92% ทำให้ heatmap ไม่สะท้อน "ความหนาแน่นปัจจุบัน" ตามเป้าหมายธุรกิจ และค่า heat ขึ้นกับ fps ของกล้อง (กล้อง 30fps ร้อนกว่ากล้อง 5fps 6 เท่าทั้งที่คนเท่ากัน)

**การแก้:**
- decay ตามเวลาจริง: `heat *= 0.5 ** (dt / half_life_sec)` โดย `half_life_sec=20`
- heat ที่เพิ่มต่อเฟรมคูณด้วย `dt` (capped 0.5s กัน stream สะดุด) → ไม่ขึ้นกับ fps
- พารามิเตอร์ `decay` เดิมยังรับได้ (deprecated warning) — โค้ดเก่าไม่พัง

**ผล verify:** โซนร้าง 20 วิ เหลือ heat 50% ตรง half-life (เดิม 98%), false hotspot หายใน ~10 วิ (เดิม >2 นาที), heat ที่ 5/15/30 fps ต่างกัน <5% (เดิม 6 เท่า), ranking A(50)>B(10)>C(5) ยังถูกต้อง, ฉากว่างผ่าน

---

### Fix 2 — Reliability: กล้องหลุดแล้วฟื้นเองเสมอ (แก้ zombie camera)
**ไฟล์:** `backend/src/api/server.py` (`camera_engine_loop`)

**ปัญหาที่วัดได้ (รันโค้ดจริง):**
1. กล้อง offline ตอนกด start → thread จบใน 0.1 วินาที **ไม่ retry เลย** ต้องกดมือใหม่
2. stream ตายกลางคัน + reconnect พลาด 1 ครั้ง → ค้างสถานะ "Reconnect failed" **ตลอดกาล** แม้กล้องกลับมาแล้ว (grab thread ไม่ถูก restart, วน `frame is None` ไม่รู้จบ)
3. stream ค้าง (เปิดได้แต่ไม่ส่งเฟรม) → loop ประมวลผลเฟรมเก่าซ้ำๆ เต็มความเร็ว นับคนที่ออกไปแล้วว่ายังอยู่

**การแก้:**
- เพิ่ม `_open_stream()` — เปิด stream แบบ retry ทุก `RECONNECT_INTERVAL` (5s) ไม่จำกัดครั้ง จนกว่าจะสำเร็จหรือผู้ใช้สั่งหยุด ใช้ทั้งตอน startup และ reconnect
- เพิ่ม `_frame_seq` counter ใน grabber → main loop แยกได้ว่าเฟรม "ใหม่" หรือ "ค้าง" — ไม่ประมวลผลเฟรมเดิมซ้ำ และตรวจจับ stream ที่เงียบไป >15 วินาที (`NO_FRAME_TIMEOUT`) แล้วเข้าสู่ reconnect เอง
- สถานะรายงานชัดเจน: "Reconnecting (attempt N)..." → "Reconnected"
- เพิ่ม capacity warning เมื่อเปิดกล้อง >6 ตัวบน CPU (เกินเพดานที่วัดได้)

**ผล verify (รัน `camera_engine_loop` จริงกับ source ที่ตาย/ฟื้นจริง):**
- กล้องหายตอน start, โผล่มา 12 วิให้หลัง → ระบบจับได้เองใน attempt ถัดไป สถานะกลับเป็น Running ✅
- stream ตายกลางคัน, reconnect ล้มเหลว 3 ครั้งติด, แล้ว source กลับมา → "Reconnected" อัตโนมัติ ✅
- stop_event ยังหยุด thread ได้ปกติทุกสถานะ ✅

---

### Fix 3 — BehaviorLogger v2: ลดปริมาณเขียน DB 98.7% + ไม่ block pipeline
**ไฟล์:** `backend/src/utils/logger.py`

**ปัญหาที่วัดได้:**
- v1 เขียน **ทุกคนทุกเฟรม** → ที่ 18 กล้อง × 50 คน × 5fps = **194–466 ล้านแถว/วัน (14.5–34.7 GB/วัน)** — SQLite รับไม่ไหวที่ retention 30 วัน
- flush ทำงาน **ใน inference loop** → DB ถูก lock ทีเดียว ทั้ง pipeline ของกล้องค้าง **5.3 วินาทีต่อ flush**

**การแก้:**
- บันทึกเฉพาะเมื่อ **(zone, behavior) เปลี่ยน** + heartbeat ทุก 5 วินาทีระหว่างที่คนยังอยู่ (query per-minute ของ dashboard ยังเห็นทุกคนครบ)
- งาน SQLite ทั้งหมดย้ายไป **background writer thread** — `log()` แค่ append buffer, ไม่แตะ DB เลย
- DB lock → buffer เก็บไว้ เขียนตามหลังเมื่อปลดล็อก (cap 50,000 แถวกัน memory บวม)
- schema เดิมทุกประการ — dashboard query ไม่ต้องแก้

**ผล verify:** 40 คน @15fps 60 วิ → เขียน 480 แถว (v1 = 36,000) = **ลด 98.7%**; ระหว่าง DB ถูก lock, `log()` 6,000 ครั้งใช้เวลารวม **0.005 วิ** (v1 ค้าง 5.3 วิ/flush); ข้อมูลครบหลังปลดล็อก ✅

---

### Fix 4 — Occupancy: peak/average จากค่าจริง + dashboard query เร็วขึ้น 5–9 เท่า
**ไฟล์:** `backend/src/api/server.py`, `backend/src/utils/data_manager.py`

**ปัญหาที่วัดได้:**
- `/api/occupancy` ประมาณ peak/avg จาก `COUNT(DISTINCT visitor)` ต่อนาที → นับ "ทุกคนที่เห็นในนาที" ไม่ใช่ "อยู่พร้อมกัน" — เมื่อคนหมุนเวียนเร็ว (dwell ~2 นาที) **peak เกินจริง +37%, average เกินจริง +49%**
- ทุก endpoint ใช้ `WHERE date(datetime(timestamp,...)) = ?` → คำนวณฟังก์ชันทุกแถว, **index `idx_ts` ไม่ถูกใช้** → full scan 4.1 วินาทีต่อ poll บนข้อมูลวันเดียว

**การแก้:**
- ตารางใหม่ `occupancy_snapshots` + sampler thread บันทึก headcount จริง (รวม + รายโซน + รายกล้อง) ทุก 15 วินาที (5,760 แถว/วัน — จิ๋ว) → `/api/occupancy` อ่านจาก snapshot เป็นหลัก, ของเก่าใช้เป็น fallback สำหรับข้อมูลย้อนหลัง
- เพิ่ม `_day_range()` แปลงวันที่เป็นช่วง epoch แล้วเปลี่ยนทุก endpoint (`/api/stats`, `/api/hourly`, `/api/occupancy`, `/api/zones_activity`) เป็น `WHERE timestamp>=? AND timestamp<?` → ใช้ index ได้
- daily cleanup ลบ snapshot เก่าตาม retention เดียวกับ events

**ผล verify:** snapshot peak error **0.0%**, avg error **0.2%** (เทียบ ground truth สถานการณ์ churn สูงเดิมที่เพี้ยน +37/+49%); query บนตาราง 5M แถว/30 วัน เร็วขึ้น **5–9 เท่า**, path หลักของ `/api/occupancy` (snapshots) เหลือ **3.1 ms** จากเดิม 4,100 ms ✅

---

### Fix 5 — Heatmap ranking: จัดอันดับตามจำนวนคน ไม่ใช่ความหนาแน่นต่อพิกเซล
**ไฟล์:** `backend/src/utils/heatmap.py` (`get_top_zones`), `backend/src/api/server.py` (`/api/heatmap/zones`)

**ปัญหาที่วัดได้:** จัดอันดับด้วย mean heat ต่อพิกเซล → โซนเล็กที่มี **8 คน** ชนะโซนใหญ่ที่มี **50 คน**

**การแก้:** `get_top_zones` คืน `(zone_id, mass, density)` โดย **mass = integrated heat ∝ จำนวนคนในโซน** ใช้จัดอันดับ; density (mean เดิม) ยังส่งให้ UI แสดงประกอบ; field `score` ใน API คงชื่อเดิมเพื่อ back-compat (frontend ใช้แบบ relative bar — ไม่ต้องแก้)

**ผล verify:** โซน 50 คน (mass 3.96M) ชนะโซน 8 คน (mass 0.57M) ✅

---

### Fix 6 — GPU support สำหรับเครื่อง deploy จริง (Windows, RTX 3060 12GB)
**ไฟล์:** `backend/src/api/server.py`

**ปัญหา:** โค้ด hardcode `device="cpu", half=False` — ต่อให้เครื่องมี RTX 3060 ระบบก็จะวิ่งบน CPU ซึ่งจากการวัดมีเพดานแค่ ~6 กล้อง

**การแก้:**
- `_detect_device()` ตรวจ CUDA อัตโนมัติตอน start (เดิมเป็น stub คืน "cpu" ตายตัว) — เจอ GPU ใช้ `device=0` + **FP16** (`half=True`), ไม่เจอ fallback เป็น CPU พฤติกรรมเดิมทุกประการ
- override ได้ด้วย env `FLOWSIGHT_DEVICE=cpu|0|1`
- imgsz auto-rule แยกตาม device: GPU ใช้ `1280 (≤4 กล้อง) / 960 (>4 กล้อง)` — คุณภาพ detection คนตัวเล็ก/ไกลดีกว่า CPU rule (640) มาก ภายใต้ VRAM 12GB
- `/api/hud` รายงาน device/gpu_name จริง (เดิม hardcode "cpu")
- แก้ลำดับใน main loop: ประมวลผลเฟรมที่ buffer ไว้ก่อนเสมอ แล้วค่อยพิจารณา reconnect เมื่อ idle (กันกล้อง flappy ทำให้เฟรมถูกทิ้ง)

**ผล verify:** บนเครื่องทดสอบ (ไม่มี CUDA) ตรวจเป็น cpu ถูกต้อง, override ทำงาน, end-to-end loop ผลิตเฟรม + HUD + stop สะอาด, V1/V2 recovery ผ่านซ้ำหลัง reorder ✅ — **path GPU จริงต้องทดสอบบนเครื่อง Windows อีกครั้ง** (เครื่องที่ audit ไม่มี NVIDIA)

---

### Fix 7 — Zone guard: กันการเรียกใช้ผิดแบบเงียบๆ
**ไฟล์:** `backend/src/engine/zones.py`

**ปัญหา (latent):** `get_zone_and_cat()` ที่ถูกเรียกโดยไม่ส่ง `frame_w/frame_h` จะ assign zone ผิด **61.5%** แบบเงียบๆ (ตอนนี้ caller ทุกตัวส่งถูก แต่ไม่มีอะไรป้องกัน caller ใหม่ในอนาคต)

**การแก้:** log warning (ครั้งเดียวต่อ instance) เมื่อถูกเรียกโดยไม่มี frame size

---

## 3. ผลทดสอบที่ "ผ่านอยู่แล้ว" ไม่ต้องแก้

- **Zone engine:** error <0.6% ทุกสถานการณ์ (720p→1080p→4K, aspect เปลี่ยน, ขอบโซนคลาดเคลื่อน ≤2px, overlapping zone priority ถูกทุกจุด, โซนเล็ก 36px รอด)
- **Counting logic:** People Now / per-zone / staff exclusion ตรง 100% เมื่อ detection ครบ (10–60 คน)
- **ByteTrack:** เดินสวน-บังกัน 0 ID switch, occlusion ≤20s ID เดิม, ความเร็ว ≤450px/s ไม่หลุด, เข้า-ออกเฟรมสะอาด
- **Corrupted frames:** zeros/noise/ขนาดประหลาดไม่ทำให้ pipeline ตาย (มี except ครอบ)

## 4. เครื่อง deploy จริง: Windows + i5-14600K + RTX 3060 12GB + RAM 32GB

**แผนใช้งานจริง: ~4 กล้อง** → สเปคนี้เหลือเฟือมาก:
- imgsz rule ใหม่จะเลือก **1280** ให้อัตโนมัติ (GPU, ≤4 กล้อง) = คุณภาพ detection สูงสุด ลดปัญหา People Now ตกจาก occlusion และ ID บวมตอนแออัดโดยตรง
- โหลด GPU ~40–60% ที่ 4 กล้อง × 15 fps เต็มอัตรา → มี headroom อัปเป็น **yolov8s/yolov8m** (แม่นขึ้นชัดเจนในฝูงชน — แค่วางไฟล์ `.pt` แทนที่ `backend/data/yolov8n.pt`) หรือเพิ่มกล้องภายหลัง
- แม้ GPU ใช้ไม่ได้ชั่วคราว ระบบ fallback CPU — i5-14600K รัน 4 กล้องที่ ~5–8 fps ได้

**ถ้าขยายถึง 18 กล้องในอนาคต** ก็ยังรองรับได้เมื่อใช้ GPU (Fix 6):
- yolov8n FP16 บน RTX 3060: ~4–8 ms/เฟรมที่ imgsz 960 → 18 กล้อง × 5–10 fps = 90–180 inference/วินาที ≈ ใช้ GPU ~50–90% — อยู่ในงบ พร้อม headroom
- i5-14600K (14C/20T) เหลือเฟือสำหรับ decode RTSP 18 สาย + tracking + Flask
- RAM 32GB เกินพอ (วัดจริง process ~1.2GB ที่ 18 กล้อง ฝั่ง CPU side)
- VRAM 12GB: yolov8n × 18 instance + activations ที่ imgsz 960 ประมาณ ~5–6GB

**ขั้นตอนติดตั้งบน Windows (สำคัญ):**
1. ติดตั้ง NVIDIA driver ล่าสุด (ไม่ต้องลง CUDA toolkit แยก — torch wheel มี runtime ในตัว)
2. ติดตั้ง PyTorch แบบ CUDA **ก่อน** ultralytics:
   `pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121`
   (ถ้าลง `pip install ultralytics` ตรงๆ จะได้ torch CPU-only แล้ว GPU ไม่ทำงาน)
3. `pip install ultralytics flask reportlab opencv-python`
4. ตรวจหลัง start: log ต้องขึ้น `CUDA available: NVIDIA GeForce RTX 3060 (12.0 GB) — GPU inference enabled` และ `/api/hud` ต้องรายงาน `"device": "cuda"`
5. **ต้องรัน stress test ซ้ำบนเครื่องจริง** (สคริปต์ `/tmp/qa_phase5_stress.py` ปรับ device ได้) เพราะตัวเลข GPU ข้างบนเป็นการประเมิน ยังไม่ได้วัดจริง — เครื่องที่ audit ไม่มี NVIDIA
6. **Docker (รองรับ GPU แล้ว):** build ปกติยังเป็น CPU image เล็กเหมือนเดิม ส่วน GPU ใช้ override file:
   `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build -d`
   (ติดตั้ง torch แบบ CUDA ใน image + reserve GPU ให้ container; ต้องใช้ Docker Desktop แบบ WSL2 backend + NVIDIA driver บน host) — ตรวจด้วย `docker logs flowsight | findstr CUDA` ต้องเห็น `CUDA available: NVIDIA GeForce RTX 3060` หรือจะรัน native ตามข้อ 1–4 ก็ได้เหมือนกัน

## 5. ข้อจำกัดที่เหลือ

| ลำดับ | เรื่อง | รายละเอียด |
|---|---|---|
| 1 | **GPU path ยังไม่ได้วัดจริง** | โค้ดพร้อมแล้ว (Fix 6) แต่ต้อง stress test บนเครื่อง RTX 3060 จริงก่อน roll-out |
| 2 | **Detection recall ภาคสนาม** | People Now ลดลงตรงตามสัดส่วน detection miss (occlusion ในฝูงชน) — ควร validate ด้วย footage จริงหน้างาน; บน GPU พิจารณาอัปเป็น yolov8s/m ได้ (VRAM เหลือ) |
| 3 | **ID fragmentation ตอนแออัด** | 60 คนแน่นๆ → unique ID บวม 15–50% ใน 30 วิ → ยอด "visitors วันนี้" สูงเกินจริง; ลดได้ด้วยกล้องมุมสูงขึ้น / โมเดลใหญ่ขึ้น / ReID |
| 4 | (เล็ก) heat ใน `/api/heatmap/jpeg` overlay ใช้ normalize per-frame — สีสัมพัทธ์ภายในภาพ ไม่เทียบข้ามกล้อง |

## 6. ไฟล์ที่แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|---|---|
| `backend/src/utils/heatmap.py` | time-based decay (half-life 20s), fps-independent deposit, `get_top_zones` คืน mass+density |
| `backend/src/utils/logger.py` | เขียนใหม่เป็น v2: event-driven + heartbeat 5s + background writer thread |
| `backend/src/api/server.py` | `_open_stream()` retry-forever, frame-seq stall detection + process-before-reconnect ordering, `_day_range()` + range queries ทุก endpoint, ตาราง+sampler `occupancy_snapshots`, `/api/occupancy` snapshot-first, `/api/heatmap/zones` mass ranking, CUDA auto-detect + FP16 + GPU imgsz rule, `/api/hud` รายงาน device จริง, capacity warning |
| `backend/src/engine/zones.py` | warning เมื่อเรียกโดยไม่ส่ง frame size |
| `backend/src/utils/data_manager.py` | ลบ `occupancy_snapshots` เก่าใน daily cleanup |
| `Dockerfile` | build arg `TORCH_INDEX_URL` เลือก torch CPU (default) หรือ CUDA |
| `docker-compose.gpu.yml` | (ใหม่) override สำหรับ GPU: CUDA torch build + NVIDIA device reservation |

## 7. Test harness

สคริปต์ทดสอบทั้งหมด (รันซ้ำได้): `/tmp/qa_phase1_zones.py`, `qa_phase2_heatmap.py`, `qa_phase2_verify.py`, `qa_phase3_occupancy.py`, `qa_phase4_tracking.py`, `qa_phase4b_congestion.py`, `qa_phase5_stress.py`, `qa_phase5b_stress_prodthreads.py`, `qa_phase6_failure.py`, `qa_verify_fixes.py`
รันด้วย: `PYTHONPATH=backend python3 <script>`

## 8. คะแนนหลังแก้

| ด้าน | ก่อน | หลัง | หมายเหตุ |
|---|---|---|---|
| Zone Accuracy | 9/10 | 9/10 | + guard |
| Heatmap Accuracy | 5/10 | **8/10** | live density + mass ranking ผ่าน verify |
| Occupancy Accuracy | 6/10 | **8/10** | peak/avg error 0.0–0.2% (จาก +37/+49%) |
| Tracking Quality | 7/10 | 7/10 | ขึ้นกับ detection quality; ดีขึ้นเองเมื่อ GPU ใช้ imgsz 960 |
| Detection Accuracy | 5/10* | 6/10* | GPU imgsz 960 ทุกกล้อง (เดิม 640) — ยังต้อง field validation |
| Scalability | 2/10 | **7/10†** | DB หายเป็นคอขวด + GPU path พร้อมแล้ว — †ต้องยืนยันด้วย stress test บน RTX 3060 จริง |
| Reliability | 3/10 | **8/10** | กล้องฟื้นเองทุกกรณีที่ทดสอบ, DB lock ไม่ block pipeline |

**สรุป:** บนเครื่อง deploy จริง (i5-14600K + RTX 3060 12GB + RAM 32GB) ระบบ**มีแนวโน้มรองรับ 18 กล้องได้ตามเป้า** — เงื่อนไขก่อน roll-out: (1) ติดตั้ง PyTorch แบบ CUDA ตามข้อ 4 และยืนยัน log ว่า GPU ทำงาน (2) รัน stress test 18 กล้องบนเครื่องจริง (3) validate detection กับ footage จริงหน้างาน
