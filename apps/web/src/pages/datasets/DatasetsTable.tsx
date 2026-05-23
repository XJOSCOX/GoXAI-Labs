import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Database } from "lucide-react";
import type { DatasetSummary } from "../../api";
import { formatDate, formatEnum } from "../../utils/format";

export function DatasetsTable({
  action,
  datasets,
  loading,
  projectScoped = false
}: {
  action?: ReactNode;
  datasets: DatasetSummary[];
  loading: boolean;
  projectScoped?: boolean;
}) {
  const visibleDatasets = projectScoped
    ? datasets.filter((dataset) => dataset.canManage || dataset.status === "READY")
    : datasets;

  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <div>
          <p className="eyebrow">Datasets</p>
          <h2>{projectScoped ? "Project datasets" : "Dataset records"}</h2>
        </div>
        {action}
      </div>
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
      ) : visibleDatasets.length > 0 ? (
        visibleDatasets.map((dataset) => <DatasetRow dataset={dataset} key={dataset.id} projectScoped={projectScoped} />)
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
  const datasetTarget = dataset.canManage ? `/datasets/${dataset.id}` : `/tasks?datasetId=${dataset.id}`;

  return (
    <article className="table-row project-row">
      <span>
        <Link className="table-link" to={datasetTarget}>
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
