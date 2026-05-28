import { getPrismaClient } from "@goxai/database";
import { type Router } from "express";
import { type AuthenticatedRequest } from "../../shared/auth.js";
import {
  buildReviewTaskWhere,
  buildVisibleTaskWhere,
  getTaskAccessScope
} from "./taskAccess.js";
import {
  buildTaskQueueFilterWhere,
  getTaskQueueOrderBy,
  parseTaskQueueFilters
} from "./taskQueue.js";
import {
  serializeTaskListItem,
  taskListIncludes
} from "./taskSerializers.js";
import { normalizeId, normalizeShortText } from "./taskValidation.js";

const taskQueueExportLimit = 5000;

export function registerTaskQueueExportRoutes(router: Router) {
  router.get("/export", async (request: AuthenticatedRequest, response) => {
    const user = request.currentUser;

    if (!user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    const datasetId = normalizeId(request.query.datasetId);
    const projectId = normalizeId(request.query.projectId);
    const queue = normalizeShortText(request.query.queue, 40);
    const queueMode = queue === "review" ? "review" : "work";
    const format = request.query.format === "json" ? "json" : "csv";
    const queueFilters = parseTaskQueueFilters(request.query);
    const prisma = getPrismaClient();
    const scope = await getTaskAccessScope(user.id);
    const visibleWhere = queueMode === "review"
      ? buildReviewTaskWhere(scope, { datasetId, projectId })
      : buildVisibleTaskWhere(scope, { datasetId, projectId });
    const where = {
      AND: [
        visibleWhere,
        buildTaskQueueFilterWhere(queueFilters, {
          now: new Date(),
          queue: queueMode,
          userId: user.id
        })
      ]
    };
    const tasks = await prisma.task.findMany({
      where,
      include: taskListIncludes,
      orderBy: getTaskQueueOrderBy(),
      take: taskQueueExportLimit
    });
    const exportedAt = new Date();
    const serialized = tasks.map((task) =>
      serializeTaskListItem(task, scope.membershipByOrganizationId.get(task.project.organizationId) ?? scope.membershipByProjectId.get(task.projectId))
    );
    const file = format === "json"
      ? buildTaskQueueJsonExport(serialized, {
          exportedAt,
          limit: taskQueueExportLimit,
          queue: queueMode,
          truncated: tasks.length === taskQueueExportLimit
        })
      : buildTaskQueueCsvExport(serialized, exportedAt);

    response
      .status(200)
      .setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`)
      .setHeader("Content-Type", file.mimeType)
      .send(file.content);
  });
}

type SerializedTaskListItem = ReturnType<typeof serializeTaskListItem>;

function buildTaskQueueJsonExport(
  tasks: SerializedTaskListItem[],
  input: { exportedAt: Date; limit: number; queue: "review" | "work"; truncated: boolean }
) {
  return {
    content: Buffer.from(JSON.stringify({
      exportedAt: input.exportedAt.toISOString(),
      limit: input.limit,
      queue: input.queue,
      taskCount: tasks.length,
      tasks,
      truncated: input.truncated
    }, null, 2)),
    fileName: `task-queue-${formatDateStamp(input.exportedAt)}.json`,
    mimeType: "application/json"
  };
}

function buildTaskQueueCsvExport(tasks: SerializedTaskListItem[], exportedAt: Date) {
  const header = [
    "task_id",
    "asset",
    "dataset",
    "project",
    "status",
    "priority",
    "assignee",
    "assignee_email",
    "reviewer",
    "reviewer_email",
    "due_at",
    "annotation_credits",
    "review_credits",
    "total_credits",
    "currency",
    "quality_flags",
    "created_at",
    "updated_at"
  ];
  const rows = [
    header,
    ...tasks.map((task) => [
      task.id,
      task.asset?.fileName ?? "",
      task.dataset?.name ?? "",
      task.project.name,
      task.status,
      task.priority,
      task.assignedTo?.name ?? "",
      task.assignedTo?.email ?? "",
      task.reviewer?.name ?? "",
      task.reviewer?.email ?? "",
      task.dueAt ? new Date(task.dueAt).toISOString() : "",
      task.payment.annotationCredits,
      task.payment.reviewCredits,
      task.payment.totalCredits,
      task.payment.currency,
      task.qualityFlags.join("|"),
      new Date(task.createdAt).toISOString(),
      new Date(task.updatedAt).toISOString()
    ])
  ];

  return {
    content: Buffer.from(rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n")),
    fileName: `task-queue-${formatDateStamp(exportedAt)}.csv`,
    mimeType: "text/csv"
  };
}

function escapeCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function formatDateStamp(value: Date) {
  return value.toISOString().slice(0, 19).replace(/[-:T]/g, "");
}
