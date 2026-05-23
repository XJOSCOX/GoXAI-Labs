import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ClipboardList,
  CloudUpload,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  FolderKanban,
  HardDrive,
  LogOut,
  Moon,
  Save,
  Search,
  Send,
  ShieldCheck,
  Sun,
  X,
  UserCheck,
  UserRoundPlus
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from "react-router-dom";
import {
  createAsset,
  createAssetUploadUrl,
  createDataset,
  createOrganization,
  createProject,
  addOrganizationMember,
  archiveDataset,
  archiveProject,
  assignTaskToSelf,
  deleteOrganization,
  generateTasksFromDataset,
  getAssetAccessUrl,
  getDataset,
  getOrganization,
  getProject,
  listAssets,
  listDatasets,
  listOrganizations,
  listProjects,
  listTasks,
  logClientEvent,
  removeOrganizationMember,
  startTask,
  submitTask,
  updateDataset,
  updateOrganization,
  updateOrganizationMember,
  updateProject,
  uploadFileToSignedUrl,
  type AssetSummary,
  type DatasetSummary,
  type MembershipSummary,
  type OrganizationDetail,
  type OrganizationSummary,
  type ProjectSummary,
  type TaskSummary
} from "./api";
import { AuthProvider, getFormValue, useAuth } from "./auth";
import { useTheme } from "./theme";

const maxBulkUploadFiles = 100;
const maxBulkUploadBytes = 1024 ** 3;
const folderInputAttributes = { directory: "", webkitdirectory: "" } as Record<string, string>;
const planOptions = [
  { value: "FREE", label: "Free", detail: "Start small", price: "$0" },
  { value: "STARTER", label: "Starter", detail: "Solo projects", price: "Basic" },
  { value: "PRO", label: "Pro", detail: "Growing teams", price: "Scale" },
  { value: "BUSINESS", label: "Business", detail: "Team controls", price: "Ops" },
  { value: "ENTERPRISE", label: "Enterprise", detail: "Custom needs", price: "Custom" }
];

type UploadProgress = {
  completed: number;
  currentFile: string;
  failed: number;
  status: "uploading" | "complete" | "error";
  total: number;
};

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
          <Route path="organization/:organizationId" element={<OrganizationSetupPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="datasets/:datasetId" element={<DatasetDetailPage />} />
          <Route path="tasks" element={<TasksPage />} />
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
  const { dbUser, logout, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const name = [dbUser?.firstName, dbUser?.lastName].filter(Boolean).join(" ") || dbUser?.email || "Signed in user";
  const email = dbUser?.email ?? "No email";
  const role = organizations[0]?.role ?? dbUser?.globalRole ?? "USER";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row compact sidebar-brand">
          <strong className="brand-wordmark">GoXAi Lab</strong>
        </div>
        <section className="sidebar-profile">
          <div className="avatar">
            <svg className="avatar-orbit" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="avatar-orbit-dark" cx="50" cy="50" r="42" />
              <path className="avatar-orbit-line cyan" d="M51 8 C28 6 32 22 43 25 C59 30 50 43 32 43 C14 43 18 61 36 64 C55 68 49 82 31 83 C19 84 27 95 51 92" />
              <path className="avatar-orbit-line yellow" d="M43 10 C22 12 24 27 39 31 C55 35 49 48 30 48 C13 48 17 66 36 69 C54 72 52 87 34 87 C25 88 31 95 55 91" />
              <path className="avatar-orbit-line magenta" d="M58 9 C35 6 36 20 49 24 C65 29 55 40 37 39 C19 39 21 56 40 61 C58 66 50 78 32 77 C20 77 25 91 49 93" />
            </svg>
            <span>{getInitials(name, email)}</span>
          </div>
          <div className="sidebar-profile-info">
            <strong>{name}</strong>
            <span>{email}</span>
            <small>{formatEnum(role)}</small>
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
        </nav>
        <button className="ghost-button" type="button" onClick={() => void logout()}>
          <LogOut size={18} />
          Sign out
        </button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div />
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
  const { tasks } = useTasks(session);
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
          <ClipboardList size={20} />
          <span>Tasks</span>
          <strong>{tasks.length}</strong>
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
  const { organizationId = "" } = useParams();
  const { error, loading, organizations, reload, setError } = useOrganizations(session);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const {
    error: organizationDetailError,
    loading: organizationDetailLoading,
    organization,
    reload: reloadOrganization,
    setError: setOrganizationDetailError
  } = useOrganization(session, organizationId);

  return (
    <section className="page-stack organization-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Organization</p>
          <h1>{organizationId ? organization?.name ?? "Organization details" : "Organizations"}</h1>
          {organizationId && (
            <Link className="back-link" to="/organization">
              All organizations
            </Link>
          )}
        </div>
        {organizations.length > 0 && (
          <button className="primary-button" type="button" onClick={() => setShowCreateModal(true)}>
            <Building2 size={18} />
            New organization
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {organizations.length > 0 && !organizationId ? (
        <>
          <section className="panel">
            <div className="section-head">
              <div>
                <p className="eyebrow">Existing organizations</p>
                <h2>{organizations.length} organization{organizations.length === 1 ? "" : "s"}</h2>
              </div>
              <span className="muted-copy">Select one to manage settings and members.</span>
            </div>
            <div className="org-card-grid">
              {organizations.map((organization) => (
                <Link
                  className="org-summary-card"
                  key={organization.id}
                  to={`/organization/${organization.id}`}
                >
                  <span>
                    <strong>{organization.name}</strong>
                    <small>{organization.workspace?.name ?? "Organization wide"}</small>
                  </span>
                  <span className="org-summary-meta">
                    <span>{formatEnum(organization.type)}</span>
                    <span>{formatEnum(organization.planTier)}</span>
                  </span>
                  <span className="org-summary-footer">
                    <span className="status-pill compact">{formatEnum(organization.role)}</span>
                    <small>Updated {formatDate(organization.updatedAt)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : organizations.length > 0 && organizationId ? (
        <>
          {(organizationDetailError || organizationDetailLoading) && (
            <p className={organizationDetailError ? "form-error" : "muted-copy"}>
              {organizationDetailError ?? "Loading organization details."}
            </p>
          )}
          {organization && (
            <OrganizationManagementPanel
              onChanged={async () => {
                await reload();
                await reloadOrganization();
              }}
              organization={organization}
              session={session}
              setPageError={setOrganizationDetailError}
            />
          )}
          {!organization && !organizationDetailLoading && !organizationDetailError && (
            <section className="panel empty-state compact-empty">
              <Building2 size={28} />
              <strong>Organization not found</strong>
              <span>Choose an organization from the directory.</span>
              <Link className="secondary-button" to="/organization">
                Back to organizations
              </Link>
            </section>
          )}
        </>
      ) : (
        <div className="single-column">
          <OrganizationCreateForm
            loading={loading}
            onCreated={async (organizationId) => {
              await reload();
              navigate(`/organization/${organizationId}`);
            }}
            session={session}
            setPageError={setError}
          />
        </div>
      )}
      {showCreateModal && (
        <OrganizationCreateModal
          loading={loading}
          onClose={() => setShowCreateModal(false)}
          onCreated={async (organizationId) => {
            await reload();
            setShowCreateModal(false);
            navigate(`/organization/${organizationId}`);
          }}
          session={session}
          setPageError={setError}
        />
      )}
    </section>
  );
}

function OrganizationCreateModal({
  loading,
  onClose,
  onCreated,
  session,
  setPageError
}: {
  loading: boolean;
  onClose: () => void;
  onCreated: (organizationId: string) => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="organization-modal-title"
        aria-modal="true"
        className="modal-panel organization-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Organizations</p>
            <h2 id="organization-modal-title">Create organization</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close organization form">
            <X size={17} />
          </button>
        </div>
        {modalError && <p className="form-error">{modalError}</p>}
        <OrganizationCreateForm
          embedded
          loading={loading}
          onCreated={async (organizationId) => {
            setModalError(null);
            setPageError(null);
            await onCreated(organizationId);
          }}
          session={session}
          setPageError={(error) => {
            setModalError(error);
            if (!error) {
              setPageError(null);
            }
          }}
        />
      </section>
    </div>
  );
}

function OrganizationCreateForm({
  embedded = false,
  loading,
  onCreated,
  session,
  setPageError
}: {
  embedded?: boolean;
  loading: boolean;
  onCreated: (organizationId: string) => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const organizationDraft = useFormDraft("goxai-draft-organization");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
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

      organizationDraft.clearDraft();
      setSavedMessage(`${result.organization.name} and ${result.workspace.name} are ready.`);
      await onCreated(result.organization.id);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={embedded ? "setup-form" : "panel setup-form"}
      onChange={organizationDraft.saveDraft}
      onSubmit={handleSubmit}
      ref={organizationDraft.formRef}
    >
      <div className="wide">
        <p className="eyebrow">Create</p>
        <h2>New organization</h2>
      </div>
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
      <fieldset className="plan-picker wide">
        <legend>Plan</legend>
        <div className="plan-option-row">
          {planOptions.map((plan) => (
            <label className="plan-option" key={plan.value}>
              <input name="plan" type="radio" value={plan.value} defaultChecked={plan.value === "FREE"} />
              <strong>{plan.label}</strong>
              <span>{plan.price}</span>
              <small>{plan.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button" type="submit" disabled={saving || loading}>
        <Building2 size={18} />
        {saving ? "Creating" : "Create organization"}
      </button>
    </form>
  );
}

function OrganizationManagementPanel({
  onChanged,
  organization,
  session,
  setPageError
}: {
  onChanged: () => Promise<void>;
  organization: OrganizationDetail;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [memberSaving, setMemberSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const primaryWorkspace = organization.workspaces[0] ?? null;

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganization(session, organization.id, {
        name: getFormValue(event, "name"),
        type: getFormValue(event, "type"),
        planTier: getFormValue(event, "planTier")
      });
      setMessage("Organization settings updated.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update organization.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setMemberSaving(true);

    try {
      await addOrganizationMember(session, organization.id, {
        email: getFormValue(event, "email"),
        role: getFormValue(event, "role")
      });
      form.reset();
      setMessage("Member added.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to add member.");
    } finally {
      setMemberSaving(false);
    }
  }

  async function handleDeleteOrganization() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await deleteOrganization(session, organization.id);
      setMessage("Organization deleted.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="detail-layout organization-detail-layout">
      <section className="content-column">
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Organization details</p>
              <h2>{organization.name}</h2>
            </div>
            <span className="status-pill">{formatEnum(organization.currentUserRole)}</span>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Type</dt>
              <dd>{formatEnum(organization.type)}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{formatEnum(organization.planTier)}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>{organization.memberships.length}</dd>
            </div>
            <div>
              <dt>Workspace</dt>
              <dd>{primaryWorkspace?.name ?? "Organization wide"}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd>{organization.slug}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(organization.updatedAt)}</dd>
            </div>
          </dl>
          <div className="description-block">
            <span>Description</span>
            <p>{primaryWorkspace?.description || "No workspace description has been added yet."}</p>
          </div>
        </section>

        <MembersTable
          members={organization.memberships}
          onChanged={onChanged}
          organizationId={organization.id}
          session={session}
          setPageError={setPageError}
        />

        <section className="panel">
          <div>
            <p className="eyebrow">Access</p>
            <h2>Role permissions</h2>
          </div>
          <RolePrivilegesPanel />
        </section>
      </section>

      <aside className="side-column">
        {message && <p className="form-success">{message}</p>}
        <section className="panel management-panel">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Edit organization</h2>
          </div>
          <form className="management-grid" onSubmit={handleUpdate}>
            <label>
              Name
              <input name="name" defaultValue={organization.name} required />
            </label>
            <label>
              Type
              <select name="type" defaultValue={organization.type}>
                <option value="PERSONAL">Personal</option>
                <option value="COMPANY">Company</option>
                <option value="ENTERPRISE">Enterprise</option>
                <option value="MARKETPLACE_VENDOR">Marketplace vendor</option>
              </select>
            </label>
            <label>
              Plan
              <select name="planTier" defaultValue={organization.planTier}>
                <option value="FREE">Free</option>
                <option value="STARTER">Starter</option>
                <option value="PRO">Pro</option>
                <option value="BUSINESS">Business</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </label>
            <div className="row-actions wide">
              <button className="primary-button" type="submit" disabled={saving}>
                <Save size={18} />
                {saving ? "Saving" : "Save organization"}
              </button>
              <button className="ghost-button danger-button" type="button" onClick={handleDeleteOrganization} disabled={saving}>
                Delete empty organization
              </button>
            </div>
          </form>
        </section>

        <section className="panel management-panel">
          <div>
            <p className="eyebrow">Members</p>
            <h2>Add member</h2>
          </div>
          <form className="management-grid" onSubmit={handleAddMember}>
            <label>
              Member email
              <input name="email" placeholder="teammate@example.com" type="email" required />
            </label>
            <label>
              Role
              <select name="role" defaultValue="ANNOTATOR">
                {memberRoles.map((role) => (
                  <option key={role} value={role}>
                    {formatEnum(role)}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary-button" type="submit" disabled={memberSaving}>
              <UserRoundPlus size={18} />
              {memberSaving ? "Adding" : "Add member"}
            </button>
          </form>
        </section>
      </aside>
    </section>
  );
}

function RolePrivilegesPanel() {
  return (
    <section className="role-grid">
      {rolePrivileges.map((role) => (
        <article className="role-card" key={role.role}>
          <strong>{formatEnum(role.role)}</strong>
          <ul>
            {role.permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}

function MembersTable({
  members,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
  members: MembershipSummary[];
  onChanged: () => Promise<void>;
  organizationId: string;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  return (
    <section className="table-panel">
      <div className="table-row member-head table-head">
        <span>Member</span>
        <span>Role</span>
        <span>Status</span>
        <span>Action</span>
      </div>
      {members.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          onChanged={onChanged}
          organizationId={organizationId}
          session={session}
          setPageError={setPageError}
        />
      ))}
    </section>
  );
}

function MemberRow({
  member,
  onChanged,
  organizationId,
  session,
  setPageError
}: {
  member: MembershipSummary;
  onChanged: () => Promise<void>;
  organizationId: string;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState(member.role);

  async function saveRole() {
    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateOrganizationMember(session, organizationId, member.id, role);
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update member.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember() {
    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await removeOrganizationMember(session, organizationId, member.id);
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to remove member.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="table-row member-head project-row">
      <span>
        <strong>{member.user.name}</strong>
        <small>{member.user.email}</small>
      </span>
      <span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {memberRoles.map((item) => (
            <option key={item} value={item}>
              {formatEnum(item)}
            </option>
          ))}
        </select>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(member.status)}</span>
      </span>
      <span className="row-actions">
        <button className="secondary-button compact-button" type="button" onClick={saveRole} disabled={saving}>
          Save
        </button>
        <button className="ghost-button compact-button danger-button" type="button" onClick={removeMember} disabled={saving}>
          Remove
        </button>
      </span>
    </article>
  );
}

const memberRoles = ["OWNER", "ADMIN", "MANAGER", "REVIEWER", "ANNOTATOR", "VIEWER"];

const rolePrivileges = [
  {
    role: "OWNER",
    permissions: ["Full organization control", "Manage owners and members", "Manage projects, datasets, assets, and tasks"]
  },
  {
    role: "ADMIN",
    permissions: ["Edit organization settings", "Manage non-owner members", "Manage projects, datasets, assets, and tasks"]
  },
  {
    role: "MANAGER",
    permissions: ["Manage projects and datasets", "Upload/register assets", "Generate and assign tasks"]
  },
  {
    role: "REVIEWER",
    permissions: ["Read workspace records", "Assign/start/submit tasks", "Reserved for review/QA tools"]
  },
  {
    role: "ANNOTATOR",
    permissions: ["Read workspace records", "Assign/start/submit tasks"]
  },
  {
    role: "VIEWER",
    permissions: ["Read-only access"]
  }
];

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
  const projectDraft = useFormDraft("goxai-draft-project");
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
      projectDraft.clearDraft();
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
        <form
          className="panel project-form"
          onChange={projectDraft.saveDraft}
          onSubmit={handleSubmit}
          ref={projectDraft.formRef}
        >
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

function ProjectSettingsPanel({
  onChanged,
  project,
  session,
  setPageError
}: {
  onChanged: () => Promise<void>;
  project: ProjectSummary;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateProject(session, project.id, {
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description"),
        status: getFormValue(event, "status"),
        instructions: getFormValue(event, "instructions")
      });
      setMessage("Project updated.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update project.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await archiveProject(session, project.id);
      setMessage("Project archived.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to archive project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel management-grid" onSubmit={handleUpdate}>
      <div className="wide">
        <p className="eyebrow">Manage</p>
        <h2>Project settings</h2>
      </div>
      <label>
        Name
        <input name="name" defaultValue={project.name} required />
      </label>
      <label>
        Status
        <select name="status" defaultValue={project.status}>
          {projectStatuses.map((status) => (
            <option key={status} value={status}>
              {formatEnum(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Description
        <textarea name="description" defaultValue={project.description ?? ""} rows={3} />
      </label>
      <label className="wide">
        Instructions
        <textarea name="instructions" defaultValue={project.instructions ?? ""} rows={4} />
      </label>
      {message && <p className="form-success wide">{message}</p>}
      <div className="row-actions wide">
        <button className="primary-button" type="submit" disabled={saving}>
          <Save size={18} />
          {saving ? "Saving" : "Save project"}
        </button>
        <button className="ghost-button danger-button" type="button" onClick={handleArchive} disabled={saving}>
          Archive project
        </button>
      </div>
    </form>
  );
}

const projectStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function ProjectDetailPage() {
  const { projectId = "" } = useParams();
  const { session } = useAuth();
  const [showDatasetModal, setShowDatasetModal] = useState(false);
  const { error: projectError, loading: projectLoading, project, reload: reloadProject } = useProject(session, projectId);
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
        {project && (
          <button className="primary-button" type="button" onClick={() => setShowDatasetModal(true)}>
            <Database size={18} />
            New dataset
          </button>
        )}
      </div>
      {(projectError ?? datasetsError) && <p className="form-error">{projectError ?? datasetsError}</p>}
      {projectLoading ? (
        <section className="panel">
          <p className="muted-copy">Loading project details.</p>
        </section>
      ) : project ? (
        <div className="detail-layout">
          <section className="content-column">
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
            <DatasetsTable datasets={datasets} loading={datasetsLoading} projectScoped />
          </section>
          <aside className="side-column">
            <ProjectSettingsPanel
              onChanged={reloadProject}
              project={project}
              session={session}
              setPageError={setDatasetsError}
            />
          </aside>
        </div>
      ) : !projectError ? (
        <section className="panel">
          <p className="muted-copy">Project was not found.</p>
        </section>
      ) : null}
      {project && showDatasetModal && (
        <DatasetCreateModal
          defaultProjectId={project.id}
          onClose={() => setShowDatasetModal(false)}
          onCreated={reloadDatasets}
          projects={[project]}
          session={session}
          setPageError={setDatasetsError}
        />
      )}
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
  const [showDatasetModal, setShowDatasetModal] = useState(false);

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
          onClick={() => setShowDatasetModal(true)}
          disabled={projects.length === 0 || projectsLoading}
        >
          <Database size={18} />
          New dataset
        </button>
      </div>
      {(projectsError ?? datasetsError) && <p className="form-error">{projectsError ?? datasetsError}</p>}
      {showDatasetModal && (
        <DatasetCreateModal
          onClose={() => setShowDatasetModal(false)}
          onCreated={reloadDatasets}
          projects={projects}
          session={session}
          setPageError={setDatasetsError}
        />
      )}
      <DatasetsTable datasets={datasets} loading={datasetsLoading || projectsLoading} />
    </section>
  );
}

function TasksPage() {
  const { session } = useAuth();
  const { error, loading, reload, setError, tasks } = useTasks(session);

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Labeling tasks</h1>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      <TasksTable loading={loading} onChanged={reload} session={session} setPageError={setError} tasks={tasks} />
    </section>
  );
}

function DatasetCreateModal({
  defaultProjectId,
  onClose,
  onCreated,
  projects,
  session,
  setPageError
}: {
  defaultProjectId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  projects: ProjectSummary[];
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="dataset-modal-title"
        aria-modal="true"
        className="modal-panel"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Datasets</p>
            <h2 id="dataset-modal-title">Create dataset</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dataset form">
            <X size={17} />
          </button>
        </div>
        {modalError && <p className="form-error">{modalError}</p>}
        <DatasetForm
          defaultProjectId={defaultProjectId}
          embedded
          onCreated={async () => {
            setModalError(null);
            setPageError(null);
            await onCreated();
            onClose();
          }}
          projects={projects}
          session={session}
          setPageError={(error) => {
            setModalError(error);
            if (!error) {
              setPageError(null);
            }
          }}
        />
      </section>
    </div>
  );
}

function DatasetForm({
  defaultProjectId,
  embedded = false,
  onCreated,
  projects,
  session,
  setPageError
}: {
  defaultProjectId?: string;
  embedded?: boolean;
  onCreated: () => Promise<void>;
  projects: ProjectSummary[];
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const datasetDraft = useFormDraft(
    defaultProjectId ? `goxai-draft-dataset-${defaultProjectId}` : "goxai-draft-dataset"
  );

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
      datasetDraft.clearDraft();
      setSavedMessage(`${dataset.name} was created as a draft.`);
      await onCreated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create dataset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={embedded ? "dataset-form" : "panel dataset-form"}
      onChange={datasetDraft.saveDraft}
      onSubmit={handleSubmit}
      ref={datasetDraft.formRef}
    >
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

function DatasetTasksPanel({
  dataset,
  loading,
  onGenerated,
  session,
  setPageError,
  tasks
}: {
  dataset: DatasetSummary;
  loading: boolean;
  onGenerated: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  tasks: TaskSummary[];
}) {
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setGenerating(true);

    try {
      const result = await generateTasksFromDataset(session, dataset.id);
      setMessage(
        result.createdCount > 0
          ? `${result.createdCount} task${result.createdCount === 1 ? "" : "s"} generated.`
          : "Tasks already exist for every dataset asset."
      );
      await onGenerated();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to generate tasks.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="panel task-panel">
      <div className="task-panel-head">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2>Dataset tasks</h2>
          <span>{tasks.length} task records for this dataset</span>
        </div>
        <button className="primary-button" type="button" onClick={handleGenerate} disabled={generating}>
          <ClipboardList size={18} />
          {generating ? "Generating" : "Generate tasks"}
        </button>
      </div>
      {message && <p className="form-success">{message}</p>}
      <TasksTable loading={loading} onChanged={onGenerated} session={session} setPageError={setPageError} tasks={tasks} />
    </section>
  );
}

function TasksTable({
  loading,
  onChanged,
  session,
  setPageError,
  tasks
}: {
  loading: boolean;
  onChanged: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  tasks: TaskSummary[];
}) {
  return (
    <section className="table-panel">
      <div className="table-row task-head table-head">
        <span>Asset</span>
        <span>Status</span>
        <span>Assigned</span>
        <span>Action</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>Loading tasks</strong>
          <span>Checking task assignments and statuses.</span>
        </div>
      ) : tasks.length > 0 ? (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            onChanged={onChanged}
            session={session}
            setPageError={setPageError}
            task={task}
          />
        ))
      ) : (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>No tasks yet</strong>
          <span>Generate tasks from dataset assets to start annotation work.</span>
        </div>
      )}
    </section>
  );
}

function TaskRow({
  onChanged,
  session,
  setPageError,
  task
}: {
  onChanged: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  task: TaskSummary;
}) {
  const [saving, setSaving] = useState(false);
  const action = getNextTaskAction(task);

  async function handleAction() {
    if (!session || !action) {
      return;
    }

    setSaving(true);
    setPageError(null);

    try {
      if (action.kind === "assign") {
        await assignTaskToSelf(session, task.id);
      } else if (action.kind === "start") {
        await startTask(session, task.id);
      } else {
        await submitTask(session, task.id);
      }

      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="table-row task-head project-row">
      <span>
        <strong>{task.asset?.fileName ?? "No asset"}</strong>
        <small>{task.dataset?.name ?? task.project.name}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(task.status)}</span>
      </span>
      <span>{task.assignedTo?.name ?? "Unassigned"}</span>
      <span>
        {action ? (
          <button className="secondary-button compact-button" type="button" onClick={handleAction} disabled={saving}>
            {action.kind === "assign" ? <UserCheck size={16} /> : action.kind === "start" ? <Eye size={16} /> : <Send size={16} />}
            {saving ? "Saving" : action.label}
          </button>
        ) : (
          <span className="muted-copy">Waiting</span>
        )}
      </span>
    </article>
  );
}

function getNextTaskAction(task: TaskSummary): { kind: "assign" | "start" | "submit"; label: string } | null {
  if (task.status === "PENDING") {
    return { kind: "assign", label: "Assign" };
  }

  if (task.status === "ASSIGNED") {
    return { kind: "start", label: "Start" };
  }

  if (task.status === "IN_PROGRESS") {
    return { kind: "submit", label: "Submit" };
  }

  return null;
}

function DatasetSettingsPanel({
  dataset,
  onChanged,
  session,
  setPageError
}: {
  dataset: DatasetSummary;
  onChanged: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await updateDataset(session, dataset.id, {
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description"),
        status: getFormValue(event, "status")
      });
      setMessage("Dataset updated.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update dataset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await archiveDataset(session, dataset.id);
      setMessage("Dataset archived.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to archive dataset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel management-grid" onSubmit={handleUpdate}>
      <div className="wide">
        <p className="eyebrow">Manage</p>
        <h2>Dataset settings</h2>
      </div>
      <label>
        Name
        <input name="name" defaultValue={dataset.name} required />
      </label>
      <label>
        Status
        <select name="status" defaultValue={dataset.status}>
          {datasetStatuses.map((status) => (
            <option key={status} value={status}>
              {formatEnum(status)}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        Description
        <textarea name="description" defaultValue={dataset.description ?? ""} rows={3} />
      </label>
      {message && <p className="form-success wide">{message}</p>}
      <div className="row-actions wide">
        <button className="primary-button" type="submit" disabled={saving}>
          <Save size={18} />
          {saving ? "Saving" : "Save dataset"}
        </button>
        <button className="ghost-button danger-button" type="button" onClick={handleArchive} disabled={saving}>
          Archive dataset
        </button>
      </div>
    </form>
  );
}

const datasetStatuses = ["DRAFT", "IMPORTING", "READY", "PROCESSING", "ARCHIVED", "FAILED"];

function DatasetDetailPage() {
  const { datasetId = "" } = useParams();
  const { session } = useAuth();
  const { dataset, error: datasetError, loading: datasetLoading, reload: reloadDataset } = useDataset(session, datasetId);
  const {
    assets,
    error: assetsError,
    loading: assetsLoading,
    reload: reloadAssets,
    setError: setAssetsError
  } = useAssets(session, { datasetId });
  const {
    error: tasksError,
    loading: tasksLoading,
    reload: reloadTasks,
    setError: setTasksError,
    tasks
  } = useTasks(session, { datasetId });

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
      {(datasetError ?? assetsError ?? tasksError) && (
        <p className="form-error">{datasetError ?? assetsError ?? tasksError}</p>
      )}
      {datasetLoading ? (
        <section className="panel">
          <p className="muted-copy">Loading dataset details.</p>
        </section>
      ) : dataset ? (
        <div className="detail-layout">
          <section className="content-column">
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
            <DatasetTasksPanel
              dataset={dataset}
              loading={tasksLoading}
              onGenerated={reloadTasks}
              session={session}
              setPageError={setTasksError}
              tasks={tasks}
            />
            <AssetsTable assets={assets} loading={assetsLoading} session={session} setPageError={setAssetsError} />
          </section>
          <aside className="side-column">
            <DatasetSettingsPanel
              dataset={dataset}
              onChanged={reloadDataset}
              session={session}
              setPageError={setTasksError}
            />
            <AssetForm
              dataset={dataset}
              onCreated={async () => {
                await reloadAssets();
                await reloadTasks();
              }}
              session={session}
              setPageError={setAssetsError}
            />
          </aside>
        </div>
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
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [renameFiles, setRenameFiles] = useState(false);
  const [uploadFolder, setUploadFolder] = useState(`datasets/v${dataset.version}`);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [renamePrefix, setRenamePrefix] = useState(toSafeObjectKeyPart(dataset.name) || "asset");
  const assetDraft = useFormDraft(`goxai-draft-asset-${dataset.id}`);
  const selectedFilesRef = useRef<File[]>([]);
  const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const objectKey = getFormValue(event, "objectKey");
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    if (selectedFiles.length === 0 && !objectKey) {
      setPageError("R2 object key is required when registering an existing object.");
      return;
    }

    setSaving(true);

    try {
      if (selectedFiles.length > 0) {
        const uploaded: AssetSummary[] = [];
        const failed: string[] = [];
        const batchBytes = selectedFiles.reduce((total, file) => total + file.size, 0);

        if (selectedFiles.length > maxBulkUploadFiles) {
          throw new Error(`Upload up to ${maxBulkUploadFiles} files at once.`);
        }

        if (batchBytes > maxBulkUploadBytes) {
          throw new Error(`Upload up to ${formatBytes(String(maxBulkUploadBytes))} per batch.`);
        }

        setUploadProgress({
          completed: 0,
          currentFile: selectedFiles[0]?.name ?? "",
          failed: 0,
          status: "uploading",
          total: selectedFiles.length
        });

        for (const [index, file] of selectedFiles.entries()) {
          setUploadProgress({
            completed: uploaded.length,
            currentFile: file.webkitRelativePath || file.name,
            failed: failed.length,
            status: "uploading",
            total: selectedFiles.length
          });

          try {
            uploaded.push(
              await uploadAndRegisterAsset(
                session,
                dataset.id,
                file,
                buildUploadObjectKey(file, {
                  folder: uploadFolder,
                  prefix: renamePrefix,
                  rename: renameFiles
                })
              )
            );
          } catch (reason) {
            failed.push(`${file.name}: ${reason instanceof Error ? reason.message : "Upload failed."}`);
          }

          setUploadProgress({
            completed: uploaded.length,
            currentFile: selectedFiles[index + 1]?.webkitRelativePath || selectedFiles[index + 1]?.name || file.name,
            failed: failed.length,
            status: "uploading",
            total: selectedFiles.length
          });
        }

        if (uploaded.length > 0) {
          setSelectedFiles([]);
          form.reset();
          assetDraft.clearDraft();
          setSavedMessage(
            failed.length > 0
              ? `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded. ${failed.length} failed.`
              : `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} uploaded to R2.`
          );
          await onCreated();
        }

        setUploadProgress({
          completed: uploaded.length,
          currentFile: "",
          failed: failed.length,
          status: failed.length > 0 ? "error" : "complete",
          total: selectedFiles.length
        });

        if (failed.length > 0) {
          setPageError(failed.slice(0, 3).join(" "));
        }

        if (uploaded.length === 0) {
          throw new Error("No files uploaded. Check the first error and try again.");
        }

        return;
      }

      const asset = await createAsset(session, {
            datasetId: dataset.id,
            bucket: getFormValue(event, "bucket"),
            objectKey,
            fileName: getFormValue(event, "fileName"),
            mimeType: getFormValue(event, "mimeType"),
            fileSize: getFormValue(event, "fileSize"),
            checksum: getFormValue(event, "checksum"),
            width: getFormValue(event, "width"),
            height: getFormValue(event, "height"),
            duration: getFormValue(event, "duration")
          });

      form.reset();
      assetDraft.clearDraft();
      setSavedMessage(`${asset.fileName} was registered from R2.`);
      await onCreated();
    } catch (reason) {
      setUploadProgress((current) =>
        current
          ? {
              ...current,
              status: "error"
            }
          : null
      );
      setPageError(reason instanceof Error ? reason.message : "Unable to register R2 asset.");
    } finally {
      setSaving(false);
    }
  }

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files).filter((file) => file.size > 0);

    if (incoming.length === 0) {
      return;
    }

    const merged = mergeFiles(selectedFilesRef.current, incoming);
    const limited = merged.slice(0, maxBulkUploadFiles);
    const totalBytes = limited.reduce((total, file) => total + file.size, 0);

    if (merged.length > maxBulkUploadFiles) {
      setPageError(`Upload up to ${maxBulkUploadFiles} files at once. Extra files were not added.`);
    } else if (totalBytes > maxBulkUploadBytes) {
      setPageError(`Upload up to ${formatBytes(String(maxBulkUploadBytes))} per batch. Remove some files before uploading.`);
    } else {
      setPageError(null);
    }

    setSelectedFiles(limited);
    setSavedMessage(null);
    setUploadProgress(null);
  }

  return (
    <form
      className={`panel asset-form${dragActive ? " drag-active" : ""}`}
      onChange={assetDraft.saveDraft}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) {
          setDragActive(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        addFiles(event.dataTransfer.files);
      }}
      onSubmit={handleSubmit}
      ref={assetDraft.formRef}
    >
      <div className="wide">
        <p className="eyebrow">Assets</p>
        <h2>Bulk upload</h2>
      </div>
      <div className="drop-zone wide">
        <CloudUpload size={22} />
        <strong>Drop images or files here</strong>
        <span>Choose many files, or choose a folder to keep the folder paths in R2.</span>
        <div className="upload-picker-row">
          <label className="secondary-button file-picker-button">
            <CloudUpload size={16} />
            Select files
            <input
              multiple
              name="files"
              onChange={(event) => {
                addFiles(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
              }}
              type="file"
            />
          </label>
          <label className="secondary-button file-picker-button">
            <FolderOpen size={16} />
            Select folder
            <input
              multiple
              name="folder"
              onChange={(event) => {
                addFiles(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
              }}
              type="file"
              {...folderInputAttributes}
            />
          </label>
        </div>
      </div>
      {selectedFiles.length > 0 && (
        <div className="selected-files wide">
          <div className="selected-files-head">
            <div>
              <strong>{selectedFiles.length} selected</strong>
              <span>{formatBytes(String(selectedBytes))}</span>
            </div>
            <button
              className="ghost-button compact-button"
              type="button"
              onClick={() => {
                setSelectedFiles([]);
                setPageError(null);
                setUploadProgress(null);
              }}
            >
              <X size={16} />
              Clear
            </button>
          </div>
          <div className="file-preview-list">
            {selectedFiles.slice(0, 6).map((file) => (
              <span key={getFileKey(file)}>
                {file.webkitRelativePath || file.name}
              </span>
            ))}
            {selectedFiles.length > 6 && <span>+{selectedFiles.length - 6} more</span>}
          </div>
        </div>
      )}
      <label className="wide">
        R2 folder
        <input
          name="uploadFolder"
          onChange={(event) => setUploadFolder(event.currentTarget.value)}
          placeholder="datasets/v1"
          value={uploadFolder}
        />
      </label>
      <label className="checkbox-row wide">
        <input
          checked={renameFiles}
          onChange={(event) => setRenameFiles(event.currentTarget.checked)}
          type="checkbox"
        />
        Rename uploaded files with a prefix and random code
      </label>
      {renameFiles && (
        <label className="wide">
          Rename prefix
          <input
            name="renamePrefix"
            onChange={(event) => setRenamePrefix(event.currentTarget.value)}
            placeholder="training"
            value={renamePrefix}
          />
        </label>
      )}
      {uploadProgress && (
        <UploadProgressPanel progress={uploadProgress} />
      )}
      <details className="advanced-fields wide">
        <summary>Manual registration fields</summary>
        <div className="advanced-grid">
          <label>
            R2 bucket
            <input name="bucket" placeholder="Uses R2_BUCKET when empty" />
          </label>
          <label>
            Existing R2 object key
            <input name="objectKey" placeholder="datasets/v1/image-001.jpg" />
          </label>
          <label>
            File name
            <input name="fileName" placeholder="image-001.jpg" />
          </label>
          <label>
            MIME type
            <input name="mimeType" placeholder="image/jpeg" />
          </label>
          <label>
            File size bytes
            <input name="fileSize" inputMode="numeric" placeholder="2483912" />
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
        </div>
      </details>
      {savedMessage && <p className="form-success wide">{savedMessage}</p>}
      <button className="primary-button wide" type="submit" disabled={saving}>
        <CloudUpload size={18} />
        {saving ? "Uploading" : selectedFiles.length > 0 ? `Upload ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}` : "Register R2 asset"}
      </button>
    </form>
  );
}

function UploadProgressPanel({ progress }: { progress: UploadProgress }) {
  const finished = progress.completed + progress.failed;
  const percent = progress.total > 0 ? Math.round((finished / progress.total) * 100) : 0;
  const statusText =
    progress.status === "complete"
      ? "Upload complete"
      : progress.status === "error"
        ? "Upload finished with errors"
        : `Uploading ${finished + 1 > progress.total ? progress.total : finished + 1} of ${progress.total}`;

  return (
    <div className="upload-progress wide">
      <div className="upload-progress-head">
        <strong>{statusText}</strong>
        <span>{percent}%</span>
      </div>
      <div className="progress-track" aria-label="Upload progress" aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} role="progressbar">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="upload-progress-meta">
        <span>{progress.completed} uploaded</span>
        <span>{progress.failed} failed</span>
      </div>
      {progress.currentFile && <p className="muted-copy">Current: {progress.currentFile}</p>}
    </div>
  );
}

function buildUploadObjectKey(
  file: File,
  options: {
    folder: string;
    prefix: string;
    rename: boolean;
  }
) {
  const folder = sanitizeObjectPath(options.folder);

  if (options.rename) {
    const prefix = toSafeObjectKeyPart(options.prefix) || "asset";
    return joinObjectKeyParts(folder, `${prefix}-${createRandomCode()}${getFileExtension(file.name)}`);
  }

  return joinObjectKeyParts(folder, sanitizeObjectPath(file.webkitRelativePath || file.name));
}

function mergeFiles(current: File[], incoming: File[]) {
  const filesByKey = new Map(current.map((file) => [getFileKey(file), file]));

  for (const file of incoming) {
    filesByKey.set(getFileKey(file), file);
  }

  return Array.from(filesByKey.values());
}

function getFileKey(file: File) {
  return `${file.webkitRelativePath || file.name}-${file.size}-${file.lastModified}`;
}

function joinObjectKeyParts(...parts: string[]) {
  return parts.filter(Boolean).join("/");
}

function sanitizeObjectPath(value: string) {
  return value
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
}

function toSafeObjectKeyPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function getFileExtension(fileName: string) {
  const cleanName = fileName.split(/[\\/]/).pop() ?? "";
  const dotIndex = cleanName.lastIndexOf(".");

  return dotIndex > 0 ? cleanName.slice(dotIndex).replace(/[^a-zA-Z0-9.]/g, "") : "";
}

function createRandomCode() {
  const bytes = new Uint8Array(4);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return Math.random().toString(36).slice(2, 10);
}

async function uploadAndRegisterAsset(
  session: NonNullable<ReturnType<typeof useAuth>["session"]>,
  datasetId: string,
  file: File,
  objectKey?: string
) {
  const signedUpload = await createAssetUploadUrl(session, {
    datasetId,
    objectKey,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size.toString()
  });

  try {
    await uploadFileToSignedUrl(file, signedUpload.upload);
  } catch (error) {
    await logClientEvent(session, {
      entityId: datasetId,
      entityType: "dataset",
      event: "r2_upload_failed",
      level: "error",
      message: error instanceof Error ? error.message : "R2 upload failed.",
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        objectKey: signedUpload.asset.objectKey,
        uploadHost: getUrlHost(signedUpload.upload.uploadUrl)
      }
    }).catch(() => {});

    throw error;
  }

  return createAsset(session, signedUpload.asset);
}

function AssetsTable({
  assets,
  loading,
  session,
  setPageError
}: {
  assets: AssetSummary[];
  loading: boolean;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetSummary | null>(null);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = normalizedQuery
    ? assets.filter((asset) =>
        [asset.fileName, asset.objectKey, asset.mimeType, asset.provider]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : assets;
  const totalBytes = assets.reduce((total, asset) => total + Number(asset.fileSize || 0), 0);

  async function handleInspect(asset: AssetSummary) {
    setSelectedAsset(asset);
    setAccessUrl(null);
    setAccessError(null);
    setPageError(null);

    if (!session) {
      setAccessError("Authentication required.");
      return;
    }

    setAccessLoading(true);

    try {
      const result = await getAssetAccessUrl(session, asset.id);
      setAccessUrl(result.accessUrl);
    } catch (reason) {
      setAccessError(reason instanceof Error ? reason.message : "Unable to create asset preview URL.");
    } finally {
      setAccessLoading(false);
    }
  }

  return (
    <section className="asset-workspace">
      <div className="asset-toolbar">
        <div>
          <p className="eyebrow">Assets</p>
          <h2>{assets.length} registered</h2>
          <span>{formatBytes(String(totalBytes))} across this dataset</span>
        </div>
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files, keys, or MIME types"
          />
        </label>
      </div>
      <section className="table-panel">
        <div className="table-row assets-head table-head">
          <span>File</span>
          <span>Type</span>
          <span>Size</span>
          <span>Action</span>
        </div>
        {loading ? (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>Loading assets</strong>
            <span>Checking registered R2 objects for this dataset.</span>
          </div>
        ) : filteredAssets.length > 0 ? (
          filteredAssets.map((asset) => (
            <AssetRow
              asset={asset}
              key={asset.id}
              onInspect={() => {
                void handleInspect(asset);
              }}
            />
          ))
        ) : assets.length > 0 ? (
          <div className="empty-state">
            <Search size={28} />
            <strong>No matching assets</strong>
            <span>Try a file name, object key, provider, or MIME type.</span>
          </div>
        ) : (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>No assets registered</strong>
            <span>Upload an R2 object to start building annotation tasks.</span>
          </div>
        )}
      </section>
      {selectedAsset && (
        <AssetPreview
          accessError={accessError}
          accessLoading={accessLoading}
          accessUrl={accessUrl}
          asset={selectedAsset}
          onClose={() => {
            setSelectedAsset(null);
            setAccessUrl(null);
            setAccessError(null);
          }}
        />
      )}
    </section>
  );
}

function AssetRow({ asset, onInspect }: { asset: AssetSummary; onInspect: () => void }) {
  return (
    <article className="table-row assets-head project-row">
      <span>
        <button className="link-button" type="button" onClick={onInspect}>
          {asset.fileName}
        </button>
        <small>{asset.objectKey}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatAssetKind(asset.mimeType)}</span>
        <small>{asset.mimeType}</small>
      </span>
      <span>{formatBytes(asset.fileSize)}</span>
      <span>
        <button className="secondary-button compact-button" type="button" onClick={onInspect}>
          <Eye size={16} />
          Preview
        </button>
      </span>
    </article>
  );
}

function AssetPreview({
  accessError,
  accessLoading,
  accessUrl,
  asset,
  onClose
}: {
  accessError: string | null;
  accessLoading: boolean;
  accessUrl: string | null;
  asset: AssetSummary;
  onClose: () => void;
}) {
  const isImage = asset.mimeType.startsWith("image/");
  const isVideo = asset.mimeType.startsWith("video/");
  const isAudio = asset.mimeType.startsWith("audio/");

  return (
    <section className="panel asset-preview">
      <div className="asset-preview-head">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>{asset.fileName}</h2>
          <span>{asset.objectKey}</span>
        </div>
        <div className="asset-preview-actions">
          {accessUrl && (
            <a className="secondary-button compact-button" href={accessUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Open
            </a>
          )}
          <button className="ghost-button compact-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <dl className="detail-list asset-detail-list">
        <div>
          <dt>Type</dt>
          <dd>{asset.mimeType}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(asset.fileSize)}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>{asset.width && asset.height ? `${asset.width} x ${asset.height}` : "Not set"}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{formatDate(asset.createdAt)}</dd>
        </div>
      </dl>
      {accessError && <p className="form-error">{accessError}</p>}
      <div className="asset-preview-stage">
        {accessLoading ? (
          <span className="muted-copy">Creating signed preview URL.</span>
        ) : accessUrl && isImage ? (
          <img alt={asset.fileName} src={accessUrl} />
        ) : accessUrl && isVideo ? (
          <video controls src={accessUrl} />
        ) : accessUrl && isAudio ? (
          <audio controls src={accessUrl} />
        ) : (
          <div className="empty-state">
            <FileText size={28} />
            <strong>{accessUrl ? "Preview opens in a new tab" : "Preview unavailable"}</strong>
            <span>{accessUrl ? "Use Open to inspect this file." : "Select an asset to create a signed URL."}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function useOrganizations(session: ReturnType<typeof useAuth>["session"]) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setOrganizations([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOrganizations(await listOrganizations(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load organizations.");
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionRef]);

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
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setProjects([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProjects(await listProjects(activeSession));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load projects.");
    } finally {
      setLoading(false);
    }
  }, [sessionKey, sessionRef]);

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

function useOrganization(session: ReturnType<typeof useAuth>["session"], organizationId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [organization, setOrganization] = useState<OrganizationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !organizationId) {
      setOrganization(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setOrganization(await getOrganization(activeSession, organizationId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load organization.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    organization,
    reload,
    setError
  };
}

function useProject(session: ReturnType<typeof useAuth>["session"], projectId: string) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !projectId) {
      setProject(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setProject(await getProject(activeSession, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load project.");
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionKey, sessionRef]);

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
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setDatasets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDatasets(await listDatasets(activeSession, projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load datasets.");
    } finally {
      setLoading(false);
    }
  }, [projectId, sessionKey, sessionRef]);

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
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession || !datasetId) {
      setDataset(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setDataset(await getDataset(activeSession, datasetId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dataset.");
    } finally {
      setLoading(false);
    }
  }, [datasetId, sessionKey, sessionRef]);

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
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setAssets([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setAssets(await listAssets(activeSession, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load assets.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, sessionKey, sessionRef]);

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

function useTasks(
  session: ReturnType<typeof useAuth>["session"],
  input: { datasetId?: string; projectId?: string } = {}
) {
  const sessionRef = useLatestSessionRef(session);
  const sessionKey = getSessionKey(session);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      setTasks([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setTasks(await listTasks(activeSession, input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [input.datasetId, input.projectId, sessionKey, sessionRef]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    error,
    loading,
    reload,
    setError,
    tasks
  };
}

function useLatestSessionRef(session: ReturnType<typeof useAuth>["session"]) {
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  return sessionRef;
}

function getSessionKey(session: ReturnType<typeof useAuth>["session"]) {
  return session?.user.id ?? "signed-out";
}

function useFormDraft(key: string) {
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    const form = formRef.current;

    if (!form) {
      return;
    }

    const rawDraft = localStorage.getItem(key);

    if (!rawDraft) {
      return;
    }

    try {
      const draft = JSON.parse(rawDraft) as Record<string, string>;

      for (const [name, value] of Object.entries(draft)) {
        const field = form.elements.namedItem(name);

        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLSelectElement ||
          field instanceof HTMLTextAreaElement
        ) {
          if (field instanceof HTMLInputElement && field.type === "file") {
            continue;
          }

          field.value = value;
        }
      }
    } catch {
      localStorage.removeItem(key);
    }
  }, [key]);

  const saveDraft = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      const form = event.currentTarget;
      const formData = new FormData(form);
      const draft: Record<string, string> = {};

      for (const [name, value] of formData.entries()) {
        if (typeof value === "string") {
          draft[name] = value;
        }
      }

      localStorage.setItem(key, JSON.stringify(draft));
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
  }, [key]);

  return {
    clearDraft,
    formRef,
    saveDraft
  };
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name: string, email: string) {
  const source = name !== "Signed in user" ? name : email;
  const parts = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  return (parts[0]?.[0] ?? "G").concat(parts[1]?.[0] ?? "X").toUpperCase();
}

function formatAssetKind(mimeType: string) {
  const [kind] = mimeType.split("/");

  return kind ? formatEnum(kind) : "File";
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

function getFormFile(event: FormEvent<HTMLFormElement>, name: string) {
  const form = new FormData(event.currentTarget);
  const value = form.get(name);

  return value instanceof File && value.size > 0 ? value : null;
}

function getUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "unknown";
  }
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="brand-mark">GX</div>
      <p>Loading GoXAI Labs</p>
    </main>
  );
}
