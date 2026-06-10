import { useEffect, useState } from "react";

export type Lang = "en" | "th";
const KEY = "flowsight.lang";

const dict = {
  en: {
    appName: "FlowSight",
    nav: { live: "Live", dashboard: "Dashboard", zones: "Zones", behaviors: "Behaviors", heatmap: "Heat Map", settings: "Settings" },
    common: {
      running: "Running", stopped: "Stopped", start: "Start engine", stop: "Stop engine",
      save: "Save", reset: "Reset", delete: "Delete", add: "Add", cancel: "Cancel",
      loading: "Loading…", noData: "No data", refresh: "Refresh", clearAll: "Clear all", saveAll: "Save all",
      engineStopped: "Engine stopped. Start the engine to begin.",
      camera: "Camera", today: "Today", export: "Export",
    },
    live: {
      title: "Live Operations", customers: "Customers", staff: "Staff", alerts: "Alerts", device: "Device",
      recentAlerts: "Recent Alerts", noAlerts: "No alerts yet.",
      viewSingle: "Single", viewGrid: "Grid",
    },
    dash: {
      title: "Dashboard", totalVisitors: "Total Visitors", interested: "Interested",
      purchasing: "Purchasing", topZone: "Top Zone", hourly: "Hourly Activity",
      zoneActivity: "Zone Activity", aiInsight: "AI Insight", activityLog: "Activity Log",
      csv: "Export CSV", pdf: "Export PDF", date: "Date",
      time: "Time", person: "Person", zone: "Zone", behavior: "Behavior", alert: "Alert",
      page: "Page", of: "of", source: "Source",
    },
    zones: {
      title: "Zone Editor", name: "Zone name", category: "Category", points: "Points",
      undo: "Undo last point", addZone: "Add zone", updateZone: "Update zone", saved: "Saved", list: "Zones",
      color: "Color", editing: "Editing", cancelEdit: "Cancel",
      categories: { product: "Product", checkout: "Checkout", seating: "Seating", staff: "Staff", entrance: "Entrance", custom: "Custom" },
      needPoints: "Click on the canvas to add at least 3 points.",
    },
    behaviors: {
      title: "Behaviors", actionLabel: "Action", thresholdLabel: "Threshold (s)", alertLabel: "Alert",
      addRow: "Add behavior",
      templates: "Quick-start templates", templatesHint: "Apply a preset behavior set for your venue type (replaces the current list).",
      applyConfirm: "Replace all behaviors with the preset",
    },
    heat: { title: "Heat Map", zoneScores: "Zone Scores", reset: "Reset heatmap" },
    settings: {
      title: "Settings", branding: "Branding", brandName: "Brand name", tagline: "Tagline",
      detection: "Detection", confidence: "Confidence", anonymize: "Anonymize people",
      dwellInterested: "Dwell — Interested (s)", dwellLoitering: "Dwell — Loitering (s)",
      dwellCheckout: "Dwell — Checkout min (s)", dwellSeating: "Dwell — Seating waiting (s)",
      aiKeys: "AI API keys", gemini: "Gemini API key", claude: "Claude API key",
      cameras: "Cameras", camId: "ID", camName: "Name", camRtsp: "RTSP URL", camEnabled: "Enabled",
      saveAll: "Save settings", saved: "Settings saved",
    },
  },
  th: {
    appName: "FlowSight",
    nav: { live: "ไลฟ์", dashboard: "แดชบอร์ด", zones: "โซน", behaviors: "พฤติกรรม", heatmap: "ฮีตแมป", settings: "ตั้งค่า" },
    common: {
      running: "กำลังทำงาน", stopped: "หยุด", start: "เริ่มทำงาน", stop: "หยุดทำงาน",
      save: "บันทึก", reset: "รีเซ็ต", delete: "ลบ", add: "เพิ่ม", cancel: "ยกเลิก",
      loading: "กำลังโหลด…", noData: "ไม่มีข้อมูล", refresh: "รีเฟรช", clearAll: "ล้างทั้งหมด", saveAll: "บันทึกทั้งหมด",
      engineStopped: "ระบบยังไม่ทำงาน เริ่มทำงานเพื่อใช้งาน",
      camera: "กล้อง", today: "วันนี้", export: "ส่งออก",
    },
    live: {
      title: "การทำงานสด", customers: "ลูกค้า", staff: "พนักงาน", alerts: "แจ้งเตือน", device: "อุปกรณ์",
      recentAlerts: "แจ้งเตือนล่าสุด", noAlerts: "ยังไม่มีการแจ้งเตือน",
      viewSingle: "กล้องเดียว", viewGrid: "ตาราง",
    },
    dash: {
      title: "แดชบอร์ด", totalVisitors: "ผู้เข้าชมรวม", interested: "สนใจ",
      purchasing: "ซื้อสินค้า", topZone: "โซนยอดนิยม", hourly: "กิจกรรมรายชั่วโมง",
      zoneActivity: "กิจกรรมตามโซน", aiInsight: "AI สรุปข้อมูล", activityLog: "บันทึกกิจกรรม",
      csv: "ส่งออก CSV", pdf: "ส่งออก PDF", date: "วันที่",
      time: "เวลา", person: "บุคคล", zone: "โซน", behavior: "พฤติกรรม", alert: "แจ้งเตือน",
      page: "หน้า", of: "จาก", source: "แหล่งข้อมูล",
    },
    zones: {
      title: "แก้ไขโซน", name: "ชื่อโซน", category: "หมวดหมู่", points: "จุด",
      undo: "ย้อนจุดล่าสุด", addZone: "เพิ่มโซน", updateZone: "อัปเดตโซน", saved: "บันทึกแล้ว", list: "รายการโซน",
      color: "สี", editing: "กำลังแก้ไข", cancelEdit: "ยกเลิก",
      categories: { product: "สินค้า", checkout: "เคาน์เตอร์", seating: "ที่นั่ง", staff: "พนักงาน", entrance: "ทางเข้า", custom: "กำหนดเอง" },
      needPoints: "คลิกบนภาพเพื่อเพิ่มจุดอย่างน้อย 3 จุด",
    },
    behaviors: {
      title: "พฤติกรรม", actionLabel: "การกระทำ", thresholdLabel: "เวลา (วินาที)", alertLabel: "แจ้งเตือน",
      addRow: "เพิ่มพฤติกรรม",
      templates: "เทมเพลตเริ่มต้น", templatesHint: "เลือกชุดพฤติกรรมสำเร็จรูปตามประเภทร้าน (จะแทนที่รายการปัจจุบัน)",
      applyConfirm: "แทนที่พฤติกรรมทั้งหมดด้วยชุด",
    },
    heat: { title: "ฮีตแมป", zoneScores: "คะแนนตามโซน", reset: "รีเซ็ตฮีตแมป" },
    settings: {
      title: "ตั้งค่า", branding: "แบรนด์", brandName: "ชื่อแบรนด์", tagline: "สโลแกน",
      detection: "การตรวจจับ", confidence: "ความเชื่อมั่น", anonymize: "ปกปิดใบหน้า",
      dwellInterested: "เวลาที่สนใจ (วินาที)", dwellLoitering: "เวลายืนนาน (วินาที)",
      dwellCheckout: "เวลาขั้นต่ำที่เคาน์เตอร์ (วินาที)", dwellSeating: "เวลารอที่นั่ง (วินาที)",
      aiKeys: "คีย์ AI", gemini: "Gemini API key", claude: "Claude API key",
      cameras: "กล้อง", camId: "ID", camName: "ชื่อ", camRtsp: "RTSP URL", camEnabled: "เปิดใช้",
      saveAll: "บันทึกการตั้งค่า", saved: "บันทึกสำเร็จ",
    },
  },
};

let current: Lang = (typeof localStorage !== "undefined" && (localStorage.getItem(KEY) as Lang)) || "en";
const listeners = new Set<() => void>();

export function getLang(): Lang { return current; }
export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch {}
  listeners.forEach((fn) => fn());
}
export function useLang() {
  const [l, set] = useState<Lang>(current);
  useEffect(() => {
    const fn = () => set(current);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return { lang: l, setLang, t: dict[l] };
}
