import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, CloudUpload, Download, Edit3, ExternalLink, Eye, FileText, FolderOpen, HardDrive, History, Maximize2, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import {
  archiveDataset,
  createAsset,
  createExportJob,
  createAssetUploadUrl,
  deleteAssets,
  deleteDataset,
  generateTasksFromDataset,
  getAssetAccessUrl,
  getExportDownloadUrl,
  listDatasetVersions,
  listExportJobs,
  logClientEvent,
  restoreDataset,
  rollbackDatasetVersion,
  updateDataset,
  uploadFileToSignedUrl,
  type AssetSummary,
  type DatasetSummary,
  type DatasetVersionSummary,
  type ExportFormat,
  type ExportJobSummary,
  type TaskSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { datasetStatuses, folderInputAttributes, maxBulkUploadBytes, maxBulkUploadFiles } from "../../constants/options";
import { useAssets, useDataset, useFormDraft, useTaskPage, useTaskStats } from "../../hooks/useResources";
import type { UploadProgress } from "../../types/upload";
import { formatAssetKind, formatBytes, formatDate, formatEnum, getUrlHost } from "../../utils/format";
import { buildUploadObjectKey, getFileKey, mergeFiles, toSafeObjectKeyPart } from "../../utils/upload";
import { TasksTable } from "../tasks/TasksPage";

const assetPageSize = 12;
const datasetTaskPageSize = 8;
const maxStructuredImportRows = 500;
const structuredImportExtensions = new Set(["csv", "json", "jsonl", "ndjson"]);

function DatasetTasksPanel({
  canGenerateTasks,
  dataset,
  loading,
  onGenerated,
  onPageChange,
  pageInfo,
  session,
  setPageError,
  taskTotal,
  tasks
}: {
  canGenerateTasks: boolean;
  dataset: DatasetSummary;
  loading: boolean;
  onGenerated: () => Promise<void>;
  onPageChange: (page: number) => void;
  pageInfo: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  taskTotal: number;
  tasks: TaskSummary[];
}) {
  const [generating, setGenerating] = useState(false);
  const [generationMode, setGenerationMode] = useState<"all" | "custom">("all");
  const [taskQuantity, setTaskQuantity] = useState("10");
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const normalizedQuantity = Number(taskQuantity);

    if (generationMode === "custom" && (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1)) {
      setPageError("Enter a whole number greater than 0 for custom task generation.");
      return;
    }

    setGenerating(true);

    try {
      const result = await generateTasksFromDataset(session, dataset.id, {
        quantity: generationMode === "custom" ? normalizedQuantity : undefined
      });
      setMessage(
        result.createdCount > 0
          ? `${result.createdCount} task${result.createdCount === 1 ? "" : "s"} generated.${
              result.remainingCount ? ` ${result.remainingCount} asset${result.remainingCount === 1 ? "" : "s"} still need tasks.` : ""
            }`
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
          <span>{taskTotal} task records for this dataset</span>
        </div>
        {canGenerateTasks ? (
          <div className="task-generator">
            <div className="task-generator-options" aria-label="Task generation quantity">
              <button
                className={generationMode === "all" ? "option-chip active" : "option-chip"}
                onClick={() => setGenerationMode("all")}
                type="button"
              >
                All
              </button>
              <button
                className={generationMode === "custom" ? "option-chip active" : "option-chip"}
                onClick={() => setGenerationMode("custom")}
                type="button"
              >
                Custom
              </button>
              {generationMode === "custom" && (
                <label className="task-quantity-field">
                  <span>Qty</span>
                  <input
                    min="1"
                    onChange={(event) => setTaskQuantity(event.currentTarget.value)}
                    step="1"
                    type="number"
                    value={taskQuantity}
                  />
                </label>
              )}
            </div>
            <button className="primary-button" type="button" onClick={handleGenerate} disabled={generating}>
              <ClipboardList size={18} />
              {generating ? "Generating" : "Generate tasks"}
            </button>
          </div>
        ) : null}
      </div>
      {message && <p className="form-success">{message}</p>}
      <TasksTable
        loading={loading}
        onChanged={onGenerated}
        onPageChange={onPageChange}
        pageInfo={pageInfo}
        session={session}
        setPageError={setPageError}
        tasks={tasks}
      />
    </section>
  );
}

function DatasetExportsPanel({
  canExport,
  dataset,
  session,
  setPageError
}: {
  canExport: boolean;
  dataset: DatasetSummary;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exports, setExports] = useState<ExportJobSummary[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("JSON");
  const [includeSourceFiles, setIncludeSourceFiles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const exportFormats = getDatasetExportFormats(dataset);
  const canIncludeSourceFiles = isSourceFileExportFormat(exportFormat);

  useEffect(() => {
    if (!exportFormats.some((format) => format.value === exportFormat)) {
      setExportFormat("JSON");
    }
  }, [dataset.id, exportFormat]);

  useEffect(() => {
    if (!canIncludeSourceFiles && includeSourceFiles) {
      setIncludeSourceFiles(false);
    }
  }, [canIncludeSourceFiles, includeSourceFiles]);

  async function reloadExports() {
    if (!session) {
      setExports([]);
      return;
    }

    setLoading(true);
    setPageError(null);

    try {
      setExports(await listExportJobs(session, { datasetId: dataset.id, projectId: dataset.projectId }));
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to load exports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadExports();
  }, [dataset.id, dataset.projectId, session?.access_token]);

  async function handleCreateExport() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setCreating(true);

    try {
      const exportJob = await createExportJob(session, {
        datasetId: dataset.id,
        format: exportFormat,
        includeSourceFiles: canIncludeSourceFiles ? includeSourceFiles : false,
        projectId: dataset.projectId
      });
      setExports((current) => [exportJob, ...current.filter((item) => item.id !== exportJob.id)]);
      setMessage(`${formatEnum(exportFormat)} export created.`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to create export.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDownload(exportJob: ExportJobSummary) {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setDownloadingId(exportJob.id);

    try {
      const result = await getExportDownloadUrl(session, exportJob.id);
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to download export.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <section className="panel export-panel">
      <div className="task-panel-head">
        <div>
          <p className="eyebrow">Delivery</p>
          <h2>Approved annotation exports</h2>
          <span>Approved tasks, accepted annotations, reviews, labels, and source asset references.</span>
        </div>
        {canExport ? (
          <div className="export-actions">
            <label>
              <span className="eyebrow">Format</span>
              <select value={exportFormat} onChange={(event) => setExportFormat(event.currentTarget.value as ExportFormat)}>
                {exportFormats.map((format) => (
                  <option key={format.value} value={format.value}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            {canIncludeSourceFiles ? (
              <label className="export-source-toggle">
                <input
                  checked={includeSourceFiles}
                  onChange={(event) => setIncludeSourceFiles(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>Include source files</span>
              </label>
            ) : null}
            <button className="primary-button" type="button" onClick={handleCreateExport} disabled={creating}>
              <Download size={18} />
              {creating ? "Exporting" : "Export"}
            </button>
          </div>
        ) : null}
      </div>
      {message && <p className="form-success">{message}</p>}
      <div className="export-list">
        {loading ? (
          <div className="compact-empty">
            <strong>Loading exports</strong>
            <span>Checking recent export jobs for this dataset.</span>
          </div>
        ) : exports.length > 0 ? (
          exports.map((exportJob) => (
            <article className="export-row" key={exportJob.id}>
              <div>
                <strong>{exportJob.outputAsset?.fileName ?? "Approved annotations export"}</strong>
                <span>
                  {formatEnum(exportJob.status)} · {formatDate(exportJob.createdAt)}
                  {exportJob.format ? ` · ${formatEnum(exportJob.format)}` : ""}
                  {exportJob.metadata && typeof exportJob.metadata.taskCount === "number" ? ` · ${exportJob.metadata.taskCount} tasks` : ""}
                </span>
                {exportJob.errorMessage && <span className="danger-copy">{exportJob.errorMessage}</span>}
              </div>
              <div className="row-actions compact">
                {exportJob.outputAsset ? <span className="muted-copy">{formatBytes(exportJob.outputAsset.fileSize)}</span> : null}
                <button
                  className="secondary-button compact-button"
                  disabled={!exportJob.outputAsset || downloadingId === exportJob.id}
                  onClick={() => {
                    void handleDownload(exportJob);
                  }}
                  type="button"
                >
                  <Download size={16} />
                  {downloadingId === exportJob.id ? "Opening" : "Download"}
                </button>
              </div>
            </article>
          ))
        ) : (
          <div className="compact-empty">
            <strong>No exports yet</strong>
            <span>Approve tasks first, then create an export for delivery, training, or backup.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function getDatasetExportFormats(dataset: DatasetSummary): { label: string; value: ExportFormat }[] {
  const formats: { label: string; value: ExportFormat }[] = [
    { label: "JSON", value: "JSON" },
    { label: "JSON_MIN", value: "JSON_MIN" },
    { label: "CSV", value: "CSV" },
    { label: "TSV", value: "TSV" }
  ];
  const enabledTools = new Set(dataset.tools.filter((tool) => tool.enabled).map((tool) => tool.tool.toUpperCase()));
  const configCode = typeof dataset.labelingConfig?.configCode === "string" ? dataset.labelingConfig.configCode : "";
  const hasImageSource = dataset.project.dataType.toUpperCase() === "IMAGE" || /<Image\b/i.test(configCode);
  const hasImageRegions = hasImageSource && (enabledTools.has("BBOX") || enabledTools.has("POLYGON"));
  const hasTextSource = dataset.project.dataType.toUpperCase() === "TEXT" || /<(Text|HyperText|Paragraphs|List|Chat)\b/i.test(configCode);
  const hasAudioSource = dataset.project.dataType.toUpperCase() === "AUDIO" || /<Audio\b/i.test(configCode);
  const hasTextAnswers = /<TextArea\b/i.test(configCode) || enabledTools.has("TEXT_AREA");

  if (hasImageRegions) {
    formats.push(
      { label: "COCO", value: "COCO" },
      { label: "YOLO", value: "YOLO" },
      { label: "Pascal VOC", value: "PASCAL_VOC" }
    );
  }

  if (hasTextSource && enabledTools.has("TEXT_SPAN")) {
    formats.push({ label: "CoNLL 2003", value: "CONLL_2003" });
  }

  if (hasAudioSource || hasTextAnswers) {
    formats.push({ label: "ASR JSONL", value: "ASR_JSONL" });
  }

  return formats;
}

function isSourceFileExportFormat(format: ExportFormat) {
  return format === "COCO" || format === "YOLO" || format === "PASCAL_VOC";
}

function DatasetVersionsPanel({
  currentVersion,
  datasetId,
  loading,
  onRollback,
  session,
  setPageError,
  versions,
  versionsError
}: {
  currentVersion: number;
  datasetId: string;
  loading: boolean;
  onRollback: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  versions: DatasetVersionSummary[];
  versionsError: string | null;
}) {
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);

  async function handleRollback(version: DatasetVersionSummary) {
    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const confirmed = window.confirm(
      `Rollback this dataset to v${version.version}? This creates a new version from that snapshot and keeps the history.`
    );

    if (!confirmed) {
      return;
    }

    setRollingBackVersion(version.version);
    setPageError(null);

    try {
      await rollbackDatasetVersion(session, datasetId, version.version);
      await onRollback();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to rollback dataset version.");
    } finally {
      setRollingBackVersion(null);
    }
  }

  return (
    <section className="panel dataset-version-panel">
      <div className="compact-panel-head">
        <div>
          <p className="eyebrow">Version history</p>
          <h3>Dataset snapshots</h3>
        </div>
        <History size={18} />
      </div>
      {versionsError ? <p className="form-error">{versionsError}</p> : null}
      {loading ? (
        <p className="muted-copy">Loading versions.</p>
      ) : versions.length > 0 ? (
        <div className="dataset-version-list">
          {versions.slice(0, 8).map((version) => {
            const isCurrent = version.version === currentVersion;
            const author = [version.createdBy?.firstName, version.createdBy?.lastName].filter(Boolean).join(" ") || version.createdBy?.email;

            return (
              <article className="dataset-version-row" key={version.id}>
                <div>
                  <strong>
                    v{version.version}
                    {isCurrent ? " Current" : ""}
                  </strong>
                  <span>
                    {formatDatasetVersionReason(version.summary.reason)}
                    {version.summary.restoredFromVersion ? ` from v${version.summary.restoredFromVersion}` : ""}
                  </span>
                  <small>
                    {version.summary.labelCount} labels / {version.summary.assetCount} assets / {version.summary.taskCount} tasks
                  </small>
                  <small>
                    {formatDate(version.createdAt)}
                    {author ? ` / ${author}` : ""}
                  </small>
                </div>
                <button
                  className="icon-button"
                  disabled={isCurrent || rollingBackVersion === version.version}
                  onClick={() => {
                    void handleRollback(version);
                  }}
                  title={isCurrent ? "Current version" : `Rollback to v${version.version}`}
                  type="button"
                >
                  <RotateCcw size={16} />
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="compact-empty">
          <strong>No snapshots yet</strong>
          <span>Changes to templates, assets, and generated tasks will appear here.</span>
        </div>
      )}
    </section>
  );
}

function formatDatasetVersionReason(reason: string) {
  const labels: Record<string, string> = {
    asset_registered: "Asset added",
    assets_deleted: "Assets deleted",
    dataset_created: "Dataset created",
    dataset_details_updated: "Details updated",
    rollback: "Rollback",
    tasks_generated: "Tasks generated",
    template_config_updated: "Template updated"
  };

  return labels[reason] ?? formatEnum(reason);
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
  const { session } = useAuth();
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
  }, [datasetId]);

  useEffect(() => {
    void reloadVersions();
  }, [datasetId, session]);

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
          <div className="dataset-detail-layout">
            <section className="content-column">
              <section className="panel">
                <div className="dataset-summary-head">
                  <div>
                    <p className="eyebrow">Dataset</p>
                    <h2>{dataset.name}</h2>
                  </div>
                  {dataset.canManage ? (
                    <div className="row-actions compact">
                      <Link className="secondary-button compact-button" to={`/datasets/${dataset.id}/label-config`}>
                        <ClipboardList size={16} />
                        Template
                      </Link>
                      <button className="secondary-button compact-button" type="button" onClick={() => setShowEditModal(true)}>
                        <Edit3 size={16} />
                        Edit dataset
                      </button>
                    </div>
                  ) : null}
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
                  <div>
                    <dt>Tasks</dt>
                    <dd>
                      {taskStats.total} / {assets.length}
                    </dd>
                  </div>
                  <div>
                    <dt>Template</dt>
                    <dd>{dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled) ? "Applied" : "Required"}</dd>
                  </div>
                </dl>
              </section>
              <DatasetTasksPanel
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
              <DatasetExportsPanel
                canExport={dataset.canGenerateTasks}
                dataset={dataset}
                session={session}
                setPageError={setTasksError}
              />
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
            </section>
            <aside className="side-column">
              {previewAsset && (
                <AssetPreview
                  accessError={previewError}
                  accessLoading={previewLoading}
                  accessUrl={previewAccessUrl}
                  asset={previewAsset}
                  onClose={clearAssetPreview}
                />
              )}
              {dataset.canManageAssets ? (
                <>
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
                </>
              ) : null}
              {dataset.canManageAssets ? (
                <AssetForm
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
            </aside>
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

async function uploadAndRegisterAsset(
  session: NonNullable<ReturnType<typeof useAuth>["session"]>,
  datasetId: string,
  file: File,
  objectKey?: string,
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void,
  metadata?: Record<string, unknown>
) {
  const imageDimensions = await readImageDimensions(file);
  const signedUpload = await createAssetUploadUrl(session, {
    datasetId,
    objectKey,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size.toString()
  });

  try {
    await uploadFileToSignedUrl(file, signedUpload.upload, onProgress);
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

  return createAsset(session, {
    ...signedUpload.asset,
    height: imageDimensions ? String(imageDimensions.height) : undefined,
    width: imageDimensions ? String(imageDimensions.width) : undefined,
    metadata
  });
}

async function readImageDimensions(file: File) {
  if (!file.type.startsWith("image/")) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    const loaded = new Promise<{ height: number; width: number } | null>((resolve) => {
      image.onload = () => {
        resolve({
          height: image.naturalHeight,
          width: image.naturalWidth
        });
      };
      image.onerror = () => resolve(null);
    });

    image.src = objectUrl;
    const dimensions = await loaded;

    return dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions : null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  const [textEntry, setTextEntry] = useState("");
  const [textEntryTitle, setTextEntryTitle] = useState("");
  const [uploadFolder, setUploadFolder] = useState(`datasets/v${dataset.version}`);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [renamePrefix, setRenamePrefix] = useState(toSafeObjectKeyPart(dataset.name) || "asset");
  const assetDraft = useFormDraft(`goxai-draft-asset-${dataset.id}`);
  const selectedFilesRef = useRef<File[]>([]);
  const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
  const datasetBindings = getDatasetBindings(dataset.labelingConfig);
  const textSources = getDatasetTextSources(dataset.labelingConfig);
  const primaryTextSource = textSources[0] ?? null;

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
          throw new Error(`Upload up to ${maxBulkUploadFiles} files at once. For larger batches, split files into multiple folders and upload them separately.`);
        }

        if (batchBytes > maxBulkUploadBytes) {
          throw new Error(`Upload up to ${formatBytes(String(maxBulkUploadBytes))} per batch.`);
        }

        const structuredFiles = selectedFiles.filter(isStructuredImportFile);

        if (datasetBindings.length > 0 && structuredFiles.length > 0) {
          if (structuredFiles.length !== selectedFiles.length) {
            throw new Error("Import CSV, JSON, and JSONL row files separately from regular asset files.");
          }

          const importedCounts: number[] = [];

          for (const file of structuredFiles) {
            const result = await importStructuredRowsFromFile(file);
            importedCounts.push(result.uploadedCount);
          }

          const importedTotal = importedCounts.reduce((total, count) => total + count, 0);

          setSelectedFiles([]);
          form.reset();
          assetDraft.clearDraft();
          setSavedMessage(`${importedTotal} row${importedTotal === 1 ? "" : "s"} imported as task data.`);
          await onCreated();
          return;
        }

        setUploadProgress({
          completed: 0,
          currentFile: selectedFiles[0]?.name ?? "",
          failed: 0,
          currentFilePercent: 0,
          currentLoadedBytes: 0,
          currentTotalBytes: selectedFiles[0]?.size ?? 0,
          status: "uploading",
          total: selectedFiles.length
        });

        for (const [index, file] of selectedFiles.entries()) {
          setUploadProgress({
            completed: uploaded.length,
            currentFile: file.webkitRelativePath || file.name,
            failed: failed.length,
            currentFilePercent: 0,
            currentLoadedBytes: 0,
            currentTotalBytes: file.size,
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
                }),
                (progress) => {
                  setUploadProgress({
                    completed: uploaded.length,
                    currentFile: file.webkitRelativePath || file.name,
                    currentFilePercent: progress.percent,
                    currentLoadedBytes: progress.loaded,
                    currentTotalBytes: progress.total,
                    failed: failed.length,
                    status: "uploading",
                    total: selectedFiles.length
                  });
                }
              )
            );
          } catch (reason) {
            failed.push(`${file.name}: ${reason instanceof Error ? reason.message : "Upload failed."}`);
          }

          setUploadProgress({
            completed: uploaded.length,
            currentFile: selectedFiles[index + 1]?.webkitRelativePath || selectedFiles[index + 1]?.name || file.name,
            failed: failed.length,
            currentFilePercent: 100,
            currentLoadedBytes: file.size,
            currentTotalBytes: file.size,
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
          currentFilePercent: failed.length > 0 ? undefined : 100,
          currentLoadedBytes: undefined,
          currentTotalBytes: undefined,
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

  async function handleCreateTextAsset() {
    setSavedMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    if (!primaryTextSource) {
      setPageError("This dataset template does not expose a text source like $text.");
      return;
    }

    const text = textEntry.trim();

    if (!text) {
      setPageError("Paste the text for this task first.");
      return;
    }

    const title = textEntryTitle.trim() || `${primaryTextSource.binding}-task`;
    const fileName = `${toSafeObjectKeyPart(title) || "text-task"}-${Date.now()}.txt`;
    const file = new File([text], fileName, { type: "text/plain;charset=utf-8" });

    setSaving(true);
    setUploadProgress({
      completed: 0,
      currentFile: file.name,
      failed: 0,
      currentFilePercent: 0,
      currentLoadedBytes: 0,
      currentTotalBytes: file.size,
      status: "uploading",
      total: 1
    });

    try {
      await uploadAndRegisterAsset(
        session,
        dataset.id,
        file,
        buildUploadObjectKey(file, {
          folder: `datasets/v${dataset.version}/text`,
          prefix: toSafeObjectKeyPart(title) || primaryTextSource.binding,
          rename: true
        }),
        (progress) => {
          setUploadProgress({
            completed: 0,
            currentFile: file.name,
            currentFilePercent: progress.percent,
            currentLoadedBytes: progress.loaded,
            currentTotalBytes: progress.total,
            failed: 0,
            status: "uploading",
            total: 1
          });
        },
        {
          data: {
            [primaryTextSource.binding]: text
          },
          source: "text-entry",
          sourceName: primaryTextSource.name,
          valueType: "text",
          [primaryTextSource.binding]: text
        }
      );

      setTextEntry("");
      setTextEntryTitle("");
      setSavedMessage("Text task data was added.");
      setUploadProgress({
        completed: 1,
        currentFile: "",
        failed: 0,
        currentFilePercent: 100,
        currentLoadedBytes: file.size,
        currentTotalBytes: file.size,
        status: "complete",
        total: 1
      });
      await onCreated();
    } catch (reason) {
      setUploadProgress((current) => current ? { ...current, status: "error" } : null);
      setPageError(reason instanceof Error ? reason.message : "Unable to add text task data.");
    } finally {
      setSaving(false);
    }
  }

  async function importStructuredRowsFromFile(file: File) {
    if (!session) {
      throw new Error("Authentication required.");
    }

    const rows = await parseStructuredImportFile(file);

    if (rows.length === 0) {
      throw new Error("No rows were found in that file.");
    }

    if (rows.length > maxStructuredImportRows) {
      throw new Error(`Import up to ${maxStructuredImportRows} rows at once for now. Split larger files into smaller batches.`);
    }

    const missingBindings = datasetBindings.filter((binding) => rows.every((row) => row[binding] === undefined || row[binding] === null || row[binding] === ""));

    if (missingBindings.length > 0) {
      throw new Error(`Missing template column${missingBindings.length === 1 ? "" : "s"}: ${missingBindings.join(", ")}.`);
    }

    const uploaded: AssetSummary[] = [];
    const failed: string[] = [];
    const importName = toSafeObjectKeyPart(file.name.replace(/\.[^.]+$/, "")) || "structured-import";

    setUploadProgress({
      completed: 0,
      currentFile: file.name,
      failed: 0,
      currentFilePercent: 0,
      currentLoadedBytes: 0,
      currentTotalBytes: file.size,
      status: "uploading",
      total: rows.length
    });

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 1;
      const rowTitle = getStructuredRowTitle(row, datasetBindings, rowNumber);
      const rowFileName = `${importName}-row-${String(rowNumber).padStart(4, "0")}.json`;
      const rowPayload = {
        data: row,
        importFileName: file.name,
        rowNumber,
        templateBindings: datasetBindings
      };
      const rowFile = new File([JSON.stringify(rowPayload, null, 2)], rowFileName, { type: "application/json" });

      setUploadProgress({
        completed: uploaded.length,
        currentFile: rowFileName,
        failed: failed.length,
        currentFilePercent: 0,
        currentLoadedBytes: 0,
        currentTotalBytes: rowFile.size,
        status: "uploading",
        total: rows.length
      });

      try {
        uploaded.push(
          await uploadAndRegisterAsset(
            session,
            dataset.id,
            rowFile,
            buildUploadObjectKey(rowFile, {
              folder: `datasets/v${dataset.version}/rows/${importName}`,
              prefix: `${importName}-row-${rowNumber}`,
              rename: true
            }),
            (progress) => {
              setUploadProgress({
                completed: uploaded.length,
                currentFile: rowFileName,
                currentFilePercent: progress.percent,
                currentLoadedBytes: progress.loaded,
                currentTotalBytes: progress.total,
                failed: failed.length,
                status: "uploading",
                total: rows.length
              });
            },
            {
              data: row,
              importFileName: file.name,
              rowNumber,
              rowTitle,
              source: "structured-import",
              templateBindings: datasetBindings
            }
          )
        );
      } catch (reason) {
        failed.push(`Row ${rowNumber}: ${reason instanceof Error ? reason.message : "Upload failed."}`);
      }
    }

    setUploadProgress({
      completed: uploaded.length,
      currentFile: "",
      failed: failed.length,
      currentFilePercent: failed.length > 0 ? undefined : 100,
      currentLoadedBytes: undefined,
      currentTotalBytes: undefined,
      status: failed.length > 0 ? "error" : "complete",
      total: rows.length
    });

    if (failed.length > 0) {
      setPageError(failed.slice(0, 3).join(" "));
    }

    if (uploaded.length === 0) {
      throw new Error("No rows imported. Check the first error and try again.");
    }

    return {
      failedCount: failed.length,
      uploadedCount: uploaded.length
    };
  }

  async function handleImportStructuredFile(file: File | null) {
    setSavedMessage(null);
    setPageError(null);

    if (!file) {
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    if (datasetBindings.length === 0) {
      setPageError("Choose a template before importing structured task data.");
      return;
    }

    setSaving(true);

    try {
      const result = await importStructuredRowsFromFile(file);
      setSavedMessage(`${result.uploadedCount} row${result.uploadedCount === 1 ? "" : "s"} imported as task data.`);
      await onCreated();
    } catch (reason) {
      setUploadProgress((current) => current ? { ...current, status: "error" } : null);
      setPageError(reason instanceof Error ? reason.message : "Unable to import structured task data.");
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
      setPageError(
        `Only ${maxBulkUploadFiles} files are allowed in one upload. Extra files were not added. For larger datasets, create multiple folders and upload one folder at a time.`
      );
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
      {primaryTextSource && (
        <section className="text-asset-entry wide">
          <div>
            <p className="eyebrow">Text task data</p>
            <h3>Add text for {primaryTextSource.binding}</h3>
            <p className="muted-copy">
              This dataset template reads from ${primaryTextSource.binding}. Paste the source text here, then generate tasks from the dataset.
            </p>
          </div>
          <label>
            Title
            <input
              onChange={(event) => setTextEntryTitle(event.target.value)}
              placeholder="Article, document, or prompt title"
              value={textEntryTitle}
            />
          </label>
          <label>
            Source text
            <textarea
              onChange={(event) => setTextEntry(event.target.value)}
              placeholder="Paste the text the annotator should summarize, classify, or answer from..."
              rows={8}
              value={textEntry}
            />
          </label>
          <div className="asset-row-actions">
            <span className="muted-copy">{textEntry.trim().length.toLocaleString()} characters</span>
            <button className="primary-button" disabled={saving || !textEntry.trim()} onClick={handleCreateTextAsset} type="button">
              <FileText size={16} />
              Add text data
            </button>
          </div>
        </section>
      )}
      {datasetBindings.length > 0 && (
        <section className="text-asset-entry wide">
          <div>
            <p className="eyebrow">Structured import</p>
            <h3>Import CSV, JSON, or JSONL rows</h3>
            <p className="muted-copy">
              Each row becomes one task data asset. You can also pick these files from bulk upload. Required columns: {datasetBindings.map((binding) => `$${binding}`).join(", ")}.
            </p>
          </div>
          <div className="structured-import-row">
            <label className="secondary-button file-picker-button">
              <FileText size={16} />
              Import rows
              <input
                accept=".csv,.json,.jsonl,application/json,text/csv,application/x-ndjson"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  event.currentTarget.value = "";
                  void handleImportStructuredFile(file);
                }}
                type="file"
              />
            </label>
            <span className="muted-copy">Up to {maxStructuredImportRows} rows per import.</span>
          </div>
        </section>
      )}
      <div className="drop-zone wide">
        <CloudUpload size={22} />
        <strong>Drop images or files here</strong>
        <span>Choose up to {maxBulkUploadFiles} files at once, or choose a folder to keep the folder paths in R2.</span>
        <small>For more than {maxBulkUploadFiles} images, split them into multiple folders and upload each folder separately.</small>
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
      {uploadProgress && (
        <UploadProgressPanel progress={uploadProgress} />
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
  const currentPercent = progress.status === "uploading" ? progress.currentFilePercent ?? 0 : progress.currentFilePercent ?? percent;
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
      {progress.status === "uploading" && (
        <div
          className="progress-track current-file-track"
          aria-label="Current file upload progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={currentPercent}
          role="progressbar"
        >
          <span style={{ width: `${currentPercent}%` }} />
        </div>
      )}
      <div className="upload-progress-meta">
        <span>{progress.completed} uploaded</span>
        <span>{progress.failed} failed</span>
      </div>
      {progress.currentFile && (
        <p className="muted-copy">
          Current: {progress.currentFile}
          {progress.currentLoadedBytes !== undefined && progress.currentTotalBytes
            ? ` (${formatBytes(String(progress.currentLoadedBytes))} / ${formatBytes(String(progress.currentTotalBytes))})`
            : ""}
        </p>
      )}
    </div>
  );
}

function AssetsTable({
  assets,
  canManageAssets,
  datasetId,
  loading,
  onChanged,
  onDeleted,
  onInspectAsset,
  onPreviewAsset,
  session,
  setPageError
}: {
  assets: AssetSummary[];
  canManageAssets: boolean;
  datasetId: string;
  loading: boolean;
  onChanged: () => Promise<void>;
  onDeleted: (input: { assetIds?: string[]; folderPrefix?: string }) => void;
  onInspectAsset: (asset: AssetSummary) => void;
  onPreviewAsset: (asset: AssetSummary) => void;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [deleting, setDeleting] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [folderPrefix, setFolderPrefix] = useState("");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = normalizedQuery
    ? assets.filter((asset) =>
        [asset.fileName, asset.objectKey, asset.mimeType, asset.provider]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : assets;
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / assetPageSize));
  const pageStart = (currentPage - 1) * assetPageSize;
  const pageAssets = filteredAssets.slice(pageStart, pageStart + assetPageSize);
  const pageEnd = pageStart + pageAssets.length;
  const visiblePageStart = filteredAssets.length > 0 ? pageStart + 1 : 0;
  const totalBytes = assets.reduce((total, asset) => total + Number(asset.fileSize || 0), 0);
  const folderOptions = [
    ...new Set(assets.map((asset) => getAssetFolderPrefix(asset.objectKey)).filter((prefix) => prefix.length > 0))
  ].sort();
  const selectedPageAssets = pageAssets.filter((asset) => selectedAssetIds.includes(asset.id));
  const selectedPageCount = selectedPageAssets.length;
  const allPageSelected = pageAssets.length > 0 && pageAssets.every((asset) => selectedAssetIds.includes(asset.id));

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedQuery, assets.length]);

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  function toggleAsset(assetId: string, checked: boolean) {
    if (!canManageAssets) {
      return;
    }

    setSelectedAssetIds((current) =>
      checked ? [...new Set([...current, assetId])] : current.filter((selectedId) => selectedId !== assetId)
    );
  }

  function toggleVisibleAssets(checked: boolean) {
    if (!canManageAssets) {
      return;
    }

    const visibleIds = pageAssets.map((asset) => asset.id);

    setSelectedAssetIds((current) =>
      checked ? [...new Set([...current, ...visibleIds])] : current.filter((selectedId) => !visibleIds.includes(selectedId))
    );
  }

  async function handleDeleteSelected() {
    if (selectedAssetIds.length === 0 || deleting) {
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedAssetIds.length} selected registered file${selectedAssetIds.length === 1 ? "" : "s"} from R2 and this dataset?`
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      const deletedAssetIds = selectedAssetIds;
      const result = await deleteAssets(session, { assetIds: deletedAssetIds });
      setSelectedAssetIds([]);
      onDeleted({ assetIds: deletedAssetIds });
      await onChanged();
      setDeleteMessage(`Deleted ${result.deletedCount} registered file${result.deletedCount === 1 ? "" : "s"}.`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete selected files.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteOne(asset: AssetSummary) {
    if (!session || deleting) {
      setPageError(session ? null : "Authentication required.");
      return;
    }

    const confirmed = window.confirm(`Delete ${asset.fileName} from R2 and this dataset?`);

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      await deleteAssets(session, { assetIds: [asset.id] });
      setSelectedAssetIds((current) => current.filter((assetId) => assetId !== asset.id));
      onDeleted({ assetIds: [asset.id] });
      await onChanged();
      setDeleteMessage("File deleted.");
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete file.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeleteFolder() {
    if (!folderPrefix || deleting) {
      return;
    }

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const matchingCount = assets.filter((asset) => asset.objectKey.startsWith(folderPrefix)).length;
    const confirmed = window.confirm(
      `Delete ${matchingCount} registered file${matchingCount === 1 ? "" : "s"} from folder ${folderPrefix}? This only deletes registered files you can manage.`
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);
    setDeleteMessage(null);
    setPageError(null);

    try {
      const result = await deleteAssets(session, { datasetId, folderPrefix });
      setFolderPrefix("");
      setSelectedAssetIds([]);
      onDeleted({ folderPrefix });
      await onChanged();
      setDeleteMessage(`Deleted ${result.deletedCount} registered file${result.deletedCount === 1 ? "" : "s"} from ${folderPrefix}.`);
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to delete folder files.");
    } finally {
      setDeleting(false);
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
        <div className="asset-toolbar-actions">
          {canManageAssets && selectedAssetIds.length > 0 && (
            <button className="ghost-button danger-button compact-button" type="button" onClick={handleDeleteSelected} disabled={deleting}>
              <Trash2 size={16} />
              Delete selected ({selectedAssetIds.length})
            </button>
          )}
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files, keys, or MIME types"
            />
          </label>
        </div>
      </div>
      {canManageAssets && folderOptions.length > 0 && (
        <div className="folder-delete-bar">
          <label>
            Delete registered folder
            <select value={folderPrefix} onChange={(event) => setFolderPrefix(event.target.value)}>
              <option value="">Choose folder prefix</option>
              {folderOptions.map((prefix) => (
                <option key={prefix} value={prefix}>
                  {prefix}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost-button danger-button compact-button" type="button" onClick={handleDeleteFolder} disabled={!folderPrefix || deleting}>
            <Trash2 size={16} />
            Delete folder files
          </button>
        </div>
      )}
      {deleteMessage && <p className="form-success">{deleteMessage}</p>}
      <section className="table-panel">
        <div className="table-row assets-head table-head">
          <span>
            {canManageAssets ? (
              <input
                aria-label="Select assets on this page"
                checked={allPageSelected}
                disabled={pageAssets.length === 0}
                onChange={(event) => toggleVisibleAssets(event.currentTarget.checked)}
                type="checkbox"
              />
            ) : null}
          </span>
          <span>File</span>
          <span>Type</span>
          <span>Size</span>
          <span>Action</span>
        </div>
        {selectedPageCount > 0 && (
          <div className="selection-summary">
            {selectedPageCount} file{selectedPageCount === 1 ? "" : "s"} selected on this page.
          </div>
        )}
        {loading ? (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>Loading assets</strong>
            <span>Checking registered R2 objects for this dataset.</span>
          </div>
        ) : filteredAssets.length > 0 ? (
          pageAssets.map((asset) => (
            <AssetRow
              asset={asset}
              canManageAssets={canManageAssets}
              checked={selectedAssetIds.includes(asset.id)}
              key={asset.id}
              onDelete={() => {
                void handleDeleteOne(asset);
              }}
              onInspect={() => {
                onInspectAsset(asset);
              }}
              onPreview={() => {
                onPreviewAsset(asset);
              }}
              onToggle={(checked) => toggleAsset(asset.id, checked)}
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
        {filteredAssets.length > assetPageSize && (
          <div className="pagination-bar">
            <span>
              Showing {visiblePageStart}-{pageEnd} of {filteredAssets.length}
            </span>
            <div>
              <button
                className="secondary-button compact-button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="secondary-button compact-button"
                disabled={currentPage === pageCount}
                onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}

function AssetRow({
  asset,
  canManageAssets,
  checked,
  onDelete,
  onInspect,
  onPreview,
  onToggle
}: {
  asset: AssetSummary;
  canManageAssets: boolean;
  checked: boolean;
  onDelete: () => void;
  onInspect: () => void;
  onPreview: () => void;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <article className="table-row assets-head project-row">
      <span>
        {canManageAssets ? (
          <input
            aria-label={`Select ${asset.fileName}`}
            checked={checked}
            onChange={(event) => onToggle(event.currentTarget.checked)}
            type="checkbox"
          />
        ) : null}
      </span>
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
        <div className="asset-row-actions">
          <button className="icon-button asset-action-button" type="button" onClick={onInspect} aria-label="Quick preview" title="Quick preview">
            <Eye size={16} />
          </button>
          <button className="icon-button asset-action-button" type="button" onClick={onPreview} aria-label="Preview" title="Preview">
            <Maximize2 size={16} />
          </button>
          {canManageAssets ? (
            <button className="icon-button asset-action-button danger-action-button" type="button" onClick={onDelete} aria-label="Delete" title="Delete">
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </span>
    </article>
  );
}

function getAssetFolderPrefix(objectKey: string) {
  const slashIndex = objectKey.lastIndexOf("/");

  return slashIndex > -1 ? objectKey.slice(0, slashIndex + 1) : "";
}

function getDatasetBindings(config: DatasetSummary["labelingConfig"]) {
  const configCode = typeof config?.configCode === "string" ? config.configCode : "";
  return Array.from(new Set(Array.from(configCode.matchAll(/\b(?:value|valueList)="\$([^"]+)"/g)).map((match) => match[1]).filter(Boolean)));
}

function getDatasetTextSources(config: DatasetSummary["labelingConfig"]) {
  const configCode = typeof config?.configCode === "string" ? config.configCode : "";
  const sources: { binding: string; name: string }[] = [];
  const textTagPattern = /<(Text|HyperText|Paragraphs|List|Chat)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = textTagPattern.exec(configCode))) {
    const attributes = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const value = getXmlAttribute(attributes, "value") ?? getXmlAttribute(attributes, "valueList");

    if (!name || !value?.startsWith("$")) {
      continue;
    }

    sources.push({
      binding: value.slice(1),
      name
    });
  }

  return sources;
}

function getXmlAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function isStructuredImportFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return structuredImportExtensions.has(extension) || ["application/json", "application/x-ndjson", "text/csv"].includes(file.type);
}

async function parseStructuredImportFile(file: File) {
  const text = await file.text();
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv" || file.type === "text/csv") {
    return parseCsvRows(text);
  }

  if (extension === "jsonl" || extension === "ndjson") {
    return parseJsonLines(text);
  }

  return parseJsonRows(text);
}

function parseJsonRows(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.data)
      ? parsed.data
      : isRecord(parsed)
        ? [parsed]
        : [];

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`JSON row ${index + 1} must be an object.`);
    }

    return row;
  });
}

function parseJsonLines(text: string): Record<string, unknown>[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as unknown;

      if (!isRecord(parsed)) {
        throw new Error(`JSONL line ${index + 1} must be an object.`);
      }

      return parsed;
    });
}

function parseCsvRows(text: string): Record<string, unknown>[] {
  const rows = parseCsvTable(text);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());

  if (headers.some((header) => !header)) {
    throw new Error("CSV headers cannot be empty.");
  }

  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });

    return record;
  });
}

function parseCsvTable(text: string) {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function getStructuredRowTitle(row: Record<string, unknown>, bindings: string[], rowNumber: number) {
  const titleValue = row.title ?? row.name ?? row.id ?? bindings.map((binding) => row[binding]).find((value) => typeof value === "string" && value.trim());

  return typeof titleValue === "string" && titleValue.trim()
    ? titleValue.trim().slice(0, 80)
    : `Row ${rowNumber}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function LargeAssetPreviewModal({
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
    <div className="modal-backdrop image-preview-backdrop" onMouseDown={onClose}>
      <section
        aria-label={`${asset.fileName} preview`}
        aria-modal="true"
        className="modal-panel image-preview-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="icon-button image-preview-close" type="button" onClick={onClose} aria-label="Close preview">
          <X size={20} />
        </button>
        {accessLoading ? (
          <span className="muted-copy">Creating signed preview URL.</span>
        ) : accessError ? (
          <p className="form-error">{accessError}</p>
        ) : accessUrl && isImage ? (
          <img alt={asset.fileName} src={accessUrl} />
        ) : (
          <div className="empty-state">
            <FileText size={28} />
            <strong>Image preview unavailable</strong>
            <span>This preview modal is built for image files.</span>
          </div>
        )}
      </section>
    </div>
  );
}
