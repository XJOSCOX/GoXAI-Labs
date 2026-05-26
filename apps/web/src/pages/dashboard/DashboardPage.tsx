import { Activity, BriefcaseBusiness, Building2, CheckCircle2, ClipboardList, Clock3, Database, FolderKanban, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth";
import { useDatasets, useOrganizations, useProjects, useTaskStats } from "../../hooks/useResources";
import { formatDate, formatEnum } from "../../utils/format";

export function DashboardPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const { projects } = useProjects(session);
  const { datasets } = useDatasets(session);
  const { stats: taskStats } = useTaskStats(session);
  const primaryMembership = organizations[0]?.role ?? "Not assigned";
  const activeProjects = projects.filter((project) => project.status === "ACTIVE").length;
  const readyDatasets = datasets.filter((dataset) => dataset.status === "READY").length;
  const configuredDatasets = datasets.filter((dataset) => dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled)).length;
  const recentProjects = [...projects]
    .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime())
    .slice(0, 5);
  const recentDatasets = [...datasets]
    .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime())
    .slice(0, 5);
  const datasetNeedsTemplate = datasets.filter((dataset) => dataset.labels.length === 0 || !dataset.tools.some((tool) => tool.enabled)).length;

  return (
    <section className="page-stack dashboard-page">
      <div className="stat-grid dashboard-stat-grid">
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
          <Activity size={20} />
          <span>Active projects</span>
          <strong>{activeProjects}</strong>
        </article>
        <article className="stat-card">
          <BriefcaseBusiness size={20} />
          <span>Datasets</span>
          <strong>{datasets.length}</strong>
        </article>
        <article className="stat-card">
          <Database size={20} />
          <span>Ready datasets</span>
          <strong>{readyDatasets}</strong>
        </article>
        <article className="stat-card">
          <Layers3 size={20} />
          <span>Configured</span>
          <strong>{configuredDatasets}</strong>
        </article>
        <article className="stat-card">
          <ClipboardList size={20} />
          <span>Total tasks</span>
          <strong>{taskStats.total}</strong>
        </article>
        <article className="stat-card">
          <Clock3 size={20} />
          <span>Pending</span>
          <strong>{taskStats.pending}</strong>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div>
            <p className="eyebrow">Workflow</p>
            <h2>Task workload</h2>
          </div>
          <dl className="detail-list compact">
            <div>
              <dt>Active</dt>
              <dd>{taskStats.active}</dd>
            </div>
            <div>
              <dt>Done</dt>
              <dd>{taskStats.done}</dd>
            </div>
            <div>
              <dt>Unassigned</dt>
              <dd>{taskStats.unassigned}</dd>
            </div>
            <div>
              <dt>Need template</dt>
              <dd>{datasetNeedsTemplate}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <div>
            <p className="eyebrow">Access</p>
            <h2>Account summary</h2>
          </div>
          <dl className="detail-list compact">
            <div>
              <dt>Platform role</dt>
              <dd>{dbUser?.globalRole ? formatEnum(dbUser.globalRole) : "Unknown"}</dd>
            </div>
            <div>
              <dt>Organization role</dt>
              <dd>{formatEnum(primaryMembership)}</dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>{dbUser?.status ? formatEnum(dbUser.status) : "Unknown"}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>{organizations.reduce((total, organization) => total + organization.counts.members, 0)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel dashboard-list-panel">
          <div className="compact-panel-head">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>Recent project activity</h2>
            </div>
            <Link className="secondary-button compact-button" to="/projects">
              Open projects
            </Link>
          </div>
          <div className="dashboard-list">
            {recentProjects.length > 0 ? recentProjects.map((project) => (
              <Link className="dashboard-list-row" key={project.id} to={`/projects/${project.id}`}>
                <span>
                  <strong>{project.name}</strong>
                  <small>{formatEnum(project.dataType)} · {project.counts.datasets} datasets · {project.counts.tasks} tasks</small>
                </span>
                <em>{formatEnum(project.status)}</em>
              </Link>
            )) : (
              <p className="muted-copy">No projects yet.</p>
            )}
          </div>
        </section>

        <section className="panel dashboard-list-panel">
          <div className="compact-panel-head">
            <div>
              <p className="eyebrow">Datasets</p>
              <h2>Latest datasets</h2>
            </div>
            <Link className="secondary-button compact-button" to="/datasets">
              Open datasets
            </Link>
          </div>
          <div className="dashboard-list">
            {recentDatasets.length > 0 ? recentDatasets.map((dataset) => (
              <Link className="dashboard-list-row" key={dataset.id} to={`/datasets/${dataset.id}`}>
                <span>
                  <strong>{dataset.name}</strong>
                  <small>{dataset.project.name} · v{dataset.version} · updated {formatDate(dataset.updatedAt)}</small>
                </span>
                <em>{dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled) ? <CheckCircle2 size={14} /> : null}{formatEnum(dataset.status)}</em>
              </Link>
            )) : (
              <p className="muted-copy">No datasets yet.</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
