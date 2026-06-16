// Thin fetch helpers for the Flask backend. All paths are relative.
import { useEffect, useState } from "react";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface Camera { id: string; name: string; rtsp_url: string; enabled: boolean; running?: boolean; msg?: string }
export interface Hud { running: boolean; cust: number; seller: number; alert: number; zones: number; cams: number; device: string; gpu_name?: string }
export interface AlertItem { time: string; person: string; zone: string; behavior: string; behavior_id: string }
export interface Stats { total: number; interested: number; purchasing: number; top_zone: string }
export interface Occupancy {
  ok: boolean;
  running: boolean;
  live: { total: number; zones: Record<string, number>; cams: Record<string, number> };
  today: { peak: number; peak_time: string; avg: number; labels: string[]; series: number[] };
}
export interface ZoneActivity { zone: string; count: number }
export interface Hourly { labels: string[]; datasets: Array<{ label: string; data: number[]; backgroundColor?: string; borderColor?: string }> }
export interface ActivityEvent { time: string; date: string; person_id: string; zone: string; behavior: string; alert: boolean }
export interface Activity { ok: boolean; events: ActivityEvent[]; total: number; page: number; pages: number }
export interface Insight { ok: boolean; html: string; source: string }
export interface BehaviorRow { id: string; name: string; zone: string; action: "moving" | "dwell" | "still" | "presence"; threshold: number; alert: boolean; color: string }
export interface HeatZone { name: string; density : number; zone_id: string; mass: number;  }
export interface HeatReport { ok: boolean; generated_at: string; zone_count: number; zones: HeatZone[]; file: string }
export interface HeatReportSummary { file: string; generated_at: string; zone_count: number; top_zone: string | null }
export interface ZonePoly { name: string; category: string; color: string; points: number[][] }
export interface ZonesConfig { _meta?: { w: number; h: number }; [camId: string]: any }
export interface Brand { name: string; tagline: string }
export interface Settings {
  conf: number; anonymize: boolean;
  dwell_interested: number; dwell_loitering: number; dwell_checkout_min: number; dwell_seating_waiting: number;
  gemini_api_key: string; claude_api_key: string;
  cameras: Camera[];
}
export interface Frame { ok: boolean; image: string; width: number; height: number }

export const api = {
  cameras: () => j<{ ok: boolean; cameras: Camera[] }>("/api/cameras"),
  hud: () => j<Hud>("/api/hud"),
  alerts: () => j<AlertItem[]>("/api/alerts"),
  start: (cam?: string) => j(cam ? `/api/start/${cam}` : "/api/start", { method: "POST" }),
  stop: (cam?: string) => j(cam ? `/api/stop/${cam}` : "/api/stop", { method: "POST" }),
  frame: (cam: string) => j<Frame>(`/api/frame/${cam}`),
  stats: () => j<Stats>("/api/stats"),
  occupancy: (date?: string) => j<Occupancy>(`/api/occupancy${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  hourly: () => j<Hourly>("/api/hourly"),
  zoneActivity: () => j<ZoneActivity[]>("/api/zones_activity"),
  activity: (date: string, page = 1) => j<Activity>(`/api/activity?date=${encodeURIComponent(date)}&page=${page}`),
  insight: (date: string) => j<Insight>(`/api/insight?date=${encodeURIComponent(date)}`),
  behaviors: () => j<BehaviorRow[]>("/api/behaviors"),
  behaviorsSave: (rows: BehaviorRow[]) => j("/api/behaviors/save", { method: "POST", body: JSON.stringify(rows) }),
  behaviorsReset: () => j("/api/behaviors/reset", { method: "POST" }),
  heatmapZones: (cam: string) => j<HeatZone[]>(`/api/heatmap/zones?cam=${encodeURIComponent(cam)}`),
  heatmapReset: () => j("/api/heatmap/reset", { method: "POST" }),
  heatmapReport: (cam: string) => j<HeatReport>("/api/heatmap/report", { method: "POST", body: JSON.stringify({ cam }) }),
  heatmapReports: () => j<HeatReportSummary[]>("/api/heatmap/reports"),
  heatmapReportDetail: (name: string) => j<HeatReport>(`/api/heatmap/reports/${encodeURIComponent(name)}`),
  zonesLoad: () => j<ZonesConfig>("/api/zones/load"),
  zonesSave: (cfg: ZonesConfig) => j("/api/zones/save", { method: "POST", body: JSON.stringify(cfg) }),
  zonesDelete: (zone_id: string, cam: string) =>
    j("/api/zones/delete", { method: "POST", body: JSON.stringify({ zone_id, cam }) }),
  zonesClear: (cam: string) =>
    j("/api/zones/clear", { method: "POST", body: JSON.stringify({ cam }) }),
  brand: () => j<Brand>("/api/brand"),
  brandSave: (b: Brand) => j("/api/brand/save", { method: "POST", body: JSON.stringify(b) }),
  settings: () => j<Settings>("/api/settings"),
  settingsSave: (s: Partial<Settings>) => j("/api/settings", { method: "POST", body: JSON.stringify(s) }),
  camerasSave: (cameras: Camera[]) => j("/api/cameras/save", { method: "POST", body: JSON.stringify({ cameras }) }),
};

export function useApiPoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []): { data: T | null; error: Error | null } {
  // Lightweight poller. Returns latest result; errors don't crash the UI.
  const [state, setState] = useState<{ data: T | null; error: Error | null }>({ data: null, error: null });
  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const tick = async () => {
      try {
        const data = await fn();
        if (!cancelled) setState({ data, error: null });
      } catch (e) {
        if (!cancelled) setState((s) => ({ data: s.data, error: e as Error }));
      } finally {
        if (!cancelled) timer = window.setTimeout(tick, ms);
      }
    };
    tick();
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
