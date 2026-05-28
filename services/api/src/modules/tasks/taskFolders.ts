import { ProjectStatus, TaskStatus } from "@goxai/database";
import { addTaskFolderCount, createTaskFolderCounters } from "./taskQueue.js";
import { getTaskPaymentCreditValue, getTaskPaymentCurrency } from "./taskSerializers.js";
import { isPlainJsonObject } from "./taskValidation.js";

export type TaskFolderEarnings = {
  credits: number;
  currency: string;
}[];

export function summarizeTaskFolderEarnings(
  tasks: { datasetId?: string | null; metadata: unknown; projectId?: string }[],
  input: { groupBy: "dataset" | "project"; mode: "review" | "work" }
) {
  const earningsByFolder = new Map<string, Map<string, number>>();

  for (const task of tasks) {
    const folderId = input.groupBy === "dataset" ? task.datasetId : task.projectId;

    if (!folderId) {
      continue;
    }

    const metadata = isPlainJsonObject(task.metadata) ? task.metadata : {};
    const currency = getTaskPaymentCurrency(metadata.paymentCurrency);
    const credits = input.mode === "review"
      ? getTaskPaymentCreditValue(metadata.paymentReviewCredits)
      : getTaskPaymentCreditValue(metadata.paymentAnnotationCredits);

    if (credits <= 0) {
      continue;
    }

    const creditsByCurrency = earningsByFolder.get(folderId) ?? new Map<string, number>();
    creditsByCurrency.set(currency, (creditsByCurrency.get(currency) ?? 0) + credits);
    earningsByFolder.set(folderId, creditsByCurrency);
  }

  return new Map(
    [...earningsByFolder.entries()].map(([folderId, creditsByCurrency]) => [
      folderId,
      [...creditsByCurrency.entries()]
        .map(([currency, credits]) => ({ credits, currency }))
        .sort((left, right) => right.credits - left.credits || left.currency.localeCompare(right.currency))
    ])
  );
}

export function summarizeProjectTaskFolders(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; projectId: string; status: TaskStatus }[],
  datasetGroups: { _count: { _all: number }; datasetId: string | null; projectId: string }[],
  projectById: Map<string, { id: string; name: string; slug: string; status: ProjectStatus }>,
  earningsByProjectId: Map<string, TaskFolderEarnings>
) {
  const countersByProjectId = new Map<string, ReturnType<typeof createTaskFolderCounters>>();
  const datasetIdsByProjectId = new Map<string, Set<string>>();
  const assigneeIdsByProjectId = new Map<string, Set<string>>();

  for (const group of statusGroups) {
    const counters = countersByProjectId.get(group.projectId) ?? createTaskFolderCounters();
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
    countersByProjectId.set(group.projectId, counters);

    if (group.assignedToId) {
      const assigneeIds = assigneeIdsByProjectId.get(group.projectId) ?? new Set<string>();
      assigneeIds.add(group.assignedToId);
      assigneeIdsByProjectId.set(group.projectId, assigneeIds);
    }
  }

  for (const group of datasetGroups) {
    if (!group.datasetId) {
      continue;
    }

    const datasetIds = datasetIdsByProjectId.get(group.projectId) ?? new Set<string>();
    datasetIds.add(group.datasetId);
    datasetIdsByProjectId.set(group.projectId, datasetIds);
  }

  return [...countersByProjectId.entries()]
    .map(([projectId, counters]) => {
      const project = projectById.get(projectId);

      if (!project) {
        return null;
      }

      return {
        ...counters,
        assignedAnnotatorCount: assigneeIdsByProjectId.get(projectId)?.size ?? 0,
        datasetCount: datasetIdsByProjectId.get(projectId)?.size ?? 0,
        earnings: earningsByProjectId.get(projectId) ?? [],
        projectId,
        projectName: project.name,
        projectSlug: project.slug,
        projectStatus: project.status
      };
    })
    .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder))
    .sort((left, right) => right.total - left.total || left.projectName.localeCompare(right.projectName));
}

export function summarizeDatasetTaskFolders(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; datasetId: string | null; status: TaskStatus }[],
  project: { id: string; name: string; slug: string; status: ProjectStatus },
  datasetById: Map<string, { id: string; name: string; version: number }>,
  earningsByDatasetId: Map<string, TaskFolderEarnings>
) {
  const countersByDatasetId = new Map<string, ReturnType<typeof createTaskFolderCounters>>();
  const assigneeIdsByDatasetId = new Map<string, Set<string>>();

  for (const group of statusGroups) {
    const datasetId = group.datasetId ?? "no-dataset";
    const counters = countersByDatasetId.get(datasetId) ?? createTaskFolderCounters();
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
    countersByDatasetId.set(datasetId, counters);

    if (group.assignedToId) {
      const assigneeIds = assigneeIdsByDatasetId.get(datasetId) ?? new Set<string>();
      assigneeIds.add(group.assignedToId);
      assigneeIdsByDatasetId.set(datasetId, assigneeIds);
    }
  }

  return [...countersByDatasetId.entries()]
    .map(([datasetId, counters]) => {
      const dataset = datasetById.get(datasetId);

      return {
        ...counters,
        assignedAnnotatorCount: assigneeIdsByDatasetId.get(datasetId)?.size ?? 0,
        datasetId,
        datasetName: dataset?.name ?? "No dataset",
        earnings: earningsByDatasetId.get(datasetId) ?? [],
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        readyLabel: dataset ? "Ready" : "Project task",
        versionLabel: dataset ? `Version ${dataset.version}` : project.name
      };
    })
    .sort((left, right) => right.total - left.total || left.datasetName.localeCompare(right.datasetName));
}
