import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { assignTaskToSelf, startTask, submitTask, type TaskSummary } from "../../api";
import { useTasks } from "../../hooks/useResources";
import { formatDate, formatEnum } from "../../utils/format";
import { ClipboardList, Eye, Send, UserCheck } from "lucide-react";

const taskPageSize = 8;

export function TasksPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const datasetId = searchParams.get("datasetId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;
  const { error, loading, reload, setError, tasks } = useTasks(session, { datasetId, projectId });

  return (
    <section className="page-stack">
      {error && <p className="form-error">{error}</p>}
      <TasksTable loading={loading} onChanged={reload} session={session} setPageError={setError} tasks={tasks} />
    </section>
  );
}

export function TasksTable({
  loading,
  onChanged,
  session,
  setPageError,
  tasks
}: {
  loading: boolean;
  onChanged: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  tasks: TaskSummary[];
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(tasks.length / taskPageSize));
  const pageStart = (currentPage - 1) * taskPageSize;
  const pageTasks = tasks.slice(pageStart, pageStart + taskPageSize);
  const pageEnd = pageStart + pageTasks.length;
  const visiblePageStart = tasks.length > 0 ? pageStart + 1 : 0;

  useEffect(() => {
    if (currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount]);

  return (
    <section className="table-panel">
      <div className="table-row task-head table-head">
        <span>Asset</span>
        <span>Status</span>
        <span>Assigned</span>
        <span>Action</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>Loading tasks</strong>
          <span>Checking task assignments and statuses.</span>
        </div>
      ) : tasks.length > 0 ? (
        pageTasks.map((task) => (
          <TaskRow
            key={task.id}
            onChanged={onChanged}
            session={session}
            setPageError={setPageError}
            task={task}
          />
        ))
      ) : (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>No tasks yet</strong>
          <span>Generate tasks from dataset assets to start annotation work.</span>
        </div>
      )}
      {tasks.length > taskPageSize && (
        <div className="pagination-bar">
          <span>
            Showing {visiblePageStart}-{pageEnd} of {tasks.length}
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
  );
}

function TaskRow({
  onChanged,
  session,
  setPageError,
  task
}: {
  onChanged: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  task: TaskSummary;
}) {
  const [saving, setSaving] = useState(false);
  const action = getNextTaskAction(task);

  async function handleAction() {
    if (!session || !action) {
      return;
    }

    setSaving(true);
    setPageError(null);

    try {
      if (action.kind === "assign") {
        await assignTaskToSelf(session, task.id);
      } else if (action.kind === "start") {
        await startTask(session, task.id);
      } else {
        await submitTask(session, task.id);
      }

      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="table-row task-head project-row">
      <span>
        <strong>{task.asset?.fileName ?? "No asset"}</strong>
        <small>{task.dataset?.name ?? task.project.name}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(task.status)}</span>
      </span>
      <span>{task.assignedTo?.name ?? "Unassigned"}</span>
      <span>
        {task.canWork && action ? (
          <button className="secondary-button compact-button" type="button" onClick={handleAction} disabled={saving}>
            {action.kind === "assign" ? <UserCheck size={16} /> : action.kind === "start" ? <Eye size={16} /> : <Send size={16} />}
            {saving ? "Saving" : action.label}
          </button>
        ) : !task.canWork ? (
          <span className="muted-copy">Read only</span>
        ) : (
          <span className="muted-copy">Waiting</span>
        )}
      </span>
    </article>
  );
}

function getNextTaskAction(task: TaskSummary): { kind: "assign" | "start" | "submit"; label: string } | null {
  if (task.status === "PENDING") {
    return { kind: "assign", label: "Assign" };
  }

  if (task.status === "ASSIGNED") {
    return { kind: "start", label: "Start" };
  }

  if (task.status === "IN_PROGRESS") {
    return { kind: "submit", label: "Submit" };
  }

  return null;
}
