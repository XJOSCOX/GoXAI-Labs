import { useState } from "react";
import { Database } from "lucide-react";
import { useAuth } from "../../auth";
import { useDatasets, useProjects } from "../../hooks/useResources";
import { DatasetCreateModal } from "./DatasetCreateModal";
import { DatasetsTable } from "./DatasetsTable";

export function DatasetsPage() {
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
      <DatasetsTable
        action={
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowDatasetModal(true)}
            disabled={projects.length === 0 || projectsLoading}
          >
            <Database size={18} />
            New dataset
          </button>
        }
        datasets={datasets}
        loading={datasetsLoading || projectsLoading}
      />
    </section>
  );
}
