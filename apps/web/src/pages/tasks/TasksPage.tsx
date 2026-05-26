import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth";
import { assignDatasetToSelf, assignTaskToSelf, startTask, type TaskDatasetFolderSummary, type TaskProjectFolderSummary, type TaskSummary } from "../../api";
import { useTaskFolders, useTaskPage } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";
import { ArrowLeft, ClipboardList, Eye, FolderKanban, UserPlus } from "lucide-react";

const taskPageSize = 8;

export function TasksPage() {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const datasetId = searchParams.get("datasetId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;
  const queueMode = searchParams.get("queue") === "review" ? "review" : "work";
  const page = getPositivePage(searchParams.get("page"));
  const projectFolders = useTaskFolders(!projectId && !datasetId ? session : null);
  const datasetFolders = useTaskFolders(projectId && !datasetId ? session : null, { projectId });
  const taskPage = useTaskPage(datasetId ? session : null, { datasetId, page, pageSize: taskPageSize, projectId, queue: queueMode });
  const [assigningDataset, setAssigningDataset] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const selectedProjectName = taskPage.tasks[0]?.project.name ?? datasetFolders.project?.name ?? "Project";
  const selectedDatasetName = taskPage.tasks[0]?.dataset?.name ?? "Dataset";
  const error = projectFolders.error ?? datasetFolders.error ?? taskPage.error;

  useEffect(() => {
    setAssignmentMessage(null);
  }, [datasetId, projectId, queueMode]);

  function handleQueueModeChange(nextQueue: "review" | "work") {
    const nextParams = new URLSearchParams(searchParams);

    if (nextQueue === "review") {
      nextParams.set("queue", "review");
    } else {
      nextParams.delete("queue");
    }

    nextParams.delete("page");
    setSearchParams(nextParams);
  }

  function handleQueuePageChange(nextPage: number) {
    const nextParams = new URLSearchParams(searchParams);

    if (nextPage <= 1) {
      nextParams.delete("page");
    } else {
      nextParams.set("page", String(nextPage));
    }

    setSearchParams(nextParams);
  }

  function getTaskDetailQuery(task: TaskSummary, currentPage: number) {
    const nextParams = new URLSearchParams();

    nextParams.set("projectId", projectId ?? task.projectId);

    if (datasetId ?? task.datasetId) {
      nextParams.set("datasetId", datasetId ?? task.datasetId ?? "");
    }

    if (currentPage > 1) {
      nextParams.set("page", String(currentPage));
    }

    if (queueMode === "review") {
      nextParams.set("queue", "review");
    }

    const query = nextParams.toString();
    return query ? `?${query}` : "";
  }

  async function handleAssignDataset() {
    if (!session || !datasetId) {
      return;
    }

    setAssigningDataset(true);
    setAssignmentMessage(null);
    taskPage.setError(null);

    try {
      const result = await assignDatasetToSelf(session, datasetId);
      setAssignmentMessage(
        result.assignedCount > 0
          ? `${result.assignedCount} task${result.assignedCount === 1 ? "" : "s"} assigned to you.`
          : "No unassigned tasks were available in this dataset."
      );
      await taskPage.reload();
    } catch (reason) {
      taskPage.setError(reason instanceof Error ? reason.message : "Unable to assign dataset tasks.");
    } finally {
      setAssigningDataset(false);
    }
  }

  return (
    <section className="page-stack">
      {error && <p className="form-error">{error}</p>}
      <section className="panel task-page-frame">
        {datasetId ? (
          <>
            <Link className="secondary-button compact-button task-back-button" to={projectId ? `/tasks?projectId=${projectId}` : "/tasks"}>
              <ArrowLeft size={16} />
              Back to dataset folders
            </Link>
            <div className="task-queue-heading">
              <div>
                <p className="eyebrow">{queueMode === "review" ? "Reviewer queue" : "Dataset queue"}</p>
                <h2>{selectedDatasetName}</h2>
              </div>
              <div className="task-queue-actions">
                <span className="muted-copy">{selectedProjectName}</span>
                <div className="segmented-control compact-segmented">
                  <button className={queueMode === "work" ? "active" : ""} onClick={() => handleQueueModeChange("work")} type="button">
                    Work
                  </button>
                  <button className={queueMode === "review" ? "active" : ""} onClick={() => handleQueueModeChange("review")} type="button">
                    Review
                  </button>
                </div>
                <button
                  className="secondary-button compact-button"
                  disabled={!session || assigningDataset}
                  onClick={handleAssignDataset}
                  type="button"
                >
                  <UserPlus size={16} />
                  {assigningDataset ? "Assigning" : "Assign dataset to me"}
                </button>
              </div>
            </div>
            {assignmentMessage && <p className="form-success">{assignmentMessage}</p>}
            <TasksTable
              detailQuery={getTaskDetailQuery}
              mode={queueMode}
              loading={taskPage.loading}
              onChanged={taskPage.reload}
              onPageChange={handleQueuePageChange}
              pageInfo={taskPage.pageInfo}
              session={session}
              setPageError={taskPage.setError}
              tasks={taskPage.tasks}
            />
          </>
        ) : projectId ? (
          <TaskDatasetFolders folders={datasetFolders.datasets} loading={datasetFolders.loading} project={datasetFolders.project} />
        ) : (
          <TaskProjectFolders folders={projectFolders.projects} loading={projectFolders.loading} />
        )}
      </section>
    </section>
  );
}

function TaskProjectFolders({ folders, loading }: { folders: TaskProjectFolderSummary[]; loading: boolean }) {
  return (
    <section className="task-folder-panel">
      <div className="section-actions">
        <div>
          <p className="eyebrow">Task folders</p>
          <h2>Projects with tasks</h2>
        </div>
        <span className="muted-copy">Open a project folder to choose a dataset queue.</span>
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

function TaskDatasetFolders({
  folders,
  loading,
  project
}: {
  folders: TaskDatasetFolderSummary[];
  loading: boolean;
  project: { id: string; name: string; slug: string; status: string } | null;
}) {
  return (
    <section className="task-folder-panel">
      <Link className="secondary-button compact-button task-back-button" to="/tasks">
        <ArrowLeft size={16} />
        Back to project folders
      </Link>
      <div className="section-actions">
        <div>
          <p className="eyebrow">Dataset folders</p>
          <h2>{project?.name ?? "Project"}</h2>
        </div>
        <span className="muted-copy">Choose the dataset queue you want to work on.</span>
      </div>
      {loading ? (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>Loading dataset folders</strong>
          <span>Checking dataset queues and task access.</span>
        </div>
      ) : folders.length > 0 ? (
        <div className="task-folder-grid">
          {folders.map((folder) => (
            <Link
              className="task-folder-card"
              key={folder.datasetId}
              to={`/tasks?projectId=${project?.id ?? folder.projectId}&datasetId=${folder.datasetId}`}
            >
              <div className="task-folder-head">
                <span className="task-folder-icon">
                  <FolderKanban size={22} />
                </span>
                <span>
                  <strong>{folder.datasetName}</strong>
                  <small>{folder.versionLabel}</small>
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
                <span className="status-pill compact">{folder.readyLabel}</span>
                <span>{folder.unassigned} unassigned</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <ClipboardList size={28} />
          <strong>No dataset task folders yet</strong>
          <span>Generate tasks from a dataset to make it appear here.</span>
        </div>
      )}
    </section>
  );
}

export function TasksTable({
  detailQuery,
  loading,
  mode = "work",
  onChanged,
  onPageChange,
  pageInfo,
  session,
  setPageError,
  tasks
}: {
  detailQuery?: (task: TaskSummary, page: number) => string;
  loading: boolean;
  mode?: "review" | "work";
  onChanged: () => Promise<void>;
  onPageChange?: (page: number) => void;
  pageInfo?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
  tasks: TaskSummary[];
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const serverPage = pageInfo?.page ?? null;
  const activePage = serverPage ?? currentPage;
  const pageSize = pageInfo?.pageSize ?? taskPageSize;
  const totalTasks = pageInfo?.total ?? tasks.length;
  const pageCount = pageInfo?.totalPages ?? Math.max(1, Math.ceil(tasks.length / taskPageSize));
  const pageStart = (activePage - 1) * pageSize;
  const pageTasks = pageInfo ? tasks : tasks.slice(pageStart, pageStart + pageSize);
  const pageEnd = pageInfo ? Math.min(pageStart + pageTasks.length, totalTasks) : pageStart + pageTasks.length;
  const visiblePageStart = totalTasks > 0 ? pageStart + 1 : 0;

  useEffect(() => {
    if (!pageInfo && currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount, pageInfo]);

  function goToPage(nextPage: number) {
    if (onPageChange) {
      onPageChange(nextPage);
    } else {
      setCurrentPage(nextPage);
    }
  }

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
            detailQuery={detailQuery}
            detailQueryPage={activePage}
            mode={mode}
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
      {totalTasks > pageSize && (
        <div className="pagination-bar">
          <span>
            Showing {visiblePageStart}-{pageEnd} of {totalTasks}
          </span>
          <div>
            <button
              className="secondary-button compact-button"
              disabled={activePage === 1}
              onClick={() => goToPage(Math.max(1, activePage - 1))}
              type="button"
            >
              Previous
            </button>
            <span>
              Page {activePage} of {pageCount}
            </span>
            <button
              className="secondary-button compact-button"
              disabled={activePage === pageCount}
              onClick={() => goToPage(Math.min(pageCount, activePage + 1))}
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
  detailQuery,
  detailQueryPage,
  mode,
  onChanged,
  session,
  setPageError,
  task
}: {
  detailQuery?: (task: TaskSummary, page: number) => string;
  detailQueryPage: number;
  mode: "review" | "work";
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
      if (action.kind === "start") {
        await startTask(session, task.id);
      } else {
        await assignTaskToSelf(session, task.id);
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
        <Link className="table-link" to={`/tasks/${task.id}${detailQuery?.(task, detailQueryPage) ?? ""}`}>
          {task.asset?.fileName ?? "No asset"}
        </Link>
        <small>{task.dataset?.name ?? task.project.name}</small>
      </span>
      <span>
        <span className="status-pill compact">{formatEnum(task.status)}</span>
      </span>
      <span>{task.assignedTo?.name ?? "Unassigned"}</span>
      <span>
        {mode === "review" && task.canReview ? (
          <Link className="secondary-button compact-button" to={`/tasks/${task.id}${detailQuery?.(task, detailQueryPage) ?? ""}`}>
            <Eye size={16} />
            Review
          </Link>
        ) : task.canWork && action ? (
          <button className="secondary-button compact-button" type="button" onClick={handleAction} disabled={saving}>
            <Eye size={16} />
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

function getPositivePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getNextTaskAction(task: TaskSummary): { kind: "assign" | "start"; label: string } | null {
  if (task.status === "REJECTED") {
    return { kind: "start", label: "Revise" };
  }

  if (task.status === "PENDING" || task.status === "ASSIGNED") {
    return { kind: "start", label: "Start" };
  }

  return null;
}
