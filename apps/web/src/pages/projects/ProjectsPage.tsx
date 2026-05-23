import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Database, FolderKanban, Save } from "lucide-react";
import { createProject, archiveProject, updateProject, type ProjectSummary } from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { projectStatuses } from "../../constants/options";
import { useDatasets, useFormDraft, useOrganizations, useProject, useProjects } from "../../hooks/useResources";
import { DatasetCreateModal } from "../datasets/DatasetCreateModal";
import { DatasetsTable } from "../datasets/DatasetsTable";
import { formatDate, formatEnum } from "../../utils/format";

export function ProjectsPage() {
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
      <div className="page-actions">
        <span />
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
        <Link className="back-link" to="/projects">
          Projects
        </Link>
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
