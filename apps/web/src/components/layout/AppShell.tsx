import { BarChart3, Building2, CheckCircle2, ClipboardList, Database, FolderKanban, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../auth";
import goxaiLogo from "../../assets/goxailab-logo.png";
import { useOrganizations } from "../../hooks/useResources";
import { formatEnum, getInitials } from "../../utils/format";
import { LoadingScreen } from "./LoadingScreen";
import { ThemeToggle } from "./ThemeToggle";

export function AppShell() {
  const { dbUser, logout, session } = useAuth();
  const location = useLocation();
  const { loading: organizationsLoading, organizations } = useOrganizations(session);
  const topbarTitle = getTopbarTitle(location.pathname);
  const name = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || dbUser?.email || "Signed in user";
  const email = dbUser?.email ?? "No email";
  const role = dbUser?.globalRole ?? "USER";
  const ownsOrganization = organizations.some((organization) => organization.role === "OWNER");
  const accountKind = organizations.length === 0 ? "Simple user" : ownsOrganization ? "Organization owner" : "Organization user";
  const onboardingOrganization = organizations.find(
    (organization) => organization.role === "OWNER" && organization.onboardingComplete === false
  );

  if (organizationsLoading) {
    return <LoadingScreen />;
  }

  if (!organizationsLoading && onboardingOrganization && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row compact sidebar-brand">
          <img className="brand-logo" src={goxaiLogo} alt="" />
          <strong className="brand-wordmark">GoXAi Lab</strong>
        </div>
        <section className="sidebar-profile">
          <div className="avatar">
            <span>{getInitials(name, email)}</span>
          </div>
          <div className="sidebar-profile-info">
            <strong>
              {name}
              {dbUser?.isVerified && <CheckCircle2 size={14} aria-label="Verified user" />}
            </strong>
            <span>{email}</span>
            <small>{formatEnum(role)}</small>
            <small>{accountKind}</small>
          </div>
        </section>
        <nav className="nav-list">
          <NavLink to="/" end>
            <BarChart3 size={18} />
            Dashboard
          </NavLink>
          <NavLink to="/organization">
            <Building2 size={18} />
            Organization
          </NavLink>
          <NavLink to="/projects">
            <FolderKanban size={18} />
            Projects
          </NavLink>
          <NavLink to="/datasets">
            <Database size={18} />
            Datasets
          </NavLink>
          <NavLink to="/tasks">
            <ClipboardList size={18} />
            Tasks
          </NavLink>
          {dbUser?.globalRole === "SUPER_ADMIN" && (
            <NavLink to="/admin">
              <ShieldCheck size={18} />
              Admin
            </NavLink>
          )}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/account" className="account-link">
            <UserRound size={18} />
            My Account
          </NavLink>
          <button className="ghost-button" type="button" onClick={() => void logout()}>
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <p className="eyebrow">{topbarTitle.eyebrow}</p>
            <h1>{topbarTitle.title}</h1>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="status-pill">
              <CheckCircle2 size={16} />
              Synced
            </span>
          </div>
        </header>
        <Outlet />
      </section>
    </main>
  );
}

function getTopbarTitle(pathname: string) {
  if (pathname === "/") {
    return { eyebrow: "Dashboard", title: "Operations overview" };
  }

  if (pathname === "/organization") {
    return { eyebrow: "Organization", title: "Organizations" };
  }

  if (pathname.startsWith("/organization/")) {
    return { eyebrow: "Organization", title: "Organization details" };
  }

  if (pathname === "/projects") {
    return { eyebrow: "Projects", title: "Projects list" };
  }

  if (pathname.startsWith("/projects/")) {
    return { eyebrow: "Projects", title: "Project detail" };
  }

  if (pathname === "/datasets") {
    return { eyebrow: "Datasets", title: "Datasets list" };
  }

  if (pathname.startsWith("/datasets/")) {
    return { eyebrow: "Datasets", title: "Dataset detail" };
  }

  if (pathname === "/tasks") {
    return { eyebrow: "Tasks", title: "Labeling tasks" };
  }

  if (pathname === "/account") {
    return { eyebrow: "Account", title: "My Account" };
  }

  if (pathname === "/admin") {
    return { eyebrow: "Admin", title: "Control panel" };
  }

  return { eyebrow: "Workspace", title: "GoXAi Lab" };
}
