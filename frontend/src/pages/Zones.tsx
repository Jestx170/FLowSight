import { useEffect, useRef, useState } from "react";
import { api, type Camera, type ZonesConfig } from "../api";
import { useLang } from "../i18n";
import { Trash2, Undo2, Plus, Save, Eraser } from "lucide-react";

const CATS: Record<string, string> = {
  product: "#3b82f6",
  checkout: "#22c55e",
  seating: "#f59e0b",
  staff: "#a855f7",
  entrance: "#14b8a6",
  custom: "#6b7280",
};

// Preset swatches to override a zone's color independent of its category.
const COLORS = ["#6366f1", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#3b82f6", "#ec4899", "#6b7280"];

interface ZoneRow { id: string; name: string; category: string; color: string; points: number[][] }

export function ZonesPage() {
  const { t } = useLang();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cam, setCam] = useState<string>("");
  const [frame, setFrame] = useState<{ ok: boolean; image?: string; width: number; height: number } | null>(null);
  const [zones, setZones] = useState<Record<string, ZoneRow>>({});
  const [draft, setDraft] = useState<number[][]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("product");
  const [color, setColor] = useState(CATS.product); // editor color (overridable)
  const [editingId, setEditingId] = useState<string | null>(null); // zone being edited
  // Authoring resolution. When the engine is stopped /api/frame has no
  // dimensions, so we fall back to the saved _meta (or a sane default) — this is
  // what lets existing zones still render on the canvas while editing offline.
  const [meta, setMeta] = useState<{ w: number; h: number }>({ w: 960, h: 540 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Effective canvas size: live frame dims if available, else saved _meta.
  const dimW = frame?.ok && frame.width ? frame.width : meta.w;
  const dimH = frame?.ok && frame.height ? frame.height : meta.h;

  useEffect(() => {
    api.cameras().then((r) => {
      setCameras(r.cameras);
      if (!cam && r.cameras.length) setCam(r.cameras[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cam) return;
    api.frame(cam).then((f) => setFrame(f)).catch(() => setFrame({ ok: false, width: 1280, height: 720 }));
    api.zonesLoad().then((cfg) => {
      if (cfg?._meta?.w && cfg?._meta?.h) setMeta({ w: cfg._meta.w, h: cfg._meta.h });
      const camCfg = (cfg?.[cam] ?? {}) as Record<string, ZoneRow>;
      const out: Record<string, ZoneRow> = {};
      Object.entries(camCfg).forEach(([id, z]) => { out[id] = { ...(z as any), id }; });
      setZones(out);
    }).catch(() => setZones({}));
  }, [cam]);

  // Draw the frame + existing zones + draft polygon onto the canvas.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = dimW;
    c.height = dimH;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, c.width, c.height);

    const drawAll = () => {
      Object.values(zones).forEach((z) => {
        if (z.id === editingId) return; // hide the original while re-editing it
        drawPoly(ctx, z.points, z.color, z.name);
      });
      if (draft.length) drawPoly(ctx, draft, color, name, true);
    };

    if (frame?.ok && frame.image) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); drawAll(); };
      img.src = `data:image/jpeg;base64,${frame.image}`;
    } else {
      ctx.fillStyle = "#9ca3af";
      ctx.font = "20px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t.common.engineStopped, c.width / 2, c.height / 2);
      ctx.textAlign = "start";
      drawAll();
    }
  }, [frame, zones, draft, color, name, editingId, dimW, dimH, t.common.engineStopped]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * c.width) / rect.width;
    const y = ((e.clientY - rect.top) * c.height) / rect.height;
    setDraft((d) => [...d, [Math.round(x), Math.round(y)]]);
  };

  const undo = () => setDraft((d) => d.slice(0, -1));

  // Picking a category sets its default color; the swatches can still override it.
  const selectCategory = (k: string) => { setCategory(k); setColor(CATS[k] ?? color); };

  const resetEditor = () => { setDraft([]); setName(""); setEditingId(null); setCategory("product"); setColor(CATS.product); };

  // Add a new zone, or update the one currently being edited.
  const commitZone = async () => {
    if (draft.length < 3) return;
    const id = editingId ?? `z_${Date.now()}`;
    const z: ZoneRow = { id, name: name || `Zone ${Object.keys(zones).length + 1}`, category, color, points: draft };
    setZones((m) => ({ ...m, [id]: z }));
    resetEditor();
  };

  // Load a zone back into the editor for re-shaping / recoloring / renaming.
  const editZone = (id: string) => {
    const z = zones[id];
    if (!z) return;
    setEditingId(id);
    setName(z.name);
    setCategory(z.category);
    setColor(z.color || CATS[z.category] || COLORS[0]);
    setDraft(z.points.map((p) => [...p]));
  };

  const removeZone = async (id: string) => {
    setZones((m) => { const n = { ...m }; delete n[id]; return n; });
    if (editingId === id) resetEditor();
    try { await api.zonesDelete(id, cam); } catch (e) { console.error(e); }
  };

  const saveAll = async () => {
    try {
      const existing = await api.zonesLoad().catch(() => ({} as ZonesConfig));
      const camCfg: Record<string, any> = {};
      Object.values(zones).forEach((z) => {
        camCfg[z.id] = { name: z.name, category: z.category, color: z.color, points: z.points };
      });
      const cfg: ZonesConfig = { ...existing, [cam]: camCfg, _meta: { w: dimW, h: dimH } };
      await api.zonesSave(cfg);
    } catch (e) { console.error(e); }
  };

  const clearAll = async () => {
    setZones({});
    setDraft([]);
    try { await api.zonesClear(cam); } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.zones.title}</h1>
          <p className="text-sm text-muted-foreground">Define polygon zones on the camera frame.</p>
        </div>
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="fs-card lg:col-span-2">
          <div className="rounded-md overflow-hidden border border-border bg-black">
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              className="w-full h-auto cursor-crosshair block"
              style={{ aspectRatio: `${dimW} / ${dimH}` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t.zones.needPoints}</p>
        </div>

        <div className="space-y-4">
          <div className="fs-card space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t.zones.name}</label>
              <input className="fs-input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Entrance A" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t.zones.category}</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(CATS).map(([k, c]) => (
                  <button key={k} onClick={() => selectCategory(k)}
                    className={"px-2.5 py-1 rounded-full text-xs font-medium border " + (category === k ? "text-white" : "text-foreground bg-surface")}
                    style={category === k ? { background: c, borderColor: c } : { borderColor: "var(--border)" }}>
                    <span className="inline-block w-2 h-2 rounded-full mr-1 align-middle" style={{ background: c }} />
                    {(t.zones.categories as any)[k] ?? k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t.zones.color}</label>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setColor(c)} title={c}
                    className={"w-6 h-6 rounded-md border-2 transition-transform " + (color.toLowerCase() === c.toLowerCase() ? "scale-110" : "border-transparent")}
                    style={{ background: c, borderColor: color.toLowerCase() === c.toLowerCase() ? "var(--foreground)" : "transparent" }} />
                ))}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                  title="Custom color" className="w-7 h-7 rounded cursor-pointer bg-transparent border border-border p-0" />
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t.zones.points}: {draft.length}</span>
              {editingId && <span className="text-primary font-medium">{t.zones.editing}: {name}</span>}
            </div>
            <div className="flex gap-2">
              <button className="fs-btn-outline" onClick={undo} disabled={!draft.length}><Undo2 size={14} />{t.zones.undo}</button>
              {editingId && <button className="fs-btn-outline" onClick={resetEditor}>{t.zones.cancelEdit}</button>}
              <button className="fs-btn" onClick={commitZone} disabled={draft.length < 3}>
                <Plus size={14} />{editingId ? t.zones.updateZone : t.zones.addZone}
              </button>
            </div>
          </div>

          <div className="fs-card">
            <h3 className="font-semibold mb-2">{t.zones.list}</h3>
            {Object.keys(zones).length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t.common.noData}</p>
            ) : (
              <ul className="space-y-1.5">
                {Object.values(zones).map((z) => (
                  <li key={z.id}
                    className={"flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-secondary " + (editingId === z.id ? "bg-accent" : "")}
                    onClick={() => editZone(z.id)} title="Click to edit">
                    <span className="w-3 h-3 rounded" style={{ background: z.color }} />
                    <span className="text-sm flex-1 truncate">{z.name}</span>
                    <span className="text-xs text-muted-foreground">{(t.zones.categories as any)[z.category] ?? z.category}</span>
                    <span className="text-xs text-muted-foreground">{z.points.length} pts</span>
                    <button onClick={(e) => { e.stopPropagation(); removeZone(z.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 mt-3">
              <button className="fs-btn flex-1" onClick={saveAll}><Save size={14} />{t.common.saveAll}</button>
              <button className="fs-btn-outline" onClick={clearAll}><Eraser size={14} />{t.common.clearAll}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawPoly(ctx: CanvasRenderingContext2D, pts: number[][], color: string, label = "", inProgress = false) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (!inProgress) ctx.closePath();
  ctx.fillStyle = hexA(color, inProgress ? 0.15 : 0.28);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (!inProgress) ctx.fill();
  ctx.stroke();
  pts.forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  });
  if (label) {
    ctx.font = "600 14px Inter, sans-serif";
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(pts[0][0], pts[0][1] - 22, w, 20);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, pts[0][0] + 6, pts[0][1] - 8);
  }
}
function hexA(hex: string, a: number) {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
