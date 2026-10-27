import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Armchair,
  BarChart3,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  Menu,
  Plus,
  ReceiptText,
  RefreshCw,
  SquareTerminal,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";
import { api, useFetch } from "../lib/api";
import { fromNow, formatClock } from "../lib/format";
import { cx } from "../lib/utils";
import { useToast } from "./Toast";

const NAV = [
  {
    label: "Service",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
      { to: "/floor", label: "Table floor", icon: Armchair },
      { to: "/pos", label: "New order", icon: Plus },
      { to: "/orders", label: "Orders", icon: ReceiptText },
      { to: "/billing", label: "Billing", icon: Wallet },
    ],
  },
  {
    label: "Catalog",
    items: [{ to: "/menu", label: "Menu manager", icon: UtensilsCrossed }],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      { to: "/sql", label: "SQL Lab", icon: SquareTerminal },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((group) => group.items);

function BrandMark({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <rect width="64" height="64" rx="16" fill="#2a1a11" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#c9873f" strokeWidth="2" />
      <path d="M32 14c5 7 5 12 0 18-5-6-5-11 0-18Z" fill="#c9873f" />
      <path d="M32 50c-5-7-5-12 0-18 5 6 5 11 0 18Z" fill="#e8d3b0" />
      <circle cx="32" cy="32" r="3" fill="#c9873f" />
    </svg>
  );
}

function matchNavItem(pathname) {
  return ALL_ITEMS
    .filter((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
    .sort((a, b) => b.to.length - a.to.length)[0];
}

export default function Layout() {
  const location = useLocation();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [syncing, setSyncing] = useState(false);
  const health = useFetch("/health", { poll: 30 });

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("nav-open", sidebarOpen);
    return () => document.body.classList.remove("nav-open");
  }, [sidebarOpen]);

  const activeItem = matchNavItem(location.pathname);
  const status = health.data?.status;
  const ok = status === "ok";
  const stores = health.data?.stores;
  const pending = health.data?.sync?.pending ?? 0;
  const healthTitle = stores
    ? `MySQL ${stores.mysql?.version || "unavailable"} · TimescaleDB ${stores.timescale?.version || "unavailable"}${stores.timescale?.error ? ` · ${stores.timescale.error}` : ""}`
    : "Checking database connections";

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await api.post("/system/sync", {});
      const result = response?.sync || {};
      if (result.error) {
        toast.error("Projector reported an error", result.error);
      } else if (result.projected > 0) {
        toast.success("Analytics synced", `${result.projected} event${result.projected === 1 ? "" : "s"} projected to TimescaleDB.`);
      } else {
        toast.info("Analytics is up to date", "There were no pending outbox events.");
      }
      health.refresh();
    } catch (error) {
      toast.error("Sync failed", error.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="shell">
      <aside className={cx("sidebar", sidebarOpen && "is-open")}>
        <div className="sidebar__brand">
          <Link to="/" className="brand">
            <BrandMark />
            <span className="brand__text">
              <strong>Saffron House</strong>
              <small>Service console</small>
            </span>
          </Link>
          <button type="button" className="icon-btn sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="nav" aria-label="Primary">
          {NAV.map((group) => (
            <div className="nav__group" key={group.label}>
              <p className="nav__label">{group.label}</p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => cx("nav__link", isActive && "is-active")}
                >
                  <item.icon size={17} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  <ChevronRight size={13} className="nav__chevron" />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="stack-card">
            <div className="stack-card__title">
              <span className={cx("pulse-dot", ok ? "is-live" : status === "degraded" ? "is-warn" : "")} />
              Polyglot pipeline
            </div>
            <div className="stack-card__row">
              <span>MySQL 8.4</span>
              <span className={cx("stack-state", stores?.mysql?.ok ? "is-ok" : "is-bad")}>
                {stores?.mysql?.ok ? "operational" : "offline"}
              </span>
            </div>
            <div className="stack-card__row">
              <span>TimescaleDB</span>
              <span className={cx("stack-state", stores?.timescale?.ok ? "is-ok" : "is-bad")}>
                {stores?.timescale?.ok ? `${stores.timescale.chunks ?? "—"} chunks` : "offline"}
              </span>
            </div>
            <p className="stack-card__meta">
              {pending > 0 ? `${pending} event${pending === 1 ? "" : "s"} queued` : "Outbox drained"}
              {health.data?.sync?.last_processed_at ? ` · ${fromNow(health.data.sync.last_processed_at)}` : ""}
            </p>
          </div>
          <p className="sidebar__signature">DA3 · Time-series extension</p>
        </div>
      </aside>

      {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu overlay" /> : null}

      <div className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button type="button" className="icon-btn topbar__menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu size={20} />
            </button>
            <div className="crumbs">
              <span className="crumbs__root">Saffron House</span>
              <ChevronRight size={13} />
              <strong>{activeItem?.label || "Service console"}</strong>
            </div>
          </div>

          <div className="topbar__right">
            <span className="clock">
              <Clock3 size={14} />
              {formatClock(now)}
            </span>
            <span className={cx("health-pill", ok ? "is-ok" : status === "degraded" ? "is-warn" : "is-idle")} title={healthTitle}>
              <span className="health-pill__dot" />
              <span>{health.loading && !health.data ? "Connecting" : ok ? "Dual store live" : status === "degraded" ? "Degraded" : "API offline"}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              onClick={syncNow}
              disabled={syncing}
              title="Project pending outbox events into TimescaleDB"
              aria-label="Sync analytics"
            >
              <RefreshCw size={16} className={syncing ? "spin" : ""} />
            </button>
            <Link to="/pos" className="btn btn--primary btn--sm topbar__cta">
              <Plus size={15} />
              <span>New order</span>
            </Link>
          </div>
        </header>

        <div className="page-wrap" key={location.pathname.split("/")[1] || "home"}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
