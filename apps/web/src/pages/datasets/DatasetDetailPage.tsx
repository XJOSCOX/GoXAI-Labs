import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Bot, ClipboardList, Download, Edit3, HardDrive, History, Save, Trash2, X } from "lucide-react";
import {
  archiveDataset,
  deleteDataset,
  getAssetAccessUrl,
  listDatasetVersions,
  restoreDataset,
  updateDataset,
  type AssetSummary,
  type DatasetSummary,
  type DatasetVersionSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { datasetStatuses } from "../../constants/options";
import { useAssets, useDataset, useTaskPage, useTaskStats } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";
import { AssetForm } from "../../features/datasets/detail/AssetForm";
import { DatasetAIPanel } from "../../features/datasets/detail/DatasetAIPanel";
import { DatasetExportsPanel } from "../../features/datasets/detail/DatasetExportsPanel";
import { DatasetTasksPanel } from "../../features/datasets/detail/DatasetTasksPanel";
import { DatasetVersionsPanel } from "../../features/datasets/detail/DatasetVersionsPanel";
import { AssetPreview, LargeAssetPreviewModal } from "../../features/datasets/detail/AssetPreview";
import { AssetsTable } from "../../features/datasets/detail/AssetsTable";
import { getCompletionPercent } from "../../features/datasets/detail/datasetDetailUtils";

const datasetTaskPageSize = 8;
type DatasetDetailView = "ai" | "assets" | "delivery" | "history" | "tasks";


function getDatasetDetailViews(dataset: DatasetSummary, aiEnabled: boolean): { icon: typeof ClipboardList; label: string; value: DatasetDetailView }[] {
  const views: { icon: typeof ClipboardList; label: string; value: DatasetDetailView }[] = [
    { icon: ClipboardList, label: "Tasks", value: "tasks" },
    { icon: Download, label: dataset.canManageAssets ? "Upload + export" : "Exports", value: "delivery" },
    { icon: HardDrive, label: "Assets", value: "assets" }
  ];

  if (aiEnabled) {
    views.splice(1, 0, { icon: Bot, label: "AI", value: "ai" });
  }

  if (dataset.canManageAssets) {
    views.push({ icon: History, label: "History", value: "history" });
  }

  return views;
}

function DatasetEditModal({
  dataset,
  onClose,
  onChanged,
  onDeleted,
  session,
  setPageError
}: {
  dataset: DatasetSummary;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setModalError(null);
    setPageError(null);

    if (!session) {
      setModalError("Authentication required.");
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
      onClose();
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "Unable to update dataset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    setMessage(null);
    setModalError(null);
    setPageError(null);

    if (!session) {
      setModalError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await archiveDataset(session, dataset.id);
      setMessage("Dataset archived.");
      await onChanged();
      onClose();
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "Unable to archive dataset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore() {
    setMessage(null);
    setModalError(null);
    setPageError(null);

    if (!session) {
      setModalError("Authentication required.");
      return;
    }

    setSaving(true);

    try {
      await restoreDataset(session, dataset.id);
      setMessage("Dataset restored.");
      await onChanged();
      onClose();
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "Unable to restore dataset.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setMessage(null);
    setModalError(null);
    setPageError(null);

    if (!session) {
      setModalError("Authentication required.");
      return;
    }

    const confirmed = window.confirm(
      "Delete this whole dataset? This permanently deletes its registered files and dataset tasks. This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      await deleteDataset(session, dataset.id);
      onDeleted();
    } catch (reason) {
      setModalError(reason instanceof Error ? reason.message : "Unable to delete dataset.");
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="dataset-edit-title"
        aria-modal="true"
        className="modal-panel dataset-edit-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Dataset</p>
            <h2 id="dataset-edit-title">Edit dataset</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dataset edit form">
            <X size={17} />
          </button>
        </div>
        {modalError && <p className="form-error">{modalError}</p>}
        <form className="dataset-form dataset-edit-form" onSubmit={handleUpdate}>
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
            <textarea name="description" defaultValue={dataset.description ?? ""} rows={4} />
          </label>
          {message && <p className="form-success wide">{message}</p>}
          <div className="row-actions wide">
            <button className="primary-button" type="submit" disabled={saving}>
              <Save size={18} />
              {saving ? "Saving" : "Save dataset"}
            </button>
            {dataset.status === "ARCHIVED" ? (
              <button className="secondary-button" type="button" onClick={handleRestore} disabled={saving}>
                Restore dataset
              </button>
            ) : (
              <button className="ghost-button danger-button" type="button" onClick={handleArchive} disabled={saving}>
                Archive dataset
              </button>
            )}
            <button className="ghost-button danger-button" type="button" onClick={handleDelete} disabled={saving}>
              <Trash2 size={17} />
              Delete dataset
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function DatasetDetailPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const { features, session } = useAuth();
  const [activeView, setActiveView] = useState<DatasetDetailView>("tasks");
  const [showEditModal, setShowEditModal] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<AssetSummary | null>(null);
  const [previewAccessUrl, setPreviewAccessUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const [largePreviewAsset, setLargePreviewAsset] = useState<AssetSummary | null>(null);
  const [largePreviewAccessUrl, setLargePreviewAccessUrl] = useState<string | null>(null);
  const [largePreviewError, setLargePreviewError] = useState<string | null>(null);
  const [largePreviewLoading, setLargePreviewLoading] = useState(false);
  const [versions, setVersions] = useState<DatasetVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const { dataset, error: datasetError, loading: datasetLoading, reload: reloadDataset } = useDataset(session, datasetId);
  const sessionAccessToken = session?.access_token;
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
    pageInfo: taskPageInfo,
    setError: setTasksError,
    tasks
  } = useTaskPage(session, { datasetId, page: taskPage, pageSize: datasetTaskPageSize });
  const { error: taskStatsError, reload: reloadTaskStats, stats: taskStats } = useTaskStats(session, { datasetId });

  async function reloadTaskResources() {
    await Promise.all([reloadTasks(), reloadTaskStats()]);
  }

  async function reloadVersions() {
    if (!session || !datasetId) {
      setVersions([]);
      return;
    }

    setVersionsLoading(true);
    setVersionsError(null);

    try {
      const result = await listDatasetVersions(session, datasetId);
      setVersions(result);
    } catch (reason) {
      setVersionsError(reason instanceof Error ? reason.message : "Unable to load dataset versions.");
    } finally {
      setVersionsLoading(false);
    }
  }

  useEffect(() => {
    setTaskPage(1);
    setActiveView("tasks");
  }, [datasetId]);

  useEffect(() => {
    void reloadVersions();
  }, [datasetId, sessionAccessToken]);

  useEffect(() => {
    if (dataset && !getDatasetDetailViews(dataset, features.aiEnabled).some((view) => view.value === activeView)) {
      setActiveView("tasks");
    }
  }, [activeView, dataset, features.aiEnabled]);

  async function handleInspectAsset(asset: AssetSummary) {
    setPreviewAsset(asset);
    setPreviewAccessUrl(null);
    setPreviewError(null);
    setAssetsError(null);

    if (!session) {
      setPreviewError("Authentication required.");
      return;
    }

    setPreviewLoading(true);

    try {
      const result = await getAssetAccessUrl(session, asset.id);
      setPreviewAccessUrl(result.accessUrl);
    } catch (reason) {
      setPreviewError(reason instanceof Error ? reason.message : "Unable to create asset preview URL.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleLargePreviewAsset(asset: AssetSummary) {
    setLargePreviewAsset(asset);
    setLargePreviewAccessUrl(null);
    setLargePreviewError(null);
    setAssetsError(null);

    if (!session) {
      setLargePreviewError("Authentication required.");
      return;
    }

    setLargePreviewLoading(true);

    try {
      const result = await getAssetAccessUrl(session, asset.id);
      setLargePreviewAccessUrl(result.accessUrl);
    } catch (reason) {
      setLargePreviewError(reason instanceof Error ? reason.message : "Unable to create asset preview URL.");
    } finally {
      setLargePreviewLoading(false);
    }
  }

  function clearAssetPreview() {
    setPreviewAsset(null);
    setPreviewAccessUrl(null);
    setPreviewError(null);
  }

  function clearLargeAssetPreview() {
    setLargePreviewAsset(null);
    setLargePreviewAccessUrl(null);
    setLargePreviewError(null);
  }

  function handleAssetsDeleted(input: { assetIds?: string[]; folderPrefix?: string }) {
    if (previewAsset && (input.assetIds?.includes(previewAsset.id) || (input.folderPrefix && previewAsset.objectKey.startsWith(input.folderPrefix)))) {
      clearAssetPreview();
    }

    if (
      largePreviewAsset &&
      (input.assetIds?.includes(largePreviewAsset.id) || (input.folderPrefix && largePreviewAsset.objectKey.startsWith(input.folderPrefix)))
    ) {
      clearLargeAssetPreview();
    }
  }

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="organization-detail-nav">
          <Link className="secondary-button compact-button" to="/datasets">
            <ArrowLeft size={16} />
            Back to datasets
          </Link>
        </div>
        {(datasetError ?? assetsError ?? tasksError ?? taskStatsError) && (
          <p className="form-error">{datasetError ?? assetsError ?? tasksError ?? taskStatsError}</p>
        )}
        {datasetLoading ? (
          <p className="muted-copy">Loading dataset details.</p>
        ) : dataset ? (
          <div className="dataset-detail-workspace">
            <section className="dataset-command-center compact">
              <article className="dataset-command-card dataset-command-card-primary">
                <div className="dataset-summary-head">
                  <div>
                    <p className="eyebrow">Dataset</p>
                    <h2>{dataset.name}</h2>
                  </div>
                  {dataset.canManage ? (
                    <button className="secondary-button compact-button" type="button" onClick={() => setShowEditModal(true)}>
                      <Edit3 size={16} />
                      Edit dataset
                    </button>
                  ) : null}
                </div>
                <dl className="dataset-command-meta">
                  <div>
                    <dt>Project</dt>
                    <dd>{dataset.project.name}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{formatEnum(dataset.status)}</dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>v{dataset.version}</dd>
                  </div>
                </dl>
              </article>
              <article className="dataset-command-card">
                <div className="dataset-progress-head compact">
                  <span>
                    <strong>{getCompletionPercent(taskStats.approved, taskStats.total)}%</strong>
                    <small>approved</small>
                  </span>
                  <div className="dataset-progress-track" aria-label="Approved task progress">
                    <span style={{ width: `${getCompletionPercent(taskStats.approved, taskStats.total)}%` }} />
                  </div>
                </div>
                <div className="dataset-progress-stats compact">
                  <span>
                    <strong>{taskStats.pending}</strong>
                    <small>Pending</small>
                  </span>
                  <span>
                    <strong>{taskStats.active}</strong>
                    <small>Active</small>
                  </span>
                  <span>
                    <strong>{taskStats.review}</strong>
                    <small>Review</small>
                  </span>
                  <span>
                    <strong>{taskStats.approved}</strong>
                    <small>Approved</small>
                  </span>
                  <span>
                    <strong>{taskStats.rejected}</strong>
                    <small>Rejected</small>
                  </span>
                </div>
              </article>
            </section>
            <nav className="dataset-detail-tabs" aria-label="Dataset detail sections">
              {getDatasetDetailViews(dataset, features.aiEnabled).map(({ icon: Icon, label, value }) => (
                <button className={activeView === value ? "active" : ""} key={value} onClick={() => setActiveView(value)} type="button">
                  <Icon size={16} />
                  {label}
                </button>
              ))}
            </nav>
            <section className="dataset-tab-panel">
              {activeView === "tasks" ? (
                <DatasetTasksPanel
                  activeTaskTotal={taskStats.active}
                  assetTotal={assets.length}
                  canGenerateTasks={dataset.canGenerateTasks}
                  dataset={dataset}
                  loading={tasksLoading}
                  onGenerated={async () => {
                    await reloadTaskResources();
                    await reloadVersions();
                  }}
                  onPageChange={setTaskPage}
                  pageInfo={taskPageInfo}
                  session={session}
                  setPageError={setTasksError}
                  taskTotal={taskStats.total}
                  tasks={tasks}
                />
              ) : null}
              {features.aiEnabled && activeView === "ai" ? (
                <DatasetAIPanel
                  dataset={dataset}
                  onImported={async () => {
                    await reloadTaskResources();
                  }}
                  session={session}
                  setPageError={setTasksError}
                />
              ) : null}
              {activeView === "delivery" ? (
                <div className={dataset.canManageAssets ? "dataset-delivery-view" : "dataset-delivery-view single"}>
                  {dataset.canManageAssets ? (
                    <AssetForm
                      assets={assets}
                      dataset={dataset}
                      onCreated={async () => {
                        await reloadAssets();
                        await reloadTaskResources();
                        await reloadVersions();
                      }}
                      session={session}
                      setPageError={setAssetsError}
                    />
                  ) : null}
                  <DatasetExportsPanel
                    canExport={dataset.canGenerateTasks}
                    dataset={dataset}
                    session={session}
                    setPageError={setTasksError}
                  />
                </div>
              ) : null}
              {activeView === "assets" ? (
                <div className={previewAsset ? "dataset-assets-view" : "dataset-assets-view single"}>
                  <AssetsTable
                    assets={assets}
                    canManageAssets={dataset.canManageAssets}
                    datasetId={dataset.id}
                    loading={assetsLoading}
                    onChanged={async () => {
                      await reloadAssets();
                      await reloadVersions();
                    }}
                    onDeleted={handleAssetsDeleted}
                    onInspectAsset={(asset) => {
                      void handleInspectAsset(asset);
                    }}
                    onPreviewAsset={(asset) => {
                      void handleLargePreviewAsset(asset);
                    }}
                    session={session}
                    setPageError={setAssetsError}
                  />
                  {previewAsset ? (
                    <AssetPreview
                      accessError={previewError}
                      accessLoading={previewLoading}
                      accessUrl={previewAccessUrl}
                      asset={previewAsset}
                      onClose={clearAssetPreview}
                    />
                  ) : null}
                </div>
              ) : null}
              {activeView === "history" && dataset.canManageAssets ? (
                <DatasetVersionsPanel
                  currentVersion={dataset.version}
                  datasetId={dataset.id}
                  loading={versionsLoading}
                  onRollback={async () => {
                    await Promise.all([reloadDataset(), reloadAssets(), reloadTaskResources(), reloadVersions()]);
                  }}
                  session={session}
                  setPageError={setTasksError}
                  versions={versions}
                  versionsError={versionsError}
                />
              ) : null}
            </section>
          </div>
        ) : !datasetError ? (
          <p className="muted-copy">Dataset was not found.</p>
        ) : null}
      </section>
      {dataset && dataset.canManage && showEditModal && (
        <DatasetEditModal
          dataset={dataset}
          onClose={() => setShowEditModal(false)}
          onChanged={async () => {
            await reloadDataset();
            await reloadVersions();
          }}
          onDeleted={() => navigate(`/projects/${dataset.projectId}`)}
          session={session}
          setPageError={setTasksError}
        />
      )}
      {largePreviewAsset && (
        <LargeAssetPreviewModal
          accessError={largePreviewError}
          accessLoading={largePreviewLoading}
          accessUrl={largePreviewAccessUrl}
          asset={largePreviewAsset}
          onClose={clearLargeAssetPreview}
        />
      )}
    </section>
  );
}


