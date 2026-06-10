import { useEffect, useMemo, useState } from "react";
import { api, type ActivityEvent, type Hourly, type Insight, type Stats, type ZoneActivity } from "../api";
import { useLang } from "../i18n";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from "chart.js";
import { Download, FileText, Sparkles, TrendingUp, Users, ShoppingCart, MapPin } from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DashboardPage() {
  const { t } = useLang();
  const [date, setDate] = useState(todayIso());
  const [stats, setStats] = useState<Stats | null>(null);
  const [hourly, setHourly] = useState<Hourly | null>(null);
  const [zones, setZones] = useState<ZoneActivity[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [page, setPage] = useState(1);
  const [activity, setActivity] = useState<{ events: ActivityEvent[]; total: number; pages: number } | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch(() => setStats(null));
    api.hourly().then(setHourly).catch(() => setHourly(null));
    api.zoneActivity().then(setZones).catch(() => setZones([]));
    api.insight(date).then(setInsight).catch(() => setInsight(null));
  }, [date]);

  useEffect(() => {
    api.activity(date, page).then((r) => setActivity({ events: r.events, total: r.total, pages: r.pages })).catch(() => setActivity(null));
  }, [date, page]);

  const exportCsv = () => {
    const rows = activity?.events ?? [];
    const header = ["time", "date", "person_id", "zone", "behavior", "alert"];
    const csv = [header.join(","), ...rows.map((r) => header.map((k) => JSON.stringify((r as any)[k] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `flowsight-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const hourlyData = useMemo(() => {
    if (!hourly) return null;
    return {
      labels: hourly.labels,
      datasets: hourly.datasets.map((d) => ({
        ...d,
        backgroundColor: d.backgroundColor || "#714B67",
        borderRadius: 4,
      })),
    };
  }, [hourly]);

  const maxZone = Math.max(1, ...zones.map((z) => z.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.dash.title}</h1>
          <p className="text-sm text-muted-foreground">Daily analytics overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted-foreground">{t.dash.date}</label>
          <input type="date" className="fs-input w-auto" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }} />
          <button className="fs-btn-outline" onClick={exportCsv}><Download size={14} />{t.dash.csv}</button>
          <a className="fs-btn" href={`/api/report/pdf?date=${date}`} target="_blank" rel="noreferrer"><FileText size={14} />{t.dash.pdf}</a>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={t.dash.totalVisitors} value={stats?.total ?? 0} icon={<Users size={18} />} />
        <Kpi label={t.dash.interested} value={stats?.interested ?? 0} icon={<TrendingUp size={18} />} />
        <Kpi label={t.dash.purchasing} value={stats?.purchasing ?? 0} icon={<ShoppingCart size={18} />} />
        <Kpi label={t.dash.topZone} value={stats?.top_zone || "—"} icon={<MapPin size={18} />} text />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="fs-card lg:col-span-2">
          <h2 className="font-semibold mb-4">{t.dash.hourly}</h2>
          <div className="h-72">
            {hourlyData ? (
              <Bar
                data={hourlyData}
                options={{
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { position: "top" as const, labels: { boxWidth: 10 } } },
                  scales: { y: { beginAtZero: true, grid: { color: "#F1F1F1" } }, x: { grid: { display: false } } },
                }}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>

        <div className="fs-card">
          <h2 className="font-semibold mb-4">{t.dash.zoneActivity}</h2>
          {zones.length === 0 ? <EmptyState /> : (
            <ul className="space-y-3">
              {zones.map((z) => (
                <li key={z.zone}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium">{z.zone}</span>
                    <span className="text-muted-foreground">{z.count}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${(z.count / maxZone) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="fs-card">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-primary" />
          <h2 className="font-semibold">{t.dash.aiInsight}</h2>
          {insight?.source && <span className="ml-auto text-xs text-muted-foreground">{t.dash.source}: {insight.source}</span>}
        </div>
        {insight?.html ? (
          <div className="prose prose-sm max-w-none text-foreground" dangerouslySetInnerHTML={{ __html: insight.html }} />
        ) : (
          <EmptyState />
        )}
      </div>

      <div className="fs-card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{t.dash.activityLog}</h2>
          {activity && <span className="text-xs text-muted-foreground">{activity.total} events</span>}
        </div>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 px-2 font-medium">{t.dash.time}</th>
                <th className="py-2 px-2 font-medium">{t.dash.person}</th>
                <th className="py-2 px-2 font-medium">{t.dash.zone}</th>
                <th className="py-2 px-2 font-medium">{t.dash.behavior}</th>
                <th className="py-2 px-2 font-medium">{t.dash.alert}</th>
              </tr>
            </thead>
            <tbody>
              {(activity?.events ?? []).map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2 px-2 font-mono text-xs">{e.time}</td>
                  <td className="py-2 px-2">{e.person_id}</td>
                  <td className="py-2 px-2">{e.zone}</td>
                  <td className="py-2 px-2">{e.behavior}</td>
                  <td className="py-2 px-2">
                    {e.alert ? <span className="fs-pill text-destructive" style={{ borderColor: "var(--destructive)" }}>alert</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              {(!activity || activity.events.length === 0) && (
                <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">{t.common.noData}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {activity && activity.pages > 1 && (
          <div className="flex items-center justify-between mt-3 text-sm">
            <span className="text-muted-foreground">{t.dash.page} {activity.pages ? page : 0} {t.dash.of} {activity.pages}</span>
            <div className="flex gap-2">
              <button className="fs-btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button className="fs-btn-outline" disabled={page >= activity.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, text }: { label: string; value: React.ReactNode; icon: React.ReactNode; text?: boolean }) {
  return (
    <div className="fs-kpi">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className={"mt-2 font-semibold " + (text ? "text-lg truncate" : "text-3xl")}>{value}</div>
    </div>
  );
}

function EmptyState() {
  const { t } = useLang();
  return <div className="text-center text-muted-foreground text-sm py-10">{t.common.noData}</div>;
}
