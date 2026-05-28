import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, UserPlus } from "lucide-react";
import { useAuth } from "../../auth";
import {
  assignDatasetToSelf,
  downloadTaskQueueExport,
  type TaskQueueFilters,
  type TaskSavedView,
  type TaskSummary
} from "../../api";
import { useTaskColumnSettings, useTaskFolders, useTaskPage, useTaskViews } from "../../hooks/useResources";
import { ReviewWorkbenchLinks } from "../../features/tasks/queue/ReviewWorkbenchLinks";
import { TaskDatasetFolders, TaskProjectFolders } from "../../features/tasks/queue/TaskFolderCards";
import { TaskQueueFiltersBar } from "../../features/tasks/queue/TaskQueueFiltersBar";
import { TaskSavedViewsBar } from "../../features/tasks/queue/TaskSavedViewsBar";
import { TasksTable } from "../../features/tasks/queue/TasksTable";
import { getQualityFilterOptions, taskPageSize } from "../../features/tasks/queue/taskQueueTypes";
import {
  appendQueueFiltersToParams,
  getPositivePage,
  getQueueFilters,
  resolveTaskViewFilters
} from "../../features/tasks/queue/taskQueueFilters";

export function TasksPage() {
  const { features, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const datasetId = searchParams.get("datasetId") ?? undefined;
  const projectId = searchParams.get("projectId") ?? undefined;
  const queueMode = searchParams.get("queue") === "review" ? "review" : "work";
  const page = getPositivePage(searchParams.get("page"));
  const queueFilters = getQueueFilters(searchParams, queueMode);
  const projectFolders = useTaskFolders(!projectId && !datasetId ? session : null, { queue: queueMode });
  const datasetFolders = useTaskFolders(projectId && !datasetId ? session : null, { projectId, queue: queueMode });
  const taskPage = useTaskPage(datasetId ? session : null, {
    ...queueFilters,
    datasetId,
    page,
    pageSize: taskPageSize,
    projectId,
    queue: queueMode
  });
  const taskViews = useTaskViews(datasetId ? session : null, {
    datasetId,
    projectId,
    queue: queueMode
  });
  const taskColumns = useTaskColumnSettings(datasetId ? session : null, {
    datasetId,
    projectId,
    queue: queueMode
  });
  const [assigningDataset, setAssigningDataset] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [viewMessage, setViewMessage] = useState<string | null>(null);
  const [exportingQueue, setExportingQueue] = useState<"csv" | "json" | null>(null);
  const activeViewId = searchParams.get("viewId");
  const selectedProjectName = taskPage.tasks[0]?.project.name ?? datasetFolders.project?.name ?? "Project";
  const selectedDatasetName = taskPage.tasks[0]?.dataset?.name ?? "Dataset";
  const error = projectFolders.error ?? datasetFolders.error ?? taskPage.error ?? taskViews.error ?? taskColumns.error;
  const qualityFilterOptions = getQualityFilterOptions(features.aiEnabled);

  useEffect(() => {
    setAssignmentMessage(null);
    setViewMessage(null);
  }, [datasetId, projectId, queueMode]);

  useEffect(() => {
    if (!features.aiEnabled && queueFilters.quality.startsWith("ai_")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("quality");
      nextParams.delete("page");
      setSearchParams(nextParams);
    }
  }, [features.aiEnabled, queueFilters.quality, searchParams, setSearchParams]);

  function handleQueueModeChange(nextQueue: "review" | "work") {
    const nextParams = new URLSearchParams(searchParams);

    if (nextQueue === "review") {
      nextParams.set("queue", "review");
    } else {
      nextParams.delete("queue");
    }

    nextParams.delete("page");
    nextParams.delete("viewId");
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

  function handleFilterChange(name: keyof TaskQueueFilters, value: string) {
    const nextParams = new URLSearchParams(searchParams);

    nextParams.delete("page");
    nextParams.delete("viewId");

    if (name === "assignment" && queueMode === "review" && value === "all") {
      nextParams.set(name, value);
    } else if (!value || value === "all" || value === "any") {
      nextParams.delete(name);
    } else {
      nextParams.set(name, value);
    }

    setSearchParams(nextParams);
  }

  function clearFilters() {
    const nextParams = new URLSearchParams(searchParams);

    for (const key of ["assignment", "due", "minPriority", "quality", "search", "status"]) {
      nextParams.delete(key);
    }

    nextParams.delete("page");
    nextParams.delete("viewId");
    setSearchParams(nextParams);
  }

  async function handleSaveView() {
    if (!session || !datasetId) {
      return;
    }

    const name = viewName.trim();

    if (!name) {
      setViewMessage("Name the view before saving it.");
      return;
    }

    setSavingView(true);
    setViewMessage(null);
    taskViews.setError(null);

    try {
      const saved = await taskViews.save({
        datasetId,
        filters: queueFilters,
        name,
        projectId,
        queue: queueMode
      });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("viewId", saved.id);
      nextParams.delete("page");
      setSearchParams(nextParams);
      setViewName("");
      setViewMessage(`Saved "${saved.name}".`);
    } catch (reason) {
      taskViews.setError(reason instanceof Error ? reason.message : "Unable to save task view.");
    } finally {
      setSavingView(false);
    }
  }

  function handleApplyView(view: TaskSavedView) {
    const nextParams = new URLSearchParams();
    const filters = resolveTaskViewFilters(view.filters, view.queue);

    if (projectId ?? view.projectId) {
      nextParams.set("projectId", projectId ?? view.projectId ?? "");
    }

    if (datasetId ?? view.datasetId) {
      nextParams.set("datasetId", datasetId ?? view.datasetId ?? "");
    }

    if (view.queue === "review") {
      nextParams.set("queue", "review");
    }

    nextParams.set("viewId", view.id);
    appendQueueFiltersToParams(nextParams, filters, view.queue);
    setSearchParams(nextParams);
  }

  async function handleDeleteView(view: TaskSavedView) {
    taskViews.setError(null);
    setViewMessage(null);

    try {
      await taskViews.remove(view.id);
      if (activeViewId === view.id) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("viewId");
        setSearchParams(nextParams);
      }
      setViewMessage(`Deleted "${view.name}".`);
    } catch (reason) {
      taskViews.setError(reason instanceof Error ? reason.message : "Unable to delete saved task view.");
    }
  }

  async function handleQueueExport(format: "csv" | "json") {
    if (!session) {
      taskPage.setError("Authentication required.");
      return;
    }

    setExportingQueue(format);
    setViewMessage(null);
    taskPage.setError(null);

    try {
      const result = await downloadTaskQueueExport(session, {
        ...queueFilters,
        datasetId,
        format,
        projectId,
        queue: queueMode
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setViewMessage(`Task queue ${format.toUpperCase()} export downloaded.`);
    } catch (reason) {
      taskPage.setError(reason instanceof Error ? reason.message : "Unable to export task queue.");
    } finally {
      setExportingQueue(null);
    }
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

    appendQueueFiltersToParams(nextParams, queueFilters, queueMode);

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
            <TaskSavedViewsBar
              activeViewId={activeViewId}
              columns={taskColumns.columns}
              exporting={exportingQueue}
              loading={taskViews.loading}
              onApply={handleApplyView}
              onChange={setViewName}
              onColumnsChange={(columns) => {
                taskColumns.setError(null);
                taskColumns.save(columns).catch((reason) => {
                  taskColumns.setError(reason instanceof Error ? reason.message : "Unable to save task columns.");
                });
              }}
              onDelete={handleDeleteView}
              onExport={handleQueueExport}
              onSave={handleSaveView}
              saving={savingView}
              value={viewName}
              views={taskViews.views}
            />
            {viewMessage && <p className="form-success">{viewMessage}</p>}
            {queueMode === "review" ? (
              <ReviewWorkbenchLinks counts={taskPage.queueCounts} filters={queueFilters} onChange={handleFilterChange} options={qualityFilterOptions} />
            ) : null}
            <TaskQueueFiltersBar filters={queueFilters} mode={queueMode} onChange={handleFilterChange} onClear={clearFilters} options={qualityFilterOptions} />
            <TasksTable
              columns={taskColumns.columns}
              detailQuery={getTaskDetailQuery}
              loading={taskPage.loading}
              mode={queueMode}
              onChanged={taskPage.reload}
              onPageChange={handleQueuePageChange}
              pageInfo={taskPage.pageInfo}
              session={session}
              setPageError={taskPage.setError}
              showAIBadges={features.aiEnabled}
              tasks={taskPage.tasks}
            />
          </>
        ) : projectId ? (
          <TaskDatasetFolders
            folders={datasetFolders.datasets}
            loading={datasetFolders.loading}
            mode={queueMode}
            onModeChange={handleQueueModeChange}
            project={datasetFolders.project}
          />
        ) : (
          <TaskProjectFolders folders={projectFolders.projects} loading={projectFolders.loading} mode={queueMode} onModeChange={handleQueueModeChange} />
        )}
      </section>
    </section>
  );
}
