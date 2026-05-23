import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, CloudUpload, Edit3, ExternalLink, Eye, FileText, FolderOpen, HardDrive, Maximize2, Save, Search, Trash2, X } from "lucide-react";
import {
  archiveDataset,
  createAsset,
  createAssetUploadUrl,
  deleteAssets,
  deleteDataset,
  generateTasksFromDataset,
  getAssetAccessUrl,
  logClientEvent,
  restoreDataset,
  updateDataset,
  uploadFileToSignedUrl,
  type AssetSummary,
  type DatasetSummary,
  type TaskSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { datasetStatuses, folderInputAttributes, maxBulkUploadBytes, maxBulkUploadFiles } from "../../constants/options";
import { useAssets, useDataset, useFormDraft, useTasks } from "../../hooks/useResources";
import type { UploadProgress } from "../../types/upload";
import { formatAssetKind, formatBytes, formatDate, formatEnum, getUrlHost } from "../../utils/format";
import { buildUploadObjectKey, getFileKey, mergeFiles, toSafeObjectKeyPart } from "../../utils/upload";
import { TasksTable } from "../tasks/TasksPage";

const assetPageSize = 12;

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
          <span>{tasks.length} task records for this dataset</span>
        </div>
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
      </div>
      {message && <p className="form-success">{message}</p>}
      <TasksTable loading={loading} onChanged={onGenerated} session={session} setPageError={setPageError} tasks={tasks} />
    </section>
  );
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
  const [largePreviewAsset, setLargePreviewAsset] = useState<AssetSummary | null>(null);
  const [largePreviewAccessUrl, setLargePreviewAccessUrl] = useState<string | null>(null);
  const [largePreviewError, setLargePreviewError] = useState<string | null>(null);
  const [largePreviewLoading, setLargePreviewLoading] = useState(false);
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
        {(datasetError ?? assetsError ?? tasksError) && (
          <p className="form-error">{datasetError ?? assetsError ?? tasksError}</p>
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
                  <button className="secondary-button compact-button" type="button" onClick={() => setShowEditModal(true)}>
                    <Edit3 size={16} />
                    Edit dataset
                  </button>
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
              <AssetsTable
                assets={assets}
                datasetId={dataset.id}
                loading={assetsLoading}
                onChanged={reloadAssets}
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
          <p className="muted-copy">Dataset was not found.</p>
        ) : null}
      </section>
      {dataset && showEditModal && (
        <DatasetEditModal
          dataset={dataset}
          onClose={() => setShowEditModal(false)}
          onChanged={reloadDataset}
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
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void
) {
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

  return createAsset(session, signedUpload.asset);
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
          throw new Error(`Upload up to ${maxBulkUploadFiles} files at once. For larger batches, split files into multiple folders and upload them separately.`);
        }

        if (batchBytes > maxBulkUploadBytes) {
          throw new Error(`Upload up to ${formatBytes(String(maxBulkUploadBytes))} per batch.`);
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
    setSelectedAssetIds((current) =>
      checked ? [...new Set([...current, assetId])] : current.filter((selectedId) => selectedId !== assetId)
    );
  }

  function toggleVisibleAssets(checked: boolean) {
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
          {selectedAssetIds.length > 0 && (
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
      {folderOptions.length > 0 && (
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
            <input
              aria-label="Select assets on this page"
              checked={allPageSelected}
              disabled={pageAssets.length === 0}
              onChange={(event) => toggleVisibleAssets(event.currentTarget.checked)}
              type="checkbox"
            />
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
  checked,
  onDelete,
  onInspect,
  onPreview,
  onToggle
}: {
  asset: AssetSummary;
  checked: boolean;
  onDelete: () => void;
  onInspect: () => void;
  onPreview: () => void;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <article className="table-row assets-head project-row">
      <span>
        <input
          aria-label={`Select ${asset.fileName}`}
          checked={checked}
          onChange={(event) => onToggle(event.currentTarget.checked)}
          type="checkbox"
        />
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
          <div className="asset-row-preview-actions">
            <button className="secondary-button compact-button" type="button" onClick={onInspect}>
              <Eye size={16} />
              Quick preview
            </button>
            <button className="secondary-button compact-button" type="button" onClick={onPreview}>
              <Maximize2 size={16} />
              Preview
            </button>
          </div>
          <button className="ghost-button danger-button compact-button" type="button" onClick={onDelete}>
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </span>
    </article>
  );
}

function getAssetFolderPrefix(objectKey: string) {
  const slashIndex = objectKey.lastIndexOf("/");

  return slashIndex > -1 ? objectKey.slice(0, slashIndex + 1) : "";
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
