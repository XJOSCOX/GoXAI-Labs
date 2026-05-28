import type { TaskAssignmentFilter, TaskQueueFilters } from "../../../api";
import {
  assignmentFilterOptions,
  defaultTaskColumns,
  type ResolvedTaskQueueFilters,
  type TaskQueueColumnKey
} from "./taskQueueTypes";

export function getPositivePage(value: string | null) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function getQueueFilters(params: URLSearchParams, mode: "review" | "work"): ResolvedTaskQueueFilters {
  const assignment = params.get("assignment");
  const due = params.get("due");
  const minPriority = Number(params.get("minPriority"));
  const quality = params.get("quality");

  return {
    assignment: assignment === "mine" || assignment === "unassigned" || assignment === "all" ? assignment : mode === "review" ? "mine" : "all",
    due: due === "overdue" || due === "soon" || due === "none" ? due : "any",
    minPriority: Number.isInteger(minPriority) && minPriority >= 0 && minPriority <= 10 ? minPriority : undefined,
    quality: isQualityFilterValue(quality) ? quality : "",
    search: params.get("search") ?? "",
    status: params.get("status") ?? ""
  };
}

export function resolveTaskViewFilters(filters: TaskQueueFilters, mode: "review" | "work"): ResolvedTaskQueueFilters {
  const quality = filters.quality ?? "";

  return {
    assignment: filters.assignment === "mine" || filters.assignment === "unassigned" || filters.assignment === "all" ? filters.assignment : mode === "review" ? "mine" : "all",
    due: filters.due === "overdue" || filters.due === "soon" || filters.due === "none" || filters.due === "any" ? filters.due : "any",
    minPriority: typeof filters.minPriority === "number" && Number.isInteger(filters.minPriority) && filters.minPriority >= 0 && filters.minPriority <= 10 ? filters.minPriority : undefined,
    quality: isQualityFilterValue(quality) ? quality : "",
    search: filters.search ?? "",
    status: filters.status ?? ""
  };
}

export function appendQueueFiltersToParams(params: URLSearchParams, filters: ResolvedTaskQueueFilters, mode: "review" | "work") {
  if (filters.assignment !== "all" || mode === "review") {
    params.set("assignment", filters.assignment);
  }

  if (filters.due !== "any") {
    params.set("due", filters.due);
  }

  if (filters.minPriority !== undefined) {
    params.set("minPriority", String(filters.minPriority));
  }

  if (filters.quality) {
    params.set("quality", filters.quality);
  }

  if (filters.search) {
    params.set("search", filters.search);
  }

  if (filters.status) {
    params.set("status", filters.status);
  }
}

export function isQualityFilterValue(value: string | null): value is NonNullable<TaskQueueFilters["quality"]> {
  return value === "ai_assisted" ||
    value === "ai_edited" ||
    value === "ai_low_confidence" ||
    value === "disagreement" ||
    value === "due_soon" ||
    value === "missing_review" ||
    value === "needs_fixes" ||
    value === "overdue" ||
    value === "sampled" ||
    value === "urgent_priority";
}

export function getAssignmentFilterOptions(mode: "review" | "work"): { label: string; value: TaskAssignmentFilter }[] {
  return mode === "review"
    ? [
        { label: "My review queue", value: "mine" },
        { label: "All reviewers", value: "all" },
        { label: "No reviewer", value: "unassigned" }
      ]
    : assignmentFilterOptions;
}

export function normalizeTaskColumns(columns: TaskQueueColumnKey[]) {
  const allowedColumns = new Set<TaskQueueColumnKey>(["action", "assigned", "due", "price", "priority", "quality", "reviewer", "status"]);
  const normalized = columns.filter((column) => allowedColumns.has(column));

  return normalized.length > 0 ? normalized : defaultTaskColumns;
}

export function getTaskGridTemplate(columns: TaskQueueColumnKey[]) {
  const widths: Record<TaskQueueColumnKey, string> = {
    action: "minmax(150px, 1fr)",
    assigned: "minmax(150px, 1fr)",
    due: "minmax(142px, 0.95fr)",
    price: "minmax(132px, 0.82fr)",
    priority: "0.68fr",
    quality: "",
    reviewer: "minmax(150px, 1fr)",
    status: "0.75fr"
  };
  const dataColumns = columns.filter((column) => column !== "quality").map((column) => widths[column]);

  return ["34px", "minmax(0, 2fr)", ...dataColumns].join(" ");
}
