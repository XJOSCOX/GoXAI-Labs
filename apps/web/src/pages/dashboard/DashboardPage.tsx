import { BriefcaseBusiness, Building2, ClipboardList, FolderKanban } from "lucide-react";
import { useAuth } from "../../auth";
import { useDatasets, useOrganizations, useProjects, useTasks } from "../../hooks/useResources";

export function DashboardPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const { projects } = useProjects(session);
  const { datasets } = useDatasets(session);
  const { tasks } = useTasks(session);
  const primaryMembership = organizations[0]?.role ?? "Not assigned";

  return (
    <section className="page-stack">
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
