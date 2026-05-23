import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Database, FolderKanban, Save } from "lucide-react";
import { createProject, archiveProject, updateProject, type ProjectSummary } from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { projectAccessModes, projectStatuses } from "../../constants/options";
import { useDatasets, useFormDraft, useOrganizations, useProject, useProjects } from "../../hooks/useResources";
import { DatasetCreateModal } from "../datasets/DatasetCreateModal";
import { DatasetsTable } from "../datasets/DatasetsTable";
import { formatDate, formatEnum } from "../../utils/format";

export function ProjectsPage() {
  const { dbUser, session } = useAuth();
  const { error: organizationError, loading: organizationsLoading, organizations } = useOrganizations(session);
  const {
    error: projectsError,
    loading: projectsLoading,
    projects,
    reload: reloadProjects,
    setError: setProjectsError
  } = useProjects(session);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const projectDraft = useFormDraft("goxai-draft-project");
  const creatableOrganizations = organizations.filter((organization) => organization.role === "OWNER");
  const defaultOrganization = creatableOrganizations[0];
  const userCreatedProjects = projects.filter((project) => project.createdById === dbUser?.id);

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
        accessMode: getFormValue(event, "accessMode"),
        memberLimit: parseOptionalInteger(getFormValue(event, "memberLimit")),
        allowExternalMembers: new FormData(event.currentTarget).get("allowExternalMembers") === "on",
        joinCodeEnabled: new FormData(event.currentTarget).get("joinCodeEnabled") === "on",
        instructions: getFormValue(event, "instructions")
      });

      form.reset();
      projectDraft.clearDraft();
      setSavedMessage(`${project.name} was created as a draft.`);
      await reloadProjects();
    } catch (reason) {
      setProjectsError(reason instanceof Error ? reason.message : "Unable to create project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      {(organizationError ?? projectsError) && (
        <p className="form-error">{organizationError ?? projectsError}</p>
      )}
      {savedMessage && <p className="form-success">{savedMessage}</p>}
      {showCreateWorkspace ? (
        <section className="panel project-create-frame">
          <div className="organization-detail-nav">
            <button className="secondary-button compact-button" type="button" onClick={() => setShowCreateWorkspace(false)}>
              <ArrowLeft size={16} />
              Back to projects
            </button>
          </div>
          <section className="project-workspace-layout">
            <ProjectRecordsTable
              emptyCopy="Create your first project record from the form."
              loading={projectsLoading || organizationsLoading}
              projects={userCreatedProjects}
              subtitle="Projects created by your account."
              title="Your project records"
            />
            <ProjectCreateForm
              creatableOrganizations={creatableOrganizations}
              defaultOrganizationId={defaultOrganization?.id ?? ""}
              draft={projectDraft}
              onSubmit={handleSubmit}
              saving={saving}
            />
          </section>
        </section>
      ) : (
        <section className="panel project-directory-frame">
          <div className="section-actions">
            {creatableOrganizations.length > 0 && (
              <button
                className="primary-button"
                type="button"
                onClick={() => setShowCreateWorkspace(true)}
                disabled={organizationsLoading}
              >
                <FolderKanban size={18} />
                New project
              </button>
            )}
          </div>
          <ProjectRecordsTable
            emptyCopy={
              creatableOrganizations.length > 0
                ? "Create the first draft project to prepare dataset ingestion."
                : "You can view signed-in public projects, but must be an organization owner to create one."
            }
            loading={projectsLoading || organizationsLoading}
            projects={projects}
            subtitle="All signed-in public projects plus records available to your access."
            title="Available projects"
          />
        </section>
      )}
    </section>
  );
}

function ProjectRecordsTable({
  emptyCopy,
  loading,
  projects,
  subtitle,
  title
}: {
  emptyCopy: string;
  loading: boolean;
  projects: ProjectSummary[];
  subtitle: string;
  title: string;
}) {
  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>{title}</h2>
          <p className="muted-copy">{subtitle}</p>
        </div>
      </div>
      <div className="table-row project-head table-head">
        <span>Name</span>
        <span>Access</span>
        <span>Status</span>
        <span>Members</span>
        <span>Updated</span>
      </div>
      {loading ? (
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
          <span>{emptyCopy}</span>
        </div>
      )}
    </section>
  );
}

function ProjectCreateForm({
  creatableOrganizations,
  defaultOrganizationId,
  draft,
  onSubmit,
  saving
}: {
  creatableOrganizations: Array<{ id: string; name: string }>;
  defaultOrganizationId: string;
  draft: ReturnType<typeof useFormDraft>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <form
      className="panel project-form compact-project-form"
      onChange={draft.saveDraft}
      onSubmit={onSubmit}
      ref={draft.formRef}
    >
      <div className="wide">
        <p className="eyebrow">Create</p>
        <h2>New project</h2>
      </div>
      <label>
        Organization
        <select name="organizationId" defaultValue={defaultOrganizationId} required disabled={creatableOrganizations.length === 0}>
          {creatableOrganizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Data type
        <select name="dataType" defaultValue="IMAGE" disabled={creatableOrganizations.length === 0}>
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
        <input name="name" placeholder="Vehicle damage labeling" required disabled={creatableOrganizations.length === 0} />
      </label>
      <label>
        Privacy
        <select name="accessMode" defaultValue="ORGANIZATION" disabled={creatableOrganizations.length === 0}>
          {projectAccessModes.map((mode) => (
            <option key={mode} value={mode}>
              {formatEnum(mode)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Member limit
        <input name="memberLimit" min={1} placeholder="No limit" type="number" disabled={creatableOrganizations.length === 0} />
      </label>
      <label className="check-row wide">
        <input name="allowExternalMembers" type="checkbox" disabled={creatableOrganizations.length === 0} />
        Allow members outside the organization
      </label>
      <label className="check-row wide">
        <input name="joinCodeEnabled" type="checkbox" disabled={creatableOrganizations.length === 0} />
        Enable join code
      </label>
      <label className="wide">
        Description
        <textarea name="description" placeholder="Short internal summary" rows={3} disabled={creatableOrganizations.length === 0} />
      </label>
      <label className="wide">
        Instructions
        <textarea
          name="instructions"
          placeholder="Labeling rules, review expectations, or QA notes"
          rows={4}
          disabled={creatableOrganizations.length === 0}
        />
      </label>
      <button className="primary-button wide" type="submit" disabled={saving || creatableOrganizations.length === 0}>
        <FolderKanban size={18} />
        {saving ? "Creating" : "Create draft project"}
      </button>
    </form>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <article className="table-row project-head project-row">
      <span>
        <Link className="table-link" to={`/projects/${project.id}`}>
          {project.name}
        </Link>
        <small>{project.organization.name}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(project.accessMode)}</span>
        <small>{formatEnum(project.dataType)}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(project.status)}</span>
      </span>
      <span>
        {project.counts.members}
        {project.memberLimit ? ` / ${project.memberLimit}` : ""}
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
        accessMode: getFormValue(event, "accessMode"),
        memberLimit: parseNullableInteger(getFormValue(event, "memberLimit")),
        allowExternalMembers: new FormData(event.currentTarget).get("allowExternalMembers") === "on",
        joinCodeEnabled: new FormData(event.currentTarget).get("joinCodeEnabled") === "on",
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
      <label>
        Privacy
        <select name="accessMode" defaultValue={project.accessMode}>
          {projectAccessModes.map((mode) => (
            <option key={mode} value={mode}>
              {formatEnum(mode)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Member limit
        <input name="memberLimit" defaultValue={project.memberLimit ?? ""} min={1} placeholder="No limit" type="number" />
      </label>
      <label className="check-row">
        <input name="allowExternalMembers" type="checkbox" defaultChecked={project.allowExternalMembers} />
        Allow external members
      </label>
      <label className="check-row">
        <input name="joinCodeEnabled" type="checkbox" defaultChecked={project.joinCodeEnabled} />
        Enable join code
      </label>
      <div className="wide description-block">
        <span>Join code</span>
        <p>{project.joinCodeEnabled ? project.joinCode ?? "Will generate on save" : "Disabled"}</p>
      </div>
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

export function ProjectDetailPage() {
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
      <div className="page-actions">
        <Link className="secondary-button compact-button" to="/projects">
          <ArrowLeft size={16} />
          Back to projects
        </Link>
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
                <div>
                  <dt>Privacy</dt>
                  <dd>{formatEnum(project.accessMode)}</dd>
                </div>
                <div>
                  <dt>Members</dt>
                  <dd>
                    {project.counts.members}
                    {project.memberLimit ? ` / ${project.memberLimit}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>External access</dt>
                  <dd>{project.allowExternalMembers ? "Allowed" : "Organization only"}</dd>
                </div>
                <div>
                  <dt>Join code</dt>
                  <dd>{project.joinCodeEnabled ? project.joinCode ?? "Generating" : "Disabled"}</dd>
                </div>
              </dl>
            </section>
            <DatasetsTable
              action={
                <button className="primary-button" type="button" onClick={() => setShowDatasetModal(true)}>
                  <Database size={18} />
                  New dataset
                </button>
              }
              datasets={datasets}
              loading={datasetsLoading}
              projectScoped
            />
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

function parseOptionalInteger(value: string) {
  return value ? Number(value) : undefined;
}

function parseNullableInteger(value: string) {
  return value ? Number(value) : null;
}
