# FlowSight — Independent Execution-Based QA Audit

**Date:** 2026-06-12
**Auditor role:** Principal QA / CV / Performance / Business Acceptance
**Method:** Real execution against the production code. Backend booted natively
(`python -m src.api.server`), driven through its real REST API and MJPEG pipeline
using a **synthetic MJPEG IP-camera simulator** that composites
segmentation-masked photographic person sprites at **known ground-truth positions
and identities**. Every PASS/FAIL below is backed by a measured number, an API
response, a database row, or a saved image — not by reading the source.

**Test rig:** Apple M2, 8 cores, 16 GB, macOS 15.3, Python 3.11.9, ultralytics
8.4.62, CPU inference (no NVIDIA present — GPU path remains **unverified**, same
caveat as the prior internal report). Model: shipped `yolov8n.pt`. Real
`bytetrack.yaml`, real `zones.py`/`behavior_engine.py`/`heatmap.py`/`logger.py`.

**Evidence directory:** `/tmp/flowsight_qa/results/` (JSON reports + annotated
JPEGs + PDF). Project DB and configs were **restored to their pre-audit state**
after testing (139,344 events; original `brand_config.json`/`zones_config.json`).

---

## Executive Summary

FlowSight is a **genuinely working** retail/crowd analytics system, not a
demo-ware shell. The analytics spine — zone assignment, occupancy snapshots,
heatmap physics, the event database, and report/PDF generation — is **accurate
and internally consistent** when measured against ground truth. The seven fixes
claimed in the prior internal `QA_FIX_REPORT.md` (2026-06-11) **reproduce under
independent testing**: heatmap decay half-life, FPS independence, mass-based
ranking, occupancy-snapshot accuracy, non-blocking logger, automatic camera
recovery, and the zone-scaling guard all verified true.

The product's ceiling is set by **two physical realities, not by bugs**:

1. **Detection recall collapses with crowd density** on `yolov8n` at CPU image
   sizes. Recall at IoU≥0.5 falls from **92.5% (10 people) → 64.8% (40) → 51.7%
   (60)** at imgsz 1280, and far worse at imgsz 640 (21.8% at 60 people). Since
   every downstream number (occupancy, heatmap mass, behavior events) is gated by
   what the detector sees, **dense scenes are systematically under-counted.** This
   is the single most important finding for the stated "40–60 people/camera" goal.

2. **CPU throughput caps at ~6 cameras**, exactly as the system itself warns.
   Single-camera inference is ~91 ms/frame (≈11 fps) at imgsz 1280. The 18-camera
   target is **only reachable on the un-tested GPU**.

Plus a handful of **real software defects**, the most user-visible being a
**stale-HUD-after-stop bug**: after `/api/stop`, `/api/hud` keeps returning the
last live customer counts (observed: "23 customers" with `running:false`), and
the Live page renders that number unconditionally.

**Verdict: Conditional GO for ≤6-camera, low-to-moderate-density deployments**
(cafés, boutiques, waiting areas, entrances). **NO-GO, as-is, for the advertised
40–60-people / 18-camera dense-crowd use case** until (a) a stronger model is run
on the GPU target and re-measured, and (b) the defects below are fixed.

---

## Functional Testing

### Category 1 — System Installation & Startup — **PASS**

| Check | Expected | Actual | Evidence |
|---|---|---|---|
| Backend starts | Flask serves | Boots, serves on configured port | `server.log`: "Running on http://127.0.0.1:5005" |
| Model loaded | YOLO loads | `yolov8n.pt` loaded per camera | log: "YOLO loaded (device=cpu)" |
| Database created | schema ready | `events` + `occupancy_snapshots` present, WAL | log: "[Logger] DB ready" |
| Config loading | reads JSON | 2 cameras, zones, behaviors loaded | log: "Loaded 2 camera(s)" |
| Device detect | report device | `cpu` correctly reported in `/api/hud` | `{"device":"cpu","gpu_name":null}` |
| Frontend served | SPA at `/` | React build served, `<!doctype html>` + assets | `curl /` returns SPA |
| Hot reload (config) | live apply | Zone/behavior reload every 150 frames (verified indirectly — zone edits took effect mid-run) | e2e run |
| Native deployment | runs on Mac | Ran entire audit natively | this report |
| Docker deployment | builds | **NOT TESTED** (no Docker run in this audit) | — |

**Severity of gap:** Low. Docker compose files exist and are unchanged; only the
native path was exercised end-to-end. **Recommendation:** smoke-test the GPU
docker-compose on the real RTX 3060 box before shipping.

**Finding 1A (Low):** `python -m src.api.server` **ignores `FLOWSIGHT_PORT` cleanly
only if free**, but on a busy port it prints "Address already in use" and exits —
expected. No retry/である. Acceptable.

---

### Category 7 — Dashboard Data Consistency — **PASS with 1 defect**

All dashboard-feeding endpoints were called live and cross-checked against the DB:

| Endpoint | Result vs DB | Verdict |
|---|---|---|
| `/api/stats` total = 70 | DB `is_new_visit=1` count = **70** | ✅ exact |
| `/api/stats` top_zone = "QA Checkout" | DB zone events: Checkout 141 > Product 109 | ✅ |
| PDF "Total Visitors" 37 (per-window) | matches `get_daily_data` path | ✅ |
| PDF behavior breakdown | Moving 142 / Checkout 134 / High-interest 69 … | matches DB GROUP BY | ✅ |
| `/api/occupancy` peak/avg | from `occupancy_snapshots` | ✅ (see Cat 6) |

**Finding 7A — Stale HUD after stop (Severity: Medium).**
- **Expected:** After `/api/stop`, "People Now" → 0.
- **Actual:** `/api/hud` returned `cust:23` with `running:false` and full per-camera
  counts for all 10 stopped cameras.
- **Root cause:** `api_stop()` clears `_cam_frames` but **not `_cam_huds`**
  ([server.py:406-414](backend/src/api/server.py#L406-L414)); `api_hud()` sums
  `_cam_huds` ([server.py:472-474](backend/src/api/server.py#L472-L474)).
- **User impact:** [Live.tsx:69](frontend/src/pages/Live.tsx#L69) renders
  `hud.data?.cust` **without gating on `running`**, so the operator sees a stopped
  system still claiming 23 customers present.
- **Mitigation that exists:** the occupancy *sampler* is gated on `running`
  ([server.py:1463-1465](backend/src/api/server.py#L1463-L1465)), so **no false
  rows are written to the DB** — the bug is display-only and self-heals on next
  start.
- **Fix:** add `_cam_huds.clear()` to `api_stop()`/`api_stop_cam()` (and ideally
  have `api_hud` return zeros when `not running`).

**Finding 7B — Activity endpoint silently ignores malformed dates (Severity: Low).**
`/api/activity?date=<garbage>` swallows the parse error
([server.py:870](backend/src/api/server.py#L870) `except Exception: pass`) and
returns **all 140k rows** instead of an error or empty set. Not a security issue
(query is parameterized; `date.fromisoformat` rejects injection), but a silent
correctness trap. **Fix:** return 400 on unparseable date.

---

## Accuracy Testing

### Category 2 — Person Detection — **PARTIAL (degrades with density)**

12 composited scenes per cell, exact GT boxes, greedy IoU≥0.5 matching, server's
real detection params (`conf=0.40, classes=[0]`).

| imgsz (cams) | People | Precision | Recall | FP | FN | Median latency |
|---|---|---|---|---|---|---|
| 1280 (≤2 cam) | 10 | 0.991 | **0.925** | 1 | 9 | 118 ms |
| 1280 | 20 | 0.961 | **0.821** | 8 | 43 | 116 ms |
| 1280 | 40 | 0.915 | **0.648** | 29 | 169 | 113 ms |
| 1280 | 60 | 0.894 | **0.517** | 44 | 348 | 115 ms |
| 640 (5+ cam) | 10 | 0.964 | 0.892 | 4 | 13 | 34 ms |
| 640 | 40 | 0.958 | **0.427** | 9 | 275 | 36 ms |
| 640 | 60 | 0.946 | **0.218** | 9 | 563 | 35 ms |

**Reading:** Precision stays high (few false positives — what it reports is real),
but **recall is the problem**: at the advertised 40–60 people the detector misses
**35–78%** of them depending on image size. The auto-downscale to imgsz 640 used
at ≥5 cameras makes dense-crowd recall **catastrophic (21.8% @ 60)**.

**Evidence:** `results/det_report.json`, annotated `results/det40_evidence.jpg`
(GT 40 green / detected 25 red).

**Severity: High** for the dense-crowd objective; **Low** for typical café/shop
density (≤10 concurrent), where recall is ~90%+.

**Caveats favoring the real world:** (1) synthetic sprites are flat composites
with hard edges and repeated textures — real footage with depth/lighting may
detect somewhat better or worse; (2) `yolov8n` is the nano model — dropping in
`yolov8m/l` on the GPU target would materially raise recall. The *architecture*
supports this (just replace the `.pt`), but it is **unmeasured**.

**Recommendation:** For any crowd-counting claim, (a) ship `yolov8s/m` on GPU and
re-run this exact table; (b) never auto-drop to imgsz 640 when crowd-counting is
the goal; (c) state a supported density envelope in the product spec.

---

### Category 3 — Tracking — **PASS (good core, expected crowd fragmentation)**

Production `model.track(persist=True, tracker=bytetrack.yaml)` + `PersonTracker`
on scripted scenes with known identities.

| Scenario | GT IDs | ID switches | Tracks/person | Coverage |
|---|---|---|---|---|
| 4 walkers, always visible, 30 s | 4 | 7 | 2.0 | 89.8% |
| Two people crossing | 2 | 2 | 1.5 | 99.6% |
| Pass-behind occlusion | 2 | 2 | 1.5 | 99.5% |
| Exit + re-enter after 5 s | 2 | **0** | 1.0 | 95.9% |
| Fast full-frame cross (2 s) | 1 | 1 | 2.0 | **13.0%** |

**Reading:** Coverage is excellent (≥95%) in normal motion; the `track_buffer=300`
tuning bridges short occlusions cleanly (crossing & pass-behind keep 1.5
tracks/person). Fragmentation appears under (a) sustained multi-target motion and
(b) very fast movement, where detection itself drops most frames (13% coverage =
a detection miss, not a tracker miss). **ID switches are non-zero but bounded.**

**Business consequence:** ID fragmentation inflates the **"unique visitors"**
metric (each fragment can count as a new `(cam,person_id)` once cooldown lapses).
The system mitigates this with a 120 s new-visit cooldown, but dense scenes will
still over-count uniques. Occupancy (instantaneous headcount) is **not** affected
by ID churn — only cumulative visitor totals are.

**Evidence:** `results/track_report.json`. **Severity: Medium** for visitor-total
accuracy in crowds; Low for occupancy.

---

### Category 4 — Zone Engine — **PASS (excellent)**

Rectangular zones authored at 960×540, queried analytically at six resolutions
incl. 4K, with overlap-priority, tiny (10×10), and full-frame zones.

| Native resolution | Accuracy | Mismatches (non-edge) |
|---|---|---|
| 960×540 | 99.84% | 6 / 3737 |
| 1920×1080 | 99.97% | 1 |
| 1280×720 | 99.97% | 1 |
| 704×576 | 99.87% | 5 |
| 640×360 | 99.92% | 3 |
| 3840×2160 | 99.97% | 1 |

- **Boundary determinism:** 500/500 points just-inside checkout classified inside,
  500/500 just-outside classified outside (at 1920×1080).
- **Overlap priority** (checkout > seating > product > floor): correct.
- **Zone-scaling guard** (the prior 61.5%-misassignment fix): the
  `get_zone_and_cat called without frame_w/frame_h` warning fires exactly once
  when frame size is omitted — regression protection confirmed.

The residual <0.2% mismatches are all sub-pixel rounding at polygon edges.
**Evidence:** `results/zone_report.json`. **Severity: none.**

---

### Category 5 — Heatmap — **PASS (all physics claims verified)**

| Property | Expected | Measured | Verdict |
|---|---|---|---|
| Decay half-life | 50% at 20 s | **49.9%** @20 s, 24.9% @40 s, 12.5% @60 s | ✅ |
| FPS independence | equal heat 5/15/30 fps | **0.0% deviation** across all three | ✅ |
| Empty room | overlay unchanged | identical to input frame | ✅ |
| Ranking by people | big-50 zone > small-8 zone | mass 3.04M vs 0.47M → 50-zone wins | ✅ |
| Density still exposed | small zone denser/px | density 10.19 (8-ppl) > 8.85 (50-ppl) | ✅ |
| False hotspot lifetime | fades fast | <10% of peak after **67 s** (was ~11 min pre-fix) | ✅ |

Live overlay (`results/heatmap_overlay.jpg`) shows hot blobs precisely at foot
positions with faces anonymized. The mass-based ranking matched live counts in
the e2e run (busier checkout zone ranked above product every phase).
**Severity: none.** This subsystem is production-quality.

---

### Category 6 — Live Occupancy — **PASS (accurate; bounded by detection)**

End-to-end: simulator → server → `/api/hud` + `occupancy_snapshots`, 4 phases,
GT known per phase. HUD samples trimmed 12 s after each transition (hysteresis).

| Phase | GT total (prod/chk/floor) | HUD cust (mean) | HUD prod / chk | Snapshot rows |
|---|---|---|---|---|
| P1 | 7 (2/3/2) | **7.00** (min7/max7) | 2.00 / 3.00 | 7,7,7,7,7 |
| P2 | 12 (4/6/2) | **11.00** | 4.00 / 5.00 | 11,11,11,11 |
| P3 | 0 | **0.00** | 0 / 0 | 0,0 |
| P4 | 4 (1/1/2) | **4.00** | 1.00 / 1.00 | 4,4,4 |

- **Occupancy *logic* is exact** — HUD and snapshots are rock-steady and match GT
  in 3 of 4 phases, and the empty room reads exactly 0 (no phantom occupancy).
- **P2 reads 11 vs GT 12** — a **detection** miss in the busiest phase (one of 12
  people not detected), **not** an occupancy bug. This is the recall ceiling from
  Cat 2 showing up end-to-end: peak occupancy under-reports by ~8% at 12 people
  and will worsen past that.
- `/api/occupancy` peak=11, avg=2.1, peak_time 13:26 — consistent with snapshots.

**Evidence:** `results/e2e_hud_log.jsonl`, `results/e2e_snapshots.json`,
`results/e2e_extras.json`. **Severity: Low** (logic perfect; accuracy inherits
detection recall).

---

## Performance Testing

### Category 11 — Performance — **PASS for ≤6 cams CPU; GPU unverified**

Isolated pipeline timing (cameras stopped, real model+tracker+zones+behavior+heatmap):

| Scene | imgsz | Inference median | p95 | Post-process | 1-cam FPS |
|---|---|---|---|---|---|
| 10 ppl | 1280 | 90.2 ms | 92.0 | 0.43 ms | 11.0 |
| 20 ppl | 1280 | 91.3 ms | 95.3 | 0.55 ms | 10.9 |
| 40 ppl | 1280 | 91.7 ms | 94.8 | 0.82 ms | 10.8 |
| 40 ppl | 640 | 26.6 ms | 27.4 | 0.55 ms | 36.8 |
| 60 ppl | 960 | 54.0 ms | 55.7 | 0.68 ms | 18.3 |

**Key result:** the **entire non-inference pipeline costs <1 ms/frame** — tracking,
zone tests, behavior inference, and heatmap accumulation are essentially free. All
cost is YOLO. This means a GPU that does inference in ~5–10 ms would lift per-camera
FPS by ~10× with no other code changes — the architecture is GPU-ready.

**API latency** (5 samples each, camera running):

| Endpoint | Median | Notes |
|---|---|---|
| `/api/hud` | **0.9 ms** | in-memory |
| `/api/stats`, `/hourly`, `/occupancy`, `/zones_activity` | 1.7–2.8 ms | epoch-range queries use the index |
| `/api/activity?limit=100` | 67 ms | paginated over 140k rows — acceptable |
| `/api/activity/summary` | 131 ms | full-day aggregate — acceptable |
| `/api/report/pdf` | **0.47 s** | 4-page PDF generated **while camera running** |

The prior report's "5–9× faster, 3.1 ms occupancy" claim is consistent with these
numbers. **Memory:** server RSS grew 543 MB (1 cam) → 848 MB (8 cams) and was
stable across the run — no leak observed over the ~25-min session.
**Evidence:** `results/perf_report.json`. **Severity: none** for CPU≤6; the
18-camera/GPU figure is **projection only**.

---

### Category 9 — Multi-Camera — **PASS (1→8), 18 not reachable on CPU**

| Cams | Convergence | Per-cam processed FPS* | CPU% (of 800) | RSS | HUD total | All running |
|---|---|---|---|---|---|---|
| 1 | 1.0 s | 5.6 | 218% | 543 MB | 6 | ✅ |
| 2 | 1.0 s | 5.2 | 432% | 706 MB | 8 | ✅ |
| 4 | 1.0 s | 4.8 | 562% | 833 MB | 12 | ✅ |
| 8 | 1.0 s | 3.6–3.8 | 595% | 848 MB | 20 | ✅ |

\*FPS is **poll-limited to 6 Hz** by the measurement method, so true per-cam FPS at
low N is higher; the **relative** decline (5.6→3.8 as cams 1→8) is the real signal.

- **No crashes, no deadlocks, all cameras reached "Running"** at every level.
- **ID namespacing verified:** raw track IDs repeat across cameras (10 distinct
  `person_id`) but the visitor key `(cam_key, person_id)` keeps them separate (22
  distinct) — cross-camera ID contamination is correctly prevented.
- The **>6-camera CPU warning fires** as designed (log captured at 8 cams).
- **18 cameras was not run** — the system's own warning plus the 11-fps single-cam
  ceiling make CPU 18-cam non-viable; this requires the GPU box.

**Evidence:** `results/multicam_report.json`. **Severity: Medium** only against the
18-cam goal (CPU); architecture scales cleanly to the CPU ceiling.

---

## Reliability Testing

### Category 10 — Fault Tolerance — **PASS**

| Test | Expected | Actual | Verdict |
|---|---|---|---|
| **Camera killed mid-run, returns 25 s later** | auto-recover | Status walked "Reconnecting (attempt 1..4)" → **"Reconnected"**, 35 s after source returned, correct count restored | ✅ |
| **Corrupted JPEG stream for 20 s** | survive, recover | Camera detected stall → "Reconnecting" → on good frames "Reconnected", `cust:3` correct, no crash | ✅ |
| **DB locked during writes** (logger component) | non-blocking + no loss | 6000 `log()` calls during a held EXCLUSIVE lock took **11.5 ms total (1.9 µs/call)**; reads succeeded via WAL; **all rows flushed after unlock, zero loss** | ✅ |

The "zombie camera" failure modes the prior report claimed to fix are **genuinely
fixed** — the camera recovered automatically from both hard-kill and corrupt-stream
faults without human intervention. The BehaviorLogger's background-writer design
holds up under DB contention exactly as claimed.

**Not tested:** disk-full, OS-level unclean shutdown (kill -9 of the whole server
mid-write), and RTSP auth-failure loops. WAL mode makes hard-kill corruption
unlikely but it is unverified.
**Evidence:** `results/fault_report.json`, `results/logger_lock_report.json`.

---

## Business Acceptance Testing

### Category 8 — Reporting & Analytics — **PASS**

- **PDF report** (`results/report_today.pdf`, 4 pages, 0.47 s): KPIs, hourly
  traffic, behavior breakdown, zone activity, alert timeline — all numbers
  **reconcile to the database** (Moving 142, Checkout 134, High-interest 69, zones
  QA-Checkout 141 / QA-Product 109 all matched `SELECT … GROUP BY`).
- **AI Insight** (rule-based tier, offline): produced coherent, correctly-computed
  business prose ("37 visitors, 13.5% interest, 18.9% checkout, peak 08:00") with
  conversion funnel and staffing recommendations. The 3-tier Gemini→Claude→rules
  fallback degraded gracefully to rules with no API key.
- **Consistency:** `/api/stats`, the PDF, and `ai_insight` share `metrics_sql.py`
  constants, so the same day yields the **same** numbers across all three surfaces
  — verified (total 70 = DB 70).

**Finding 8A — Alert metric inflation (Severity: Low/Medium).**
"Staff Alerts: **203**" on the PDF/stats counts **event rows** with
`needs_staff=1`, but only **12 distinct people** ever triggered an alert. Because
the v2 logger heartbeats every 5 s while a person dwells in an alerting behavior,
a single sustained "High interest" produces dozens of alert rows. The headline
number overstates actual alert *incidents* by ~17×. **Fix:** report
`COUNT(DISTINCT visitor)` (or distinct alert episodes) for the alert KPI, as is
already done for visitors/interested/purchasing.

### Category 13 — Business Goals

| # | Objective | Verdict | Basis |
|---|---|---|---|
| 1 | Identify crowded zones immediately | **PASS** | Heatmap mass-ranking matched live counts every phase; `/api/heatmap/zones` correct |
| 2 | Know how many people are present now | **PASS\*** | HUD/snapshots exact at ≤10; under-counts in dense scenes (detection), and stale after stop (Finding 7A) |
| 3 | Today's busiest period | **PASS** | `/api/occupancy` peak_time + hourly graph correct vs DB |
| 4 | Busiest zone | **PASS** | top_zone consistent across HUD, stats, heatmap, PDF |
| 5 | Retrieve historical occupancy | **PASS** | `occupancy_snapshots` + epoch-range queries; 30-day retention |
| 6 | Dashboard supports operational decisions | **PARTIAL** | Data is sound and fast; Finding 7A (stale HUD) and 8A (alert inflation) would mislead an operator |
| 7 | Run continuously 24 h | **PARTIAL** | 25-min session stable, no leak, auto-recovers from faults; **24 h not endurance-tested** |
| 8 | Support 18 cameras | **FAIL on CPU / UNVERIFIED on GPU** | CPU ceiling ~6 cams @11 fps; 18 needs the un-tested RTX 3060 |
| 9 | Heatmap = live density, not cumulative | **PASS** | 20 s half-life, fps-independent, false hotspots gone in 67 s |
| 10 | Whole system meets business objectives | **PARTIAL** | Meets them for ≤6-cam moderate-density; not for the 40–60-ppl/18-cam claim as-is |

---

## Security Testing

### Category 12 — API Robustness — **PASS**

| Attack | Result |
|---|---|
| SQLi via `?date='OR'1'='1`, `';DROP TABLE events;--` | No injection — parameterized; `events` table intact (140,033 rows after) |
| SQLi via `?behavior=x' OR 1=1--` | Parameterized, returned empty set, no leak |
| Path traversal `?date=../../etc/passwd` | Treated as a string, no file access |
| XSS payload in `?date=<script>` | Echoed only inside JSON (not HTML), no execution |
| Malformed JSON body to `/api/zones/save` | Clean `400 {"ok":false,"msg":"Invalid JSON"}` |
| `?limit=999999` / negative | Bounded by pagination; no resource exhaustion (67 ms) |
| 60 concurrent `/api/stats` under camera load | **60/60 → HTTP 200**, no errors/deadlock |

**No injection, no traversal, no crash.** The system is **not** hardened in other
ways expected of internet-facing software, but it is designed as a LAN/on-prem
appliance (Flask dev server, `0.0.0.0`, no auth):

**Finding 12A (Medium — deployment posture):** No authentication on any endpoint;
runs on the Flask **development** WSGI server (it prints the warning itself). Fine
for an isolated store LAN; **unacceptable if exposed to the internet.**
**Finding 12B (Low):** `brand_config.json` ships with **real camera RTSP
credentials** (`Admin123:12345678@184.82.172.209`) — a secret-leak risk if pushed
to a public repo. Use the provided `*.example.json` and gitignore the live config.

---

## Production Readiness

**Ready now (evidence-backed):** zone engine, heatmap, occupancy logic, event DB +
logger durability, analytics/PDF/insight consistency, fault recovery, API latency,
input safety, 1–6 camera scaling.

**Blocks the advertised dense/18-cam use case:** detection recall on `yolov8n` at
crowd density; CPU camera ceiling; GPU path entirely unverified.

**Should fix before any production ship:** Finding 7A (stale HUD), 8A (alert
inflation), 12A/12B (deployment posture & secrets).

**Still owed (untested here):** GPU benchmark on the real RTX 3060; 24 h endurance
soak; Docker-GPU deploy smoke test; disk-full and unclean-shutdown faults.

---

## Risk Assessment

| Risk | Likelihood | Impact | Exposure |
|---|---|---|---|
| Under-counting in dense crowds (recall) | **High** in target use | High (core metric wrong) | **Critical for 40–60 ppl claim** |
| 18-cam goal unmet on delivered hardware | High if CPU-only | High | Critical — needs GPU |
| GPU path fails/perf short on real box | Unknown (untested) | High | High — must validate pre-ship |
| Stale HUD misleads operator (7A) | Certain after every stop | Medium | Medium |
| Alert KPI inflation (8A) | Certain | Medium (false staffing signals) | Medium |
| No auth / dev server if exposed (12A) | Low on LAN | High if WAN | Medium |
| Visitor over-count from ID fragmentation | Medium in crowds | Medium | Medium |
| 24 h stability unproven | Unknown | High | Medium |
| Leaked RTSP creds in repo (12B) | Low | Medium | Low |

---

## Recommended Improvements (priority order)

1. **Re-measure detection on the GPU target with `yolov8s/m`** using the exact
   Cat 2 table. Define and document a supported density envelope. Gate the
   40–60-people claim on those numbers. *(Critical)*
2. **Do not auto-downscale to imgsz 640 when crowd-counting** — recall at 60 ppl
   was 21.8% vs 51.7% at 1280. Make image size policy density-aware, not just
   camera-count-aware. *(Critical)*
3. **Run the RTX 3060 stress test** (4 and 18 cams) the prior report deferred —
   this is the single largest unknown. *(Critical)*
4. **Fix Finding 7A:** clear `_cam_huds` on stop and/or zero the HUD when
   `running:false`. *(High — trivial, high visibility)*
5. **Fix Finding 8A:** alert KPI = distinct people/episodes, not event rows. *(High)*
6. **24 h endurance soak** on the deploy box (memory, fd, DB growth, thread
   health). *(High)*
7. **Deployment hardening:** put behind a production WSGI server + reverse proxy,
   add auth if reachable beyond the store LAN; move RTSP creds out of the repo
   (12A/12B). *(Medium)*
8. **Activity endpoint:** 400 on malformed `date` instead of silent full-table
   return (7B). *(Low)*
9. **Mitigate ID fragmentation** in dense scenes (e.g. appearance embedding /
   stronger ReID) to stop unique-visitor over-counting. *(Medium)*

---

# Production Readiness Score

Scores are 0–10, weighted by evidence gathered. "CPU" = on the tested machine;
GPU-dependent items are scored against what was *measurable*, with the unknown
called out.

| Dimension | Score | Justification |
|---|---:|---|
| **Detection Accuracy** | **5.0 / 10** | 92% recall @10 ppl but 52–65% @40–60 on nano/CPU; precision good. Model/HW upgrade path exists but unmeasured. |
| **Tracking** | **7.0 / 10** | ≥95% coverage in normal motion, clean occlusion bridging; bounded ID switches; fragments in crowds/fast motion. |
| **Heatmap** | **9.5 / 10** | Every physics claim verified exactly (half-life, fps-independence, mass ranking, false-hotspot decay). |
| **Zone Engine** | **9.5 / 10** | 99.8–99.97% across 6 resolutions incl. 4K; boundary-deterministic; regression guard works. |
| **Occupancy** | **8.0 / 10** | Logic exact (0% error ≤10 ppl, empty=0); under-counts in dense scenes purely via detection. |
| **Dashboard** | **7.0 / 10** | Fast, consistent with DB; docked for stale-HUD-after-stop (7A). |
| **Reports** | **8.5 / 10** | PDF/insight reconcile to DB; docked for alert-count inflation (8A). |
| **Analytics** | **8.5 / 10** | Single source of truth across stats/PDF/insight; epoch-range queries fast and indexed. |
| **Performance** | **7.5 / 10** | <1 ms non-inference pipeline, sub-3 ms APIs, 0.47 s PDF; capped by CPU inference (GPU-ready). |
| **Reliability** | **7.5 / 10** | Auto-recovers from disconnect/corrupt-stream; logger lossless under lock; 24 h soak unproven. |
| **Security** | **6.5 / 10** | No injection/traversal/crash; but no auth, dev server, and committed RTSP creds (appliance-grade only). |
| **Maintainability** | **8.0 / 10** | Clear module boundaries, shared metrics SQL, live config reload, sensible logging. |
| **Scalability** | **5.5 / 10** | Clean 1→8 on CPU with correct ID namespacing; 18-cam target needs the untested GPU. |

### Overall Production Readiness: **7.2 / 10** — *Conditional GO*

**GO** for on-prem deployments of **≤6 cameras at low-to-moderate density**
(cafés, boutiques, galleries, waiting areas, entrance counting), where the
analytics, heatmap, occupancy, reporting, and fault-recovery are all genuinely
production-quality.

**NO-GO, as-is, for the advertised "40–60 people per camera, 18 cameras"
dense-crowd configuration** until the three Critical items are closed:
(1) detection recall re-measured and acceptable on `yolov8s/m` + GPU,
(2) image-size policy fixed for density, and (3) the RTX 3060 stress test actually
run. The four High/Medium software defects (stale HUD, alert inflation, deployment
hardening, endurance soak) should also be cleared before broad release.

*The engineering foundation is strong and the prior fix round is real. The gap is
not code quality — it is that the product's headline capacity claim rests on a
detection model and a hardware path that have not yet been measured under the load
they promise.*
