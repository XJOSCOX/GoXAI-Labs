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
  const datasetCreateProjects = projects.filter((project) => project.canCreateDataset);

  return (
    <section className="page-stack">
      {(projectsError ?? datasetsError) && <p className="form-error">{projectsError ?? datasetsError}</p>}
      {showDatasetModal && datasetCreateProjects.length > 0 && (
        <DatasetCreateModal
          onClose={() => setShowDatasetModal(false)}
          onCreated={reloadDatasets}
          projects={datasetCreateProjects}
          session={session}
          setPageError={setDatasetsError}
        />
      )}
      <DatasetsTable
        action={
          datasetCreateProjects.length > 0 ? (
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowDatasetModal(true)}
              disabled={projectsLoading}
            >
              <Database size={18} />
              New dataset
            </button>
          ) : null
        }
        datasets={datasets}
        loading={datasetsLoading || projectsLoading}
      />
    </section>
  );
}
