import type { TaskQueueFilters, TaskSummary } from "../../../api";

export type ResolvedTaskQueueFilters = Omit<TaskQueueFilters, "assignment" | "due" | "search" | "status"> & {
  assignment: NonNullable<TaskQueueFilters["assignment"]>;
  due: NonNullable<TaskQueueFilters["due"]>;
  quality: NonNullable<TaskQueueFilters["quality"]>;
  search: string;
  status: string;
};

type TaskQueueQuery = {
  datasetId: string | null;
  filters: ResolvedTaskQueueFilters;
  page: string | null;
  projectId: string | null;
  queue: string | null;
};

export function getTaskQueueLink(queueQuery: TaskQueueQuery, task: TaskSummary | null | undefined) {
  const params = new URLSearchParams();
  const projectId = queueQuery.projectId ?? task?.projectId ?? null;
  const datasetId = queueQuery.datasetId ?? task?.datasetId ?? null;

  if (projectId) {
    params.set("projectId", projectId);
  }

  if (datasetId) {
    params.set("datasetId", datasetId);
  }

  if (datasetId && queueQuery.page) {
    params.set("page", queueQuery.page);
  }

  if (queueQuery.queue === "review") {
    params.set("queue", "review");
  }

  appendQueueFiltersToParams(params, queueQuery.filters);

  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function getTaskDetailSearch(queueQuery: TaskQueueQuery, task: TaskSummary) {
  const params = new URLSearchParams();
  const projectId = queueQuery.projectId ?? task.projectId;
  const datasetId = queueQuery.datasetId ?? task.datasetId;

  params.set("projectId", projectId);

  if (datasetId) {
    params.set("datasetId", datasetId);
  }

  if (queueQuery.page) {
    params.set("page", queueQuery.page);
  }

  if (queueQuery.queue === "review") {
    params.set("queue", "review");
  }

  appendQueueFiltersToParams(params, queueQuery.filters);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function getQueueFilters(params: URLSearchParams): ResolvedTaskQueueFilters {
  const assignment = params.get("assignment");
  const due = params.get("due");
  const minPriority = Number(params.get("minPriority"));
  const quality = params.get("quality");

  return {
    assignment: assignment === "mine" || assignment === "unassigned" ? assignment : "all",
    due: due === "overdue" || due === "soon" || due === "none" ? due : "any",
    minPriority: Number.isInteger(minPriority) && minPriority >= 0 && minPriority <= 10 ? minPriority : undefined,
    quality: isQualityFilterValue(quality) ? quality : "",
    search: params.get("search") ?? "",
    status: params.get("status") ?? ""
  };
}

function appendQueueFiltersToParams(params: URLSearchParams, filters: ResolvedTaskQueueFilters) {
  if (filters.assignment !== "all") {
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

function isQualityFilterValue(value: string | null): value is NonNullable<TaskQueueFilters["quality"]> {
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
