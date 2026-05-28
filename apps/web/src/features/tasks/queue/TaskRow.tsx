import { useState } from "react";
import { Link } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Eye } from "lucide-react";
import {
  assignTaskToSelf,
  startTask,
  type TaskQueueColumnKey,
  type TaskSummary
} from "../../../api";
import { formatEnum } from "../../../utils/format";
import { getTaskPaymentDisplay } from "../payment/payment";
import {
  formatTaskDueDate,
  getNextTaskAction,
  getTaskQualityBadges,
  isPastDue
} from "./taskQueueFormatting";

export function TaskRow({
  detailQuery,
  detailQueryPage,
  isSelected,
  mode,
  onChanged,
  onToggleSelected,
  session,
  setPageError,
  showAIBadges,
  task,
  taskGridTemplate,
  visibleColumns
}: {
  detailQuery?: (task: TaskSummary, page: number) => string;
  detailQueryPage: number;
  isSelected: boolean;
  mode: "review" | "work";
  onChanged: () => Promise<void>;
  onToggleSelected: (taskId: string) => void;
  session: Session | null;
  setPageError: (error: string | null) => void;
  showAIBadges: boolean;
  task: TaskSummary;
  taskGridTemplate: string;
  visibleColumns: Set<TaskQueueColumnKey>;
}) {
  const [saving, setSaving] = useState(false);
  const action = getNextTaskAction(task);
  const paymentDisplay = getTaskPaymentDisplay(task, mode);
  const qualityBadges = getTaskQualityBadges(task.qualityFlags ?? [], showAIBadges);

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
    <article className={`table-row task-head project-row task-table-row${isSelected ? " selected" : ""}`} style={{ gridTemplateColumns: taskGridTemplate }}>
      <span>
        <input
          aria-label={`Select ${task.asset?.fileName ?? "task"}`}
          checked={isSelected}
          disabled={!task.canManage}
          onChange={() => onToggleSelected(task.id)}
          type="checkbox"
        />
      </span>
      <span>
        <Link className="table-link" to={`/tasks/${task.id}${detailQuery?.(task, detailQueryPage) ?? ""}`}>
          {task.asset?.fileName ?? "No asset"}
        </Link>
        <small>{task.dataset?.name ?? task.project.name}</small>
        {visibleColumns.has("quality") && qualityBadges.length > 0 ? (
          <div className="task-quality-flags">
            {qualityBadges.map((badge) => (
              <span className={badge.ai ? "ai" : ""} key={badge.flag}>{badge.label}</span>
            ))}
          </div>
        ) : null}
      </span>
      {visibleColumns.has("status") ? <span>
        <span className="status-pill compact">{formatEnum(task.status)}</span>
      </span> : null}
      {visibleColumns.has("priority") ? <span>
        <span className={`task-priority-pill ${task.priority > 0 ? "active" : ""}`}>{task.priority}</span>
      </span> : null}
      {visibleColumns.has("price") ? <span>
        <span className="task-price-cell">
          <span className="task-price-pill">{paymentDisplay.activeText}</span>
          <small>{paymentDisplay.label} price</small>
        </span>
      </span> : null}
      {visibleColumns.has("due") ? <span>
        {task.dueAt ? (
          <span className={isPastDue(task.dueAt) ? "danger-copy" : "muted-copy"}>{formatTaskDueDate(task.dueAt)}</span>
        ) : (
          <span className="muted-copy">No due date</span>
        )}
      </span> : null}
      {visibleColumns.has("assigned") ? <span>
        {task.assignedTo?.name ?? "Unassigned"}
      </span> : null}
      {visibleColumns.has("reviewer") ? <span>
        {task.reviewer?.name ?? "No reviewer"}
      </span> : null}
      {visibleColumns.has("action") ? <span>
        <div className="task-row-actions">
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
        </div>
      </span> : null}
    </article>
  );
}
