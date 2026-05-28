import {
  NotificationPreferenceEvent,
  NotificationType,
  type Prisma
} from "@goxai/database";
import type { NotificationInput } from "../notifications/notifications.js";

export function buildTaskAssignmentNotifications(input: {
  assignmentCounts: Array<{ count: number; userId: string }>;
  dataset: { id: string; name: string };
  projectId: string;
  title: string;
}): NotificationInput[] {
  return input.assignmentCounts.map((assignment) => ({
    userId: assignment.userId,
    event: NotificationPreferenceEvent.TASK_ASSIGNED,
    type: NotificationType.TASK_ASSIGNED,
    title: input.title,
    message: `${assignment.count} task${assignment.count === 1 ? "" : "s"} assigned in ${input.dataset.name}.`,
    metadata: {
      actionUrl: `/tasks?projectId=${encodeURIComponent(input.projectId)}&datasetId=${encodeURIComponent(input.dataset.id)}`,
      datasetId: input.dataset.id,
      projectId: input.projectId,
      taskCount: assignment.count
    }
  }));
}

export function buildTaskNotificationMetadata(
  task: {
    id: string;
    projectId: string;
    datasetId: string | null;
    assetId: string | null;
  },
  queue?: "review"
): Prisma.InputJsonObject {
  const query = new URLSearchParams();
  query.set("projectId", task.projectId);

  if (task.datasetId) {
    query.set("datasetId", task.datasetId);
  }

  if (queue) {
    query.set("queue", queue);
  }

  return {
    actionUrl: `/tasks/${encodeURIComponent(task.id)}?${query.toString()}`,
    assetId: task.assetId,
    datasetId: task.datasetId,
    projectId: task.projectId,
    taskId: task.id
  };
}

export function getTaskAssetName(task: { asset?: { fileName: string } | null; dataset?: { name: string } | null }) {
  return task.asset?.fileName ?? task.dataset?.name ?? "Task";
}

export function getTaskCommentNotificationRecipients(
  task: {
    annotations?: Array<{ userId: string }>;
    assignedToId?: string | null;
    reviewerId?: string | null;
  },
  actorUserId: string
) {
  return [
    task.assignedToId,
    task.reviewerId,
    ...(task.annotations?.map((annotation) => annotation.userId) ?? [])
  ].filter((userId, index, allUserIds): userId is string =>
    Boolean(userId) && userId !== actorUserId && allUserIds.indexOf(userId) === index
  );
}
