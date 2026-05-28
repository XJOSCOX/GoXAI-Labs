import type { TaskParticipantSummary } from "../../../api";
import type { TaskBulkDraft } from "./taskQueueTypes";

export function TaskBulkActionBar({
  canManage,
  draft,
  loadingParticipants,
  onApply,
  onChange,
  onClear,
  participants,
  saving,
  selectedCount
}: {
  canManage: boolean;
  draft: TaskBulkDraft;
  loadingParticipants: boolean;
  onApply: () => void;
  onChange: (draft: TaskBulkDraft) => void;
  onClear: () => void;
  participants: TaskParticipantSummary[];
  saving: boolean;
  selectedCount: number;
}) {
  const assignees = participants.filter((participant) => participant.canWork);
  const reviewers = participants.filter((participant) => participant.canReview);

  function updateDraft(patch: Partial<TaskBulkDraft>) {
    onChange({ ...draft, ...patch });
  }

  return (
    <div className="task-bulk-actions">
      <div className="task-bulk-summary">
        <strong>{selectedCount}</strong>
        <span>selected</span>
      </div>
      <select
        aria-label="Bulk assignee"
        disabled={!canManage || loadingParticipants}
        onChange={(event) => updateDraft({ assignedToId: event.currentTarget.value })}
        value={draft.assignedToId}
      >
        <option value="">Assignee unchanged</option>
        <option value="__clear">Clear assignee</option>
        {assignees.map((participant) => (
          <option key={participant.id} value={participant.id}>
            {participant.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Bulk reviewer"
        disabled={!canManage || loadingParticipants}
        onChange={(event) => updateDraft({ reviewerId: event.currentTarget.value })}
        value={draft.reviewerId}
      >
        <option value="">Reviewer unchanged</option>
        <option value="__clear">Clear reviewer</option>
        {reviewers.map((participant) => (
          <option key={participant.id} value={participant.id}>
            {participant.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Bulk status"
        disabled={!canManage}
        onChange={(event) => updateDraft({ status: event.currentTarget.value })}
        value={draft.status}
      >
        <option value="">Status unchanged</option>
        <option value="PENDING">Pending</option>
        <option value="ASSIGNED">Assigned</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="SUBMITTED">Submitted</option>
        <option value="REVIEWING">Reviewing</option>
        <option value="REJECTED">Rejected</option>
      </select>
      <select
        aria-label="Bulk priority"
        disabled={!canManage}
        onChange={(event) => updateDraft({ priority: event.currentTarget.value })}
        value={draft.priority}
      >
        <option value="">Priority unchanged</option>
        {Array.from({ length: 11 }, (_, priority) => (
          <option key={priority} value={String(priority)}>
            Priority {priority}
          </option>
        ))}
      </select>
      <select
        aria-label="Bulk due date mode"
        disabled={!canManage}
        onChange={(event) => updateDraft({ dueMode: event.currentTarget.value, dueAt: event.currentTarget.value === "set" ? draft.dueAt : "" })}
        value={draft.dueMode}
      >
        <option value="unchanged">Due unchanged</option>
        <option value="set">Set due date</option>
        <option value="clear">Clear due date</option>
      </select>
      {draft.dueMode === "set" ? (
        <input
          aria-label="Bulk due date"
          disabled={!canManage}
          onChange={(event) => updateDraft({ dueAt: event.currentTarget.value })}
          type="date"
          value={draft.dueAt}
        />
      ) : null}
      <button className="primary-button compact-button" disabled={!canManage || saving} onClick={onApply} type="button">
        {saving ? "Applying" : "Apply"}
      </button>
      <button className="secondary-button compact-button" onClick={onClear} type="button">
        Clear
      </button>
      {!canManage ? <span className="muted-copy">Manager access required</span> : null}
    </div>
  );
}
