import { useHashRoute, navigate, type RoutePath } from "./router";
import { useLang } from "./i18n";
import { LivePage } from "./pages/Live";
import { DashboardPage } from "./pages/Dashboard";
import { ZonesPage } from "./pages/Zones";
import { BehaviorsPage } from "./pages/Behaviors";
import { HeatmapPage } from "./pages/Heatmap";
import { SettingsPage } from "./pages/Settings";
import { Activity, BarChart3, LayoutGrid, ListChecks, Flame, Settings as Cog } from "lucide-react";
import logo from "./public/logo.png";

export default function App() {
  const route = useHashRoute();
  const { lang, setLang, t } = useLang();

  const links: Array<{ to: RoutePath; label: string; icon: React.ReactNode }> = [
    { to: "/live", label: t.nav.live, icon: <Activity size={16} /> },
    { to: "/dashboard", label: t.nav.dashboard, icon: <BarChart3 size={16} /> },
    { to: "/zones", label: t.nav.zones, icon: <LayoutGrid size={16} /> },
    { to: "/behaviors", label: t.nav.behaviors, icon: <ListChecks size={16} /> },
    { to: "/heatmap", label: t.nav.heatmap, icon: <Flame size={16} /> },
    { to: "/settings", label: t.nav.settings, icon: <Cog size={16} /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="bg-surface border-b border-border sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
          <a href="#/live" className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <img src={logo} alt="FlowSight" className="w-8 h-8 object-contain" />
            {t.appName}
          </a>
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {links.map((l) => {
              const active = route === l.to;
              return (
                <button
                  key={l.to}
                  onClick={() => navigate(l.to)}
                  className={
                    "inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
                    (active
                      ? "bg-accent text-primary"
                      : "text-foreground/70 hover:text-primary hover:bg-accent/60")
                  }
                >
                  {l.icon}
                  {l.label}
                </button>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1 border border-border rounded-md p-0.5 bg-surface">
            <button
              onClick={() => setLang("en")}
              className={"px-2 py-1 text-xs font-semibold rounded " + (lang === "en" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >EN</button>
            <button
              onClick={() => setLang("th")}
              className={"px-2 py-1 text-xs font-semibold rounded " + (lang === "th" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >TH</button>
          </div>
        </div>
        <div className="md:hidden border-t border-border overflow-x-auto">
          <div className="flex gap-1 px-4 py-2 min-w-max">
            {links.map((l) => {
              const active = route === l.to;
              return (
                <button key={l.to} onClick={() => navigate(l.to)}
                  className={"px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap " + (active ? "bg-accent text-primary" : "text-muted-foreground")}>
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
          {route === "/live" && <LivePage />}
          {route === "/dashboard" && <DashboardPage />}
          {route === "/zones" && <ZonesPage />}
          {route === "/behaviors" && <BehaviorsPage />}
          {route === "/heatmap" && <HeatmapPage />}
          {route === "/settings" && <SettingsPage />}
        </div>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 text-xs text-muted-foreground flex items-center justify-between">
          <span>© {new Date().getFullYear()} FlowSight</span>
          <span>Retail Intelligence Platform</span>
        </div>
      </footer>
    </div>
  );
}
