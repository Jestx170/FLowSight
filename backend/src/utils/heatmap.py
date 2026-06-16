# =============================================================================
# heatmap.py — FlowSight Customer Heat Map Generator
# สร้าง heat map จาก trajectory data ของลูกค้า
# =============================================================================
import cv2, numpy as np, logging, json, time
from pathlib import Path

log = logging.getLogger("flowsight.heatmap")

# Per-frame contribution from a stalled/resumed stream is capped at this many
# wall-clock seconds so a long gap (reconnect) can't dump one giant blob.
_MAX_ADD_DT = 0.5

class HeatMapEngine:
    """Live crowd-density heat map.

    Heat decays on a wall-clock half-life (not a frame count) and each person's
    contribution is scaled by elapsed time, so the map reflects CURRENT density
    and is independent of frame rate — a person standing for one real second
    deposits the same heat whether the camera runs at 5 fps or 30 fps, and a
    vacated spot fades with the same half-life on every camera.

    For a long-horizon cumulative-footfall map, set half_life_sec very large
    (or 0 to disable decay entirely).
    """

    def __init__(self, width: int = 1280, height: int = 720,
                 half_life_sec: float = 20.0, decay=None):
        self.w             = width
        self.h             = height
        # Seconds for a vacated spot's heat to halve. 0 disables decay
        # (pure cumulative footfall).
        self.half_life_sec = float(half_life_sec)
        self._heat         = np.zeros((height, width), dtype=np.float32)
        self._last_t       = None   # monotonic time of previous update
        if decay is not None:
            log.warning("HeatMapEngine: 'decay' is deprecated and ignored; "
                        "use half_life_sec (current=%.1fs)", self.half_life_sec)

    def update(self, persons: list, now: float | None = None):
        """Add current person positions to heat map.

        now — monotonic timestamp (seconds); injectable for tests. Defaults to
        time.monotonic().
        """
        if now is None:
            now = time.monotonic()
        if self._last_t is None:
            dt = 1.0 / 15.0          # nominal first-frame step
        else:
            dt = max(0.0, now - self._last_t)
        self._last_t = now

        # Time-based exponential decay (frame-rate independent)
        if dt > 0 and self.half_life_sec > 0:
            self._heat *= float(0.5 ** (dt / self.half_life_sec))

        # Contribution scaled by elapsed time (capped against stream stalls)
        add_dt = min(dt, _MAX_ADD_DT)
        if add_dt <= 0:
            return

        r = max(self.w, self.h) // 20
        # Pre-build distance grid for the blob (vectorized, reused each call).
        # Scaled by add_dt so the deposit is per-second, not per-frame.
        _ys, _xs = np.ogrid[-r:r+1, -r:r+1]
        _blob_base = (np.clip(1.0 - np.hypot(_xs, _ys) / r, 0, None)
                      * add_dt).astype(np.float32)

        for p in persons:
            cx, cy = p.get("center", (0, 0))
            cx = max(0, min(self.w-1, int(cx)))
            cy = max(0, min(self.h-1, int(cy)))
            # Crop blob to image boundary
            bx1, bx2 = cx - r, cx + r + 1
            by1, by2 = cy - r, cy + r + 1
            sx1 = max(0, -bx1); sx2 = _blob_base.shape[1] - max(0, bx2 - self.w)
            sy1 = max(0, -by1); sy2 = _blob_base.shape[0] - max(0, by2 - self.h)
            fx1, fx2 = max(0, bx1), min(self.w, bx2)
            fy1, fy2 = max(0, by1), min(self.h, by2)
            if fx2 > fx1 and fy2 > fy1:
                self._heat[fy1:fy2, fx1:fx2] += _blob_base[sy1:sy2, sx1:sx2]

    def get_overlay(self, frame: np.ndarray, alpha: float = 0.45) -> np.ndarray:
        """Return frame with heat map overlay"""
        if self._heat.max() < 0.1:
            return frame

        # Normalize and colorize
        norm = cv2.normalize(self._heat, None, 0, 255, cv2.NORM_MINMAX)
        heat_u8  = norm.astype(np.uint8)
        colored  = cv2.applyColorMap(heat_u8, cv2.COLORMAP_JET)

        # Resize to match frame if needed
        h_f, w_f = frame.shape[:2]
        if colored.shape[:2] != (h_f, w_f):
            colored = cv2.resize(colored, (w_f, h_f))

        # Blend — only where heat > threshold
        mask = (heat_u8 > 15).astype(np.float32)
        if heat_u8.shape != (h_f, w_f):
            mask = cv2.resize(mask, (w_f, h_f))
        mask = mask[:, :, np.newaxis]

        blended = (frame * (1 - alpha * mask) +
                   colored * alpha * mask).astype(np.uint8)
        return blended

    def get_jpeg(self, frame: np.ndarray, alpha: float = 0.45,
                 quality: int = 75) -> bytes:
        """Return heat map overlay as JPEG bytes"""
        overlay = self.get_overlay(frame, alpha)
        _, jpg = cv2.imencode(".jpg", overlay,
                              [cv2.IMWRITE_JPEG_QUALITY, quality])
        return jpg.tobytes()

    def save_snapshot(self, frame: np.ndarray, out_path: str,
                      alpha: float = 0.55):
        """Save heat map snapshot to file"""
        overlay = self.get_overlay(frame, alpha)
        cv2.imwrite(out_path, overlay)
        log.info("Heat map saved: %s", out_path)

    def reset(self):
        self._heat.fill(0)
        self._last_t = None
        log.info("Heat map reset")

    def get_top_zones(self, zones_poly: dict, top_n: int = 5) -> list:
        scores = []
        for zone_id, zone_data in zones_poly.items(): # สมมติว่า zone_data เก็บ {poly: [...], name: "..."}
            poly = zone_data.get("poly")
            name = zone_data.get("name", zone_id) # ถ้าไม่มีชื่อ ให้ใช้ ID แทน
            
            if poly is None or len(poly) < 3:
                continue
                
            mask = np.zeros(self._heat.shape, dtype=np.uint8)
            cv2.fillPoly(mask, [poly.astype(np.int32)], 255)
            zone_heat = self._heat[mask > 0]
            
            if zone_heat.size > 0:
                scores.append({
                    "zone_id": zone_id,
                    "name": name,
                    "mass": float(zone_heat.sum()),
                    "density": float(zone_heat.mean())
                })
        
        # เรียงลำดับตาม mass (เปลี่ยนจากเดิมที่เรียง index 1)
        scores.sort(key=lambda x: x["mass"], reverse=True)
        return scores[:top_n]

    def generate_report(self, zones_poly: dict, out_dir: str = "reports",
                        top_n: int = 5, frame: np.ndarray | None = None) -> dict:
        """Snapshot the CURRENT top zones into a timestamped JSON report.

        Reads the live heat buffer at call time, so mass/density reflect the
        latest accumulated state right before the caller stops the engine.
        Writes <out_dir>/heatmap_report_YYYYMMDD_HHMMSS.json and returns the
        report dict (with the saved file path attached as "file").

        If `frame` (the camera's latest raw frame) is given, also saves a
        colorized heat-map snapshot next to the JSON as a .jpg, so the report
        carries a visual you can hand straight to marketing — not just numbers.
        The filename is recorded in the report under "image".
        """
        top = self.get_top_zones(zones_poly, top_n=top_n)
        ts  = time.strftime("%Y%m%d_%H%M%S")
        report = {
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "zone_count": len(top),
            "zones": [
                {"zone_id": z["zone_id"], "name": z["name"],
                 "mass": round(z["mass"], 2), "density": round(z["density"], 2)}
                for z in top
            ],
        }

        out  = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)

        if frame is not None:
            img_name = f"heatmap_report_{ts}.jpg"
            self.save_snapshot(frame, str(out / img_name))
            report["image"] = img_name

        path = out / f"heatmap_report_{ts}.json"
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2),
                        encoding="utf-8")

        report["file"] = str(path)
        log.info("Heat map report saved: %s (%d zones)", path, len(top))
        return report
