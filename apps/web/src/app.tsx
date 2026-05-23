import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  Database,
  FolderKanban,
  LogOut,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRoundPlus
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import {
  createOrganization,
  listOrganizations,
  type OrganizationSummary
} from "./api";
import { AuthProvider, getFormValue, useAuth } from "./auth";
import { useTheme } from "./theme";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="organization" element={<OrganizationSetupPage />} />
          <Route path="projects" element={<ProjectsPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { initialized, session } = useAuth();

  if (!initialized) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AuthFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="utility-row">
          <ThemeToggle />
        </div>
        <div className="brand-row">
          <div className="brand-mark">GX</div>
          <div>
            <p className="eyebrow">GoXAI Labs</p>
            <h1>{title}</h1>
          </div>
        </div>
        <p className="auth-copy">{subtitle}</p>
        {children}
      </section>
      <aside className="auth-aside">
        <div className="metric-strip">
          <span>Auth</span>
          <strong>Supabase</strong>
        </div>
        <div className="metric-strip">
          <span>Database</span>
          <strong>Postgres + Prisma</strong>
        </div>
        <div className="metric-strip">
          <span>Workflow</span>
          <strong>Labeling studio</strong>
        </div>
      </aside>
    </main>
  );
}

function LoginPage() {
  const { error, loading, login, session } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    try {
      await login(getFormValue(event, "email"), getFormValue(event, "password"));
      navigate("/");
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to log in.");
    }
  }

  return (
    <AuthFrame title="Login" subtitle="Access your labeling operations workspace.">
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {(formError ?? error) && <p className="form-error">{formError ?? error}</p>}
        <button className="primary-button" type="submit" disabled={loading}>
          <ShieldCheck size={18} />
          {loading ? "Signing in" : "Sign in"}
        </button>
      </form>
      <p className="auth-switch">
        New workspace? <Link to="/register">Create an account</Link>
      </p>
    </AuthFrame>
  );
}

function RegisterPage() {
  const { error, loading, register, session } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (session) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFormError(null);

    try {
      const result = await register({
        email: getFormValue(event, "email"),
        password: getFormValue(event, "password"),
        firstName: getFormValue(event, "firstName"),
        lastName: getFormValue(event, "lastName")
      });

      if (result === "signed-in") {
        navigate("/organization");
      } else {
        setMessage("Check your email to confirm the account before signing in.");
      }
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Unable to register.");
    }
  }

  return (
    <AuthFrame title="Register" subtitle="Create your GoXAI identity and sync it to the platform database.">
      <form className="auth-form two-column" onSubmit={handleSubmit}>
        <label>
          First name
          <input name="firstName" autoComplete="given-name" required />
        </label>
        <label>
          Last name
          <input name="lastName" autoComplete="family-name" required />
        </label>
        <label className="wide">
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="wide">
          Password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        {(formError ?? error) && <p className="form-error wide">{formError ?? error}</p>}
        {message && <p className="form-success wide">{message}</p>}
        <button className="primary-button wide" type="submit" disabled={loading}>
          <UserRoundPlus size={18} />
          {loading ? "Creating account" : "Create account"}
        </button>
      </form>
      <p className="auth-switch">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </AuthFrame>
  );
}

function AppShell() {
  const { dbUser, logout } = useAuth();
  const name = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || dbUser?.email;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row compact">
          <div className="brand-mark">GX</div>
          <div>
            <p className="eyebrow">GoXAI Labs</p>
            <strong>Studio Ops</strong>
          </div>
        </div>
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
        </nav>
        <button className="ghost-button" type="button" onClick={() => void logout()}>
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Signed in</p>
            <h2>{name}</h2>
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

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      className="icon-button"
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

function DashboardPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const initials = useMemo(() => {
    const parts = [dbUser?.firstName, dbUser?.lastName].filter(Boolean);
    return parts.length ? parts.map((part) => part?.[0]).join("") : "GX";
  }, [dbUser]);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Operations overview</h1>
        </div>
        <div className="avatar">{initials}</div>
      </div>
      <div className="stat-grid">
        <article className="stat-card">
          <Building2 size={20} />
          <span>Organizations</span>
          <strong>{organizations.length}</strong>
        </article>
        <article className="stat-card">
          <FolderKanban size={20} />
          <span>Projects</span>
          <strong>0</strong>
        </article>
        <article className="stat-card">
          <BriefcaseBusiness size={20} />
          <span>Tasks</span>
          <strong>0</strong>
        </article>
        <article className="stat-card">
          <Sparkles size={20} />
          <span>AI jobs</span>
          <strong>0</strong>
        </article>
      </div>
      <section className="panel">
        <div>
          <p className="eyebrow">Identity</p>
          <h2>Backend user row</h2>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Email</dt>
            <dd>{dbUser?.email}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{dbUser?.status}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{dbUser?.globalRole}</dd>
          </div>
        </dl>
      </section>
    </section>
  );
}

function OrganizationSetupPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { error, loading, organizations, reload, setError } = useOrganizations(session);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedMessage(null);
    setError(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      const result = await createOrganization(session, {
        organizationName: getFormValue(event, "name"),
        workspaceName: getFormValue(event, "workspace"),
        organizationType: getFormValue(event, "type"),
        planTier: getFormValue(event, "plan")
      });

      setSavedMessage(`${result.organization.name} and ${result.workspace.name} are ready.`);
      await reload();
      navigate("/projects");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Organization</p>
          <h1>Setup</h1>
        </div>
      </div>
      {organizations.length > 0 && (
        <section className="panel">
          <div>
            <p className="eyebrow">Existing organizations</p>
            <h2>{organizations.length} workspace foundation</h2>
          </div>
          <div className="org-list">
            {organizations.map((organization) => (
              <article className="org-item" key={organization.id}>
                <div>
                  <strong>{organization.name}</strong>
                  <span>{organization.workspace?.name ?? "Organization wide"}</span>
                </div>
                <span className="status-pill">{organization.role}</span>
              </article>
            ))}
          </div>
        </section>
      )}
      <form className="panel setup-form" onSubmit={handleSubmit}>
        <label>
          Organization name
          <input name="name" placeholder="GoXAI Labs" required />
        </label>
        <label>
          Workspace name
          <input name="workspace" placeholder="Default workspace" required />
        </label>
        <label>
          Type
          <select name="type" defaultValue="COMPANY">
            <option value="PERSONAL">Personal</option>
            <option value="COMPANY">Company</option>
            <option value="ENTERPRISE">Enterprise</option>
            <option value="MARKETPLACE_VENDOR">Marketplace vendor</option>
          </select>
        </label>
        <label>
          Plan
          <select name="plan" defaultValue="FREE">
            <option value="FREE">Free</option>
            <option value="STARTER">Starter</option>
            <option value="PRO">Pro</option>
            <option value="BUSINESS">Business</option>
            <option value="ENTERPRISE">Enterprise</option>
          </select>
        </label>
        {error && <p className="form-error">{error}</p>}
        {savedMessage && <p className="form-success">{savedMessage}</p>}
        <button className="primary-button" type="submit" disabled={saving || loading}>
          <Building2 size={18} />
          {saving ? "Creating" : "Create organization"}
        </button>
      </form>
    </section>
  );
}

function ProjectsPage() {
  const { session } = useAuth();
  const { organizations } = useOrganizations(session);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Projects list</h1>
        </div>
        <button className="primary-button" type="button">
          <FolderKanban size={18} />
          New project
        </button>
      </div>
      <section className="table-panel">
        <div className="table-row table-head">
          <span>Name</span>
          <span>Data type</span>
          <span>Status</span>
          <span>Updated</span>
        </div>
        <div className="empty-state">
          <FolderKanban size={28} />
          <strong>No projects yet</strong>
          <span>
            {organizations.length > 0
              ? "Organization foundation is ready. Project creation is the next backend step."
              : "Create an organization first, then projects and datasets come next."}
          </span>
        </div>
      </section>
    </section>
  );
}

function useOrganizations(session: ReturnType<typeof useAuth>["session"]) {
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) {
      setOrganizations([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOrganizations(await listOrganizations(session));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load organizations.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    organizations,
    reload,
    setError
  };
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">GX</div>
      <p>Loading GoXAI Labs</p>
    </main>
  );
}
