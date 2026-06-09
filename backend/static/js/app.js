// FlowSight UI logic — extracted from index.html
// ── Constants ──────────────────────────────────────────────────────────────────
const COLORS = ["#6366f1","#f59e0b","#22c55e","#ef4444","#a855f7","#14b8a6","#f97316","#3b82f6","#ec4899","#6b7280"];
const CAT_COLORS = {product:"#3b82f6",checkout:"#22c55e",seating:"#f59e0b",staff:"#a855f7",entrance:"#14b8a6",custom:"#6b7280"};
const BEH_BADGE = {interested:"badge-amber",loitering:"badge-red",checkout_ready:"badge-green",waiting:"badge-red"};
let hourlyChart = null;

// ── Helpers ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function toast(msg, type="ok"){
  const t=$("toast"); t.textContent=msg; t.className=`toast show ${type}`;
  setTimeout(()=>t.className="toast",2600);
}
function showPage(id, btn){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("on"));
  document.querySelectorAll(".ntab").forEach(t=>t.classList.remove("on"));
  $("pg-"+id).classList.add("on"); btn.classList.add("on");
  if(id==="dash")     loadDash();
  if(id==="zones")    initZoneEditor();
  if(id==="behaviors")loadBehaviors();
  if(id==="heatmap")  startHeatmapPoll();
  if(id==="dash") { loadDash(); loadActivity(1); }
  else                stopHeatmapPoll();
  // Re-apply translations after tab content renders (small delay lets loadDash etc finish)
  setTimeout(function(){ if(typeof window.applyLang==="function") window.applyLang(); }, 50);
}
function buildColorPalette(containerId, selectedColor, onSelect){
  const el=$(containerId); el.innerHTML="";
  COLORS.forEach(c=>{
    const d=document.createElement("div");
    d.className="c-swatch"+(c===selectedColor?" sel":"");
    d.style.background=c; d.title=c;
    d.onclick=()=>{ el.querySelectorAll(".c-swatch").forEach(x=>x.classList.remove("sel")); d.classList.add("sel"); if(onSelect)onSelect(c); };
    el.appendChild(d);
  });
}
function getSelectedColor(containerId){
  const sel=$(containerId).querySelector(".c-swatch.sel");
  return sel ? sel.style.background : COLORS[0];
}
function confirm_(title,msg,onYes){
  const bg=document.createElement("div"); bg.className="modal-bg";
  bg.innerHTML=`<div class="modal"><h3>${title}</h3><p>${msg}</p><div class="modal-btns"><button class="btn" id="cn">${t("btn_cancel","Cancel")}</button><button class="btn btn-danger" id="cy">${t("btn_delete","Delete")}</button></div></div>`;
  document.body.appendChild(bg);
  bg.querySelector("#cy").onclick=()=>{document.body.removeChild(bg);onYes();};
  bg.querySelector("#cn").onclick=()=>document.body.removeChild(bg);
}

// ── Engine ─────────────────────────────────────────────────────────────────────
let running=false, soundOn=true;
async function toggleEngine(){
  const btn=$("main-btn"); btn.disabled=true;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  try{
    if(!running){
      const r=await fetch("/api/start",{method:"POST"}).then(r=>r.json()).catch(()=>({ok:false,msg:"Server not responding"}));
      if(r.ok){
        running=true; updateNav(); startCamPolling();
        toast(t("t_started"));
      } else {
        toast(r.msg||t("t_start_fail"),"err");
      }
    } else {
      btn.innerHTML="⏳ " + t("lbl_stopping","Stopping...");
      await fetch("/api/stop",{method:"POST"}).catch(()=>{});
      await new Promise(r=>setTimeout(r,1500));
      running=false; updateNav(); stopCamPolling();
      // Clear all canvases
      document.querySelectorAll("canvas[id^='grid-canvas-']").forEach(c=>{
        c.style.display="none";
        const off = document.getElementById(c.id.replace("grid-canvas-","grid-off-"));
        if(off) off.style.display="flex";
      });
      const lc=$("live-canvas"); if(lc) lc.style.display="none";
      const fo=$("feed-off"); if(fo) fo.style.display="flex";
      toast(t("t_stopped"));
    }
  } finally { btn.disabled=false; }
}
function updateNav(){
  const dot=$("dot"),lbl=$("status-lbl"),btn=$("main-btn"),badge=$("live-badge");
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  dot.className="dot-live"+(running?" on":"");
  lbl.textContent=running?(t("status_running","Running")):(t("lbl_cam_status_stopped","Stopped"));
  btn.className="btn "+(running?"btn-danger":"btn-primary");
  btn.innerHTML=running?`⏹ ${t("btn_stop","⏹ Stop").replace("⏹ ","")}`:`▶ ${t("btn_start","▶ Start").replace("▶ ","")}`;
  if(badge) badge.style.display=running?"block":"none";
}

// ── Polling ─────────────────────────────────────────────────────────────────────
let prevAlertCnt=0;
function pollHud(){
  fetch("/api/hud").then(r=>r.json()).then(d=>{
    if(d.running!==running){running=d.running;updateNav();if(running)startCamPolling();else stopCamPolling();}
    ["cust","seller","alert"].forEach(k=>{
      $("k-"+k).textContent=d[k]??0;
      if($("h-"+k)) $("h-"+k).textContent=d[k]??0;
    });
    if($("h-staff")) $("h-staff").textContent=d.seller??0;
    $("k-staff").textContent=d.seller??0;
  }).catch(()=>{});
}
function pollAlerts(){
  fetch("/api/alerts").then(r=>r.json()).then(data=>{
    if(data.length>prevAlertCnt) playAlert();
    prevAlertCnt=data.length; renderAlerts(data,"alert-list");
  }).catch(()=>{});
}
function pollStats(){
  fetch("/api/stats").then(r=>r.json()).then(d=>{$("k-today").textContent=d.total??0;}).catch(()=>{});
}
function playAlert(){
  if(!soundOn)return;
  try{const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [880,660].forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);o.frequency.value=f;
      g.gain.setValueAtTime(.2,ctx.currentTime+i*.15);
      g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+i*.15+.3);
      o.start(ctx.currentTime+i*.15);o.stop(ctx.currentTime+i*.15+.3);});
  }catch(e){}
}
function renderAlerts(data,id){
  const el=$(id);
  if(!data||!data.length){el.innerHTML='<div class="empty">No alerts</div>';return;}
  el.innerHTML=[...data].reverse().slice(0,30).map(a=>`
    <div class="a-item ${a.behavior_id==='loitering'||a.behavior_id==='waiting'?'urgent':''}">
      <span class="a-time">${a.time}</span>
      <span class="a-txt">#${a.person} · ${a.zone}</span>
      <span class="badge ${BEH_BADGE[a.behavior_id]||'badge-amber'}">${a.behavior}</span>
    </div>`).join("");
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
async function loadDash(){
  const date=$("rpt-date").value||new Date().toISOString().slice(0,10);
  fetch("/api/stats").then(r=>r.json()).then(d=>{
    $("d-total").textContent=d.total??0; $("d-inter").textContent=d.interested??0;
    $("d-purch").textContent=d.purchasing??0; $("d-zone").textContent=d.top_zone||"—";
  }).catch(()=>{});
  fetch("/api/hourly").then(r=>r.json()).then(d=>{
    const ctx=$("hourly-chart");
    if(hourlyChart)hourlyChart.destroy();
    Chart.defaults.color="#888";
    hourlyChart=new Chart(ctx,{type:"bar",data:{labels:d.labels,datasets:d.datasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{position:"top",labels:{usePointStyle:true,boxWidth:8,font:{size:11}}}},
        scales:{
          x:{stacked:true,grid:{display:false},ticks:{maxTicksLimit:8},
            title:{display:true,text:window.t?window.t("axis_time","Time of Day"):"Time of Day",color:"#888",font:{size:11}}},
          y:{stacked:true,grid:{color:"#f0f0f4"},
            title:{display:true,text:window.t?window.t("axis_events","Events"):"Events",color:"#888",font:{size:11}}}
        }}});
  }).catch(()=>{});
  fetch("/api/zones_activity").then(r=>r.json()).then(data=>{
    const el=$("zone-bars");
    if(!data.length){el.innerHTML='<div class="empty">No data</div>';return;}
    const max=data[0].count;
    el.innerHTML=data.map(z=>`<div class="zbar-row">
      <div class="zbar-meta"><span>${z.zone}</span><span style="color:var(--muted)">${z.count}</span></div>
      <div class="zbar-bg"><div class="zbar-fill" style="width:${Math.round(z.count/max*100)}%;background:var(--accent)"></div></div>
    </div>`).join("");
  }).catch(()=>{});
}
function exportReport(fmt){
  const date=$("rpt-date").value||new Date().toISOString().slice(0,10);
  // PDF only
  window.open(`/api/report/pdf?date=${date}`,"_blank");
}
async function loadInsight(){
  const date = $("rpt-date")?.value || new Date().toISOString().slice(0,10);
  const d    = await fetch(`/api/insight?date=${date}`).then(r=>r.json()).catch(()=>({ok:false,msg:"error"}));
  const srcEl  = $("insight-src");
  const cntEl  = $("insight-content");
  if(srcEl){ srcEl.textContent = d.source||"Analysis"; srcEl.style.display="inline-block"; }
  if(cntEl){ cntEl.innerHTML = d.html||"<span style='color:var(--muted)'>No data</span>"; cntEl.style.display="block"; }
}

// ── Zone Editor ───────────────────────────────────────────────────────────────
let zCvs,zCtx,zones={},curPts=[],curColor=COLORS[0],curCat="product",zEditId=null;
function initZoneEditor(){
  zCvs=$("zone-canvas"); zCtx=zCvs.getContext("2d");
  zCvs.onclick=onZoneClick;
  buildColorPalette("zn-colors",curColor,c=>curColor=c);
  if(_activeCam) _zeCam=_activeCam;
  zePopulateCamSelect();
  if(!Object.keys(zones).length) loadZones();
}
// ── Zone Editor camera state ──────────────────────────────────────────────────
let _zeCam = "cam_0"; // which camera the zone editor is currently editing

function zePopulateCamSelect(){
  const sel=$("ze-cam-select");
  if(!sel) return;
  const cams=_cameras&&_cameras.length?_cameras:[{id:"cam_0",name:"Camera 1"}];
  sel.innerHTML=cams.map(c=>`<option value="${c.id}"${c.id===_zeCam?" selected":""}>${c.name||c.id}</option>`).join("");
}

function zeChangeCam(camId){
  _zeCam=camId;
  zones={};curPts=[];zEditId=null;
  renderZoneList();redrawZones();
  loadZones();
  toast(`Switched to ${_cameras.find(c=>c.id===camId)?.name||camId}`);
}

async function loadFrame(){
  toast(t("t_frame_load"));
  const camId=_zeCam||"cam_0";
  const r=await fetch(`/api/frame/${camId}`).then(r=>r.json()).catch(()=>({ok:false}));
  if(!r.ok){toast(t("t_no_frame")+" ("+camId+")","err");return;}
  const img=new Image();
  img.onload=()=>{zCtx._bg=img;redrawZones();toast(t("t_frame_ok"));};  // canvas stays 960×540
  img.src="data:image/jpeg;base64,"+r.image;
}
async function loadZones(){
  const r=await fetch("/api/zones/load").then(r=>r.json()).catch(()=>({}));
  const cam=r[_zeCam]||{};
  zones={};
  for(const[id,data] of Object.entries(cam)){
    if(Array.isArray(data)) zones[id]={name:id,category:"product",color:COLORS[0],points:data};
    else zones[id]=data;
  }
  curPts=[]; renderZoneList(); redrawZones();
}
function redrawZones(){
  const w=zCvs.width,h=zCvs.height;
  zCtx.clearRect(0,0,w,h);
  if(zCtx._bg)zCtx.drawImage(zCtx._bg,0,0,w,h);
  else{zCtx.fillStyle="#1a1a1a";zCtx.fillRect(0,0,w,h);}
  for(const[id,z] of Object.entries(zones)){
    const pts=z.points;
    if(!pts||pts.length<3)continue;
    const col=z.color||COLORS[0];
    zCtx.beginPath();zCtx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length;i++)zCtx.lineTo(pts[i][0],pts[i][1]);
    zCtx.closePath();
    zCtx.fillStyle=col+"33";zCtx.fill();
    zCtx.strokeStyle=col;zCtx.lineWidth=2;zCtx.stroke();
    const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length;
    const cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    zCtx.fillStyle="#fff";zCtx.font="bold 12px system-ui";
    zCtx.fillText(z.name||id,cx-40,cy);
  }
  if(curPts.length){
    const col=curColor;
    zCtx.strokeStyle=col;zCtx.lineWidth=2;zCtx.setLineDash([5,3]);
    zCtx.beginPath();zCtx.moveTo(curPts[0][0],curPts[0][1]);
    for(let i=1;i<curPts.length;i++)zCtx.lineTo(curPts[i][0],curPts[i][1]);
    if(curPts.length>2)zCtx.lineTo(curPts[0][0],curPts[0][1]);
    zCtx.stroke();zCtx.setLineDash([]);
    curPts.forEach(p=>{zCtx.beginPath();zCtx.arc(p[0],p[1],5,0,Math.PI*2);zCtx.fillStyle=col;zCtx.fill();});
    zCtx.fillStyle="rgba(0,0,0,.65)";zCtx.fillRect(6,6,240,26);
    zCtx.fillStyle="#fff";zCtx.font="13px system-ui";
    zCtx.fillText(`Drawing: ${$("zn-name").value||"zone"} (${curPts.length} pts)`,10,24);
  }
}
function onZoneClick(e){
  const rect=zCvs.getBoundingClientRect();
  const sx=zCvs.width/rect.width,sy=zCvs.height/rect.height;
  curPts.push([Math.round((e.clientX-rect.left)*sx),Math.round((e.clientY-rect.top)*sy)]);
  redrawZones();
}
function undoPt(){if(curPts.length){curPts.pop();redrawZones();}}
function clearCur(){curPts=[];redrawZones();}
function saveCur(){
  const name=$("zn-name").value.trim();
  if(!name){toast(t("t_zone_name"),"err");return;}
  if(curPts.length<3){toast(t("t_zone_pts"),"err");return;}
  const id=zEditId||("z_"+Date.now());
  zones[id]={name,category:curCat,color:curColor,points:[...curPts]};
  curPts=[];zEditId=null;renderZoneList();redrawZones();toast(`Zone "${name}" saved`);
}
async function saveAllZones(){
  // Load full config first so we don't overwrite other cameras' zones
  let cfg={};
  try{ cfg=await fetch("/api/zones/load").then(r=>r.json()); }catch(e){}
  cfg[_zeCam]={};
  for(const[id,z] of Object.entries(zones)) cfg[_zeCam][id]=z;
  cfg["_meta"]={"w":zCvs.width,"h":zCvs.height};  // record authoring resolution
  const r=await fetch("/api/zones/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(cfg)}).then(r=>r.json()).catch(()=>({ok:false}));
  r.ok?toast(t("t_zones_saved")):toast("Save failed","err");
}
function confirmClearAll(){confirm_(t("c_clear_zones"),"This will delete every zone and cannot be undone.",async()=>{
  zones={};curPts=[];renderZoneList();redrawZones();
  await fetch("/api/zones/clear",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cam:_zeCam})});
  toast(t("t_zones_clear"));});}
function deleteZone(id){confirm_(`Delete "${zones[id]?.name||id}"?`,"Remove this zone from canvas and file.",async()=>{
  delete zones[id];renderZoneList();redrawZones();
  await fetch("/api/zones/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({zone_id:id,cam:_zeCam})});
  toast(t("t_zone_del"));});}
function editZone(id){
  const z=zones[id]; if(!z)return;
  $("zn-name").value=z.name||id; curColor=z.color||COLORS[0]; curCat=z.category||"product";
  buildColorPalette("zn-colors",curColor,c=>curColor=c);
  document.querySelectorAll(".cat-chip").forEach(c=>c.classList.toggle("on",c.dataset.cat===curCat));
  curPts=[...(z.points||[])]; zEditId=id; redrawZones();
}
function renderZoneList(){
  const el=$("zone-list");
  const entries=Object.entries(zones);
  if(!entries.length){el.innerHTML='<div class="empty">No zones yet</div>';return;}
  el.innerHTML=entries.map(([id,z])=>`
    <div class="zone-item" onclick="editZone('${id}')">
      <div class="z-dot" style="background:${z.color||'#888'}"></div>
      <span class="z-name">${z.name||id}</span>
      <span class="z-cat">${z.category||""}</span>
      <span class="z-pts">${(z.points||[]).length}pt</span>
      <button class="icon-btn" onclick="event.stopPropagation();deleteZone('${id}')" title="Delete">
        <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>`).join("");
}
function selCat(chip){
  document.querySelectorAll(".cat-chip").forEach(c=>c.classList.remove("on")); chip.classList.add("on");
  curCat=chip.dataset.cat;
  const col=CAT_COLORS[curCat]||COLORS[0]; curColor=col;
  buildColorPalette("zn-colors",col,c=>curColor=c);
}

// ── Behaviors ──────────────────────────────────────────────────────────────────
// ── Multi-Camera Manager ──────────────────────────────────────────────────────
let _cameras   = [];
let _activeCam = null;
let _camView   = localStorage.getItem("cam_view") || "tab";
let _camPolls  = {}; // cam_id -> intervalId

async function loadCameras(){
  const d = await fetch("/api/cameras").then(r=>r.json()).catch(()=>({cameras:[]}));
  _cameras = d.cameras || [];
  if(!_cameras.length){
    _cameras = [{id:"cam_0",name:"Camera 1",rtsp_url:"",enabled:true}];
  }
  if(!_activeCam || !_cameras.find(c=>c.id===_activeCam)){
    _activeCam = _cameras[0]?.id || "cam_0";
  }
  renderCamTabs();
  renderCamGrid();
  renderCamManagerList();
}

function renderCamTabs(){
  const tabs = document.getElementById("cam-tabs");
  if(!tabs) return;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  tabs.innerHTML = _cameras.map(c => `
    <button onclick="switchCam('${c.id}')"
      style="padding:5px 12px;border-radius:16px;border:1px solid var(--border);
             font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;
             background:${c.id===_activeCam?'var(--accent)':'var(--surface2)'};
             color:${c.id===_activeCam?'white':'var(--muted)'}">
      ${c.name}
      <span style="margin-left:4px;font-size:9px;opacity:.8"
        id="cam-tab-dot-${c.id}">●</span>
    </button>`).join("");
}

function renderCamGrid(){
  const grid = document.getElementById("cam-grid");
  if(!grid) return;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  grid.innerHTML = _cameras.map(c => `
    <div class="card" style="overflow:hidden">
      <div class="card-hd" style="padding:10px 14px">
        <h3 style="font-size:13px">${c.name}</h3>
        <span id="grid-status-${c.id}" style="font-size:10px;color:var(--muted)"></span>
      </div>
      <div style="position:relative;background:#000;aspect-ratio:16/9">
        <canvas id="grid-canvas-${c.id}"
          style="width:100%;height:100%;display:none;object-fit:contain"></canvas>
        <div id="grid-off-${c.id}"
          style="position:absolute;inset:0;display:flex;flex-direction:column;
                 align-items:center;justify-content:center;color:#666;gap:6px">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
          </svg>
          <span style="font-size:11px">${t("lbl_press_start","Press Start to connect")}</span>
        </div>
      </div>
      <div style="padding:6px 14px;font-size:11px;color:var(--muted);display:flex;gap:12px"
           id="grid-hud-${c.id}">
        <span>0 ${t("hud_customers","customers")}</span>
        <span>0 ${t("hud_staff","staff")}</span>
        <span>0 ${t("hud_alerts","alerts")}</span>
      </div>
    </div>`).join("");
}

function switchCam(camId){
  _activeCam = camId;
  renderCamTabs();
  const lbl = document.getElementById("cam-lbl");
  const cam = _cameras.find(c=>c.id===camId);
  if(lbl && cam) lbl.textContent = cam.name;
  // Reconnect MJPEG stream to new camera
  if(_pollRunning && _camView === "tab"){
    _connectMjpeg(camId, "live-stream");
  }
}

function setCamView(mode){
  _camView = mode;
  localStorage.setItem("cam_view", mode);
  document.getElementById("cam-tab-view").style.display  = mode==="tab"  ? "" : "none";
  document.getElementById("cam-grid-view").style.display = mode==="grid" ? "" : "none";
  const tabBtn  = document.getElementById("view-tab-btn");
  const gridBtn = document.getElementById("view-grid-btn");
  if(tabBtn){  tabBtn.style.background  = mode==="tab"  ? "var(--accent)" : ""; tabBtn.style.color  = mode==="tab"  ? "#2a2a28" : ""; }
  if(gridBtn){ gridBtn.style.background = mode==="grid" ? "var(--accent)" : ""; gridBtn.style.color = mode==="grid" ? "#2a2a28" : ""; }
  // Reconnect MJPEG streams for the new view if running
  if(mode === "tab"){
    // Disconnect grid streams
    document.querySelectorAll("img[id^='grid-stream-']").forEach(img=>{ img.src=""; });
    _connectMjpeg(_activeCam, "live-stream");
  } else {
    // Disconnect tab stream
    const ls = document.getElementById("live-stream");
    if(ls) ls.src = "";
    for(const cam of _cameras) _connectGridMjpeg(cam.id);
  }
}

async function toggleCam(camId){
  const cam = _cameras.find(c=>c.id===camId);
  if(!cam) return;
  const btn = document.getElementById(`grid-btn-${camId}`);
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  const status = await fetch("/api/cameras").then(r=>r.json())
    .then(d => (d.cameras||[]).find(c=>c.id===camId)?.running);
  if(status){
    await fetch(`/api/stop/${camId}`, {method:"POST"});
    if(btn) btn.innerHTML = `▶ ${t("btn_start","▶ Start").replace("▶ ","")}`;
    if(btn) btn.style.background = "";
  } else {
    await fetch(`/api/start/${camId}`, {method:"POST"});
    if(btn) btn.innerHTML = `⏹ ${t("btn_stop","⏹ Stop").replace("⏹ ","")}`;
    if(btn) btn.style.background = "#ef4444";
  }
}

// Camera settings manager
function renderCamManagerList(){
  const list = document.getElementById("cam-list");
  if(!list) return;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  list.innerHTML = _cameras.map((c,i) => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:var(--muted);min-width:20px">#${i+1}</span>
        <input value="${c.name}" onchange="_cameras[${i}].name=this.value;renderCamTabs();renderCamGrid()"
          placeholder="${t("lbl_cam_name","Camera name")}"
          style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--border);
                 background:var(--surface);color:var(--text);font-size:12px;font-weight:600;outline:none">
        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);cursor:pointer">
          <input type="checkbox" ${c.enabled?"checked":""} onchange="_cameras[${i}].enabled=this.checked">
          ${t("lbl_enable","Enable")}
        </label>
        <button onclick="removeCamera(${i})"
          style="padding:4px 8px;border-radius:6px;border:1px solid #fca5a5;
                 background:#fef2f2;color:#ef4444;cursor:pointer;font-size:11px">
          ✕
        </button>
      </div>
      <input value="${c.rtsp_url||""}" onchange="_cameras[${i}].rtsp_url=this.value"
        placeholder="rtsp://user:pass@192.168.x.x/stream"
        style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--border);
               background:var(--surface);color:var(--text);font-size:12px;
               font-family:monospace;outline:none;box-sizing:border-box">
    </div>`).join("");
}

function addCamera(){
  const n = _cameras.length + 1;
  _cameras.push({id:`cam_${n-1}`,name:`Camera ${n}`,rtsp_url:"",enabled:true});
  renderCamManagerList();
  renderCamTabs();
  renderCamGrid();
}

function removeCamera(idx){
  if(_cameras.length <= 1){ toast(t("t_cam_min","Need at least 1 camera"),"err"); return; }
  _cameras.splice(idx, 1);
  renderCamManagerList();
  renderCamTabs();
  renderCamGrid();
}

async function saveCameras(){
  // Regenerate IDs based on order
  _cameras = _cameras.map((c,i) => ({...c, id:`cam_${i}`}));
  const r = await fetch("/api/cameras/save", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({cameras: _cameras})
  }).then(r=>r.json()).catch(()=>({ok:false}));
  if(r.ok){
    renderCamTabs(); renderCamGrid();
    toast(t("t_cam_saved","Cameras saved ✓"));
  } else {
    toast(r.msg||"Save failed","err");
  }
}

// ── Multi-camera MJPEG streaming (smooth) ────────────────────────────────────
let _pollRunning = false;

function _connectMjpeg(camId, imgId){
  const img = document.getElementById(imgId);
  if(!img) return;
  img.src = `/api/stream/${camId}?t=${Date.now()}`;
  img.style.display = "block";
  const off = document.getElementById("feed-off");
  if(off) off.style.display = "none";
  img.onerror = () => {
    if(_pollRunning) setTimeout(()=>_connectMjpeg(camId, imgId), 2000);
  };
}

function _connectGridMjpeg(camId){
  const imgId = `grid-stream-${camId}`;
  let img = document.getElementById(imgId);
  if(!img){
    const offEl = document.getElementById(`grid-off-${camId}`);
    const parent = offEl?.parentElement;
    if(!parent) return;
    img = document.createElement("img");
    img.id = imgId;
    img.style.cssText = "width:100%;height:100%;object-fit:contain;display:none;position:absolute;inset:0;background:#000";
    parent.appendChild(img);
  }
  img.src = `/api/stream/${camId}?t=${Date.now()}`;
  img.style.display = "block";
  const offEl = document.getElementById(`grid-off-${camId}`);
  if(offEl) offEl.style.display = "none";
  img.onerror = () => {
    if(_pollRunning) setTimeout(()=>_connectGridMjpeg(camId), 2000);
  };
}

async function pollAllCams(){
  if(!_pollRunning) return;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  const hud = await fetch("/api/hud").then(r=>r.json()).catch(()=>({}));
  if(hud.cust !== undefined){
    const kc=$("k-cust");if(kc)kc.textContent=hud.cust;
    const ks=$("k-staff");if(ks)ks.textContent=hud.seller;
    const ka=$("k-alert");if(ka)ka.textContent=hud.alert;
    const hc=$("h-cust");if(hc)hc.textContent=hud.cust;
    const hs=$("h-staff");if(hs)hs.textContent=hud.seller;
    const ha=$("h-alert");if(ha)ha.textContent=hud.alert;
  }
  if(_camView==="grid" && hud.cams){
    for(const cam of _cameras){
      const h = hud.cams[cam.id]||{};
      const hudEl = document.getElementById(`grid-hud-${cam.id}`);
      if(hudEl) hudEl.innerHTML =
        `<span>${h.cust||0} ${t("hud_customers","customers")}</span>
         <span>${h.seller||0} ${t("hud_staff","staff")}</span>
         <span>${h.alert||0} ${t("hud_alerts","alerts")}</span>`;
    }
  }
}

function startCamPolling(){
  _pollRunning = true;
  if(_camView === "tab"){
    _connectMjpeg(_activeCam, "live-stream");
  } else {
    for(const cam of _cameras) _connectGridMjpeg(cam.id);
  }
  if(!window._camPollInterval)
    window._camPollInterval = setInterval(pollAllCams, 1000);
  pollAllCams();
}

function stopCamPolling(){
  _pollRunning = false;
  clearInterval(window._camPollInterval);
  window._camPollInterval = null;
  const ls = document.getElementById("live-stream");
  if(ls){ ls.src=""; ls.style.display="none"; }
  const fo = document.getElementById("feed-off");
  if(fo) fo.style.display="flex";
  document.querySelectorAll("img[id^='grid-stream-']").forEach(img=>{
    img.src=""; img.style.display="none";
    const offEl = document.getElementById(img.id.replace("grid-stream-","grid-off-"));
    if(offEl) offEl.style.display="flex";
  });
}
// ── End Multi-Camera Manager ───────────────────────────────────────────────────

// ── Behavior Templates ────────────────────────────────────────────────────────
const BEH_TEMPLATES = {
  retail:{ en:{name:"Retail Shop",desc:"General retail — tracks browsing, interest, checkout queue and loitering."}, th:{name:"ร้านค้าปลีก",desc:"ร้านค้าทั่วไป — ติดตามการเดินเลือก ความสนใจ คิวชำระเงิน และการยืนนาน"},
    behaviors:[{id:"browsing",name:"Browsing",name_th:"เดินเลือกสินค้า",zone:"any",action:"moving",threshold:0,alert:false,color:"#888888"},{id:"interested",name:"Interested",name_th:"สนใจสินค้า",zone:"product",action:"dwell",threshold:25,alert:true,color:"#f59e0b"},{id:"loitering",name:"Loitering",name_th:"ยืนนานผิดปกติ",zone:"product",action:"dwell",threshold:90,alert:true,color:"#ef4444"},{id:"checkout",name:"Checkout ready",name_th:"รอชำระเงิน",zone:"checkout",action:"dwell",threshold:5,alert:true,color:"#22c55e"},{id:"queue_long",name:"Long queue",name_th:"คิวยาวนาน",zone:"checkout",action:"dwell",threshold:120,alert:true,color:"#ef4444"},{id:"staff",name:"Staff",name_th:"พนักงาน",zone:"staff",action:"presence",threshold:0,alert:false,color:"#d4a800"}]},
  restaurant:{ en:{name:"Restaurant",desc:"Dine-in restaurant — monitors seating wait times, table occupancy and entrance flow."}, th:{name:"ร้านอาหาร",desc:"ร้านอาหาร — ติดตามเวลารอที่นั่ง การใช้โต๊ะ และการเข้าออกร้าน"},
    behaviors:[{id:"entering",name:"Entering",name_th:"เข้าร้าน",zone:"entrance",action:"presence",threshold:0,alert:false,color:"#22c55e"},{id:"waiting",name:"Waiting seat",name_th:"รอที่นั่ง",zone:"entrance",action:"dwell",threshold:60,alert:true,color:"#f59e0b"},{id:"seated",name:"Seated",name_th:"นั่งรับประทาน",zone:"seating",action:"dwell",threshold:5,alert:false,color:"#d4a800"},{id:"long_seated",name:"Long stay",name_th:"นั่งนานเกิน",zone:"seating",action:"dwell",threshold:90,alert:true,color:"#f59e0b"},{id:"need_help",name:"Needs service",name_th:"ต้องการบริการ",zone:"seating",action:"still",threshold:180,alert:true,color:"#ef4444"},{id:"staff",name:"Staff",name_th:"พนักงาน",zone:"staff",action:"presence",threshold:0,alert:false,color:"#888888"}]},
  wineshop:{ en:{name:"Wine Shop",desc:"Wine & spirits — tracks tasting area dwell time, interest in premium products."}, th:{name:"ร้านไวน์",desc:"ร้านไวน์และเครื่องดื่ม — ติดตามเวลาชิมไวน์ ความสนใจสินค้า premium"},
    behaviors:[{id:"browsing",name:"Browsing",name_th:"เดินเลือก",zone:"any",action:"moving",threshold:0,alert:false,color:"#888888"},{id:"tasting",name:"Tasting",name_th:"กำลังชิม",zone:"product",action:"dwell",threshold:30,alert:false,color:"#a78bfa"},{id:"interested",name:"High interest",name_th:"สนใจมาก",zone:"product",action:"dwell",threshold:60,alert:true,color:"#f59e0b"},{id:"premium",name:"Premium zone",name_th:"โซน Premium",zone:"product",action:"dwell",threshold:45,alert:true,color:"#d4a800"},{id:"checkout",name:"Checkout",name_th:"ชำระเงิน",zone:"checkout",action:"dwell",threshold:5,alert:true,color:"#22c55e"},{id:"loitering",name:"Loitering",name_th:"ยืนนานผิดปกติ",zone:"any",action:"dwell",threshold:300,alert:true,color:"#ef4444"}]},
  exhibition:{ en:{name:"Exhibition",desc:"Trade show / museum — tracks exhibit engagement, crowd flow and dwell at displays."}, th:{name:"นิทรรศการ",desc:"งานแสดงสินค้า / พิพิธภัณฑ์ — ติดตามการมีส่วนร่วม การไหลของฝูงชน และเวลาที่จุดแสดง"},
    behaviors:[{id:"viewing",name:"Viewing",name_th:"กำลังชม",zone:"product",action:"dwell",threshold:10,alert:false,color:"#d4a800"},{id:"engaged",name:"Engaged",name_th:"มีส่วนร่วมสูง",zone:"product",action:"dwell",threshold:60,alert:false,color:"#22c55e"},{id:"crowded",name:"Crowded spot",name_th:"จุดแออัด",zone:"product",action:"dwell",threshold:120,alert:true,color:"#f59e0b"},{id:"blocking",name:"Blocking",name_th:"ขวางทางเดิน",zone:"entrance",action:"dwell",threshold:30,alert:true,color:"#ef4444"},{id:"passing",name:"Passing by",name_th:"เดินผ่าน",zone:"any",action:"moving",threshold:0,alert:false,color:"#aaaaaa"},{id:"staff",name:"Staff",name_th:"เจ้าหน้าที่",zone:"staff",action:"presence",threshold:0,alert:false,color:"#888888"}]},
  cafe:{ en:{name:"Cafe",desc:"Coffee shop — monitors queue at counter, table turnover and long-stay customers."}, th:{name:"คาเฟ่",desc:"ร้านกาแฟ — ติดตามคิวหน้าเคาน์เตอร์ การหมุนเวียนโต๊ะ และลูกค้าที่นั่งนาน"},
    behaviors:[{id:"ordering",name:"Ordering",name_th:"สั่งสินค้า",zone:"checkout",action:"dwell",threshold:5,alert:false,color:"#22c55e"},{id:"queue_long",name:"Long queue",name_th:"คิวยาว",zone:"checkout",action:"dwell",threshold:90,alert:true,color:"#ef4444"},{id:"seated",name:"Seated",name_th:"นั่งในร้าน",zone:"seating",action:"dwell",threshold:5,alert:false,color:"#d4a800"},{id:"long_stay",name:"Long stay",name_th:"นั่งนาน (>2hr)",zone:"seating",action:"dwell",threshold:120,alert:true,color:"#f59e0b"},{id:"browsing",name:"Browsing menu",name_th:"ดูเมนู",zone:"product",action:"dwell",threshold:15,alert:false,color:"#888888"},{id:"staff",name:"Staff",name_th:"บาริสต้า",zone:"staff",action:"presence",threshold:0,alert:false,color:"#a78bfa"}]},
  supermarket:{ en:{name:"Supermarket",desc:"Large retail — tracks aisle browsing, product interest, checkout queue and staff coverage."}, th:{name:"ซูเปอร์มาร์เก็ต",desc:"ร้านค้าขนาดใหญ่ — ติดตามการเดินในช่อง สินค้าน่าสนใจ คิวชำระเงิน และพนักงาน"},
    behaviors:[{id:"browsing",name:"Browsing",name_th:"เดินเลือกสินค้า",zone:"any",action:"moving",threshold:0,alert:false,color:"#888888"},{id:"interested",name:"Interested",name_th:"สนใจสินค้า",zone:"product",action:"dwell",threshold:30,alert:false,color:"#f59e0b"},{id:"checkout",name:"Checkout",name_th:"รอชำระเงิน",zone:"checkout",action:"dwell",threshold:5,alert:true,color:"#22c55e"},{id:"queue_alert",name:"Queue alert",name_th:"คิวยาวเกิน",zone:"checkout",action:"dwell",threshold:180,alert:true,color:"#ef4444"},{id:"need_help",name:"Needs help",name_th:"ต้องการความช่วยเหลือ",zone:"any",action:"still",threshold:60,alert:true,color:"#f97316"},{id:"staff",name:"Staff",name_th:"พนักงาน",zone:"staff",action:"presence",threshold:0,alert:false,color:"#d4a800"}]},
};
async function applyTemplate(key){
  const tmpl=BEH_TEMPLATES[key]; if(!tmpl) return;
  const isTH = (window.isTH ? window.isTH() : (localStorage.getItem("fs_lang")||"en")==="th");
  const info=isTH?tmpl.th:tmpl.en;
  if(!confirm(`${t("c_reset_beh","Reset?").replace("?","")} "${info.name}"?`)) return;
  const newB=tmpl.behaviors.map(b=>({id:b.id,name:isTH?b.name_th:b.name,zone:b.zone,action:b.action,threshold:b.threshold,alert:b.alert,color:b.color}));
  await fetch("/api/behaviors/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(newB)});
  document.querySelectorAll(".tmpl-chip").forEach(c=>c.classList.remove("active"));
  const chip=document.querySelector(`.tmpl-chip[data-tmpl="${key}"]`);
  if(chip) chip.classList.add("active");
  const desc=document.getElementById("tmpl-desc");
  if(desc){desc.textContent=info.desc;desc.style.display="block";}
  await loadBehaviors();
  toast(`Applied "${info.name}" ✓`);
}
// ── End Behavior Templates ─────────────────────────────────────────────────────

let behaviors=[], behEditIdx=-1;
async function loadBehaviors(){
  behaviors=await fetch("/api/behaviors").then(r=>r.json()).catch(()=>[]);
  buildColorPalette("beh-colors",COLORS[0]);
  renderBehList();
}
// Lookup maps for translating behavior zone/action values
const ZONE_KEYS = {any:"opt_any_zone",product:"opt_product_area",checkout:"cat_checkout",
  seating:"cat_seating",staff:"opt_staff_area",entrance:"cat_entrance",floor:"opt_floor"};
const ACTION_KEYS = {dwell:"opt_dwell",still:"opt_still",moving:"opt_moving",presence:"opt_presence"};

function renderBehList(){
  const el=$("beh-list");
  if(!behaviors.length){el.innerHTML='<div class="empty">No behaviors</div>';return;}
  el.innerHTML=behaviors.map((b,i)=>{
    const zoneLbl = t(ZONE_KEYS[b.zone]||b.zone, b.zone);
    const actLbl  = t(ACTION_KEYS[b.action]||b.action, b.action);
    return `
    <div class="beh-item">
      <div class="beh-color" style="background:${b.color||'#888'}"></div>
      <div class="beh-info">
        <div class="beh-name">${b.name}</div>
        <div class="beh-meta">${zoneLbl} · ${actLbl}${b.threshold>0?' · '+b.threshold+'s':''}</div>
      </div>
      ${b.alert?`<span class="badge badge-red">${t("col_alert","Alert")}</span>`:''}
      <button class="icon-btn" onclick="editBeh(${i})" title="Edit">
        <svg viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      </button>
      <button class="icon-btn" onclick="deleteBeh(${i})" title="Delete">
        <svg viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
      </button>
    </div>`;
  }).join("");
  el.innerHTML += `<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="clearBehForm()">+ ${t("lbl_add_beh","Add Behavior")}</button>`;
}
function editBeh(i){
  const b=behaviors[i]; behEditIdx=i;
  $("beh-form-title").textContent=t("lbl_edit_beh","Edit Behavior");
  $("beh-edit-id").value=b.id||"";
  $("beh-name").value=b.name||"";
  $("beh-zone").value=b.zone||"any";
  $("beh-action").value=b.action||"dwell";
  $("beh-threshold").value=b.threshold||0;
  $("beh-dur-val").textContent=b.threshold||0;
  $("beh-alert").checked=!!b.alert;
  buildColorPalette("beh-colors",b.color||COLORS[0]);
}
function clearBehForm(){
  behEditIdx=-1; $("beh-form-title").textContent=t("lbl_add_beh","Add Behavior");
  $("beh-name").value=""; $("beh-zone").value="any";
  $("beh-action").value="dwell"; $("beh-threshold").value=20;
  $("beh-dur-val").textContent=20; $("beh-alert").checked=true;
  buildColorPalette("beh-colors",COLORS[0]);
}
async function saveBehavior(){
  const name=$("beh-name").value.trim();
  if(!name){toast(t("t_beh_name"),"err");return;}
  const beh={
    id: $("beh-edit-id").value||("b_"+Date.now()),
    name, zone:$("beh-zone").value,
    action:$("beh-action").value,
    threshold:+$("beh-threshold").value,
    alert:$("beh-alert").checked,
    color:getSelectedColor("beh-colors"),
  };
  if(behEditIdx>=0) behaviors[behEditIdx]=beh;
  else behaviors.push(beh);
  await fetch("/api/behaviors/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(behaviors)});
  toast(t("t_beh_saved")); clearBehForm(); renderBehList();
}
async function deleteBeh(i){
  confirm_(`Delete "${behaviors[i].name}"?`,"Remove this behavior rule.",async()=>{
    behaviors.splice(i,1);
    await fetch("/api/behaviors/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(behaviors)});
    toast(t("t_beh_del")); renderBehList();});
}
async function resetBehaviors(){
  confirm_(t("c_reset_beh"),t("c_reset_beh"),async()=>{
    await fetch("/api/behaviors/reset",{method:"POST"});
    await loadBehaviors(); toast(t("t_beh_reset"));});
}

// ── Settings ───────────────────────────────────────────────────────────────────
async function loadSettings(){
  const s=await fetch("/api/settings").then(r=>r.json()).catch(()=>({}));
  if(s.conf!=null) $("s-conf").value=s.conf;
  if(s.gemini_api_key) $("s-gemini").value=s.gemini_api_key;
  if(s.claude_api_key) $("s-claude").value=s.claude_api_key;
  $("s-anon").checked=!!s.anonymize;
}
async function saveSettings(){
  const settings={
    conf:+$("s-conf").value,
    anonymize:$("s-anon").checked,
    gemini_api_key:$("s-gemini").value, claude_api_key:$("s-claude").value,
  };
  await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(settings)});
  toast(t("t_set_saved"));
}

// ── Heat Map ──────────────────────────────────────────────────────────────────
let hmTimer = null;
let _hmCam = "cam_0";

function hmPopulateCamSelect(){
  const sel=$("hm-cam-select");
  if(!sel) return;
  const cams=_cameras&&_cameras.length?_cameras:[{id:"cam_0",name:"Camera 1"}];
  sel.innerHTML=cams.map(c=>`<option value="${c.id}"${c.id===_hmCam?" selected":""}>${c.name||c.id}</option>`).join("");
}

function onHeatmapCamChange(){
  _hmCam=$("hm-cam-select")?.value||"cam_0";
  refreshHeatmap();
}

function startHeatmapPoll(){
  if(_activeCam) _hmCam=_activeCam;
  hmPopulateCamSelect();
  if(hmTimer) return;
  hmTimer = setInterval(refreshHeatmap, 5000);
  refreshHeatmap();
}
function stopHeatmapPoll(){ clearInterval(hmTimer); hmTimer=null; }

function refreshHeatmap(){
  const alpha = Math.round(($("hm-alpha")?.value||50)/100*100);
  const img = $("heatmap-img");
  if(img) img.src = `/api/heatmap/jpeg?cam=${_hmCam}&alpha=${alpha/100}&t=${Date.now()}`;
  fetch(`/api/heatmap/zones?cam=${_hmCam}`).then(r=>r.json()).then(zones=>{
    const el=$("hm-zones");
    if(!el) return;
    if(!zones.length){el.innerHTML='<div class="empty">No zone data yet</div>';return;}
    const max=zones[0].score||1;
    el.innerHTML=zones.map((z,i)=>`
      <div class="zbar-row">
        <div class="zbar-meta">
          <span>${i===0?"🔥":"📍"} ${z.name}</span>
          <span style="color:var(--muted)">#${i+1}</span>
        </div>
        <div class="zbar-bg">
          <div class="zbar-fill" style="width:${Math.round(z.score/max*100)}%;background:var(--accent)"></div>
        </div>
      </div>`).join("");
  }).catch(()=>{});
}

function resetHeatmap(){
  fetch("/api/heatmap/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cam:_hmCam})}).then(()=>{ refreshHeatmap(); toast(t("t_hm_reset")); });
}

// ── Subscription ──────────────────────────────────────────────────────────────


// ── AI Insight (no auth required) ────────────────────────────────────────────
async function loadInsight(){
  const panel = document.getElementById("insight-content");
  const srcEl = document.getElementById("insight-src");
  if(panel){ panel.style.display = "block"; panel.innerHTML = "⏳ Generating..."; }
  if(srcEl) srcEl.style.display = "block";
  const date = $("rpt-date")?.value || new Date().toISOString().slice(0,10);
  const r = await fetch(`/api/insight?date=${date}`)
    .then(res=>res.json()).catch(()=>({ok:false}));
  if(srcEl) srcEl.textContent = r.source || "AI Analysis";
  if(panel) panel.innerHTML = r.html || "<span style='color:var(--muted)'>No data available</span>";
}

// ── Activity Log ──────────────────────────────────────────────────────────────
let _actPage = 1;
async function loadActivity(page){
  page=Math.max(1,page||1); _actPage=page;
  const date=document.getElementById("rpt-date")?.value||"";
  const behavior=document.getElementById("act-behavior")?.value||"";
  const zone=document.getElementById("act-zone")?.value||"";
  const alert=document.getElementById("act-alert")?.value||"";
  const tbody=document.getElementById("act-tbody");
  if(tbody) tbody.innerHTML=`<tr><td colspan="5" style="padding:32px;text-align:center;color:var(--muted)">${t("lbl_loading","Loading...")}</td></tr>`;
  const params=new URLSearchParams({page,per_page:50});
  if(date) params.set("date",date); if(behavior) params.set("behavior",behavior);
  if(zone) params.set("zone",zone); if(alert) params.set("alert",alert);
  const [d,s]=await Promise.all([
    fetch(`/api/activity?${params}`).then(r=>r.json()).catch(()=>({ok:false,events:[],total:0,pages:1})),
    fetch(`/api/activity/summary?date=${date}`).then(r=>r.json()).catch(()=>({ok:false,total:0,interested:0,alerts:0,top_zone:"—"}))
  ]);
  // Counter cards
  const el=id=>document.getElementById(id);
  if(el("cnt-total")) el("cnt-total").textContent=s.total?.toLocaleString()||"0";
  if(el("cnt-interested")) el("cnt-interested").textContent=s.interested?.toLocaleString()||"0";
  if(el("cnt-interested-pct")) el("cnt-interested-pct").textContent=s.total?`${s.interested_pct}% ${t("cnt_of_visitors","of visitors")}`:"";
  if(el("cnt-alerts")) el("cnt-alerts").textContent=s.alerts?.toLocaleString()||"0";
  if(el("cnt-top-zone")) el("cnt-top-zone").textContent=s.top_zone||"—";
  if(el("cnt-top-zone-count")&&s.top_zone_count) el("cnt-top-zone-count").textContent=`${s.top_zone_count} ${t("hud_alerts","events")}`;
  // Filters — preserve value after rebuild
  _updateActDropdown("act-behavior",d.behaviors||[],t("opt_all_beh","All behaviors"));
  _updateActDropdown("act-zone",d.zones||[],t("opt_all_zones","All zones"));
  if(behavior) document.getElementById("act-behavior").value=behavior;
  if(zone) document.getElementById("act-zone").value=zone;
  // Summary
  const tl=el("act-total-lbl");
  if(tl) tl.textContent=`${d.total?.toLocaleString()||0} ${t("lbl_no_activity","events found").replace("No events found","events found")}`;
  // Table
  if(!tbody) return;
  if(!d.events?.length){
    tbody.innerHTML=`<tr><td colspan="5" style="padding:32px;text-align:center;color:var(--muted)">${t("lbl_no_activity","No events found")}</td></tr>`;
    return;
  }
  tbody.innerHTML=d.events.map(e=>`<tr style="border-bottom:1px solid var(--border)" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background=''">
    <td style="padding:9px 12px;color:var(--muted);font-family:monospace">${e.time}</td>
    <td style="padding:9px 12px;font-weight:500">#${e.person_id}</td>
    <td style="padding:9px 12px"><span style="background:var(--surface2);padding:2px 8px;border-radius:4px;font-size:11px">${e.zone}</span></td>
    <td style="padding:9px 12px">${e.behavior}</td>
    <td style="padding:9px 12px;text-align:center">${e.alert?`<span style="background:#fef2f2;color:#ef4444;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">⚠ ${t("col_alert","Alert")}</span>`:'<span style="color:var(--muted)">—</span>'}</td>
  </tr>`).join("");
  const pi=el("act-page-info");
  if(pi) pi.textContent=`${t("btn_prev","Page").replace("←","").trim()} ${page} / ${d.pages}`;
  const pb=el("act-prev"); if(pb) pb.disabled=page<=1;
  const nb=el("act-next"); if(nb) nb.disabled=page>=d.pages;
}
function _updateActDropdown(id,items,allLabel){
  const sel=document.getElementById(id); if(!sel) return;
  const cur=sel.value;
  sel.innerHTML=`<option value="">${allLabel}</option>`+items.map(v=>`<option value="${v}">${v}</option>`).join("");
  if(cur) sel.value=cur;
}
function clearActivityFilters(){
  // act-date removed — date is shared via rpt-date
  const b=document.getElementById("act-behavior"); if(b) b.value="";
  const z=document.getElementById("act-zone"); if(z) z.value="";
  const a=document.getElementById("act-alert"); if(a) a.value="";
  loadActivity(1);
}
async function exportActivityCSV(){
  const date=document.getElementById("rpt-date")?.value||"";
  const behavior=document.getElementById("act-behavior")?.value||"";
  const zone=document.getElementById("act-zone")?.value||"";
  const alert=document.getElementById("act-alert")?.value||"";
  const params=new URLSearchParams({page:1,per_page:10000});
  if(date) params.set("date",date); if(behavior) params.set("behavior",behavior);
  if(zone) params.set("zone",zone); if(alert) params.set("alert",alert);
  const d=await fetch(`/api/activity?${params}`).then(r=>r.json()).catch(()=>({events:[]}));
  if(!d.events?.length){toast(t("t_no_data","No data to export"),"err");return;}
  const header="Time,Date,Person ID,Zone,Behavior,Alert\n";
  const rows=d.events.map(e=>`${e.time},${e.date},#${e.person_id},"${e.zone}","${e.behavior}",${e.alert?"Yes":"No"}`).join("\n");
  const blob=new Blob([header+rows],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`flowsight_activity_${date||"all"}.csv`; a.click();
  URL.revokeObjectURL(url); toast(t("t_exported","Exported ✓"));
}
// ── End Activity Log ──────────────────────────────────────────────────────────

// ── Init ───────────────────────────────────────────────────────────────────────
$("rpt-date").value=new Date().toISOString().slice(0,10);
const _actDateEl=null; // merged — uses rpt-date
if(_actDateEl) _actDateEl.value=new Date().toISOString().slice(0,10);
// act-date removed — rpt-date is the shared date picker
loadSettings();
loadCameras().then(()=>setCamView(_camView));
fetch("/api/brand").then(r=>r.json()).then(b=>{
  if(b.name){$("nav-brand").innerHTML=`<svg class="brand-icon" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">  <defs>    <linearGradient id="fg1" x1="0%" y1="0%" x2="100%" y2="100%">      <stop offset="0%" style="stop-color:#4dd0c4"/>      <stop offset="100%" style="stop-color:#1a5f7a"/>    </linearGradient>  </defs>  <!-- Eye shape -->  <path d="M4 13 Q16 4 28 13 Q16 22 4 13Z" fill="none" stroke="url(#fg1)" stroke-width="2" stroke-linejoin="round"/>  <!-- Pupil -->  <circle cx="16" cy="13" r="4" fill="url(#fg1)"/>  <circle cx="17" cy="12" r="1.2" fill="rgba(255,255,255,0.5)"/>  <!-- Flow lines -->  <path d="M6 20 Q10 18 14 21 Q18 24 22 21" fill="none" stroke="url(#fg1)" stroke-width="1.8" stroke-linecap="round"/>  <path d="M8 24 Q12 22 16 25 Q19 27 22 25" fill="none" stroke="url(#fg1)" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/></svg>${b.name}`;document.title=b.name;}
});
pollHud(); pollAlerts(); pollStats();
setInterval(pollHud,1500); setInterval(pollAlerts,3000); setInterval(pollStats,15000);
