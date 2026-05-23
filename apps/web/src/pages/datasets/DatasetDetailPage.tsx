import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, CloudUpload, Edit3, ExternalLink, Eye, FileText, FolderOpen, HardDrive, Save, Search, X } from "lucide-react";
import {
  archiveDataset,
  createAsset,
  createAssetUploadUrl,
  generateTasksFromDataset,
  getAssetAccessUrl,
  logClientEvent,
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
import { formatAssetKind, formatBytes, formatDate, formatEnum, getFormFile, getUrlHost } from "../../utils/format";
import { buildUploadObjectKey, getFileKey, joinObjectKeyParts, mergeFiles, toSafeObjectKeyPart } from "../../utils/upload";
import { TasksTable } from "../tasks/TasksPage";

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
  const [message, setMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    setGenerating(true);

    try {
      const result = await generateTasksFromDataset(session, dataset.id);
      setMessage(
        result.createdCount > 0
          ? `${result.createdCount} task${result.createdCount === 1 ? "" : "s"} generated.`
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
        <button className="primary-button" type="button" onClick={handleGenerate} disabled={generating}>
          <ClipboardList size={18} />
          {generating ? "Generating" : "Generate tasks"}
        </button>
      </div>
      {message && <p className="form-success">{message}</p>}
      <TasksTable loading={loading} onChanged={onGenerated} session={session} setPageError={setPageError} tasks={tasks} />
    </section>
  );
}

function DatasetSettingsPanel({
  dataset,
  onChanged,
  session,
  setPageError
}: {
  dataset: DatasetSummary;
  onChanged: () => Promise<void>;
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
      await updateDataset(session, dataset.id, {
        name: getFormValue(event, "name"),
        description: getFormValue(event, "description"),
        status: getFormValue(event, "status")
      });
      setMessage("Dataset updated.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update dataset.");
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
      await archiveDataset(session, dataset.id);
      setMessage("Dataset archived.");
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to archive dataset.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel management-grid" onSubmit={handleUpdate}>
      <div className="wide">
        <p className="eyebrow">Manage</p>
        <h2>Dataset settings</h2>
      </div>
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
        <textarea name="description" defaultValue={dataset.description ?? ""} rows={3} />
      </label>
      {message && <p className="form-success wide">{message}</p>}
      <div className="row-actions wide">
        <button className="primary-button" type="submit" disabled={saving}>
          <Save size={18} />
          {saving ? "Saving" : "Save dataset"}
        </button>
        <button className="ghost-button danger-button" type="button" onClick={handleArchive} disabled={saving}>
          Archive dataset
        </button>
      </div>
    </form>
  );
}

export function DatasetDetailPage() {
  const { datasetId = "" } = useParams();
  const { session } = useAuth();
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
                <div>
                  <p className="eyebrow">Dataset</p>
                  <h2>{dataset.name}</h2>
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
              <AssetsTable assets={assets} loading={assetsLoading} session={session} setPageError={setAssetsError} />
            </section>
            <aside className="side-column">
              <DatasetSettingsPanel
                dataset={dataset}
                onChanged={reloadDataset}
                session={session}
                setPageError={setTasksError}
              />
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
          throw new Error(`Upload up to ${maxBulkUploadFiles} files at once.`);
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
      setPageError(`Upload up to ${maxBulkUploadFiles} files at once. Extra files were not added.`);
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
        <span>Choose many files, or choose a folder to keep the folder paths in R2.</span>
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
  loading,
  session,
  setPageError
}: {
  assets: AssetSummary[];
  loading: boolean;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<AssetSummary | null>(null);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = normalizedQuery
    ? assets.filter((asset) =>
        [asset.fileName, asset.objectKey, asset.mimeType, asset.provider]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : assets;
  const totalBytes = assets.reduce((total, asset) => total + Number(asset.fileSize || 0), 0);

  async function handleInspect(asset: AssetSummary) {
    setSelectedAsset(asset);
    setAccessUrl(null);
    setAccessError(null);
    setPageError(null);

    if (!session) {
      setAccessError("Authentication required.");
      return;
    }

    setAccessLoading(true);

    try {
      const result = await getAssetAccessUrl(session, asset.id);
      setAccessUrl(result.accessUrl);
    } catch (reason) {
      setAccessError(reason instanceof Error ? reason.message : "Unable to create asset preview URL.");
    } finally {
      setAccessLoading(false);
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
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files, keys, or MIME types"
          />
        </label>
      </div>
      <section className="table-panel">
        <div className="table-row assets-head table-head">
          <span>File</span>
          <span>Type</span>
          <span>Size</span>
          <span>Action</span>
        </div>
        {loading ? (
          <div className="empty-state">
            <HardDrive size={28} />
            <strong>Loading assets</strong>
            <span>Checking registered R2 objects for this dataset.</span>
          </div>
        ) : filteredAssets.length > 0 ? (
          filteredAssets.map((asset) => (
            <AssetRow
              asset={asset}
              key={asset.id}
              onInspect={() => {
                void handleInspect(asset);
              }}
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
      </section>
      {selectedAsset && (
        <AssetPreview
          accessError={accessError}
          accessLoading={accessLoading}
          accessUrl={accessUrl}
          asset={selectedAsset}
          onClose={() => {
            setSelectedAsset(null);
            setAccessUrl(null);
            setAccessError(null);
          }}
        />
      )}
    </section>
  );
}

function AssetRow({ asset, onInspect }: { asset: AssetSummary; onInspect: () => void }) {
  return (
    <article className="table-row assets-head project-row">
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
        <button className="secondary-button compact-button" type="button" onClick={onInspect}>
          <Eye size={16} />
          Preview
        </button>
      </span>
    </article>
  );
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
