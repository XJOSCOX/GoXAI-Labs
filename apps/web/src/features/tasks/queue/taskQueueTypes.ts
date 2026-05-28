import type { TaskAssignmentFilter, TaskDueFilter, TaskQueueColumnKey as ApiTaskQueueColumnKey, TaskQueueFilters } from "../../../api";

export type TaskQueueColumnKey = ApiTaskQueueColumnKey;

export const taskPageSize = 8;

export const statusFilterOptions = [
  { label: "All statuses", value: "" },
  { label: "Pending", value: "PENDING" },
  { label: "Assigned", value: "ASSIGNED" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Submitted", value: "SUBMITTED" },
  { label: "Reviewing", value: "REVIEWING" },
  { label: "Rejected", value: "REJECTED" },
  { label: "Approved", value: "APPROVED" }
];

export const assignmentFilterOptions: { label: string; value: TaskAssignmentFilter }[] = [
  { label: "All assignees", value: "all" },
  { label: "Assigned to me", value: "mine" },
  { label: "Unassigned", value: "unassigned" }
];

export const dueFilterOptions: { label: string; value: TaskDueFilter }[] = [
  { label: "Any due date", value: "any" },
  { label: "Overdue", value: "overdue" },
  { label: "Due in 24h", value: "soon" },
  { label: "No due date", value: "none" }
];

export const baseQualityFilterOptions = [
  { label: "Any quality flag", value: "" },
  { label: "Needs review", value: "missing_review" },
  { label: "Sampled for QA", value: "sampled" },
  { label: "Disagreement", value: "disagreement" },
  { label: "Due soon", value: "due_soon" },
  { label: "Urgent", value: "urgent_priority" },
  { label: "Rejected / fixes", value: "needs_fixes" },
  { label: "Overdue", value: "overdue" }
] as const;

export const aiQualityFilterOptions = [
  { label: "AI assisted", value: "ai_assisted" },
  { label: "AI edited", value: "ai_edited" },
  { label: "AI low confidence", value: "ai_low_confidence" }
] as const;

export type QualityFilterOption = (typeof baseQualityFilterOptions)[number] | (typeof aiQualityFilterOptions)[number];

export type ResolvedTaskQueueFilters = Omit<TaskQueueFilters, "assignment" | "due" | "search" | "status"> & {
  assignment: TaskAssignmentFilter;
  due: TaskDueFilter;
  quality: NonNullable<TaskQueueFilters["quality"]>;
  search: string;
  status: string;
};

export type TaskBulkDraft = {
  assignedToId: string;
  dueAt: string;
  dueMode: string;
  priority: string;
  reviewerId: string;
  status: string;
};

export const taskColumnOptions: { key: TaskQueueColumnKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "price", label: "Price" },
  { key: "due", label: "Due" },
  { key: "assigned", label: "Assignee" },
  { key: "reviewer", label: "Reviewer" },
  { key: "quality", label: "Quality flags" },
  { key: "action", label: "Action" }
];

export const defaultTaskColumns: TaskQueueColumnKey[] = ["status", "priority", "price", "due", "assigned", "reviewer", "action"];

export function getQualityFilterOptions(aiEnabled: boolean): QualityFilterOption[] {
  return aiEnabled ? [...baseQualityFilterOptions, ...aiQualityFilterOptions] : [...baseQualityFilterOptions];
}
