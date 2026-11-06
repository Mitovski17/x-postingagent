import { useEffect, useState, type ReactNode } from "react";
import { ListOrdered, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Settings2 } from "lucide-react";
import type { Route } from "../lib/router";
import type { Settings } from "../lib/types";
import { relative } from "../lib/time";
import { useNow } from "../lib/data";

export function publisherHealthy(s: Settings | null, now: number): boolean {
  if (!s?.publisher_last_run) return false;
  return now - new Date(s.publisher_last_run).getTime() < 3 * 60_000;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("rail-collapsed") === "1";
  } catch {
    return false;
  }
}

export function Shell({
  route,
  settings,
  upcoming,
  replies = 0,
  children,
}: {
  route: Route;
  settings: Settings | null;
  upcoming: number;
  replies?: number;
  children: ReactNode;
}) {
  const now = useNow(10_000);
  const healthy = publisherHealthy(settings, now);
  const active = route.name === "edit" ? "queue" : route.name;
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem("rail-collapsed", collapsed ? "1" : "0");
    } catch { /* storage unavailable */ }
  }, [collapsed]);

  // "[" toggles the side menu
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "[" && !e.metaKey && !e.ctrlKey) setCollapsed((c) => !c);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const items = [
    { key: "queue", href: "#/", label: "Queue", Icon: ListOrdered, count: upcoming },
    { key: "replies", href: "#/replies", label: "Replies", Icon: MessagesSquare, count: replies },
    { key: "new", href: "#/new", label: "New post", Icon: Plus },
    { key: "settings", href: "#/settings", label: "Settings", Icon: Settings2 },
  ] as const;

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className={`shell${collapsed ? " shell--collapsed" : ""}`}>
      <aside className="rail">
        <div className="rail__top">
          <a href="#/" className="brand" aria-label="X Queue home">
            <span className="brand__mark" aria-hidden>
              <svg viewBox="0 0 16 16" width="12" height="12">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="brand__name">Queue</span>
          </a>
          <button
            className="icon-btn rail__toggle"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Open side menu" : "Close side menu"}
            aria-expanded={!collapsed}
            title={`${collapsed ? "Open" : "Close"} side menu  [`}
          >
            <ToggleIcon size={17} strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <nav className="nav" aria-label="Main">
          {items.map(({ key, href, label, Icon, ...rest }) => (
            <a
              key={key}
              href={href}
              className={`nav__item${active === key ? " is-active" : ""}`}
              aria-current={active === key ? "page" : undefined}
              title={collapsed ? label : undefined}
            >
              <Icon size={16} strokeWidth={1.75} aria-hidden />
              <span className="nav__label">{label}</span>
              {"count" in rest && rest.count > 0 && <span className="nav__count">{rest.count}</span>}
            </a>
          ))}
        </nav>

        <div className="rail__foot">
          <a href="#/settings" className="status-line" title={settings?.x_username ? `@${settings.x_username}` : "X not connected"}>
            <span className={`dot${settings?.x_username ? " dot--on" : ""}`} aria-hidden />
            <span className="status-line__text">
              {settings?.x_username ? `@${settings.x_username}` : "X not connected"}
            </span>
          </a>
          <a href="#/settings" className="status-line" title={settings?.publisher_last_result ?? undefined}>
            <span className={`dot${healthy ? " dot--on dot--pulse" : ""}`} aria-hidden />
            <span className="status-line__text">
              {settings?.publisher_last_run
                ? `Publisher · ${relative(settings.publisher_last_run, now)}`
                : "Publisher · waiting"}
            </span>
          </a>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
