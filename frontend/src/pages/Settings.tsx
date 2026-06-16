import { useEffect, useState } from "react";
import { api, type Brand, type Camera, type Settings } from "../api";
import { useLang } from "../i18n";
import { Plus, Save, Trash2, AlertTriangle } from "lucide-react";

export function SettingsPage() {
  const { t } = useLang();
  const [brand, setBrand] = useState<Brand>({ name: "", tagline: "" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState<{ events: number; occupancy: number } | null>(null);

  useEffect(() => {
    api.brand().then(setBrand).catch(() => {});
    api.settings().then((s) => {
      setSettings(s);
      setCameras(s.cameras || []);
    }).catch(() => {});
  }, []);

  const saveAll = async () => {
    setSaved(false);
    try {
      await api.brandSave(brand);
      if (settings) {
        await api.settingsSave({
          conf: settings.conf,
          anonymize: settings.anonymize,
          dwell_interested: settings.dwell_interested,
          dwell_loitering: settings.dwell_loitering,
          dwell_checkout_min: settings.dwell_checkout_min,
          dwell_seating_waiting: settings.dwell_seating_waiting,
          gemini_api_key: settings.gemini_api_key,
          claude_api_key: settings.claude_api_key,
        });
      }
      await api.camerasSave(cameras);
      setSaved(true);
    } catch (e) { console.error(e); }
  };

  const updateCam = (i: number, patch: Partial<Camera>) =>
    setCameras((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const addCam = () => setCameras((cs) => [...cs, { id: `cam${cs.length + 1}`, name: `Camera ${cs.length + 1}`, rtsp_url: "", enabled: true }]);
  const removeCam = (i: number) => setCameras((cs) => cs.filter((_, k) => k !== i));

  const updateSettings = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  const clearData = async () => {
    if (clearing || !confirm(t.settings.clearConfirm)) return;
    setClearing(true);
    setCleared(null);
    try {
      const r = await api.dataClear();
      setCleared({ events: r.events, occupancy: r.occupancy });
    } catch (e) {
      console.error(e);
      alert("❌ " + String(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.settings.title}</h1>
          <p className="text-sm text-muted-foreground">Manage branding, detection thresholds, AI keys, and cameras.</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="fs-pill" style={{ color: "var(--success)" }}>{t.settings.saved}</span>}
          <button className="fs-btn" onClick={saveAll}><Save size={14} />{t.settings.saveAll}</button>
        </div>
      </div>

      <div className="fs-card space-y-4">
        <h2 className="font-semibold">{t.settings.branding}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t.settings.brandName}>
            <input className="fs-input" value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
          </Field>
          <Field label={t.settings.tagline}>
            <input className="fs-input" value={brand.tagline} onChange={(e) => setBrand({ ...brand, tagline: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="fs-card space-y-4">
        <h2 className="font-semibold">{t.settings.detection}</h2>
        {!settings ? <p className="text-muted-foreground text-sm">{t.common.loading}</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={`${t.settings.confidence}: ${settings.conf.toFixed(2)}`}>
              <input type="range" min={0.1} max={0.9} step={0.05}
                value={settings.conf} onChange={(e) => updateSettings({ conf: Number(e.target.value) })}
                className="w-full accent-[var(--color-primary)]" />
            </Field>
            <Field label={t.settings.anonymize}>
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input type="checkbox" checked={settings.anonymize} onChange={(e) => updateSettings({ anonymize: e.target.checked })} />
                <span className="text-muted-foreground">Blur faces and IDs</span>
              </label>
            </Field>
            <Field label={t.settings.dwellInterested}>
              <input type="number" className="fs-input" value={settings.dwell_interested} onChange={(e) => updateSettings({ dwell_interested: Number(e.target.value) })} />
            </Field>
            <Field label={t.settings.dwellLoitering}>
              <input type="number" className="fs-input" value={settings.dwell_loitering} onChange={(e) => updateSettings({ dwell_loitering: Number(e.target.value) })} />
            </Field>
            <Field label={t.settings.dwellCheckout}>
              <input type="number" className="fs-input" value={settings.dwell_checkout_min} onChange={(e) => updateSettings({ dwell_checkout_min: Number(e.target.value) })} />
            </Field>
            <Field label={t.settings.dwellSeating}>
              <input type="number" className="fs-input" value={settings.dwell_seating_waiting} onChange={(e) => updateSettings({ dwell_seating_waiting: Number(e.target.value) })} />
            </Field>
          </div>
        )}
      </div>

      <div className="fs-card space-y-4">
        <h2 className="font-semibold">{t.settings.aiKeys}</h2>
        {!settings ? <p className="text-muted-foreground text-sm">{t.common.loading}</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t.settings.gemini}>
              <input type="password" className="fs-input font-mono" value={settings.gemini_api_key}
                onChange={(e) => updateSettings({ gemini_api_key: e.target.value })} placeholder="***" />
            </Field>
            <Field label={t.settings.claude}>
              <input type="password" className="fs-input font-mono" value={settings.claude_api_key}
                onChange={(e) => updateSettings({ claude_api_key: e.target.value })} placeholder="***" />
            </Field>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Leaving the masked value (***) unchanged keeps the existing key.</p>
      </div>

      <div className="fs-card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t.settings.cameras}</h2>
          <button className="fs-btn-outline" onClick={addCam}><Plus size={14} />{t.common.add}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 px-2 font-medium">{t.settings.camId}</th>
                <th className="py-2 px-2 font-medium">{t.settings.camName}</th>
                <th className="py-2 px-2 font-medium">{t.settings.camRtsp}</th>
                <th className="py-2 px-2 font-medium">{t.settings.camEnabled}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cameras.map((c, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2 px-2"><input className="fs-input" value={c.id} onChange={(e) => updateCam(i, { id: e.target.value })} /></td>
                  <td className="py-2 px-2"><input className="fs-input" value={c.name} onChange={(e) => updateCam(i, { name: e.target.value })} /></td>
                  <td className="py-2 px-2"><input className="fs-input font-mono text-xs" value={c.rtsp_url} onChange={(e) => updateCam(i, { rtsp_url: e.target.value })} placeholder="rtsp://…" /></td>
                  <td className="py-2 px-2"><input type="checkbox" checked={c.enabled} onChange={(e) => updateCam(i, { enabled: e.target.checked })} /></td>
                  <td className="py-2 px-2 text-right"><button className="text-muted-foreground hover:text-destructive" onClick={() => removeCam(i)}><Trash2 size={16} /></button></td>
                </tr>
              ))}
              {cameras.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">{t.common.noData}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="fs-card space-y-3" style={{ borderColor: "var(--destructive)" }}>
        <h2 className="font-semibold flex items-center gap-2" style={{ color: "var(--destructive)" }}>
          <AlertTriangle size={16} />{t.settings.dangerZone}
        </h2>
        <p className="text-sm text-muted-foreground">{t.settings.clearDataDesc}</p>
        <div className="flex items-center gap-3">
          <button className="fs-btn-outline" style={{ color: "var(--destructive)", borderColor: "var(--destructive)" }}
            onClick={clearData} disabled={clearing}>
            <Trash2 size={14} />{clearing ? "…" : t.settings.clearData}
          </button>
          {cleared && (
            <span className="text-sm" style={{ color: "var(--success)" }}>
              {t.settings.clearDone}: {cleared.events} events, {cleared.occupancy} occupancy
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  );
}
