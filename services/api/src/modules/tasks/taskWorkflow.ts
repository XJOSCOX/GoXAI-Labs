import { getPrismaClient, Prisma, TaskStatus } from "@goxai/database";
import { userCanReviewProjectTasks, userCanWorkProjectTasks } from "./taskAccess.js";
import {
  getDatasetWorkflowAssignments,
  type DatasetTaskWorkflowValue
} from "./taskPolicies.js";

export async function patchTaskMetadataMany(
  tx: Prisma.TransactionClient,
  taskIds: string[],
  patch: Prisma.InputJsonObject
) {
  const chunkSize = 500;

  for (let index = 0; index < taskIds.length; index += chunkSize) {
    const chunk = taskIds.slice(index, index + chunkSize);

    if (chunk.length === 0) {
      continue;
    }

    await tx.$executeRaw`
      UPDATE "tasks"
      SET "metadata" = COALESCE("metadata", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
          "updated_at" = NOW()
      WHERE "id" IN (${Prisma.join(chunk)})
    `;
  }
}

type AssignmentWorkloadInput = Array<{ count: number; userId: string }>;

export async function buildDatasetWorkflowAssignmentPlan(
  prisma: ReturnType<typeof getPrismaClient>,
  value: DatasetTaskWorkflowValue,
  input: { projectId: string; taskCount: number }
) {
  if (value.assignmentMode !== "round_robin" || value.assigneeIds.length === 0 || input.taskCount === 0) {
    return getDatasetWorkflowAssignments(value, input.taskCount);
  }

  const workload = await prisma.task.groupBy({
    by: ["assignedToId"],
    where: {
      assignedToId: {
        in: value.assigneeIds
      },
      projectId: input.projectId,
      status: {
        in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]
      }
    },
    _count: {
      _all: true
    }
  });

  return getDatasetWorkflowAssignments(value, input.taskCount, normalizeAssignmentWorkload(workload));
}

export function normalizeAssignmentWorkload(workload: Array<{ _count: { _all: number }; assignedToId: string | null }>): AssignmentWorkloadInput {
  return workload
    .filter((item): item is { _count: { _all: number }; assignedToId: string } => Boolean(item.assignedToId))
    .map((item) => ({
      count: item._count._all,
      userId: item.assignedToId
    }));
}

export async function validateDatasetTaskWorkflowMembers(value: DatasetTaskWorkflowValue, projectId: string, organizationId: string) {
  const assigneeIds = value.assignmentMode === "single"
    ? value.assignedToId ? [value.assignedToId] : []
    : value.assignmentMode === "round_robin"
      ? value.assigneeIds
      : [];

  for (const assigneeId of assigneeIds) {
    if (!(await userCanWorkProjectTasks(assigneeId, projectId, organizationId))) {
      return "Choose project members who can work tasks.";
    }
  }

  if (value.reviewerId && !(await userCanReviewProjectTasks(value.reviewerId, projectId, organizationId))) {
    return "Choose a reviewer, manager, admin, or owner for review.";
  }

  return null;
}
