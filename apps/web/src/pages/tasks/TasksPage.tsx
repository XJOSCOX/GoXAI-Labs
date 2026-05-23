import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { assignTaskToSelf, startTask, submitTask, type TaskSummary } from "../../api";
import { useTasks } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";
import { ArrowLeft, ClipboardList, Eye, FolderKanban, Send, UserCheck } from "lucide-react";

const taskPageSize = 8;

export function TasksPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const datasetId = searchParams.get("datasetId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;
  const { error, loading, reload, setError, tasks } = useTasks(session, { datasetId, projectId });
  const isFiltered = Boolean(datasetId || projectId);

  return (
    <section className="page-stack">
      {error && <p className="form-error">{error}</p>}
      {isFiltered ? (
        <>
          <Link className="secondary-button compact-button task-back-button" to="/tasks">
            <ArrowLeft size={16} />
            Back to task folders
          </Link>
          <TasksTable loading={loading} onChanged={reload} session={session} setPageError={setError} tasks={tasks} />
        </>
      ) : (
        <TaskProjectFolders loading={loading} tasks={tasks} />
      )}
    </section>
  );
}

function TaskProjectFolders({ loading, tasks }: { loading: boolean; tasks: TaskSummary[] }) {
  const folders = useMemo(() => buildProjectFolders(tasks), [tasks]);

  return (
    <section className="panel task-folder-panel">
      <div className="section-actions">
        <div>
          <p className="eyebrow">Task folders</p>
          <h2>Projects with tasks</h2>
        </div>
        <span className="muted-copy">Open a project folder to see its task queue.</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>Loading task folders</strong>
          <span>Checking project queues and task access.</span>
        </div>
      ) : folders.length > 0 ? (
        <div className="task-folder-grid">
          {folders.map((folder) => (
            <Link className="task-folder-card" key={folder.projectId} to={`/tasks?projectId=${folder.projectId}`}>
              <div className="task-folder-head">
                <span className="task-folder-icon">
                  <FolderKanban size={22} />
                </span>
                <span>
                  <strong>{folder.projectName}</strong>
                  <small>{folder.datasetCount} dataset folder{folder.datasetCount === 1 ? "" : "s"}</small>
                </span>
              </div>
              <div className="task-folder-stats">
                <span>
                  <strong>{folder.total}</strong>
                  <small>Total</small>
                </span>
                <span>
                  <strong>{folder.pending}</strong>
                  <small>Pending</small>
                </span>
                <span>
                  <strong>{folder.active}</strong>
                  <small>Active</small>
                </span>
                <span>
                  <strong>{folder.done}</strong>
                  <small>Done</small>
                </span>
              </div>
              <div className="task-folder-footer">
                <span className="status-pill compact">{formatEnum(folder.projectStatus)}</span>
                <span>{folder.unassigned} unassigned</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>No task folders yet</strong>
          <span>Active projects with generated tasks will appear here.</span>
        </div>
      )}
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

function buildProjectFolders(tasks: TaskSummary[]) {
  const folders = new Map<
    string,
    {
      active: number;
      datasetIds: Set<string>;
      done: number;
      pending: number;
      projectId: string;
      projectName: string;
      projectStatus: string;
      total: number;
      unassigned: number;
    }
  >();

  for (const task of tasks) {
    const folder =
      folders.get(task.projectId) ??
      {
        active: 0,
        datasetIds: new Set<string>(),
        done: 0,
        pending: 0,
        projectId: task.projectId,
        projectName: task.project.name,
        projectStatus: task.project.status,
        total: 0,
        unassigned: 0
      };

    folder.total += 1;

    if (task.datasetId) {
      folder.datasetIds.add(task.datasetId);
    }

    if (!task.assignedToId) {
      folder.unassigned += 1;
    }

    if (task.status === "PENDING") {
      folder.pending += 1;
    } else if (["ASSIGNED", "IN_PROGRESS", "REVIEWING"].includes(task.status)) {
      folder.active += 1;
    } else if (["SUBMITTED", "APPROVED"].includes(task.status)) {
      folder.done += 1;
    }

    folders.set(task.projectId, folder);
  }

  return [...folders.values()]
    .map((folder) => ({
      ...folder,
      datasetCount: folder.datasetIds.size
    }))
    .sort((left, right) => right.total - left.total || left.projectName.localeCompare(right.projectName));
}
