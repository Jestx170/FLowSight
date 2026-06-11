// Quick-start behavior presets (ported from the legacy app). Applying a template
// replaces the whole behavior list with a curated set for that venue type.
import type { BehaviorRow } from "./api";
import retailIcon from "./public/shop-1-svgrepo-com.svg";
import restaurantIcon from "./public/food-dish-svgrepo-com.svg";
import wineshopIcon from "./public/wine-glass-svgrepo-com.svg";
import exhibitionIcon from "./public/art-design-paint-pallet-format-text-svgrepo-com.svg";
import cafeIcon from "./public/cafe-svgrepo-com.svg";
import supermarketIcon from "./public/trolley-2-svgrepo-com.svg";

interface TemplateBeh {
  id: string; name: string; name_th: string; zone: string;
  action: BehaviorRow["action"]; threshold: number; alert: boolean; color: string;
}
export interface BehaviorTemplate {
  key: string; icon: string;
  iconSrc?: string; // optional image URL — takes precedence over the emoji
  en: { name: string; desc: string };
  th: { name: string; desc: string };
  behaviors: TemplateBeh[];
}

export const BEH_TEMPLATES: BehaviorTemplate[] = [
  {
    key: "retail", icon: "🛍️", iconSrc: retailIcon,
    en: { name: "Retail Shop", desc: "General retail — browsing, interest, checkout queue and loitering." },
    th: { name: "ร้านค้าปลีก", desc: "ร้านทั่วไป — เดินเลือก ความสนใจ คิวชำระเงิน และการยืนนาน" },
    behaviors: [
      { id: "browsing", name: "Browsing", name_th: "เดินเลือกสินค้า", zone: "any", action: "moving", threshold: 0, alert: false, color: "#888888" },
      { id: "interested", name: "Interested", name_th: "สนใจสินค้า", zone: "product", action: "dwell", threshold: 25, alert: true, color: "#f59e0b" },
      { id: "loitering", name: "Loitering", name_th: "ยืนนานผิดปกติ", zone: "product", action: "dwell", threshold: 90, alert: true, color: "#ef4444" },
      { id: "checkout", name: "Checkout ready", name_th: "รอชำระเงิน", zone: "checkout", action: "dwell", threshold: 5, alert: true, color: "#22c55e" },
      { id: "queue_long", name: "Long queue", name_th: "คิวยาวนาน", zone: "checkout", action: "dwell", threshold: 120, alert: true, color: "#ef4444" },
      { id: "staff", name: "Staff", name_th: "พนักงาน", zone: "staff", action: "presence", threshold: 0, alert: false, color: "#d4a800" },
    ],
  },
  {
    key: "restaurant", icon: "🍽️", iconSrc: restaurantIcon,
    en: { name: "Restaurant", desc: "Dine-in — seating wait times, table occupancy and entrance flow." },
    th: { name: "ร้านอาหาร", desc: "ร้านอาหาร — เวลารอที่นั่ง การใช้โต๊ะ และการเข้าออกร้าน" },
    behaviors: [
      { id: "entering", name: "Entering", name_th: "เข้าร้าน", zone: "entrance", action: "presence", threshold: 0, alert: false, color: "#22c55e" },
      { id: "waiting", name: "Waiting seat", name_th: "รอที่นั่ง", zone: "entrance", action: "dwell", threshold: 60, alert: true, color: "#f59e0b" },
      { id: "seated", name: "Seated", name_th: "นั่งรับประทาน", zone: "seating", action: "dwell", threshold: 5, alert: false, color: "#d4a800" },
      { id: "long_seated", name: "Long stay", name_th: "นั่งนานเกิน", zone: "seating", action: "dwell", threshold: 90, alert: true, color: "#f59e0b" },
      { id: "need_help", name: "Needs service", name_th: "ต้องการบริการ", zone: "seating", action: "still", threshold: 180, alert: true, color: "#ef4444" },
      { id: "staff", name: "Staff", name_th: "พนักงาน", zone: "staff", action: "presence", threshold: 0, alert: false, color: "#888888" },
    ],
  },
  {
    key: "wineshop", icon: "🍷", iconSrc: wineshopIcon,
    en: { name: "Wine Shop", desc: "Wine & spirits — tasting dwell time, interest in premium products." },
    th: { name: "ร้านไวน์", desc: "ร้านไวน์ — เวลาชิม ความสนใจสินค้า premium" },
    behaviors: [
      { id: "browsing", name: "Browsing", name_th: "เดินเลือก", zone: "any", action: "moving", threshold: 0, alert: false, color: "#888888" },
      { id: "tasting", name: "Tasting", name_th: "กำลังชิม", zone: "product", action: "dwell", threshold: 30, alert: false, color: "#a78bfa" },
      { id: "interested", name: "High interest", name_th: "สนใจมาก", zone: "product", action: "dwell", threshold: 60, alert: true, color: "#f59e0b" },
      { id: "premium", name: "Premium zone", name_th: "โซน Premium", zone: "product", action: "dwell", threshold: 45, alert: true, color: "#d4a800" },
      { id: "checkout", name: "Checkout", name_th: "ชำระเงิน", zone: "checkout", action: "dwell", threshold: 5, alert: true, color: "#22c55e" },
      { id: "loitering", name: "Loitering", name_th: "ยืนนานผิดปกติ", zone: "any", action: "dwell", threshold: 300, alert: true, color: "#ef4444" },
    ],
  },
  {
    key: "exhibition", icon: "🏛️", iconSrc: exhibitionIcon,
    en: { name: "Exhibition", desc: "Trade show / museum — exhibit engagement, crowd flow, dwell at displays." },
    th: { name: "นิทรรศการ", desc: "งานแสดง / พิพิธภัณฑ์ — การมีส่วนร่วม การไหลของฝูงชน เวลาที่จุดแสดง" },
    behaviors: [
      { id: "viewing", name: "Viewing", name_th: "กำลังชม", zone: "product", action: "dwell", threshold: 10, alert: false, color: "#d4a800" },
      { id: "engaged", name: "Engaged", name_th: "มีส่วนร่วมสูง", zone: "product", action: "dwell", threshold: 60, alert: false, color: "#22c55e" },
      { id: "crowded", name: "Crowded spot", name_th: "จุดแออัด", zone: "product", action: "dwell", threshold: 120, alert: true, color: "#f59e0b" },
      { id: "blocking", name: "Blocking", name_th: "ขวางทางเดิน", zone: "entrance", action: "dwell", threshold: 30, alert: true, color: "#ef4444" },
      { id: "passing", name: "Passing by", name_th: "เดินผ่าน", zone: "any", action: "moving", threshold: 0, alert: false, color: "#aaaaaa" },
      { id: "staff", name: "Staff", name_th: "เจ้าหน้าที่", zone: "staff", action: "presence", threshold: 0, alert: false, color: "#888888" },
    ],
  },
  {
    key: "cafe", icon: "☕", iconSrc: cafeIcon,
    en: { name: "Cafe", desc: "Coffee shop — counter queue, table turnover and long-stay customers." },
    th: { name: "คาเฟ่", desc: "ร้านกาแฟ — คิวหน้าเคาน์เตอร์ การหมุนเวียนโต๊ะ และลูกค้านั่งนาน" },
    behaviors: [
      { id: "ordering", name: "Ordering", name_th: "สั่งสินค้า", zone: "checkout", action: "dwell", threshold: 5, alert: false, color: "#22c55e" },
      { id: "queue_long", name: "Long queue", name_th: "คิวยาว", zone: "checkout", action: "dwell", threshold: 90, alert: true, color: "#ef4444" },
      { id: "seated", name: "Seated", name_th: "นั่งในร้าน", zone: "seating", action: "dwell", threshold: 5, alert: false, color: "#d4a800" },
      { id: "long_stay", name: "Long stay", name_th: "นั่งนาน (>2hr)", zone: "seating", action: "dwell", threshold: 120, alert: true, color: "#f59e0b" },
      { id: "browsing", name: "Browsing menu", name_th: "ดูเมนู", zone: "product", action: "dwell", threshold: 15, alert: false, color: "#888888" },
      { id: "staff", name: "Staff", name_th: "บาริสต้า", zone: "staff", action: "presence", threshold: 0, alert: false, color: "#a78bfa" },
    ],
  },
  {
    key: "supermarket", icon: "🛒", iconSrc: supermarketIcon,
    en: { name: "Supermarket", desc: "Large retail — aisle browsing, product interest, checkout queue, staff coverage." },
    th: { name: "ซูเปอร์มาร์เก็ต", desc: "ร้านขนาดใหญ่ — เดินในช่อง สินค้าน่าสนใจ คิวชำระเงิน และพนักงาน" },
    behaviors: [
      { id: "browsing", name: "Browsing", name_th: "เดินเลือกสินค้า", zone: "any", action: "moving", threshold: 0, alert: false, color: "#888888" },
      { id: "interested", name: "Interested", name_th: "สนใจสินค้า", zone: "product", action: "dwell", threshold: 30, alert: false, color: "#f59e0b" },
      { id: "checkout", name: "Checkout", name_th: "รอชำระเงิน", zone: "checkout", action: "dwell", threshold: 5, alert: true, color: "#22c55e" },
      { id: "queue_alert", name: "Queue alert", name_th: "คิวยาวเกิน", zone: "checkout", action: "dwell", threshold: 180, alert: true, color: "#ef4444" },
      { id: "need_help", name: "Needs help", name_th: "ต้องการความช่วยเหลือ", zone: "any", action: "still", threshold: 60, alert: true, color: "#f97316" },
      { id: "staff", name: "Staff", name_th: "พนักงาน", zone: "staff", action: "presence", threshold: 0, alert: false, color: "#d4a800" },
    ],
  },
];

// Convert a template into the BehaviorRow[] the backend expects, picking names
// for the active language.
export function templateToRows(tpl: BehaviorTemplate, lang: "en" | "th"): BehaviorRow[] {
  return tpl.behaviors.map((b) => ({
    id: b.id, name: lang === "th" ? b.name_th : b.name,
    zone: b.zone, action: b.action, threshold: b.threshold, alert: b.alert, color: b.color,
  }));
}
