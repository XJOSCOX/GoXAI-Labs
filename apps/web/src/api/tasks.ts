import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, getDownloadFileName, removeEmptyValues } from "./http";
import type { BulkTaskWorkflowResult, CommentSummary, DatasetAssignmentResult, DatasetWorkflowResult, DownloadFileResult, GenerateTasksResult, NextTaskResult, ReviewTaskResult, SaveAnnotationInput, TaskColumnSettingsResult, TaskDetailResult, TaskFoldersResult, TaskPageResult, TaskParticipantSummary, TaskQueueColumnKey, TaskQueueFilters, TaskSavedView, TaskSavedViewsResult, TaskStatsSummary, TaskSummary, TaskWorkflowInput } from "./types";
export async function listTasks(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load tasks."));
  }

  return ((await response.json()) as { tasks: TaskSummary[] }).tasks;
}

export async function listTaskPage(
  session: Session,
  input: { datasetId?: string; page?: number; pageSize?: number; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters = {}
) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.page) {
    params.set("page", String(input.page));
  }

  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  appendTaskQueueFilters(params, input);

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load tasks."));
  }

  return (await response.json()) as TaskPageResult;
}

export async function listTaskFolders(session: Session, input: { projectId?: string; queue?: "review" | "work" } = {}) {
  const params = new URLSearchParams();

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/folders${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task folders."));
  }

  return (await response.json()) as TaskFoldersResult;
}

export async function downloadTaskQueueExport(
  session: Session,
  input: { datasetId?: string; format: "csv" | "json"; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters
): Promise<DownloadFileResult> {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  params.set("format", input.format);
  appendTaskQueueFilters(params, input);

  const response = await authenticatedFetch(session, `/api/tasks/export?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to export task queue."));
  }

  return {
    blob: await response.blob(),
    fileName: getDownloadFileName(response.headers.get("content-disposition")) ?? `task-queue.${input.format}`
  };
}

export async function listTaskViews(session: Session, input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue) {
    params.set("queue", input.queue);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/views${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load saved task views."));
  }

  return (await response.json()) as TaskSavedViewsResult;
}

export async function createTaskView(
  session: Session,
  input: { datasetId?: string; filters: TaskQueueFilters; isDefault?: boolean; name: string; projectId?: string; queue: "review" | "work" }
) {
  const response = await authenticatedFetch(session, "/api/tasks/views", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save task view."));
  }

  return ((await response.json()) as { view: TaskSavedView }).view;
}

export async function updateTaskView(
  session: Session,
  viewId: string,
  input: Partial<{ datasetId: string; filters: TaskQueueFilters; isDefault: boolean; name: string; projectId: string; queue: "review" | "work" }>
) {
  const response = await authenticatedFetch(session, `/api/tasks/views/${encodeURIComponent(viewId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update saved task view."));
  }

  return ((await response.json()) as { view: TaskSavedView }).view;
}

export async function deleteTaskView(session: Session, viewId: string) {
  const response = await authenticatedFetch(session, `/api/tasks/views/${encodeURIComponent(viewId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete saved task view."));
  }
}

export async function getTaskColumnSettings(session: Session, input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/columns${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task columns."));
  }

  return (await response.json()) as TaskColumnSettingsResult;
}

export async function updateTaskColumnSettings(
  session: Session,
  input: { columns: TaskQueueColumnKey[]; datasetId?: string; projectId?: string; queue?: "review" | "work" }
) {
  const response = await authenticatedFetch(session, "/api/tasks/columns", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save task columns."));
  }

  return (await response.json()) as TaskColumnSettingsResult;
}

export async function getTaskStats(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/stats${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task stats."));
  }

  return ((await response.json()) as { stats: TaskStatsSummary }).stats;
}

export async function getTask(session: Session, taskId: string) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function addTaskComment(session: Session, taskId: string, input: { annotationId?: string | null; body: string }) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to add comment."));
  }

  return ((await response.json()) as { comment: CommentSummary }).comment;
}

export async function reviewTask(
  session: Session,
  taskId: string,
  input: { decision: "approve" | "reject"; feedback?: string; reason?: string; score?: number | null; severity?: string }
) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/review`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to review task."));
  }

  return (await response.json()) as ReviewTaskResult;
}

export async function getNextTask(
  session: Session,
  taskId: string,
  input: { datasetId?: string; projectId?: string; queue?: "review" | "work" } & TaskQueueFilters = {}
) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.queue === "review") {
    params.set("queue", "review");
  }

  appendTaskQueueFilters(params, input);

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/next${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load the next task."));
  }

  return (await response.json()) as NextTaskResult;
}

export async function saveTaskAnnotation(session: Session, taskId: string, input: SaveAnnotationInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/annotation`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save annotation."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function submitTaskAnnotation(session: Session, taskId: string, input: SaveAnnotationInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/annotation/submit`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit annotation."));
  }

  return (await response.json()) as TaskDetailResult;
}

export async function generateTasksFromDataset(session: Session, datasetId: string, input: { quantity?: number } & TaskWorkflowInput = {}) {
  const response = await authenticatedFetch(session, "/api/tasks/generate-from-dataset", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate tasks."));
  }

  return (await response.json()) as GenerateTasksResult;
}

export async function applyDatasetTaskWorkflow(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update dataset task workflow."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function saveDatasetTaskWorkflowDefaults(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow/defaults", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save dataset controller defaults."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function applyDatasetTaskRouting(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow/routing", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to apply dataset task routing."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function saveDatasetQualityGates(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow/quality", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save dataset quality gates."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function applyDatasetBudgetPolicy(session: Session, datasetId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, "/api/tasks/dataset-workflow/budget", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues({ ...input, datasetId }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to apply dataset budget."));
  }

  return (await response.json()) as DatasetWorkflowResult;
}

export async function assignDatasetToSelf(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, "/api/tasks/assign-dataset-to-self", {
    method: "POST",
    body: JSON.stringify({ datasetId })
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to assign dataset tasks."));
  }

  return (await response.json()) as DatasetAssignmentResult;
}

export async function listTaskParticipants(session: Session, projectId: string) {
  const params = new URLSearchParams({ projectId });
  const response = await authenticatedFetch(session, `/api/tasks/participants?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load task participants."));
  }

  return ((await response.json()) as { participants: TaskParticipantSummary[] }).participants;
}

export async function updateTaskWorkflow(session: Session, taskId: string, input: TaskWorkflowInput) {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/workflow`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update task workflow."));
  }

  return ((await response.json()) as { task: TaskSummary }).task;
}

export async function bulkUpdateTaskWorkflow(session: Session, input: { taskIds: string[] } & TaskWorkflowInput & { status?: string }) {
  const response = await authenticatedFetch(session, "/api/tasks/bulk/workflow", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update selected tasks."));
  }

  return (await response.json()) as BulkTaskWorkflowResult;
}

export async function assignTaskToSelf(session: Session, taskId: string) {
  return updateTask(session, taskId, "assign-self");
}

export async function startTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "start");
}

export async function submitTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "submit");
}

function appendTaskQueueFilters(params: URLSearchParams, input: TaskQueueFilters) {
  if (input.assignment && input.assignment !== "all") {
    params.set("assignment", input.assignment);
  }

  if (input.due && input.due !== "any") {
    params.set("due", input.due);
  }

  if (typeof input.minPriority === "number" && Number.isFinite(input.minPriority)) {
    params.set("minPriority", String(input.minPriority));
  }

  if (input.quality?.trim()) {
    params.set("quality", input.quality.trim());
  }

  if (input.search?.trim()) {
    params.set("search", input.search.trim());
  }

  if (input.status?.trim()) {
    params.set("status", input.status.trim());
  }
}

async function updateTask(session: Session, taskId: string, action: "assign-self" | "start" | "submit") {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update task."));
  }

  return ((await response.json()) as { task: TaskSummary }).task;
}
