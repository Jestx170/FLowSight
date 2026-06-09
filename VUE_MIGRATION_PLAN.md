# FlowSight — แผนปรับปรุง Frontend เป็น Vue 3

> เป้าหมาย: ย้ายจาก single-file `viwe/index.html` (502 บรรทัด) + `static/js/app.js`
> (883 บรรทัด vanilla JS แบบ global function / `onclick` inline) ไปเป็น
> **Vue 3 + Vite (SFC)** ที่แตกเป็น component ดูแลง่าย โดย **ไม่แตะ Flask API**
> และทำ **ทีละหน้า (incremental)** เพื่อให้ของเดิมยังใช้งานได้ระหว่างทาง
>
> การตัดสินใจที่ล็อกไว้: Vite SFC · JavaScript (ไม่ใช่ TS) · incremental migration

---

## 1. สถานะปัจจุบัน (baseline)

| ส่วน | ที่อยู่ | สภาพ |
|---|---|---|
| Backend (Flask) | `frontend/src/api/server.py` (1,224 บรรทัด) | ~40 REST endpoints — **ไม่แตะ** |
| HTML หน้าเดียว | `frontend/src/viwe/index.html` (502) | สะกดผิด "viwe", `onclick` inline, ซ่อน-โชว์ 6 div |
| JS หลัก | `static/js/app.js` (883) | global functions: `showPage`, `toggleEngine`, `loadDash`, … |
| i18n | `static/js/i18n.js` (115), `static/js/translations.js` (293) | ใช้ `localStorage fs_lang` + `window.isTH()` |
| CSS | `static/css/style.css` (11.8KB) | global, ใช้ CSS variables (`--blue`, `--radius`, …) |
| Charts | Chart.js 4.4 ผ่าน CDN | |

**6 หน้า:** Live · Dashboard · Zones · Behaviors · Heat Map · Settings

**ปัญหาโครงสร้างที่เจอ (ต้องเก็บกวาดก่อน):**
- โฟลเดอร์ชื่อ `frontend/` จริง ๆ คือ **backend** (ชวนสับสน)
- `static/` อยู่ที่ repo root แต่ Flask `PROJECT_ROOT` = `frontend/`
  (`paths.py` → `parents[1]` ของ `frontend/src/paths.py`) → คาดหวัง
  `frontend/templates/` + `frontend/static/` ซึ่ง**ยังไม่มีบน host**
- Dockerfile `COPY src/ templates/ static/` อ้าง path ที่ host ไม่ตรง (build ได้เพราะ context/รก mid-refactor)
- โฟลเดอร์สะกดผิด `viwe/`

---

## 2. API ที่ frontend ใช้ (สัญญาที่ต้องคงไว้)

ทั้งหมดอยู่ใต้ `/api/*` (proxy ง่าย):

- **Stream/Live:** `/api/stream/<cam>`, `/api/stream`, `/api/jpeg`, `/api/frame/<cam>`, `/api/hud`, `/api/alerts`
- **Engine:** `/api/start`, `/api/stop`, `/api/start/<cam>`, `/api/stop/<cam>`, `/api/cameras`, `/api/cameras/save`
- **Dashboard:** `/api/stats`, `/api/hourly`, `/api/zones_activity`, `/api/activity`, `/api/activity/summary`, `/api/insight`, `/api/report/pdf`, `/api/report/html`
- **Zones:** `/api/zones/load|save|delete|clear`
- **Behaviors:** `/api/behaviors`, `/api/behaviors/save|reset`
- **Heatmap:** `/api/heatmap/jpeg|reset|zones`
- **Settings/Brand:** `/api/settings` (GET/POST), `/api/brand`, `/api/brand/save`
- **อื่น ๆ:** `/translations.js`, `/api/push`, `/api/demo/*`

> หมายเหตุ: stream เป็น **MJPEG** → ฝั่ง Vue ใช้ `<img :src="...">` ตรง ๆ
> Vue ไม่ต้องจัดการ streaming เอง

---

## 3. โครงสร้างเป้าหมาย

```
flowsight/
├─ backend/                 # (เปลี่ยนชื่อจาก frontend/ — ทำใน Phase 0, ดูหมายเหตุ)
│  └─ src/ ...               # Flask + engine + utils  (ไม่แตะ logic)
├─ frontend/                     # ★ Vue SPA ใหม่
│  ├─ index.html            # entry ของ Vite (dev)
│  ├─ vite.config.js
│  ├─ package.json
│  └─ src/
│     ├─ main.js            # createApp + router + pinia + i18n
│     ├─ App.vue            # layout: <NavBar/> + <RouterView/>
│     ├─ router/index.js    # 6 routes
│     ├─ api/client.js      # fetch wrapper (base /api)
│     ├─ stores/            # pinia: engine, cameras, brand, ui
│     ├─ composables/       # usePolling, useChart, …
│     ├─ i18n/              # index.js + locales/en.js, th.js (พอร์ตจาก translations.js)
│     ├─ assets/style.css   # ย้าย style.css เข้ามา
│     ├─ components/        # NavBar, StatusPill, StartButton, LangSwitcher,
│     │                     #   Card, KpiCard, AlertList, CameraFeed, CameraTabs, …
│     └─ views/             # LiveView, DashboardView, ZonesView,
│                           #   BehaviorsView, HeatMapView, SettingsView
└─ (build output) → templates/index.html + static/assets/*  (ให้ Flask เสิร์ฟ)
```

> **หมายเหตุการเปลี่ยนชื่อ `frontend/` → `backend/`:** เป็น optional และเสี่ยง
> (กระทบ Dockerfile + `python -m src.api.server` + import). ถ้าอยากเลี่ยงความเสี่ยง
> ช่วงแรก เก็บ backend ไว้ที่ `frontend/src/` เดิมก็ได้ แล้วค่อยเปลี่ยนชื่อตอนท้าย
> ตัว Vue app วางที่ `frontend/` แยกชัดเจนอยู่แล้ว

---

## 4. การ integrate กับ Flask (จุดสำคัญที่สุด)

**Dev:** รัน 2 process
- `cd frontend && npm run dev` → Vite dev server (`:5173`) มี HMR
- Flask รันตามปกติ (`:5001`)
- `vite.config.js` ตั้ง proxy: `/api`, `/translations.js` → `http://localhost:5001`
  (MJPEG stream อยู่ใต้ `/api` จึงผ่าน proxy อัตโนมัติ)

**Prod / Docker:** `npm run build` แล้วให้ผลลัพธ์ตรงกับที่ Flask เสิร์ฟอยู่แล้ว
- `vite.config.js`: `base: '/static/'`, `build.outDir = '<static dir>'`,
  `emptyOutDir: false` (กันลบ `assets/icon.*` ที่มีอยู่)
- post-build copy: `static/index.html` → `templates/index.html`
  (เพราะ Flask อ่าน `TMPL_PATH = templates/index.html`)
  — ทางเลือก: แก้ route `index()` ให้เสิร์ฟ `static/index.html` ตรง ๆ (เปลี่ยน Flask 1 บรรทัด)

**Dockerfile → multi-stage:**
```dockerfile
# stage 1: build Vue
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # ออก dist/

# stage 2: python (เดิม) + copy ผลลัพธ์ build
FROM python:3.12-slim
...
COPY --from=web /frontend/dist/static/    ./static/
COPY --from=web /frontend/dist/templates/ ./templates/
```

---

## 5. การ map ของเดิม → Vue

| ของเดิม (vanilla) | ของใหม่ (Vue) |
|---|---|
| `showPage('live', …)` ซ่อน-โชว์ div | **vue-router** + `<router-link>` |
| global `toggleEngine()` / สถานะ start-stop | **pinia `engineStore`** (`isRunning`, `start()`, `stop()`, poll status) |
| `setLang()` / `window.isTH()` / `translations.js` | **vue-i18n** (`en.js`, `th.js`) + persist `localStorage fs_lang` |
| `fetch('/api/...')` กระจายทั่วไฟล์ | **`api/client.js`** + เรียกจาก store/composable |
| `setInterval` หลายจุด (hud, dash) | **`usePolling()`** ผูกกับ mount/unmount + route ที่ active |
| Chart.js สร้าง/ทำลายเอง | **`useChart()`** composable (destroy ตอน unmount) |
| canvas วาด zone (Zones page) | component เดียวที่ถือ `canvas ref` + pointer events |
| `<img id="live-stream">` MJPEG | `<CameraFeed :src="streamUrl">` (img เฉย ๆ) |

**Libraries:** `vue`, `vue-router`, `pinia`, `vue-i18n`, `chart.js` (ใช้ตัวเดิม, import ผ่าน npm แทน CDN)

---

## 6. แผนทำทีละเฟส (incremental — ของเดิมยังใช้ได้ตลอด)

> กลยุทธ์อยู่ร่วมกัน: เสิร์ฟ Vue ที่ `/v2` ก่อน, ของเดิมอยู่ที่ `/`
> พอ parity ครบทุกหน้าแล้วค่อย **cutover** สลับ `/` เป็น Vue แล้วลบของเก่า

**Phase 0 — เก็บกวาด + วาง path ให้ตรง** *(เล็ก, ทำก่อน)*
- ตัดสินเรื่องเปลี่ยนชื่อ `frontend/`→`backend/` (หรือเลื่อนไว้ท้าย)
- ทำให้ `templates/` + `static/` ที่ Flask คาดหวัง มีอยู่จริงและตรงกันทั้ง host/Docker
- ลบโฟลเดอร์สะกดผิด `viwe/` (ย้าย index.html ไป template path ที่ถูก)

**Phase 1 — Scaffold + build pipeline** *(วางรากฐาน)*
- สร้าง `frontend/` (Vite + Vue 3), ติดตั้ง router/pinia/i18n/chart.js
- ตั้ง vite proxy (dev) + base/outDir (prod) + post-build copy
- แก้ Dockerfile เป็น multi-stage
- `App.vue` + `NavBar` + 6 route ว่าง (placeholder) → **verify ว่า build แล้ว Flask เสิร์ฟได้**

**Phase 2 — Shared infra**
- `api/client.js`, `engineStore` (start/stop + poll `/api/...`), `StatusPill`, `StartButton`
- `LangSwitcher` + vue-i18n (พอร์ต `translations.js` → `en.js`/`th.js`)

**Phase 3 — Live** → cameras, `CameraFeed` (MJPEG), HUD polling, alerts, tab/grid view
**Phase 4 — Dashboard** → KPI, hourly chart, zone bars, activity table, AI insight, export PDF/CSV
**Phase 5 — Zones** → canvas editor + load/save/delete/clear *(หน้ายากสุด)*
**Phase 6 — Behaviors** → ฟอร์ม config + save/reset
**Phase 7 — Heat Map** → jpeg + reset + zones overlay
**Phase 8 — Settings** → settings + brand save

**Phase 9 — Cutover & cleanup**
- สลับ Flask `index()` ให้เสิร์ฟ Vue build ที่ `/`
- ลบ `static/js/app.js`, `i18n.js`, `viwe/index.html` เก่า
- เก็บ `style.css` (ย้ายเข้า `frontend/src/assets/`)

---

## 7. ความเสี่ยง / จุดต้องระวัง

- **Path/serve mismatch (host↔Docker)** — เคลียร์ใน Phase 0 ก่อน ไม่งั้นพังตอน build
- **MJPEG** — ห้ามให้ Vue reactivity ไป re-render `<img>` ถี่ ๆ จน stream หลุด → bind `src` ครั้งเดียว
- **Chart.js memory leak** — ต้อง `chart.destroy()` ทุก unmount (ทำใน `useChart`)
- **i18n backward-compat** — มีโค้ด/route `/translations.js` ฝั่ง server; ตอนพอร์ตต้องไม่ทำให้ของเดิม (ที่ยังรันคู่กัน) พัง
- **Zones canvas** — เป็น stateful UI ที่ซับซ้อนสุด แยก component ชัด ๆ ทำเป็น Phase เดี่ยว
- **`emptyOutDir: false`** — กันเผลอลบ `static/assets/icon.*`

---

## 8. สิ่งที่จะส่งมอบเมื่อจบ

- Vue SPA แตก component ครบ 6 หน้า, มี router/store/i18n
- `npm run dev` (HMR) + `npm run build` (เสิร์ฟผ่าน Flask) ใช้งานได้
- Dockerfile multi-stage build เสร็จในคอนเทนเนอร์
- ลบโค้ด vanilla เดิมทิ้ง, โครงสร้างโฟลเดอร์สะอาด

---
*ขั้นถัดไป: อนุมัติแผนนี้ → เริ่ม Phase 0 + Phase 1 (scaffold) ให้เห็นโครง Vue เปล่า ๆ เสิร์ฟผ่าน Flask ได้จริงก่อน*
