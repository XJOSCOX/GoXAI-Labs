import { type FormEvent, useEffect, useRef, useState } from "react";
import { CloudUpload, FileText, FolderOpen, X } from "lucide-react";

import {
  createAsset,
  createAssetUploadUrl,
  logClientEvent,
  resumableUploadThresholdBytes,
  uploadFileToSignedUrl,
  uploadFileWithResumableMultipart,
  type AssetSummary,
  type CreateAssetInput,
  type DatasetSummary
} from "../../../api";
import { getFormValue } from "../../../auth";
import { folderInputAttributes, maxBulkUploadBytes, maxBulkUploadFiles } from "../../../constants/options";
import { useFormDraft } from "../../../hooks/useResources";
import type { UploadProgress } from "../../../types/upload";
import { formatBytes } from "../../../utils/format";
import { buildUploadObjectKey, getFileKey, mergeFiles, toSafeObjectKeyPart } from "../../../utils/upload";
import { type AuthSession } from "../../shared/resourceSession";
import {
  createUploadJobs,
  getDatasetBindings,
  getDatasetTextSources,
  getStructuredRowTitle,
  isStructuredImportFile,
  parseStructuredImportFile
} from "./datasetDetailUtils";

const maxConcurrentAssetUploads = 3;
const maxStructuredImportRows = 500;
const maxUploadFolderAssets = 250;
async function uploadAndRegisterAsset(
  session: NonNullable<AuthSession>,
  datasetId: string,
  file: File,
  objectKey?: string,
  onProgress?: (progress: { loaded: number; percent: number; total: number }) => void,
  metadata?: Record<string, unknown>
) {
  const imageDimensions = await readImageDimensions(file);
  const uploadRequest = {
    datasetId,
    objectKey,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: file.size.toString()
  };
  let assetInput: CreateAssetInput;

  try {
    if (file.size >= resumableUploadThresholdBytes) {
      assetInput = await uploadFileWithResumableMultipart(session, file, uploadRequest, onProgress);
    } else {
      const signedUpload = await createAssetUploadUrl(session, uploadRequest);
      await uploadFileToSignedUrl(file, signedUpload.upload, onProgress);
      assetInput = signedUpload.asset;
    }
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
        objectKey,
        uploadMode: file.size >= resumableUploadThresholdBytes ? "multipart" : "single"
      }
    }).catch(() => {});

    throw error;
  }

  return createAsset(session, {
    ...assetInput,
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

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();

      if (item !== undefined) {
        await worker(item);
      }
    }
  });

  await Promise.all(workers);
}

export function AssetForm({
  assets,
  dataset,
  onCreated,
  session,
  setPageError
}: {
  assets: AssetSummary[];
  dataset: DatasetSummary;
  onCreated: () => Promise<void>;
  session: AuthSession;
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [renameFiles, setRenameFiles] = useState(false);
  const [textEntry, setTextEntry] = useState("");
  const [textEntryTitle, setTextEntryTitle] = useState("");
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
          throw new Error(`Upload up to ${maxBulkUploadFiles} files at once.`);
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

        const uploadJobs = createUploadJobs({
          assets,
          dataset,
          files: selectedFiles,
          rename: renameFiles,
          renamePrefix
        });
        const loadedByFileKey = new Map(uploadJobs.map((job) => [job.key, 0]));
        const activeFileNames = new Set<string>();
        const updateParallelProgress = () => {
          const loadedBytes = Array.from(loadedByFileKey.values()).reduce((total, loaded) => total + loaded, 0);
          const activeLabel = activeFileNames.size > 1
            ? `${activeFileNames.size} files uploading`
            : activeFileNames.values().next().value ?? "";

          setUploadProgress({
            completed: uploaded.length,
            currentFile: activeLabel,
            failed: failed.length,
            currentFilePercent: batchBytes > 0 ? Math.round((loadedBytes / batchBytes) * 100) : 0,
            currentLoadedBytes: loadedBytes,
            currentTotalBytes: batchBytes,
            status: "uploading",
            total: selectedFiles.length
          });
        };

        updateParallelProgress();

        await runWithConcurrency(uploadJobs, maxConcurrentAssetUploads, async (job) => {
          const displayName = job.file.webkitRelativePath || job.file.name;
          activeFileNames.add(displayName);
          updateParallelProgress();
          try {
            uploaded.push(
              await uploadAndRegisterAsset(
                session,
                dataset.id,
                job.file,
                job.objectKey,
                (progress) => {
                  loadedByFileKey.set(job.key, progress.loaded);
                  updateParallelProgress();
                }
              )
            );
            loadedByFileKey.set(job.key, job.file.size);
          } catch (reason) {
            failed.push(`${job.file.name}: ${reason instanceof Error ? reason.message : "Upload failed."}`);
          } finally {
            activeFileNames.delete(displayName);
            updateParallelProgress();
          }
        });

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
        `Only ${maxBulkUploadFiles} files are allowed in one upload. Extra files were not added.`
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
        <span>Choose up to {maxBulkUploadFiles} files at once, or choose a folder to preserve file paths inside the dataset upload folder.</span>
        <small>GoXAi Lab assigns dataset folders automatically and opens a new folder after {maxUploadFolderAssets} files.</small>
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
      <label className="checkbox-row wide">
        <input
          checked={renameFiles}
          onChange={(event) => setRenameFiles(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>
          Rename uploaded files with a prefix and unique code
          <small>Recommended for long or unclean file names.</small>
        </span>
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
