// FlowSight i18n engine — extracted from index.html
// Loads AFTER translations.js (window.FS_LANG must exist).
// ── i18n Engine — instant no-reload language switch ───────────────────────────
(function(){
  var _L = localStorage.getItem("fs_lang") || "en";

  function _T(key, fallback){
    var d = window.FS_LANG[_L] || {};
    return d[key] || (window.FS_LANG.en||{})[key] || fallback || key;
  }
  window.t = _T;

  window.applyLang = function applyLang(){
    // 1. data-i18n elements
    document.querySelectorAll("[data-i18n]").forEach(function(el){
      var key = el.getAttribute("data-i18n");
      var val = _T(key);
      if(val) el.textContent = val;
    });
    // 2. Nav tab text nodes (plain text inside .ntab buttons)
    var tabMap = {
      live:"nav_live", dash:"nav_dashboard", zones:"nav_zones",
      behaviors:"nav_behaviors", heatmap:"nav_heatmap",
      settings:"nav_settings"
    };
    document.querySelectorAll(".ntab").forEach(function(btn){
      var fn = btn.getAttribute("onclick")||"";
      var m  = fn.match(/showPage\('(\w+)'/);
      if(!m) return;
      var key = tabMap[m[1]];
      if(!key) return;
      var val = _T(key);
      // Find and replace text node
      for(var i=0; i<btn.childNodes.length; i++){
        var node = btn.childNodes[i];
        if(node.nodeType===3 && node.textContent.trim()){
          node.textContent = " "+val+" "; break;
        }
      }
    });
    // 3. Status label
    var sLbl = document.getElementById("status-lbl");
    if(sLbl){
      var running = sLbl.closest && sLbl.textContent.trim() !== _T("status_stopped");
      // preserve current state
      var isRunning = !["Stopped","หยุดทำงาน"].includes(sLbl.textContent.trim());
      sLbl.textContent = isRunning ? _T("status_running") : _T("status_stopped");
    }
    // 4. Start/Stop button
    var mainBtn = document.getElementById("main-btn");
    if(mainBtn){
      var span = mainBtn.querySelector("span[data-i18n]");
      if(span){
        var isStop = ["btn_stop","⏹ Stop","⏹ หยุด"].some(function(v){
          return span.textContent.includes("หยุด")||span.textContent.includes("Stop");
        });
        span.textContent = isStop ? _T("btn_stop") : _T("btn_start");
      }
    }
    // 5. lang-select
    var sel = document.getElementById("lang-select");
    if(sel) sel.value = _L;
    // 6. html lang attribute
    document.documentElement.lang = _L;
    // 7. placeholder attributes
    document.querySelectorAll("[data-i18n-ph]").forEach(function(el){
      var val = _T(el.getAttribute("data-i18n-ph"));
      if(val) el.placeholder = val;
    });
    // 8. select <option> tags with data-i18n
    document.querySelectorAll("select option[data-i18n]").forEach(function(el){
      var val = _T(el.getAttribute("data-i18n"));
      if(val) el.textContent = val;
    });
    // 9. tip-box uses innerHTML so line breaks survive — re-render with <br>
    document.querySelectorAll(".tip-box[data-i18n]").forEach(function(el){
      var key = el.getAttribute("data-i18n");
      var raw = _T(key);
      if(raw) el.innerHTML = raw.replace(/\|/g,"<br>");
    });
  }

  window.setLang = function(lang){
    if(lang !== "en" && lang !== "th") return;
    _L = lang;
    localStorage.setItem("fs_lang", lang);
    applyLang();
    // Re-render all dynamic content
    if(typeof loadCameras === "function") loadCameras();
    if(typeof renderCamManagerList === "function") renderCamManagerList();
    if(typeof renderCamGrid === "function") renderCamGrid();
    if(typeof loadBehaviors === "function" && document.getElementById("pg-behaviors")?.classList.contains("on")) loadBehaviors();
    if(typeof loadDash === "function" && document.getElementById("pg-dash")?.classList.contains("on")){ loadDash(); loadActivity(1); }
    // Refresh active page dynamic content
    var activePage = document.querySelector(".page.on");
    if(activePage && activePage.id === "pg-dash" && typeof loadActivity === "function") loadActivity(_actPage||1);
  };

  window.toggleLang = function(){
    window.setLang(_L === "en" ? "th" : "en");
  };
  // Global helper - replaces localStorage.getItem checks throughout app
  window.isTH = function(){ return _L === "th"; };

  // Apply on load — translations.js loads synchronously before this block
  function safeApply(){
    if(window.FS_LANG){ applyLang(); }
    else { setTimeout(safeApply, 20); }  // fallback poll just in case
  }
  // Run immediately — DOM is ready and translations.js already executed
  safeApply();
  // Also re-apply after full page load to catch any late-rendered elements
  window.addEventListener("load", function(){ applyLang(); });
})();
// ── End i18n ──────────────────────────────────────────────────────────────────
