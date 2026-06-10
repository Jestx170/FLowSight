import { useEffect, useState } from "react";
import { api, type BehaviorRow } from "../api";
import { useLang } from "../i18n";
import { BEH_TEMPLATES, templateToRows } from "../behaviorTemplates";
import { Plus, Save, RotateCcw, Trash2 } from "lucide-react";

const ACTIONS: BehaviorRow["action"][] = ["moving", "dwell", "still", "presence"];

export function BehaviorsPage() {
  const { t, lang } = useLang();
  const [rows, setRows] = useState<BehaviorRow[]>([]);
  const [savedAt, setSavedAt] = useState(0);

  const load = () => api.behaviors().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  // Apply a venue preset: replaces the whole list (after confirm) and saves it.
  const applyTemplate = async (key: string) => {
    const tpl = BEH_TEMPLATES.find((x) => x.key === key);
    if (!tpl) return;
    const info = lang === "th" ? tpl.th : tpl.en;
    if (!confirm(`${t.behaviors.applyConfirm} "${info.name}"?`)) return;
    const next = templateToRows(tpl, lang);
    setRows(next);
    try { await api.behaviorsSave(next); setSavedAt(Date.now()); } catch (e) { console.error(e); }
  };

  const update = (i: number, patch: Partial<BehaviorRow>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const addRow = () => setRows((rs) => [...rs, {
    id: `b_${Date.now()}`, name: "New behavior", zone: "", action: "dwell", threshold: 5, alert: true, color: "#714B67",
  }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, k) => k !== i));

  const save = async () => {
    try { await api.behaviorsSave(rows); setSavedAt(Date.now()); } catch (e) { console.error(e); }
  };
  const reset = async () => {
    try { await api.behaviorsReset(); await load(); } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.behaviors.title}</h1>
          <p className="text-sm text-muted-foreground">Define detection rules and alerts.</p>
        </div>
        <div className="flex gap-2">
          <button className="fs-btn-outline" onClick={addRow}><Plus size={14} />{t.behaviors.addRow}</button>
          <button className="fs-btn-outline" onClick={reset}><RotateCcw size={14} />{t.common.reset}</button>
          <button className="fs-btn" onClick={save}><Save size={14} />{t.common.save}</button>
        </div>
      </div>

      {savedAt > 0 && <div className="fs-pill" style={{ color: "var(--success)" }}>Saved</div>}

      <div className="fs-card">
        <h3 className="text-sm font-semibold mb-1">{t.behaviors.templates}</h3>
        <p className="text-xs text-muted-foreground mb-3">{t.behaviors.templatesHint}</p>
        <div className="flex flex-wrap gap-2">
          {BEH_TEMPLATES.map((tpl) => {
            const info = lang === "th" ? tpl.th : tpl.en;
            return (
              <button key={tpl.key} onClick={() => applyTemplate(tpl.key)} title={info.desc}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface hover:border-primary hover:text-primary text-sm transition-colors">
                <span className="text-lg leading-none">{tpl.icon}</span>
                <span className="font-medium">{info.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="fs-card overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2 px-2 font-medium">Name</th>
              <th className="py-2 px-2 font-medium">Zone</th>
              <th className="py-2 px-2 font-medium">{t.behaviors.actionLabel}</th>
              <th className="py-2 px-2 font-medium">{t.behaviors.thresholdLabel}</th>
              <th className="py-2 px-2 font-medium">{t.behaviors.alertLabel}</th>
              <th className="py-2 px-2 font-medium">Color</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? i} className="border-b border-border last:border-0">
                <td className="py-2 px-2"><input className="fs-input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                <td className="py-2 px-2"><input className="fs-input" value={r.zone} onChange={(e) => update(i, { zone: e.target.value })} /></td>
                <td className="py-2 px-2">
                  <select className="fs-input" value={r.action} onChange={(e) => update(i, { action: e.target.value as BehaviorRow["action"] })}>
                    {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </td>
                <td className="py-2 px-2"><input type="number" className="fs-input w-24" value={r.threshold} onChange={(e) => update(i, { threshold: Number(e.target.value) })} /></td>
                <td className="py-2 px-2"><input type="checkbox" checked={r.alert} onChange={(e) => update(i, { alert: e.target.checked })} /></td>
                <td className="py-2 px-2"><input type="color" value={r.color} onChange={(e) => update(i, { color: e.target.value })} className="h-8 w-12 rounded border border-border" /></td>
                <td className="py-2 px-2 text-right">
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => removeRow(i)}><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
