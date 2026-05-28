import { History, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { rollbackDatasetVersion, type DatasetVersionSummary } from "../../../api";
import { formatDate } from "../../../utils/format";
import { type AuthSession } from "../../shared/resourceSession";
import { formatDatasetVersionReason } from "./datasetDetailUtils";

const datasetVersionPageSize = 8;

type DatasetVersionsPanelProps = {
  currentVersion: number;
  datasetId: string;
  loading: boolean;
  onRollback: () => Promise<void>;
  session: AuthSession;
  setPageError: (error: string | null) => void;
  versions: DatasetVersionSummary[];
  versionsError: string | null;
};

export function DatasetVersionsPanel({
  currentVersion,
  datasetId,
  loading,
  onRollback,
  session,
  setPageError,
  versions,
  versionsError
}: DatasetVersionsPanelProps) {
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);
  const [versionPage, setVersionPage] = useState(1);
  const versionPageCount = Math.max(1, Math.ceil(versions.length / datasetVersionPageSize));
  const versionStart = (versionPage - 1) * datasetVersionPageSize;
  const visibleVersions = versions.slice(versionStart, versionStart + datasetVersionPageSize);
  const versionEnd = Math.min(versions.length, versionStart + visibleVersions.length);

  useEffect(() => {
    setVersionPage(1);
  }, [datasetId]);

  useEffect(() => {
    setVersionPage((current) => Math.min(current, versionPageCount));
  }, [versionPageCount]);

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
        <>
          <div className="dataset-version-list">
            {visibleVersions.map((version) => {
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
          <div className="pagination-bar">
            <span>
              Showing {versionStart + 1}-{versionEnd} of {versions.length}
            </span>
            <div>
              <button
                className="secondary-button compact-button"
                disabled={versionPage <= 1}
                onClick={() => setVersionPage((current) => Math.max(1, current - 1))}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {versionPage} of {versionPageCount}
              </span>
              <button
                className="secondary-button compact-button"
                disabled={versionPage >= versionPageCount}
                onClick={() => setVersionPage((current) => Math.min(versionPageCount, current + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="compact-empty">
          <strong>No snapshots yet</strong>
          <span>Changes to templates, assets, and generated tasks will appear here.</span>
        </div>
      )}
    </section>
  );
}
