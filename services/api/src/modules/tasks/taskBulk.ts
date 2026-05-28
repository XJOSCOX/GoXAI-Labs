import { getPrismaClient, TaskStatus, type Prisma } from "@goxai/database";
import { type Router } from "express";
import { type AuthenticatedRequest } from "../../shared/auth.js";
import { getRequestId } from "../../shared/logging.js";
import { canGenerateTasks } from "../../shared/permissions.js";
import { getEffectiveProjectMembership, userCanReviewProjectTasks, userCanWorkProjectTasks } from "./taskAccess.js";
import { parseTaskWorkflowBody } from "./taskPolicies.js";
import { normalizeId, parseTaskStatusQuery } from "./taskValidation.js";

const maxBulkTaskCount = 200;

export function registerTaskBulkRoutes(router: Router) {
  router.patch("/bulk/workflow", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const taskIds = parseBulkTaskIds(request.body?.taskIds);

    if (taskIds.length === 0) {
      response.status(400).json({ error: "Choose at least one task." });
      return;
    }

    if (taskIds.length > maxBulkTaskCount) {
      response.status(400).json({ error: `Update up to ${maxBulkTaskCount} tasks at a time.` });
      return;
    }

    const parsed = parseBulkWorkflowBody(request.body);

    if (!parsed.ok) {
      response.status(400).json({ error: parsed.error });
      return;
    }

    const prisma = getPrismaClient();
    const tasks = await prisma.task.findMany({
      where: {
        id: {
          in: taskIds
        }
      },
      select: {
        assignedToId: true,
        dueAt: true,
        id: true,
        priority: true,
        project: {
          select: {
            createdById: true,
            id: true,
            organizationId: true
          }
        },
        projectId: true,
        reviewerId: true,
        status: true
      }
    });

    if (tasks.length !== taskIds.length) {
      response.status(404).json({ error: "One or more selected tasks were not found." });
      return;
    }

    const projects = new Map(tasks.map((task) => [task.projectId, task.project]));

    for (const project of projects.values()) {
      const manager = await getEffectiveProjectMembership(user.id, project.id, project.organizationId);

      if (project.createdById !== user.id && (!manager || !canGenerateTasks(manager))) {
        response.status(403).json({ error: "You need manager access to update the selected task queues." });
        return;
      }

      if (parsed.value.assignedToId !== undefined && parsed.value.assignedToId !== null) {
        const canAssign = await userCanWorkProjectTasks(parsed.value.assignedToId, project.id, project.organizationId);

        if (!canAssign) {
          response.status(400).json({ error: "Choose a project member who can work tasks." });
          return;
        }
      }

      if (parsed.value.reviewerId !== undefined && parsed.value.reviewerId !== null) {
        const canReview = await userCanReviewProjectTasks(parsed.value.reviewerId, project.id, project.organizationId);

        if (!canReview) {
          response.status(400).json({ error: "Choose a reviewer, manager, admin, or owner for review." });
          return;
        }
      }
    }

    const updateData = parsed.value;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.updateMany({
        where: {
          id: {
            in: taskIds
          }
        },
        data: updateData
      });

      for (const project of projects.values()) {
        await tx.auditLog.create({
          data: {
            action: "task.workflow.bulk_updated",
            entityType: "task",
            metadata: {
              changes: serializeBulkWorkflowChanges(updateData),
              requestId: getRequestId(request),
              taskCount: tasks.filter((task) => task.projectId === project.id).length,
              taskIds: tasks.filter((task) => task.projectId === project.id).map((task) => task.id)
            },
            organizationId: project.organizationId,
            projectId: project.id,
            userId: user.id
          }
        });
      }

      return updated;
    });

    response.status(200).json({
      requestedCount: taskIds.length,
      updatedCount: result.count
    });
  });
}

function parseBulkTaskIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(normalizeId).filter((id): id is string => Boolean(id)))];
}

function parseBulkWorkflowBody(body: unknown):
  | {
      ok: true;
      value: {
        assignedToId?: string | null;
        dueAt?: Date | null;
        priority?: number;
        reviewerId?: string | null;
        status?: TaskStatus;
      };
    }
  | { ok: false; error: string } {
  const workflowFields = ["assignedToId", "dueAt", "priority", "reviewerId"];
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const hasWorkflowFields = workflowFields.some((field) => Object.prototype.hasOwnProperty.call(record, field));
  const status = Object.prototype.hasOwnProperty.call(record, "status") ? parseTaskStatusQuery(record.status) : undefined;
  const value: {
    assignedToId?: string | null;
    dueAt?: Date | null;
    priority?: number;
    reviewerId?: string | null;
    status?: TaskStatus;
  } = {};

  if (hasWorkflowFields) {
    const parsed = parseTaskWorkflowBody(record);

    if (!parsed.ok) {
      return parsed;
    }

    Object.assign(value, parsed.value);
  }

  if (Object.prototype.hasOwnProperty.call(record, "status")) {
    if (!status) {
      return { error: "Choose a valid task status.", ok: false };
    }

    if (status === TaskStatus.APPROVED) {
      return { error: "Approve tasks through review so credits and escrow settle correctly.", ok: false };
    }

    value.status = status;
  }

  if (Object.keys(value).length === 0) {
    return { error: "Choose at least one bulk action.", ok: false };
  }

  return { ok: true, value };
}

function serializeBulkWorkflowChanges(value: {
  assignedToId?: string | null;
  dueAt?: Date | null;
  priority?: number;
  reviewerId?: string | null;
  status?: TaskStatus;
}): Prisma.InputJsonObject {
  return {
    ...(value.assignedToId !== undefined ? { assignedToId: value.assignedToId } : {}),
    ...(value.dueAt !== undefined ? { dueAt: value.dueAt instanceof Date ? value.dueAt.toISOString() : value.dueAt } : {}),
    ...(value.priority !== undefined ? { priority: value.priority } : {}),
    ...(value.reviewerId !== undefined ? { reviewerId: value.reviewerId } : {}),
    ...(value.status !== undefined ? { status: value.status } : {})
  };
}
