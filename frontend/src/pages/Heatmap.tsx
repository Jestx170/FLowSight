import { useEffect, useState } from "react";
import { api, type Camera, type HeatZone } from "../api";
import { useLang } from "../i18n";
import { RotateCcw } from "lucide-react";

export function HeatmapPage() {
  const { t } = useLang();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cam, setCam] = useState("");
  const [bust, setBust] = useState(Date.now());
  const [zones, setZones] = useState<HeatZone[]>([]);

  useEffect(() => {
    api.cameras().then((r) => { setCameras(r.cameras); if (r.cameras[0]) setCam((c) => c || r.cameras[0].id); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!cam) return;
    const tick = () => { setBust(Date.now()); api.heatmapZones(cam).then(setZones).catch(() => setZones([])); };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, [cam]);

  const reset = async () => { try { await api.heatmapReset(); setBust(Date.now()); } catch (e) { console.error(e); } };
  const maxScore = Math.max(1, ...zones.map((z) => z.score));

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
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="fs-card lg:col-span-2">
          <div className="rounded-md overflow-hidden border border-border bg-black aspect-video flex items-center justify-center">
            {cam ? (
              <img key={bust} src={`/api/heatmap/jpeg?cam=${encodeURIComponent(cam)}&t=${bust}`} alt="Heatmap"
                className="w-full h-full object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
            ) : (
              <span className="text-muted-foreground text-sm">{t.common.engineStopped}</span>
            )}
          </div>
        </div>

        <div className="fs-card">
          <h2 className="font-semibold mb-3">{t.heat.zoneScores}</h2>
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t.common.noData}</p>
          ) : (
            <ul className="space-y-3">
              {zones.map((z) => (
                <li key={z.zone_id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{z.name}</span>
                    <span className="text-muted-foreground">{z.score.toFixed(1)}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(z.score / maxScore) * 100}%`, background: "linear-gradient(90deg,#714B67,#F0AD4E,#DC3545)" }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
