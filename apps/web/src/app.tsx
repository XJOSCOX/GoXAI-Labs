import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  CloudUpload,
  Database,
  FolderKanban,
  HardDrive,
  LogOut,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRoundPlus
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  createAsset,
  createDataset,
  createOrganization,
  createProject,
  getDataset,
  getProject,
  listAssets,
  listDatasets,
  listOrganizations,
  listProjects,
  type AssetSummary,
  type DatasetSummary,
  type OrganizationSummary,
  type ProjectSummary
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
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="datasets/:datasetId" element={<DatasetDetailPage />} />
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
          <NavLink to="/datasets">
            <Database size={18} />
            Datasets
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
  const { projects } = useProjects(session);
  const { datasets } = useDatasets(session);
  const primaryMembership = organizations[0]?.role ?? "Not assigned";

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Operations overview</h1>
        </div>
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
          <strong>{projects.length}</strong>
        </article>
        <article className="stat-card">
          <BriefcaseBusiness size={20} />
          <span>Datasets</span>
          <strong>{datasets.length}</strong>
        </article>
        <article className="stat-card">
          <Sparkles size={20} />
          <span>AI jobs</span>
          <strong>0</strong>
        </article>
      </div>
      <section className="panel">
        <div>
          <p className="eyebrow">Access</p>
          <h2>Account summary</h2>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Platform role</dt>
            <dd>{dbUser?.globalRole}</dd>
          </div>
          <div>
            <dt>Organization role</dt>
            <dd>{primaryMembership}</dd>
          </div>
          <div>
            <dt>Account status</dt>
            <dd>{dbUser?.status}</dd>
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
  const { error: organizationError, loading: organizationsLoading, organizations } = useOrganizations(session);
  const {
    error: projectsError,
    loading: projectsLoading,
    projects,
    reload: reloadProjects,
    setError: setProjectsError
  } = useProjects(session);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const defaultOrganization = organizations[0];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSavedMessage(null);
    setProjectsError(null);

    if (!session) {
      setProjectsError("Authentication required.");
      return;
    }

    const organizationId = getFormValue(event, "organizationId");
    const organization = organizations.find((item) => item.id === organizationId);

    if (!organization) {
      setProjectsError("Choose an organization before creating a project.");
      return;
    }

    setSaving(true);

    try {
      const project = await createProject(session, {
        organizationId,
        workspaceId: organization.workspace?.id,
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description"),
        dataType: getFormValue(event, "dataType"),
        instructions: getFormValue(event, "instructions")
      });

      form.reset();
      setSavedMessage(`${project.name} was created as a draft.`);
      setShowForm(false);
      await reloadProjects();
    } catch (reason) {
      setProjectsError(reason instanceof Error ? reason.message : "Unable to create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Projects list</h1>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => setShowForm((value) => !value)}
          disabled={organizations.length === 0 || organizationsLoading}
        >
          <FolderKanban size={18} />
          {showForm ? "Close" : "New project"}
        </button>
      </div>
      {(organizationError ?? projectsError) && (
        <p className="form-error">{organizationError ?? projectsError}</p>
      )}
      {savedMessage && <p className="form-success">{savedMessage}</p>}
      {showForm && (
        <form className="panel project-form" onSubmit={handleSubmit}>
          <label>
            Organization
            <select name="organizationId" defaultValue={defaultOrganization?.id ?? ""} required>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Data type
            <select name="dataType" defaultValue="IMAGE">
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
              <option value="AUDIO">Audio</option>
              <option value="TEXT">Text</option>
              <option value="PDF">PDF</option>
              <option value="TIME_SERIES">Time series</option>
              <option value="MULTIMODAL">Multimodal</option>
            </select>
          </label>
          <label className="wide">
            Project name
            <input name="name" placeholder="Vehicle damage labeling" required />
          </label>
          <label className="wide">
            Description
            <textarea name="description" placeholder="Short internal summary" rows={3} />
          </label>
          <label className="wide">
            Instructions
            <textarea name="instructions" placeholder="Labeling rules, review expectations, or QA notes" rows={4} />
          </label>
          <button className="primary-button wide" type="submit" disabled={saving}>
            <FolderKanban size={18} />
            {saving ? "Creating" : "Create draft project"}
          </button>
        </form>
      )}
      <section className="table-panel">
        <div className="table-row table-head">
          <span>Name</span>
          <span>Data type</span>
          <span>Status</span>
          <span>Updated</span>
        </div>
        {projectsLoading || organizationsLoading ? (
          <div className="empty-state">
            <FolderKanban size={28} />
            <strong>Loading projects</strong>
            <span>Checking your organization access and project records.</span>
          </div>
        ) : projects.length > 0 ? (
          projects.map((project) => <ProjectRow key={project.id} project={project} />)
        ) : (
          <div className="empty-state">
            <FolderKanban size={28} />
            <strong>No projects yet</strong>
            <span>
              {organizations.length > 0
                ? "Create the first draft project to prepare dataset ingestion."
                : "Create an organization first, then projects and datasets come next."}
            </span>
          </div>
        )}
      </section>
    </section>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <article className="table-row project-row">
      <span>
        <Link className="table-link" to={`/projects/${project.id}`}>
          {project.name}
        </Link>
        <small>{project.organization.name}</small>
      </span>
      <span>{formatEnum(project.dataType)}</span>
      <span>
        <span className="status-pill compact">{formatEnum(project.status)}</span>
      </span>
      <span>{formatDate(project.updatedAt)}</span>
    </article>
  );
}

function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const { session } = useAuth();
  const { error: projectError, loading: projectLoading, project } = useProject(session, projectId);
  const {
    datasets,
    error: datasetsError,
    loading: datasetsLoading,
    reload: reloadDatasets,
    setError: setDatasetsError
  } = useDatasets(session, projectId);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/projects">
            Projects
          </Link>
          <h1>{project?.name ?? "Project detail"}</h1>
        </div>
      </div>
      {(projectError ?? datasetsError) && <p className="form-error">{projectError ?? datasetsError}</p>}
      {projectLoading ? (
        <section className="panel">
          <p className="muted-copy">Loading project details.</p>
        </section>
      ) : project ? (
        <>
          <section className="panel">
            <div>
              <p className="eyebrow">Project</p>
              <h2>{project.name}</h2>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Organization</dt>
                <dd>{project.organization.name}</dd>
              </div>
              <div>
                <dt>Data type</dt>
                <dd>{formatEnum(project.dataType)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatEnum(project.status)}</dd>
              </div>
            </dl>
          </section>
          <DatasetForm
            defaultProjectId={project.id}
            onCreated={reloadDatasets}
            projects={[project]}
            session={session}
            setPageError={setDatasetsError}
          />
          <DatasetsTable datasets={datasets} loading={datasetsLoading} projectScoped />
        </>
      ) : !projectError ? (
        <section className="panel">
          <p className="muted-copy">Project was not found.</p>
        </section>
      ) : null}
    </section>
  );
}

function DatasetsPage() {
  const { session } = useAuth();
  const { error: projectsError, loading: projectsLoading, projects } = useProjects(session);
  const {
    datasets,
    error: datasetsError,
    loading: datasetsLoading,
    reload: reloadDatasets,
    setError: setDatasetsError
  } = useDatasets(session);
  const [showForm, setShowForm] = useState(false);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Datasets</p>
          <h1>Datasets list</h1>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => setShowForm((value) => !value)}
          disabled={projects.length === 0 || projectsLoading}
        >
          <Database size={18} />
          {showForm ? "Close" : "New dataset"}
        </button>
      </div>
      {(projectsError ?? datasetsError) && <p className="form-error">{projectsError ?? datasetsError}</p>}
      {showForm && (
        <DatasetForm
          onCreated={async () => {
            await reloadDatasets();
            setShowForm(false);
          }}
          projects={projects}
          session={session}
          setPageError={setDatasetsError}
        />
      )}
      <DatasetsTable datasets={datasets} loading={datasetsLoading || projectsLoading} />
    </section>
  );
}

function DatasetForm({
  defaultProjectId,
  onCreated,
  projects,
  session,
  setPageError
}: {
  defaultProjectId?: string;
  onCreated: () => Promise<void>;
  projects: ProjectSummary[];
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      const dataset = await createDataset(session, {
        projectId: defaultProjectId ?? getFormValue(event, "projectId"),
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description")
      });

      form.reset();
      setSavedMessage(`${dataset.name} was created as a draft.`);
      await onCreated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create dataset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel dataset-form" onSubmit={handleSubmit}>
      {!defaultProjectId && (
        <label>
          Project
          <select name="projectId" defaultValue={projects[0]?.id ?? ""} required>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={defaultProjectId ? "wide" : undefined}>
        Dataset name
        <input name="name" placeholder="Training set v1" required />
      </label>
      <label className="wide">
        Description
        <textarea name="description" placeholder="Source, scope, or ingestion notes" rows={3} />
      </label>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button wide" type="submit" disabled={saving || projects.length === 0}>
        <Database size={18} />
        {saving ? "Creating" : "Create draft dataset"}
      </button>
    </form>
  );
}

function DatasetsTable({
  datasets,
  loading,
  projectScoped = false
}: {
  datasets: DatasetSummary[];
  loading: boolean;
  projectScoped?: boolean;
}) {
  return (
    <section className="table-panel">
      <div className="table-row table-head">
        <span>Name</span>
        <span>{projectScoped ? "Version" : "Project"}</span>
        <span>Status</span>
        <span>Updated</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <Database size={28} />
          <strong>Loading datasets</strong>
          <span>Checking dataset records and project access.</span>
        </div>
      ) : datasets.length > 0 ? (
        datasets.map((dataset) => <DatasetRow dataset={dataset} key={dataset.id} projectScoped={projectScoped} />)
      ) : (
        <div className="empty-state">
          <Database size={28} />
          <strong>No datasets yet</strong>
          <span>Create a draft dataset before adding file ingestion.</span>
        </div>
      )}
    </section>
  );
}

function DatasetRow({ dataset, projectScoped }: { dataset: DatasetSummary; projectScoped: boolean }) {
  return (
    <article className="table-row project-row">
      <span>
        <Link className="table-link" to={`/datasets/${dataset.id}`}>
          {dataset.name}
        </Link>
        <small>{dataset.organization.name}</small>
      </span>
      <span>{projectScoped ? `v${dataset.version}` : dataset.project.name}</span>
      <span>
        <span className="status-pill compact">{formatEnum(dataset.status)}</span>
      </span>
      <span>{formatDate(dataset.updatedAt)}</span>
    </article>
  );
}

function DatasetDetailPage() {
  const { datasetId = "" } = useParams();
  const { session } = useAuth();
  const { dataset, error: datasetError, loading: datasetLoading } = useDataset(session, datasetId);
  const {
    assets,
    error: assetsError,
    loading: assetsLoading,
    reload: reloadAssets,
    setError: setAssetsError
  } = useAssets(session, { datasetId });

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <Link className="back-link" to="/datasets">
            Datasets
          </Link>
          <h1>{dataset?.name ?? "Dataset detail"}</h1>
        </div>
      </div>
      {(datasetError ?? assetsError) && <p className="form-error">{datasetError ?? assetsError}</p>}
      {datasetLoading ? (
        <section className="panel">
          <p className="muted-copy">Loading dataset details.</p>
        </section>
      ) : dataset ? (
        <>
          <section className="panel">
            <div>
              <p className="eyebrow">Dataset</p>
              <h2>{dataset.name}</h2>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Project</dt>
                <dd>{dataset.project.name}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>v{dataset.version}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatEnum(dataset.status)}</dd>
              </div>
            </dl>
          </section>
          <AssetForm
            dataset={dataset}
            onCreated={reloadAssets}
            session={session}
            setPageError={setAssetsError}
          />
          <AssetsTable assets={assets} loading={assetsLoading} />
        </>
      ) : !datasetError ? (
        <section className="panel">
          <p className="muted-copy">Dataset was not found.</p>
        </section>
      ) : null}
    </section>
  );
}

function AssetForm({
  dataset,
  onCreated,
  session,
  setPageError
}: {
  dataset: DatasetSummary;
  onCreated: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      const asset = await createAsset(session, {
        datasetId: dataset.id,
        bucket: getFormValue(event, "bucket"),
        objectKey: getFormValue(event, "objectKey"),
        fileName: getFormValue(event, "fileName"),
        mimeType: getFormValue(event, "mimeType"),
        fileSize: getFormValue(event, "fileSize"),
        checksum: getFormValue(event, "checksum"),
        width: getFormValue(event, "width"),
        height: getFormValue(event, "height"),
        duration: getFormValue(event, "duration")
      });

      form.reset();
      setSavedMessage(`${asset.fileName} was registered from R2.`);
      await onCreated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to register R2 asset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel asset-form" onSubmit={handleSubmit}>
      <label>
        R2 bucket
        <input name="bucket" placeholder="Uses R2_BUCKET when empty" />
      </label>
      <label>
        R2 object key
        <input name="objectKey" placeholder="datasets/training-set-v1/image-001.jpg" required />
      </label>
      <label>
        File name
        <input name="fileName" placeholder="image-001.jpg" required />
      </label>
      <label>
        MIME type
        <input name="mimeType" placeholder="image/jpeg" required />
      </label>
      <label>
        File size bytes
        <input name="fileSize" inputMode="numeric" placeholder="2483912" required />
      </label>
      <label>
        Checksum
        <input name="checksum" placeholder="Optional hash" />
      </label>
      <label>
        Width
        <input name="width" inputMode="numeric" placeholder="Optional" />
      </label>
      <label>
        Height
        <input name="height" inputMode="numeric" placeholder="Optional" />
      </label>
      <label>
        Duration seconds
        <input name="duration" inputMode="decimal" placeholder="Optional" />
      </label>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button wide" type="submit" disabled={saving}>
        <CloudUpload size={18} />
        {saving ? "Registering" : "Register R2 asset"}
      </button>
    </form>
  );
}

function AssetsTable({ assets, loading }: { assets: AssetSummary[]; loading: boolean }) {
  return (
    <section className="table-panel">
      <div className="table-row assets-head table-head">
        <span>File</span>
        <span>Provider</span>
        <span>Size</span>
        <span>Registered</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <HardDrive size={28} />
          <strong>Loading assets</strong>
          <span>Checking registered R2 objects for this dataset.</span>
        </div>
      ) : assets.length > 0 ? (
        assets.map((asset) => <AssetRow asset={asset} key={asset.id} />)
      ) : (
        <div className="empty-state">
          <HardDrive size={28} />
          <strong>No assets registered</strong>
          <span>Register R2 object metadata before generating upload flows.</span>
        </div>
      )}
    </section>
  );
}

function AssetRow({ asset }: { asset: AssetSummary }) {
  return (
    <article className="table-row assets-head project-row">
      <span>
        <strong>{asset.fileName}</strong>
        <small>{asset.objectKey}</small>
      </span>
      <span>{asset.provider}</span>
      <span>{formatBytes(asset.fileSize)}</span>
      <span>{formatDate(asset.createdAt)}</span>
    </article>
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

function useProjects(session: ReturnType<typeof useAuth>["session"]) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) {
      setProjects([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProjects(await listProjects(session));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load projects.");
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
    projects,
    reload,
    setError
  };
}

function useProject(session: ReturnType<typeof useAuth>["session"], projectId: string) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session || !projectId) {
      setProject(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProject(await getProject(session, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    project,
    reload
  };
}

function useDatasets(session: ReturnType<typeof useAuth>["session"], projectId?: string) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) {
      setDatasets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDatasets(await listDatasets(session, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load datasets.");
    } finally {
      setLoading(false);
    }
  }, [projectId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    datasets,
    error,
    loading,
    reload,
    setError
  };
}

function useDataset(session: ReturnType<typeof useAuth>["session"], datasetId: string) {
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session || !datasetId) {
      setDataset(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDataset(await getDataset(session, datasetId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dataset.");
    } finally {
      setLoading(false);
    }
  }, [datasetId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    dataset,
    error,
    loading,
    reload
  };
}

function useAssets(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; projectId?: string } = {}
) {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!session) {
      setAssets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setAssets(await listAssets(session, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load assets.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, session]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    assets,
    error,
    loading,
    reload,
    setError
  };
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatBytes(value: string) {
  const bytes = Number(value);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;

  return `${amount.toFixed(amount >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">GX</div>
      <p>Loading GoXAI Labs</p>
    </main>
  );
}
