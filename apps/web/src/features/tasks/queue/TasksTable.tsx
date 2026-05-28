import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ClipboardList } from "lucide-react";
import {
  bulkUpdateTaskWorkflow,
  listTaskParticipants,
  type TaskParticipantSummary,
  type TaskQueueColumnKey,
  type TaskSummary
} from "../../../api";
import { TaskBulkActionBar } from "./TaskBulkActionBar";
import { TaskRow } from "./TaskRow";
import { getTaskGridTemplate, normalizeTaskColumns } from "./taskQueueFilters";
import { defaultTaskColumns, taskPageSize, type TaskBulkDraft } from "./taskQueueTypes";

export function TasksTable({
  columns = defaultTaskColumns,
  detailQuery,
  loading,
  mode = "work",
  onChanged,
  onPageChange,
  pageInfo,
  session,
  setPageError,
  showAIBadges = true,
  tasks
}: {
  columns?: TaskQueueColumnKey[];
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
  session: Session | null;
  setPageError: (error: string | null) => void;
  showAIBadges?: boolean;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [participants, setParticipants] = useState<TaskParticipantSummary[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkDraft, setBulkDraft] = useState<TaskBulkDraft>({
    assignedToId: "",
    dueAt: "",
    dueMode: "unchanged",
    priority: "",
    reviewerId: "",
    status: ""
  });
  const selectedTasks = pageTasks.filter((task) => selectedIds.has(task.id));
  const selectedManageable = selectedTasks.length > 0 && selectedTasks.every((task) => task.canManage);
  const selectablePageTasks = pageTasks.filter((task) => task.canManage);
  const allPageSelected = selectablePageTasks.length > 0 && selectablePageTasks.every((task) => selectedIds.has(task.id));
  const activeProjectId = selectedTasks[0]?.projectId ?? pageTasks[0]?.projectId;
  const visibleColumns = normalizeTaskColumns(columns);
  const visibleColumnSet = new Set(visibleColumns);
  const taskGridTemplate = getTaskGridTemplate(visibleColumns);

  useEffect(() => {
    if (!pageInfo && currentPage > pageCount) {
      setCurrentPage(pageCount);
    }
  }, [currentPage, pageCount, pageInfo]);

  useEffect(() => {
    const pageTaskIds = new Set(pageTasks.map((task) => task.id));
    setSelectedIds((current) => new Set([...current].filter((id) => pageTaskIds.has(id))));
  }, [tasks, pageInfo?.page]);

  useEffect(() => {
    setBulkMessage(null);
  }, [mode, pageInfo?.page]);

  useEffect(() => {
    if (!session || !activeProjectId || selectedTasks.length === 0) {
      setParticipants([]);
      return;
    }

    let active = true;
    setParticipantsLoading(true);
    listTaskParticipants(session, activeProjectId)
      .then((nextParticipants) => {
        if (active) {
          setParticipants(nextParticipants);
        }
      })
      .catch((reason) => {
        if (active) {
          setPageError(reason instanceof Error ? reason.message : "Unable to load task participants.");
          setParticipants([]);
        }
      })
      .finally(() => {
        if (active) {
          setParticipantsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeProjectId, selectedTasks.length, session, setPageError]);

  function goToPage(nextPage: number) {
    if (onPageChange) {
      onPageChange(nextPage);
    } else {
      setCurrentPage(nextPage);
    }
  }

  function toggleTask(taskId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }

      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (allPageSelected) {
        selectablePageTasks.forEach((task) => next.delete(task.id));
      } else {
        selectablePageTasks.forEach((task) => next.add(task.id));
      }

      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkMessage(null);
  }

  async function handleBulkApply() {
    if (!session || selectedTasks.length === 0) {
      return;
    }

    if (!selectedManageable) {
      setPageError("You need manager access to update selected tasks.");
      return;
    }

    const input: {
      assignedToId?: string | null;
      dueAt?: string | null;
      priority?: number;
      reviewerId?: string | null;
      status?: string;
      taskIds: string[];
    } = {
      taskIds: selectedTasks.map((task) => task.id)
    };

    if (bulkDraft.assignedToId === "__clear") {
      input.assignedToId = null;
    } else if (bulkDraft.assignedToId) {
      input.assignedToId = bulkDraft.assignedToId;
    }

    if (bulkDraft.reviewerId === "__clear") {
      input.reviewerId = null;
    } else if (bulkDraft.reviewerId) {
      input.reviewerId = bulkDraft.reviewerId;
    }

    if (bulkDraft.priority !== "") {
      input.priority = Number(bulkDraft.priority);
    }

    if (bulkDraft.status) {
      input.status = bulkDraft.status;
    }

    if (bulkDraft.dueMode === "clear") {
      input.dueAt = null;
    } else if (bulkDraft.dueMode === "set" && bulkDraft.dueAt) {
      input.dueAt = bulkDraft.dueAt;
    }

    if (Object.keys(input).length === 1) {
      setPageError("Choose at least one bulk action.");
      return;
    }

    setBulkSaving(true);
    setBulkMessage(null);
    setPageError(null);

    try {
      const result = await bulkUpdateTaskWorkflow(session, input);
      setBulkMessage(`${result.updatedCount} selected task${result.updatedCount === 1 ? "" : "s"} updated.`);
      setSelectedIds(new Set());
      setBulkDraft({
        assignedToId: "",
        dueAt: "",
        dueMode: "unchanged",
        priority: "",
        reviewerId: "",
        status: ""
      });
      await onChanged();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to update selected tasks.");
    } finally {
      setBulkSaving(false);
    }
  }

  return (
    <section className="table-panel">
      {bulkMessage && <p className="form-success task-bulk-message">{bulkMessage}</p>}
      {selectedTasks.length > 0 ? (
        <TaskBulkActionBar
          canManage={selectedManageable}
          draft={bulkDraft}
          loadingParticipants={participantsLoading}
          onApply={handleBulkApply}
          onChange={setBulkDraft}
          onClear={clearSelection}
          participants={participants}
          saving={bulkSaving}
          selectedCount={selectedTasks.length}
        />
      ) : null}
      <div className="table-row task-head table-head" style={{ gridTemplateColumns: taskGridTemplate }}>
        <span>
          <input
            aria-label="Select all visible tasks"
            checked={allPageSelected}
            onChange={togglePageSelection}
            type="checkbox"
          />
        </span>
        <span>Asset</span>
        {visibleColumnSet.has("status") ? <span>Status</span> : null}
        {visibleColumnSet.has("priority") ? <span>Priority</span> : null}
        {visibleColumnSet.has("price") ? <span>Price</span> : null}
        {visibleColumnSet.has("due") ? <span>Due</span> : null}
        {visibleColumnSet.has("assigned") ? <span>Assigned</span> : null}
        {visibleColumnSet.has("reviewer") ? <span>Reviewer</span> : null}
        {visibleColumnSet.has("action") ? <span>Action</span> : null}
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
            isSelected={selectedIds.has(task.id)}
            mode={mode}
            onChanged={onChanged}
            onToggleSelected={toggleTask}
            session={session}
            setPageError={setPageError}
            showAIBadges={showAIBadges}
            task={task}
            taskGridTemplate={taskGridTemplate}
            visibleColumns={visibleColumnSet}
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
