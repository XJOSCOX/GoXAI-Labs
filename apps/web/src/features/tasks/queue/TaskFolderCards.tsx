import { Link } from "react-router-dom";
import { ArrowLeft, ClipboardList, FolderKanban } from "lucide-react";
import type { TaskDatasetFolderSummary, TaskProjectFolderSummary } from "../../../api";
import { formatEnum } from "../../../utils/format";
import { QueueModeToggle } from "./QueueModeToggle";
import {
  formatPendingUnassigned,
  formatTaskCount,
  getTaskFolderProgress,
  TaskFolderEarningsBadge
} from "./taskQueueFormatting";

export function TaskProjectFolders({
  folders,
  loading,
  mode,
  onModeChange
}: {
  folders: TaskProjectFolderSummary[];
  loading: boolean;
  mode: "review" | "work";
  onModeChange: (mode: "review" | "work") => void;
}) {
  return (
    <section className="task-folder-panel">
      <div className="section-actions">
        <div>
          <p className="eyebrow">{mode === "review" ? "Reviewer folders" : "Task folders"}</p>
          <h2>{mode === "review" ? "Projects awaiting review" : "Projects with tasks"}</h2>
        </div>
        <div className="task-folder-toolbar">
          <span className="muted-copy">Open a project folder to choose a dataset queue.</span>
          <QueueModeToggle mode={mode} onChange={onModeChange} />
        </div>
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
            <Link className="task-folder-card" key={folder.projectId} to={buildTaskFolderLink({ mode, projectId: folder.projectId })}>
              <div className="task-folder-head">
                <div className="task-folder-title-row">
                  <span className="task-folder-icon">
                    <FolderKanban size={22} />
                  </span>
                  <span className="task-folder-title">
                    <strong>{folder.projectName}</strong>
                    <small>
                      {folder.datasetCount} folder{folder.datasetCount === 1 ? "" : "s"} | {formatTaskCount(folder.total)}
                    </small>
                  </span>
                </div>
                <TaskFolderEarningsBadge earnings={folder.earnings} mode={mode} />
              </div>
              <TaskFolderStats folder={folder} />
              <div className="task-folder-progress" aria-label={`${getTaskFolderProgress(folder.done, folder.total)} percent complete`}>
                <span style={{ width: `${getTaskFolderProgress(folder.done, folder.total)}%` }} />
              </div>
              <div className="task-folder-footer">
                <span className="status-pill compact">{formatEnum(folder.projectStatus)}</span>
                <span>{folder.done}/{folder.total} done</span>
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

export function TaskDatasetFolders({
  folders,
  loading,
  mode,
  onModeChange,
  project
}: {
  folders: TaskDatasetFolderSummary[];
  loading: boolean;
  mode: "review" | "work";
  onModeChange: (mode: "review" | "work") => void;
  project: { id: string; name: string; slug: string; status: string } | null;
}) {
  return (
    <section className="task-folder-panel">
      <Link className="secondary-button compact-button task-back-button" to={mode === "review" ? "/tasks?queue=review" : "/tasks"}>
        <ArrowLeft size={16} />
        Back to project folders
      </Link>
      <div className="section-actions">
        <div>
          <p className="eyebrow">{mode === "review" ? "Reviewer queue" : "Dataset folders"}</p>
          <h2>{project?.name ?? "Project"}</h2>
        </div>
        <div className="task-folder-toolbar">
          <span className="muted-copy">Choose the dataset queue you want to work on.</span>
          <QueueModeToggle mode={mode} onChange={onModeChange} />
        </div>
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
              to={buildTaskFolderLink({ datasetId: folder.datasetId, mode, projectId: project?.id ?? folder.projectId })}
            >
              <div className="task-folder-head">
                <div className="task-folder-title-row">
                  <span className="task-folder-icon">
                    <FolderKanban size={22} />
                  </span>
                  <span className="task-folder-title">
                    <strong>{folder.datasetName}</strong>
                    <small>{formatTaskCount(folder.total)}</small>
                  </span>
                </div>
                <TaskFolderEarningsBadge earnings={folder.earnings} mode={mode} />
              </div>
              <TaskFolderStats folder={folder} />
              <div className="task-folder-progress" aria-label={`${getTaskFolderProgress(folder.done, folder.total)} percent complete`}>
                <span style={{ width: `${getTaskFolderProgress(folder.done, folder.total)}%` }} />
              </div>
              <div className="task-folder-footer">
                <span className="status-pill compact">{folder.readyLabel}</span>
                <span>{folder.done}/{folder.total} done</span>
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

function TaskFolderStats({
  folder
}: {
  folder: Pick<TaskProjectFolderSummary, "active" | "approved" | "assignedAnnotatorCount" | "pending" | "rejected" | "review" | "unassigned">;
}) {
  return (
    <div className="task-folder-stats">
      <span className="task-folder-primary-stat">
        <strong>{formatPendingUnassigned(folder.pending, folder.unassigned)}</strong>
        <small>Pending / unassigned</small>
      </span>
      <span>
        <strong>{folder.active}</strong>
        <small>Active</small>
      </span>
      <span>
        <strong>{folder.assignedAnnotatorCount}</strong>
        <small>Annotators</small>
      </span>
      <span>
        <strong>{folder.review}</strong>
        <small>Review</small>
      </span>
      <span>
        <strong>{folder.approved}</strong>
        <small>Approved</small>
      </span>
      <span>
        <strong>{folder.rejected}</strong>
        <small>Rejected</small>
      </span>
    </div>
  );
}

function buildTaskFolderLink(input: { datasetId?: string; mode: "review" | "work"; projectId: string }) {
  const params = new URLSearchParams({ projectId: input.projectId });

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.mode === "review") {
    params.set("queue", "review");
  }

  return `/tasks?${params.toString()}`;
}
