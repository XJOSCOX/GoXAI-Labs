import { useEffect, useState } from "react";
import { cleanupNoisyAuditLogs, listAuditLogs, type AuditCleanupResult, type AuditLogSummary } from "../../api";
import { useAuth } from "../../auth";
import { formatEnum } from "../../utils/format";
import { Activity, ShieldCheck, Trash2, Search, X } from "lucide-react";

const auditPageSize = 20;

export function AuditPage() {
  const { dbUser, session } = useAuth();
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [includeTechnical, setIncludeTechnical] = useState(false);
  const [logs, setLogs] = useState<AuditLogSummary[]>([]);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState({ total: 0, totalPages: 1 });
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<AuditCleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canCleanTechnicalLogs = dbUser?.globalRole === "SUPER_ADMIN";

  useEffect(() => {
    let active = true;

    if (!session) {
      setLogs([]);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);

    listAuditLogs(session, {
      action,
      entityType,
      includeTechnical,
      page,
      pageSize: auditPageSize
    })
      .then((result) => {
        if (!active) {
          return;
        }

        setLogs(result.logs);
        setPageInfo({
          total: result.total,
          totalPages: result.totalPages
        });
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load audit activity.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [action, entityType, includeTechnical, page, reloadKey, session?.access_token]);

  function clearFilters() {
    setAction("");
    setEntityType("");
    setIncludeTechnical(false);
    setPage(1);
  }

  async function handlePreviewCleanup() {
    if (!session) {
      return;
    }

    setCleanupLoading(true);
    setCleanupMessage(null);
    setError(null);

    try {
      const result = await cleanupNoisyAuditLogs(session, { dryRun: true });
      setCleanupPreview(result);
      setCleanupMessage(`${result.matchedCount} noisy technical event${result.matchedCount === 1 ? "" : "s"} matched. Nothing was deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to preview audit cleanup.");
    } finally {
      setCleanupLoading(false);
    }
  }

  async function handleCleanup() {
    if (!session || !cleanupPreview || cleanupPreview.matchedCount === 0) {
      return;
    }

    const confirmed = window.confirm(`Delete ${cleanupPreview.matchedCount} noisy technical audit event${cleanupPreview.matchedCount === 1 ? "" : "s"}? This keeps business audit events.`);

    if (!confirmed) {
      return;
    }

    setCleanupLoading(true);
    setCleanupMessage(null);
    setError(null);

    try {
      const result = await cleanupNoisyAuditLogs(session, {
        confirm: "delete-noisy-audit-logs",
        dryRun: false
      });
      setCleanupPreview(result);
      setCleanupMessage(`${result.deletedCount} noisy technical event${result.deletedCount === 1 ? "" : "s"} deleted.`);
      setPage(1);
      setReloadKey((key) => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to clean audit activity.");
    } finally {
      setCleanupLoading(false);
    }
  }

  return (
    <section className="page-stack">
      {error ? <p className="form-error">{error}</p> : null}
      <section className="panel audit-page-frame">
        <div className="section-actions">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2>Activity log</h2>
          </div>
          <span className="muted-copy">{pageInfo.total} events</span>
        </div>
        <div className="audit-filters">
          <label className="search-field compact-search-field">
            <Search size={15} />
            <input
              aria-label="Filter by action"
              onChange={(event) => {
                setAction(event.currentTarget.value);
                setPage(1);
              }}
              placeholder="Action contains..."
              value={action}
            />
          </label>
          <select
            aria-label="Filter by entity type"
            onChange={(event) => {
              setEntityType(event.currentTarget.value);
              setPage(1);
            }}
            value={entityType}
          >
            <option value="">All entities</option>
            <option value="asset">Asset</option>
            <option value="dataset">Dataset</option>
            <option value="export_job">Export</option>
            <option value="project">Project</option>
            <option value="task">Task</option>
          </select>
          <label className="audit-technical-toggle">
            <input
              checked={includeTechnical}
              onChange={(event) => {
                setIncludeTechnical(event.currentTarget.checked);
                setPage(1);
              }}
              type="checkbox"
            />
            Show technical events
          </label>
          {(action || entityType || includeTechnical) && (
            <button className="secondary-button compact-button" onClick={clearFilters} type="button">
              <X size={15} />
              Clear
            </button>
          )}
        </div>
        {canCleanTechnicalLogs ? (
          <section className="audit-cleanup-panel">
            <span className="audit-cleanup-icon">
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>Technical event cleanup</strong>
              <small>
                Hides noisy API events by default. Preview and remove stored technical rows only when the count gets too high.
              </small>
              {cleanupMessage ? <span className="audit-cleanup-message">{cleanupMessage}</span> : null}
            </div>
            <div className="audit-cleanup-actions">
              <button className="secondary-button compact-button" disabled={!session || cleanupLoading} onClick={() => void handlePreviewCleanup()} type="button">
                <Search size={15} />
                Preview
              </button>
              <button
                className="secondary-button compact-button danger-button"
                disabled={!session || cleanupLoading || !cleanupPreview || cleanupPreview.matchedCount === 0}
                onClick={() => void handleCleanup()}
                type="button"
              >
                <Trash2 size={15} />
                Clean noisy logs
              </button>
            </div>
          </section>
        ) : null}
        <div className="audit-list">
          {loading ? (
            <div className="empty-state">
              <Activity size={28} />
              <strong>Loading activity</strong>
              <span>Checking audit events for your workspace.</span>
            </div>
          ) : logs.length > 0 ? (
            logs.map((log) => <AuditLogRow key={log.id} log={log} />)
          ) : (
            <div className="empty-state">
              <Activity size={28} />
              <strong>No audit activity found</strong>
              <span>Try another filter or create new dataset/task activity.</span>
            </div>
          )}
        </div>
        {pageInfo.totalPages > 1 ? (
          <div className="pagination-bar">
            <span>
              Page {page} of {pageInfo.totalPages}
            </span>
            <div>
              <button className="secondary-button compact-button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
                Previous
              </button>
              <button
                className="secondary-button compact-button"
                disabled={page >= pageInfo.totalPages}
                onClick={() => setPage((current) => Math.min(pageInfo.totalPages, current + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function AuditLogRow({ log }: { log: AuditLogSummary }) {
  return (
    <article className="audit-row">
      <span className="audit-icon">
        <Activity size={16} />
      </span>
      <div>
        <strong>{formatEnum(log.action)}</strong>
        <span>
          {log.project?.name ?? "Workspace"} - {log.user?.name ?? "System"}
        </span>
        <small>{formatAuditMeta(log)}</small>
      </div>
      <time>{formatAuditTime(log.createdAt)}</time>
    </article>
  );
}

function formatAuditMeta(log: AuditLogSummary) {
  const parts = [
    log.entityType ? formatEnum(log.entityType) : null,
    log.entityId ? log.entityId.slice(0, 12) : null,
    isRecord(log.metadata) && typeof log.metadata.datasetId === "string" ? `Dataset ${log.metadata.datasetId.slice(0, 12)}` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" - ") : "General activity";
}

function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
