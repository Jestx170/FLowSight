import { useEffect, useState } from "react";
import { api, type Camera, type HeatZone } from "../api";
import { useLang } from "../i18n";
import { RotateCcw, Save } from "lucide-react";

export function HeatmapPage() {
  const { t } = useLang();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cam, setCam] = useState("");
  const [bust, setBust] = useState(Date.now());
  const [zones, setZones] = useState<HeatZone[]>([]);

  const [viewMode, setViewMode] = useState<'mass' | 'density'>('mass');
  const [timeMode, setTimeMode] = useState<'live' | 'cumulative'>('live');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.cameras().then((r) => { setCameras(r.cameras); if (r.cameras[0]) setCam((c) => c || r.cameras[0].id); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cam) return;
    const tick = () => { setBust(Date.now()); api.heatmapZones(cam, timeMode).then(setZones).catch(() => setZones([])); };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [cam, timeMode]);

  // Mass and Density rank zones differently (total footfall vs. how packed a
  // zone is per unit area) — re-sort by whichever metric is selected so the
  // two views actually look different instead of just relabeling the same bars.
  const sortedZones = [...zones].sort((a, b) =>
    viewMode === 'mass' ? b.mass - a.mass : b.density - a.density);

  const reset = async () => { try { await api.heatmapReset(); setBust(Date.now()); } catch (e) { console.error(e); } };
  const saveReport = async () => {
    if (!cam || saving) return;
    setSaving(true);
    try {
      const r = await api.heatmapReport(cam);
      const top = r.zones[0];
      // Report always reads the cumulative (whole-session) engine regardless
      // of the Live/Cumulative toggle above — that's what makes it a usable
      // end-of-day summary instead of whatever's live at the moment you click.
      alert(`✅ บันทึก Report สำเร็จ — สะสมทั้งเซสชัน (${r.zone_count} โซน)` +
            (top ? `\nโซนที่มีคนใช้งานมากสุด: ${top.name} (Mass ${top.mass})` : "") +
            `\n\nไฟล์: ${r.file}`);
    } catch (e) {
      console.error(e);
      alert("❌ บันทึก Report ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  };
  const maxScore = Math.max(1, ...sortedZones.map((z) => viewMode === 'mass' ? z.mass : z.density));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.heat.title}</h1>
          <p className="text-sm text-muted-foreground">Accumulated movement intensity per zone.</p>
        </div>
        <div className="flex items-center gap-2">
          {cameras.length > 1 && (
            <div className="flex gap-1 border border-border rounded-md p-0.5 bg-surface">
              {cameras.map((c) => (
                <button key={c.id} onClick={() => setCam(c.id)}
                  className={"px-3 py-1.5 text-sm rounded " + (cam === c.id ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  {c.name || c.id}
                </button>
              ))}
            </div>
          )}
          <button className="fs-btn-outline" onClick={reset}><RotateCcw size={14} />{t.heat.reset}</button>
          <button className="fs-btn" onClick={saveReport} disabled={saving || !cam}>
            <Save size={14} />{saving ? "Saving…" : "Stop & Save Report"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex gap-2 border border-border w-fit rounded-lg p-1">
          <button
            onClick={() => setTimeMode('live')}
            className={`px-4 py-1.5 text-sm rounded ${timeMode === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Live (now)
          </button>
          <button
            onClick={() => setTimeMode('cumulative')}
            className={`px-4 py-1.5 text-sm rounded ${timeMode === 'cumulative' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Cumulative (whole session)
          </button>
        </div>

        <div className="flex gap-2 border border-border w-fit rounded-lg p-1">
          <button
            onClick={() => setViewMode('mass')}
            className={`px-4 py-1.5 text-sm rounded ${viewMode === 'mass' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Total Mass
          </button>
          <button
            onClick={() => setViewMode('density')}
            className={`px-4 py-1.5 text-sm rounded ${viewMode === 'density' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            Average Density
          </button>
        </div>
      </div>

      <div className="fs-card text-sm leading-relaxed space-y-2">
        {timeMode === 'live' ? (
          <p>
            <span className="font-semibold text-foreground">Live (now):</span>{" "}
            <span className="text-muted-foreground">
              ความเข้มจะค่อยๆจางลงเมื่อจุดนั้นไม่มีคนแล้ว (ครึ่งความเข้มทุก ~20 วินาที) —
              เหมาะกับดูว่า "ตอนนี้" ตรงไหนมีคนอยู่ ไม่เหมาะกับสรุปทั้งวัน เพราะถ้าทิ้งไว้นานความเข้มจะจางจนเหลือ 0
              ก่อนถึงเวลาที่คุณจะมาดูสรุป
            </span>
          </p>
        ) : (
          <p>
            <span className="font-semibold text-foreground">Cumulative (whole session):</span>{" "}
            <span className="text-muted-foreground">
              สะสมไปเรื่อยๆไม่จางหาย ตั้งแต่กด Reset ครั้งล่าสุด — ใช้โหมดนี้ถ้าจะเปิดระบบทิ้งไว้ทั้งวัน (เช่น 9:00–19:00)
              แล้วกด "Stop & Save Report" ตอนปิดร้านเพื่อดูสรุปฮีตแมปทั้งวัน ไม่ใช่แค่ไม่กี่วินาทีล่าสุด
            </span>
          </p>
        )}
        {viewMode === 'mass' ? (
          <p>
            <span className="font-semibold text-foreground">Mass (Total):</span>{" "}
            <span className="text-muted-foreground">
              เหมาะสำหรับการวิเคราะห์ "ความนิยมของพื้นที่" (เช่น ทางเดินหลัก, หน้าร้านค้า)
              ยิ่งค่าสูงยิ่งแสดงว่ามีคนใช้งานเยอะ
            </span>
          </p>
        ) : (
          <p>
            <span className="font-semibold text-foreground">Density (Average):</span>{" "}
            <span className="text-muted-foreground">
              เหมาะสำหรับการวิเคราะห์ "ความแออัด" (เช่น จุดพักคอย, หน้าเคาน์เตอร์ชำระเงิน)
              หากโซนขนาดเล็กมีค่า Density สูง แสดงว่าจุดนั้นเกิดการกระจุกตัวของคนสูงเกินไป
            </span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="fs-card lg:col-span-2">
          <div className="rounded-md overflow-hidden border border-border bg-black aspect-video flex items-center justify-center">
            {cam ? (
              <img key={`${bust}-${timeMode}`} src={api.heatmapJpegUrl(cam, timeMode, bust)} alt="Heatmap"
                className="w-full h-full object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
            ) : (
              <span className="text-muted-foreground text-sm">{t.common.engineStopped}</span>
            )}
          </div>
        </div>

        <div className="fs-card">
          <h2 className="font-semibold mb-3">{t.heat.zoneScores}</h2>
          {sortedZones.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t.common.noData}</p>
          ) : (
            <ul className="space-y-3">
              {sortedZones.map((z) => {
                // เลือกค่าที่จะนำมาแสดงและคำนวณ Progress Bar ตามโหมดที่เลือก
                const val = viewMode === 'mass' ? z.mass : z.density;
                return (
                  <li key={z.zone_id}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{z.name}</span>
                      <span className="text-muted-foreground">{val.toFixed(1)}</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" 
                           style={{ width: `${(val / maxScore) * 100}%`, background: "linear-gradient(90deg,#4A4F54,#F5B731,#DC3545)" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}