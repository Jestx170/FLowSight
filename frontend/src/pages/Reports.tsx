import { useEffect, useState } from "react";
import { api, type HeatReport, type HeatReportSummary } from "../api";
import { useLang } from "../i18n";
import { RotateCcw, FileText, Trash2 } from "lucide-react";

export function ReportsPage() {
  const { t } = useLang();
  const [list, setList] = useState<HeatReportSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<HeatReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.heatmapReports()
      .then((r) => {
        setList(r);
        // Auto-select the newest report on first load.
        setSelected((cur) => cur ?? (r[0]?.file ?? null));
      })
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    api.heatmapReportDetail(selected).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const deleteReport = async (file: string) => {
    if (deleting || !confirm(t.reports.deleteConfirm)) return;
    setDeleting(file);
    try {
      await api.heatmapReportDelete(file);
      setList((cur) => {
        const next = cur.filter((r) => r.file !== file);
        setSelected((cur2) => (cur2 === file ? (next[0]?.file ?? null) : cur2));
        return next;
      });
    } catch (e) {
      console.error(e);
      alert("❌ " + String(e));
    } finally {
      setDeleting(null);
    }
  };

  // mass is the ranking value; scale bars relative to the busiest zone.
  const maxMass = Math.max(1, ...(detail?.zones ?? []).map((z) => z.mass));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.reports.title}</h1>
          <p className="text-sm text-muted-foreground">{t.reports.subtitle}</p>
        </div>
        <button className="fs-btn-outline" onClick={load}><RotateCcw size={14} />{t.reports.refresh}</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="fs-card">
          <h2 className="font-semibold mb-3">{t.reports.saved}</h2>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {loading ? "…" : t.reports.none}
            </p>
          ) : (
            <ul className="space-y-1">
              {list.map((r) => (
                <li key={r.file} className="group relative">
                  <button
                    onClick={() => setSelected(r.file)}
                    className={"w-full text-left px-3 py-2 pr-9 rounded-md transition-colors " +
                      (selected === r.file ? "bg-accent text-primary" : "hover:bg-accent/60")}
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText size={14} />{r.generated_at || r.file}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.zone_count} {t.reports.zones}
                      {r.top_zone ? ` · ${t.reports.top}: ${r.top_zone}` : ""}
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteReport(r.file); }}
                    disabled={deleting === r.file}
                    title={t.common.delete}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="fs-card lg:col-span-2">
          {!detail ? (
            <p className="text-sm text-muted-foreground py-10 text-center">{t.reports.select}</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-semibold">{t.reports.detail}</h2>
                <span className="text-sm text-muted-foreground">{detail.generated_at}</span>
              </div>

              <div className="mb-4">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{t.reports.snapshot}</h3>
                {detail.image ? (
                  <a href={api.heatmapReportImageUrl(detail.image)} target="_blank" rel="noreferrer">
                    <img src={api.heatmapReportImageUrl(detail.image)} alt={t.reports.snapshot}
                      className="w-full rounded-md border border-border object-contain bg-black" />
                  </a>
                ) : (
                  <p className="text-xs text-muted-foreground py-4 text-center border border-dashed border-border rounded-md">
                    {t.reports.noImage}
                  </p>
                )}
              </div>

              {detail.zones.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">{t.reports.empty}</p>
              ) : (
                <ul className="space-y-3">
                  {detail.zones.map((z, i) => (
                    <li key={z.zone_id}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium">{i + 1}. {z.name}</span>
                        <span className="text-muted-foreground">
                          Mass {z.mass.toFixed(1)} · Density {z.density.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300"
                             style={{ width: `${(z.mass / maxMass) * 100}%`, background: "linear-gradient(90deg,#4A4F54,#F5B731,#DC3545)" }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
