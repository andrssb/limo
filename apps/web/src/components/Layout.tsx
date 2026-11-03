import React, { useEffect, useState } from "react";
import { Outlet, NavLink, useNavigate, Navigate } from "react-router-dom";
import { clearToken, getStoredUser, setStoredUser, apiFetch } from "../lib/api";
import {
  LayoutDashboard, Users, BookUser, PhoneCall,
  MailPlus, BarChart3, Settings, ListChecks,
  Search, Cpu, Trophy, GraduationCap, Mic, LogOut,
  LineChart, Sun, Moon, Filter, Bot, PhoneForwarded,
} from "lucide-react";

const NAV_BASE = [
  { to: "/dashboard",        Icon: LayoutDashboard, label: "Dashboard",   roles: null },
  { to: "/contacts",         Icon: BookUser,        label: "Contatos",    roles: null },
  { to: "/calls",            Icon: PhoneCall,       label: "Ligações",    roles: null },
  { to: "/lists",            Icon: ListChecks,      label: "Listas",      roles: null },
  { to: "/discovery",        Icon: Search,          label: "Descobrir",   roles: null },
  { to: "/garimpo",          Icon: Cpu,             label: "Garimpo",     roles: null },
  { to: "/goals",            Icon: Trophy,          label: "Metas",       roles: null },
  { to: "/sales-playbook",   Icon: Mic,             label: "Discurso",    roles: null },
  { to: "/product-education",Icon: GraduationCap,   label: "Produto",     roles: null },
  { to: "/members",          Icon: Users,           label: "Membros",     roles: ["manager","admin"] },
  { to: "/head-panel",       Icon: LineChart,       label: "Painel Head", roles: ["manager","admin"] },
  { to: "/lia",              Icon: Bot,             label: "Lia",         roles: ["manager","admin"] },
  { to: "/voice-sdr",        Icon: PhoneForwarded,  label: "Aquisição interna", roles: ["manager","admin"] },
  { to: "/qualification",    Icon: Filter,          label: "Qualificação", roles: ["manager","admin"] },
  { to: "/reports",          Icon: BarChart3,       label: "Relatórios",  roles: ["manager","admin"] },
  { to: "/invites",          Icon: MailPlus,        label: "Convites",    roles: ["manager","admin"] },
  { to: "/settings",         Icon: Settings,        label: "Config.",     roles: null },
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("limo_theme", next);
  }

  return { theme, toggle };
}

export function Layout() {
  const navigate = useNavigate();
  const [user, setUser] = useState(getStoredUser());
  const [trialExpired, setTrialExpired] = useState(false);
  const { theme, toggle } = useTheme();
  const NAV = NAV_BASE
    .filter((item) => (!item.roles || item.roles.includes(user?.role)) && item.to !== "/lia")
    .map((item) => item.to === "/voice-sdr" ? { ...item, label: "Prospecção Automática" } : item);

  useEffect(() => {
    apiFetch<{ user: any }>("/auth/me").then((res) => {
      setStoredUser(res.user);
      setUser(res.user);
      const isPaid = res.user.teamPlan && res.user.teamPlan !== "trial";
      if (!isPaid && res.user.trialEndsAt && new Date(res.user.trialEndsAt) < new Date()) {
        setTrialExpired(true);
      }
    }).catch(() => {});
  }, []);

  if (trialExpired) return <Navigate to="/trial-expired" replace />;

  function logout() {
    clearToken();
    navigate("/login");
  }

  const initials = user?.name
    ? user.name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand">
            <img
              src={theme === "light" ? "/logo_oficial.png" : "/logo_dark.png"}
              alt="Limo"
              className="brand-logo-img"
            />
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <Icon size={16} strokeWidth={2.5} style={{ flexShrink: 0 }} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="name">{user?.name ?? "—"}</div>
              <div className="role">{user?.role ?? "—"}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button className="logout-btn" onClick={logout}>
              <LogOut size={13} style={{ marginRight: 4 }} />
              Sair da conta
            </button>
            <button
              className="theme-toggle"
              onClick={toggle}
              title={theme === "dark" ? "Modo claro" : "Modo escuro"}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
