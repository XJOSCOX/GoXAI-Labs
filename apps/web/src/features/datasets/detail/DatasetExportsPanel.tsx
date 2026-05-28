import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import {
  createExportJob,
  getExportDownloadUrl,
  getQualityStats,
  listExportJobs,
  type DatasetSummary,
  type ExportFormat,
  type ExportJobSummary,
  type QualityStatsResult
} from "../../../api";
import { formatBytes, formatDate, formatEnum } from "../../../utils/format";
import { type AuthSession } from "../../shared/resourceSession";
import {
  getDatasetExportFormats,
  getDatasetExportQualityWarnings,
  getDatasetQualityPolicy,
  getStringArray,
  isRecord,
  isSourceFileExportFormat
} from "./datasetDetailUtils";

type DatasetExportsPanelProps = {
  canExport: boolean;
  dataset: DatasetSummary;
  session: AuthSession;
  setPageError: (error: string | null) => void;
};

export function DatasetExportsPanel({
  canExport,
  dataset,
  session,
  setPageError
}: DatasetExportsPanelProps) {
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exports, setExports] = useState<ExportJobSummary[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("JSON");
  const [includeSourceFiles, setIncludeSourceFiles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityStatsResult | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const exportFormats = getDatasetExportFormats(dataset);
  const canIncludeSourceFiles = isSourceFileExportFormat(exportFormat);
  const qualityPolicy = getDatasetQualityPolicy(dataset);
  const qualityWarnings = getDatasetExportQualityWarnings(quality, qualityPolicy);

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

  useEffect(() => {
    let mounted = true;

    async function loadQuality() {
      if (!session) {
        setQuality(null);
        return;
      }

      setQualityLoading(true);

      try {
        const result = await getQualityStats(session, { datasetId: dataset.id, projectId: dataset.projectId });

        if (mounted) {
          setQuality(result);
        }
      } catch {
        if (mounted) {
          setQuality(null);
        }
      } finally {
        if (mounted) {
          setQualityLoading(false);
        }
      }
    }

    void loadQuality();

    return () => {
      mounted = false;
    };
  }, [dataset.id, dataset.projectId, session?.access_token]);

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
          {qualityLoading ? <span className="muted-copy">Checking dataset quality gates.</span> : null}
          {qualityWarnings.length > 0 ? (
            <div className="export-quality-warning">
              <strong>Quality warning</strong>
              {qualityWarnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
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
                  {formatEnum(exportJob.status)} - {formatDate(exportJob.createdAt)}
                  {exportJob.format ? ` - ${formatEnum(exportJob.format)}` : ""}
                  {exportJob.metadata && typeof exportJob.metadata.taskCount === "number" ? ` - ${exportJob.metadata.taskCount} tasks` : ""}
                  {exportJob.metadata && typeof exportJob.metadata.annotationCount === "number" ? ` - ${exportJob.metadata.annotationCount} annotations` : ""}
                </span>
                {isRecord(exportJob.metadata?.manifest) ? (
                  <small className="muted-copy">
                    Manifest: {getStringArray(exportJob.metadata.manifest.taskStatuses).join(", ") || "APPROVED"} tasks,
                    {" "}
                    {getStringArray(exportJob.metadata.manifest.annotationStatuses).join(", ") || "ACCEPTED"} annotations
                  </small>
                ) : null}
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
