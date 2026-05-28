import { getPrismaClient, Prisma, TaskStatus } from "@goxai/database";
import { type Router } from "express";
import { type AuthenticatedRequest } from "../../shared/auth.js";
import { getRequestId } from "../../shared/logging.js";
import { buildAccessibleProjectConditions, getTaskAccessScope } from "./taskAccess.js";
import { normalizeId, normalizeShortText, parseTaskStatusQuery } from "./taskValidation.js";

const taskViewSelect = {
  createdAt: true,
  datasetId: true,
  filters: true,
  id: true,
  isDefault: true,
  name: true,
  projectId: true,
  queue: true,
  sort: true,
  updatedAt: true
} satisfies Prisma.TaskViewSelect;

type TaskViewRecord = Prisma.TaskViewGetPayload<{ select: typeof taskViewSelect }>;
type TaskViewQueue = "review" | "work";

type TaskViewContext = {
  datasetId: string | null;
  organizationId: string | null;
  projectId: string | null;
};

const taskQualityFilters = new Set([
  "ai_assisted",
  "ai_edited",
  "ai_low_confidence",
  "disagreement",
  "due_soon",
  "missing_review",
  "needs_fixes",
  "overdue",
  "sampled",
  "urgent_priority"
]);
const taskColumnKeys = new Set([
  "action",
  "assigned",
  "due",
  "price",
  "priority",
  "quality",
  "reviewer",
  "status"
]);
const defaultTaskColumns = ["status", "priority", "price", "due", "assigned", "reviewer", "action"] as const;

export function registerTaskViewRoutes(router: Router) {
  router.get("/columns", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const context = await resolveTaskViewContext(user.id, {
      datasetId: normalizeId(request.query.datasetId),
      projectId: normalizeId(request.query.projectId)
    });

    if (!context.ok) {
      response.status(context.status).json({ error: context.error });
      return;
    }

    const queue = parseTaskViewQueue(request.query.queue) ?? "work";
    const prisma = getPrismaClient();
    const preference = await prisma.taskView.findFirst({
      where: {
        datasetId: context.value.datasetId,
        name: getTaskColumnPreferenceName(queue),
        projectId: context.value.projectId,
        scope: "task_columns",
        userId: user.id
      },
      select: taskViewSelect
    });

    response.status(200).json({
      columns: parseTaskColumnSettings(preference?.sort)
    });
  });

  router.patch("/columns", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const context = await resolveTaskViewContext(user.id, {
      datasetId: normalizeId(request.body?.datasetId),
      projectId: normalizeId(request.body?.projectId)
    });

    if (!context.ok) {
      response.status(context.status).json({ error: context.error });
      return;
    }

    const queue = parseTaskViewQueue(request.body?.queue) ?? "work";
    const columns = parseTaskColumnSettings({ columns: request.body?.columns });
    const prisma = getPrismaClient();
    const existing = await prisma.taskView.findFirst({
      where: {
        datasetId: context.value.datasetId,
        name: getTaskColumnPreferenceName(queue),
        projectId: context.value.projectId,
        scope: "task_columns",
        userId: user.id
      },
      select: {
        id: true
      }
    });
    const data = {
      datasetId: context.value.datasetId,
      filters: {},
      name: getTaskColumnPreferenceName(queue),
      projectId: context.value.projectId,
      queue,
      scope: "task_columns",
      sort: {
        columns
      },
      userId: user.id
    } satisfies Prisma.TaskViewUncheckedCreateInput;

    if (existing) {
      await prisma.taskView.update({
        data: {
          sort: data.sort
        },
        where: {
          id: existing.id
        }
      });
    } else {
      await prisma.taskView.create({
        data
      });
    }

    response.status(200).json({
      columns
    });
  });

  router.get("/views", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const context = await resolveTaskViewContext(user.id, {
      datasetId: normalizeId(request.query.datasetId),
      projectId: normalizeId(request.query.projectId)
    });

    if (!context.ok) {
      response.status(context.status).json({ error: context.error });
      return;
    }

    const queue = parseTaskViewQueue(request.query.queue);
    const prisma = getPrismaClient();
    const views = await prisma.taskView.findMany({
      where: {
        datasetId: context.value.datasetId,
        projectId: context.value.projectId,
        scope: "task_manager",
        userId: user.id,
        ...(queue ? { queue } : {})
      },
      orderBy: [
        { isDefault: "desc" },
        { updatedAt: "desc" },
        { name: "asc" }
      ],
      select: taskViewSelect
    });

    response.status(200).json({
      views: views.map(serializeTaskView)
    });
  });

  router.post("/views", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const name = normalizeShortText(request.body?.name, 80);

    if (!name) {
      response.status(400).json({ error: "View name is required." });
      return;
    }

    const context = await resolveTaskViewContext(user.id, {
      datasetId: normalizeId(request.body?.datasetId),
      projectId: normalizeId(request.body?.projectId)
    });

    if (!context.ok) {
      response.status(context.status).json({ error: context.error });
      return;
    }

    const queue = parseTaskViewQueue(request.body?.queue) ?? "work";
    const filters = parseTaskViewFilters(request.body?.filters);
    const prisma = getPrismaClient();
    const duplicate = await prisma.taskView.findFirst({
      where: {
        datasetId: context.value.datasetId,
        name,
        projectId: context.value.projectId,
        scope: "task_manager",
        userId: user.id
      },
      select: {
        id: true
      }
    });

    if (duplicate) {
      response.status(409).json({ error: "A saved view with that name already exists here." });
      return;
    }

    const view = await prisma.$transaction(async (tx) => {
      const created = await tx.taskView.create({
        data: {
          datasetId: context.value.datasetId,
          filters,
          isDefault: request.body?.isDefault === true,
          name,
          projectId: context.value.projectId,
          queue,
          scope: "task_manager",
          userId: user.id
        },
        select: taskViewSelect
      });

      await tx.auditLog.create({
        data: {
          action: "task.view_created",
          entityId: created.id,
          entityType: "task_view",
          metadata: {
            datasetId: context.value.datasetId,
            projectId: context.value.projectId,
            queue,
            requestId: getRequestId(request)
          },
          organizationId: context.value.organizationId,
          projectId: context.value.projectId,
          userId: user.id
        }
      });

      return created;
    });

    response.status(201).json({
      view: serializeTaskView(view)
    });
  });

  router.patch("/views/:viewId", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const viewId = normalizeId(request.params.viewId);

    if (!viewId) {
      response.status(400).json({ error: "Saved view is required." });
      return;
    }

    const prisma = getPrismaClient();
    const existing = await prisma.taskView.findFirst({
      where: {
        id: viewId,
        scope: "task_manager",
        userId: user.id
      },
      select: taskViewSelect
    });

    if (!existing) {
      response.status(404).json({ error: "Saved view was not found." });
      return;
    }

    const name = request.body?.name === undefined ? existing.name : normalizeShortText(request.body?.name, 80);

    if (!name) {
      response.status(400).json({ error: "View name is required." });
      return;
    }

    const contextChanged = request.body?.datasetId !== undefined || request.body?.projectId !== undefined;
    const context = contextChanged
      ? await resolveTaskViewContext(user.id, {
          datasetId: normalizeId(request.body?.datasetId),
          projectId: normalizeId(request.body?.projectId)
        })
      : {
          ok: true as const,
          value: {
            datasetId: existing.datasetId,
            organizationId: null,
            projectId: existing.projectId
          }
        };

    if (!context.ok) {
      response.status(context.status).json({ error: context.error });
      return;
    }

    const duplicate = await prisma.taskView.findFirst({
      where: {
        datasetId: context.value.datasetId,
        id: {
          not: viewId
        },
        name,
        projectId: context.value.projectId,
        scope: "task_manager",
        userId: user.id
      },
      select: {
        id: true
      }
    });

    if (duplicate) {
      response.status(409).json({ error: "A saved view with that name already exists here." });
      return;
    }

    const queue = parseTaskViewQueue(request.body?.queue) ?? (existing.queue === "review" ? "review" : "work");
    const view = await prisma.$transaction(async (tx) => {
      const updated = await tx.taskView.update({
        data: {
          datasetId: context.value.datasetId,
          ...(request.body?.filters !== undefined ? { filters: parseTaskViewFilters(request.body.filters) } : {}),
          ...(request.body?.isDefault !== undefined ? { isDefault: request.body.isDefault === true } : {}),
          name,
          projectId: context.value.projectId,
          queue
        },
        where: {
          id: viewId
        },
        select: taskViewSelect
      });

      await tx.auditLog.create({
        data: {
          action: "task.view_updated",
          entityId: updated.id,
          entityType: "task_view",
          metadata: {
            datasetId: updated.datasetId,
            projectId: updated.projectId,
            queue,
            requestId: getRequestId(request)
          },
          organizationId: context.value.organizationId,
          projectId: updated.projectId,
          userId: user.id
        }
      });

      return updated;
    });

    response.status(200).json({
      view: serializeTaskView(view)
    });
  });

  router.delete("/views/:viewId", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const viewId = normalizeId(request.params.viewId);

    if (!viewId) {
      response.status(400).json({ error: "Saved view is required." });
      return;
    }

    const prisma = getPrismaClient();
    const existing = await prisma.taskView.findFirst({
      where: {
        id: viewId,
        scope: "task_manager",
        userId: user.id
      },
      select: taskViewSelect
    });

    if (!existing) {
      response.status(404).json({ error: "Saved view was not found." });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.taskView.delete({
        where: {
          id: viewId
        }
      });

      await tx.auditLog.create({
        data: {
          action: "task.view_deleted",
          entityId: viewId,
          entityType: "task_view",
          metadata: {
            datasetId: existing.datasetId,
            projectId: existing.projectId,
            queue: existing.queue,
            requestId: getRequestId(request)
          },
          projectId: existing.projectId,
          userId: user.id
        }
      });
    });

    response.status(204).send();
  });
}

async function resolveTaskViewContext(
  userId: string,
  input: { datasetId?: string; projectId?: string }
): Promise<
  | { ok: true; value: TaskViewContext }
  | { error: string; ok: false; status: 400 | 404 }
> {
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(userId);

  if (input.datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: input.datasetId,
        project: {
          OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds)
        }
      },
      select: {
        id: true,
        project: {
          select: {
            id: true,
            organizationId: true
          }
        },
        projectId: true
      }
    });

    if (!dataset) {
      return { error: "Dataset was not found or you do not have access.", ok: false, status: 404 };
    }

    if (input.projectId && input.projectId !== dataset.projectId) {
      return { error: "Dataset does not belong to that project.", ok: false, status: 400 };
    }

    return {
      ok: true,
      value: {
        datasetId: dataset.id,
        organizationId: dataset.project.organizationId,
        projectId: dataset.projectId
      }
    };
  }

  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: input.projectId,
        OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds)
      },
      select: {
        id: true,
        organizationId: true
      }
    });

    if (!project) {
      return { error: "Project was not found or you do not have access.", ok: false, status: 404 };
    }

    return {
      ok: true,
      value: {
        datasetId: null,
        organizationId: project.organizationId,
        projectId: project.id
      }
    };
  }

  return {
    ok: true,
    value: {
      datasetId: null,
      organizationId: null,
      projectId: null
    }
  };
}

function parseTaskViewQueue(value: unknown): TaskViewQueue | undefined {
  return value === "review" || value === "work" ? value : undefined;
}

function getTaskColumnPreferenceName(queue: TaskViewQueue) {
  return `__columns_${queue}`;
}

function parseTaskColumnSettings(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawColumns = Array.isArray(record.columns) ? record.columns : defaultTaskColumns;
  const columns = rawColumns.filter((column): column is string => typeof column === "string" && taskColumnKeys.has(column));
  const uniqueColumns = [...new Set(columns)];

  return uniqueColumns.length > 0 ? uniqueColumns : [...defaultTaskColumns];
}

function parseTaskViewFilters(value: unknown): Prisma.InputJsonObject {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const assignment = record.assignment === "all" || record.assignment === "mine" || record.assignment === "unassigned"
    ? record.assignment
    : undefined;
  const due = record.due === "any" || record.due === "overdue" || record.due === "soon" || record.due === "none"
    ? record.due
    : undefined;
  const priority = Number(record.minPriority);
  const quality = typeof record.quality === "string" && taskQualityFilters.has(record.quality) ? record.quality : undefined;
  const search = normalizeShortText(record.search, 160);
  const status = parseTaskStatusQuery(record.status);

  return {
    ...(assignment ? { assignment } : {}),
    ...(due ? { due } : {}),
    ...(Number.isInteger(priority) && priority >= 0 && priority <= 10 ? { minPriority: priority } : {}),
    ...(quality ? { quality } : {}),
    ...(search ? { search } : {}),
    ...(status ? { status } : {})
  };
}

function serializeTaskView(view: TaskViewRecord) {
  return {
    createdAt: view.createdAt.toISOString(),
    datasetId: view.datasetId,
    filters: serializeTaskViewFilters(view.filters),
    id: view.id,
    isDefault: view.isDefault,
    name: view.name,
    projectId: view.projectId,
    queue: view.queue === "review" ? "review" : "work",
    sort: view.sort ?? null,
    updatedAt: view.updatedAt.toISOString()
  };
}

function serializeTaskViewFilters(value: Prisma.JsonValue) {
  const filters = parseTaskViewFilters(value);
  const status = typeof filters.status === "string" && Object.values(TaskStatus).includes(filters.status as TaskStatus)
    ? filters.status
    : undefined;

  return {
    ...(typeof filters.assignment === "string" ? { assignment: filters.assignment } : {}),
    ...(typeof filters.due === "string" ? { due: filters.due } : {}),
    ...(typeof filters.minPriority === "number" ? { minPriority: filters.minPriority } : {}),
    ...(typeof filters.quality === "string" ? { quality: filters.quality } : {}),
    ...(typeof filters.search === "string" ? { search: filters.search } : {}),
    ...(status ? { status } : {})
  };
}
