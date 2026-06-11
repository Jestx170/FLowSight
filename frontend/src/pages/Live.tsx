import { useEffect, useRef, useState } from "react";
import { api, useApiPoll, type Camera } from "../api";
import { useLang } from "../i18n";
import { Play, Square, AlertTriangle, Users, UserCheck, Cpu, Bell, LayoutGrid, RectangleHorizontal } from "lucide-react";

export function LivePage() {
  const { t } = useLang();
  const [activeCam, setActiveCam] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"single" | "grid">(
    () => ((localStorage.getItem("cam_view") as "single" | "grid") || "single"),
  );
  const setViewMode = (v: "single" | "grid") => { setView(v); localStorage.setItem("cam_view", v); };

  const cams = useApiPoll(api.cameras, 1500);
  const hud = useApiPoll(api.hud, 1500);
  const alerts = useApiPoll(api.alerts, 1500);

  const cameras: Camera[] = cams.data?.cameras ?? [];
  useEffect(() => {
    if (!activeCam && cameras.length) setActiveCam(cameras[0].id);
  }, [cameras, activeCam]);

  const running = !!hud.data?.running;

  const toggle = async () => {
    setBusy(true);
    try {
      if (running) await api.stop();
      else await api.start();
    } catch (e) { console.error(e); }
    setBusy(false);
  };

  // Per-camera start/stop. `cams` is polled, so the running dot updates on its own.
  const [camBusy, setCamBusy] = useState<Record<string, boolean>>({});
  const toggleCam = async (camId: string, isRunning: boolean) => {
    setCamBusy((m) => ({ ...m, [camId]: true }));
    try {
      if (isRunning) await api.stop(camId);
      else await api.start(camId);
    } catch (e) { console.error(e); }
    setCamBusy((m) => ({ ...m, [camId]: false }));
  };

  const recent = (alerts.data ?? []).slice(0, 30);
  const activeCamObj = cameras.find((c) => c.id === activeCam);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t.live.title}</h1>
          <p className="text-sm text-muted-foreground">Real-time camera feed and alerts</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={"fs-pill " + (running ? "" : "")} style={{ color: running ? "var(--success)" : "var(--muted-foreground)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: running ? "var(--success)" : "var(--muted-foreground)" }} />
            {running ? t.common.running : t.common.stopped}
          </span>
          <button onClick={toggle} disabled={busy} className={running ? "fs-btn-danger" : "fs-btn"}>
            {running ? <Square size={14} /> : <Play size={14} />}
            {running ? t.common.stop : t.common.start}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiChip icon={<Users size={18} />} label={t.live.customers} value={hud.data?.cust ?? 0} />
        <KpiChip icon={<UserCheck size={18} />} label={t.live.staff} value={hud.data?.seller ?? 0} />
        <KpiChip icon={<Bell size={18} />} label={t.live.alerts} value={hud.data?.alert ?? 0} accent="warning" />
        <KpiChip icon={<Cpu size={18} />} label={t.live.device} value={hud.data?.device ?? "cpu"} mono />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 fs-card">
          <div className="flex items-center justify-between gap-2 mb-3 border-b border-border">
            {/* camera tabs — single view only */}
            <div className="flex gap-1 overflow-x-auto">
              {view === "single" && cameras.length > 1 && cameras.map((c) => (
                <button key={c.id} onClick={() => setActiveCam(c.id)}
                  className={"px-3 py-1.5 text-sm border-b-2 -mb-px whitespace-nowrap " + (activeCam === c.id ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground")}>
                  {c.name || c.id}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* per-camera start/stop for the active camera (single view) */}
              {view === "single" && activeCamObj && (
                <button onClick={() => toggleCam(activeCamObj.id, !!activeCamObj.running)} disabled={!!camBusy[activeCamObj.id]}
                  className={"inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border " +
                    (activeCamObj.running ? "border-destructive/40 text-destructive" : "border-border text-foreground hover:border-primary hover:text-primary")}>
                  {activeCamObj.running ? <Square size={12} /> : <Play size={12} />}
                  {activeCamObj.running ? t.live.camStop : t.live.camStart}
                </button>
              )}
              {/* view toggle: Single | Grid */}
              <div className="flex items-center gap-0.5 border border-border rounded-md p-0.5">
                <button onClick={() => setViewMode("single")} title={t.live.viewSingle}
                  className={"inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded " + (view === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  <RectangleHorizontal size={13} />{t.live.viewSingle}
                </button>
                <button onClick={() => setViewMode("grid")} title={t.live.viewGrid}
                  className={"inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded " + (view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                  <LayoutGrid size={13} />{t.live.viewGrid}
                </button>
              </div>
            </div>
          </div>

          {view === "single" ? (
            <div className="bg-[#111] rounded-md overflow-hidden aspect-video flex items-center justify-center">
              {activeCam ? (
                <CameraStream camId={activeCam} running={running} />
              ) : (
                <span className="text-muted-foreground text-sm">{t.common.engineStopped}</span>
              )}
            </div>
          ) : (
            <div className={"grid gap-3 " + (cameras.length > 1 ? "sm:grid-cols-2" : "grid-cols-1")}>
              {cameras.map((c) => {
                const ch = (hud.data?.cams as any)?.[c.id] ?? {};
                return (
                  <div key={c.id} className="rounded-md border border-border overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-surface text-xs">
                      <span className="font-medium truncate flex items-center gap-1.5">
                        <span className={"w-2 h-2 rounded-full " + (c.running ? "bg-[var(--success)]" : "bg-muted-foreground")} />
                        {c.name || c.id}
                      </span>
                      <button onClick={() => toggleCam(c.id, !!c.running)} disabled={!!camBusy[c.id]}
                        className={"inline-flex items-center gap-1 px-2 py-0.5 rounded border " +
                          (c.running ? "border-destructive/40 text-destructive" : "border-border hover:border-primary hover:text-primary")}>
                        {c.running ? <Square size={11} /> : <Play size={11} />}
                        {c.running ? t.live.camStop : t.live.camStart}
                      </button>
                    </div>
                    <div className="bg-[#111] aspect-video flex items-center justify-center">
                      <CameraStream camId={c.id} running={running} />
                    </div>
                    <div className="flex gap-3 px-3 py-1.5 text-xs text-muted-foreground bg-surface">
                      <span>{ch.cust ?? 0} {t.live.customers}</span>
                      <span>{ch.seller ?? 0} {t.live.staff}</span>
                      <span>{ch.alert ?? 0} {t.live.alerts}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fs-card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-primary" />
            <h2 className="font-semibold">{t.live.recentAlerts}</h2>
            <span className="ml-auto text-xs text-muted-foreground">{recent.length}</span>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t.live.noAlerts}</p>
          ) : (
            <ul className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {recent.map((a, i) => {
                const urgent = a.behavior_id === "loitering" || a.behavior_id === "waiting";
                return (
                  <li key={i} className={"rounded-md border px-3 py-2 text-sm " + (urgent ? "border-destructive/40 bg-destructive/5" : "border-border bg-secondary/40")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={"font-medium " + (urgent ? "text-destructive" : "text-foreground")}>{a.behavior}</span>
                      <span className="text-xs text-muted-foreground">{a.time}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {a.person} · {a.zone}
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

function KpiChip({ icon, label, value, mono, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; mono?: boolean; accent?: "warning" }) {
  return (
    <div className="fs-kpi flex items-center gap-3">
      <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={"text-lg font-semibold " + (accent === "warning" ? "text-warning" : "") + (mono ? " font-mono text-base" : "")}>
          {value}
        </div>
      </div>
    </div>
  );
}

// Keep <img src> stable: set ONCE when camId changes. Re-rendering with new src would
// kill the MJPEG socket and reconnect every poll, leaving the feed black.
function CameraStream({ camId, running }: { camId: string; running: boolean }) {
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (imgRef.current && running) {
      imgRef.current.src = `/api/stream/${camId}`;
    }
  }, [camId, running]);
  if (!running) {
    return <div className="text-muted-foreground text-sm">{ "Engine stopped. Start the engine to begin." }</div>;
  }
  return <img ref={imgRef} alt="Live feed" className="w-full h-full object-contain" />;
}
