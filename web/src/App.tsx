import { useCallback, useEffect, useState } from "react";
import {
  Boxes, Database, HardDrive, LayoutDashboard, Menu, Network, NotebookPen, Search, Server as ServerIcon, Settings, Warehouse, Wrench,
} from "lucide-react";
import { StoreProvider, useStore } from "./store";
import { Button, Toasts } from "./components/ui";
import { DetailDrawer } from "./components/details";
import { CommandMenu } from "./components/CommandMenu";
import Dashboard from "./views/Dashboard";
import RackView from "./views/RackView";
import { DisksView, LogView, PoolsView, ServersView, ServicesView } from "./views/Lists";
import MapView from "./views/Map";
import ToolsView from "./views/Tools";
import SettingsView from "./views/Settings";
import { useTheme } from "./theme";

const PAGES = [
  { route: "overview", label: "Overview", icon: LayoutDashboard },
  { route: "rack", label: "Rack", icon: Warehouse },
  { route: "disks", label: "Disks", icon: HardDrive },
  { route: "pools", label: "Pools", icon: Database },
  { route: "servers", label: "Servers", icon: ServerIcon },
  { route: "services", label: "Services", icon: Boxes },
  { route: "map", label: "Dependencies", icon: Network },
  { route: "log", label: "Log", icon: NotebookPen },
  { route: "tools", label: "Tools", icon: Wrench },
  { route: "settings", label: "Settings", icon: Settings },
] as const;

function useRoute(): [string, (r: string) => void] {
  const get = () => window.location.hash.replace(/^#\/?/, "") || "overview";
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, useCallback((r: string) => { window.location.hash = `/${r}`; }, [])];
}

function Shell() {
  const store = useStore();
  const [route, go] = useRoute();
  const [theme, setTheme] = useTheme();
  const [cmd, setCmd] = useState(false);
  const [nav, setNav] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd((v) => !v); }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTheme]);

  useEffect(() => { setNav(false); document.querySelector(".main")?.scrollTo(0, 0); }, [route]);

  const [base, sub] = route.split("/");
  const page = PAGES.find((p) => p.route === base) ?? PAGES[0];
  const counts: Record<string, number> = {
    disks: store.state.disks.length, pools: store.state.pools.length, servers: store.state.servers.length, services: store.state.services.length,
  };
  const critical = store.alerts.some((a) => a.severity === "critical");

  let body;
  if (store.loading) body = <div className="page muted">Loading…</div>;
  else if (store.error)
    body = (
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="cp-callout cp-callout-danger">
          <div>
            <div className="cp-callout-title">ZFStack cannot reach its server</div>
            <div>{store.error} Check that the app container and Postgres are running, then try again.</div>
            <div style={{ marginTop: 8 }}><Button variant="outline" size="sm" onClick={store.reload}>Try again</Button></div>
          </div>
        </div>
      </div>
    );
  else {
    switch (page.route) {
      case "rack": body = <RackView />; break;
      case "disks": body = <DisksView />; break;
      case "pools": body = <PoolsView go={go} />; break;
      case "servers": body = <ServersView />; break;
      case "services": body = <ServicesView />; break;
      case "map": body = <MapView />; break;
      case "log": body = <LogView />; break;
      case "tools": body = <ToolsView sub={sub} go={go} />; break;
      case "settings": body = <SettingsView theme={theme} setTheme={setTheme} />; break;
      default: body = <Dashboard go={go} />;
    }
  }

  return (
    <div className={`app ${nav ? "nav-open" : ""}`}>
      {nav && <div className="scrim" onClick={() => setNav(false)} />}
      <nav className="sidebar" aria-label="Main">
        <div className="brand">ZFStack<span className="brand-dot" aria-hidden /></div>
        <button className="cp-btn cp-btn-outline cp-btn-sm" style={{ justifyContent: "flex-start", color: "var(--muted-foreground)" }} onClick={() => setCmd(true)}>
          <Search size={14} /> Search <span className="spacer" /><span className="cp-kbd">Ctrl K</span>
        </button>
        <div>
          <div className="nav-label">Lab</div>
          <ul className="nav">
            {PAGES.slice(0, 8).map((p) => (
              <li key={p.route}>
                <a className={`nav-item ${page.route === p.route ? "current" : ""}`} href={`#/${p.route}`} aria-current={page.route === p.route ? "page" : undefined}>
                  <p.icon size={16} />
                  {p.label}
                  {p.route === "overview" && critical ? <span className="nav-dot" aria-label="Critical issues" /> : counts[p.route] ? <span className="nav-count">{counts[p.route]}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="sidebar-foot">
          <ul className="nav">
            {PAGES.slice(8).map((p) => (
              <li key={p.route}>
                <a className={`nav-item ${page.route === p.route ? "current" : ""}`} href={`#/${p.route}`} aria-current={page.route === p.route ? "page" : undefined}>
                  <p.icon size={16} />{p.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <main className="main">
        <div className="topbar">
          <Button variant="ghost" size="sm" icon className="menu-btn" aria-label="Open menu" onClick={() => setNav(true)}><Menu size={18} /></Button>
          <span className="topbar-title">{page.label}</span>
          <div className="topbar-actions">
            <Button variant="ghost" size="sm" icon aria-label="Search" onClick={() => setCmd(true)}><Search size={16} /></Button>
          </div>
        </div>
        {body}
      </main>
      <DetailDrawer />
      {cmd && <CommandMenu onClose={() => setCmd(false)} go={go} pages={PAGES.map((p) => ({ route: p.route, label: p.label }))} />}
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
