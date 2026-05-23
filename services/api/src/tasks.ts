import {
  getPrismaClient,
  TaskStatus,
  type Task
} from "@goxai/database";
import { Router, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId, saveAuditLog } from "./logging.js";
import { canGenerateTasks, canWorkTasks } from "./permissions.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const organizationIds = await getAccessibleOrganizationIds(user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({ tasks: [] });
    return;
  }

  if (datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: datasetId,
        organizationId: {
          in: organizationIds
        }
      },
      select: {
        id: true
      }
    });

    if (!dataset) {
      response.status(404).json({ error: "Dataset was not found or you do not have access." });
      return;
    }
  }

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId: {
          in: organizationIds
        }
      },
      select: {
        id: true
      }
    });

    if (!project) {
      response.status(404).json({ error: "Project was not found or you do not have access." });
      return;
    }
  }

  const tasks = await prisma.task.findMany({
    where: {
      project: {
        organizationId: {
          in: organizationIds
        }
      },
      ...(datasetId ? { datasetId } : {}),
      ...(projectId ? { projectId } : {})
    },
    include: taskIncludes,
    orderBy: [
      {
        priority: "desc"
      },
      {
        updatedAt: "desc"
      }
    ]
  });

  response.status(200).json({
    tasks: tasks.map(serializeTask)
  });
});

router.post("/generate-from-dataset", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.body?.datasetId);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: datasetId
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      projectId: true
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: dataset.organizationId,
      status: "ACTIVE"
    },
    select: {
      id: true,
      role: true
    }
  });

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to generate tasks for this dataset."
    });
    return;
  }

  const assets = await prisma.storageAsset.findMany({
    where: {
      datasetId: dataset.id,
      projectId: dataset.projectId,
      organizationId: dataset.organizationId
    },
    select: {
      id: true,
      fileName: true
    }
  });

  if (assets.length === 0) {
    response.status(400).json({ error: "Upload assets before generating tasks." });
    return;
  }

  const existingTasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id,
      assetId: {
        in: assets.map((asset) => asset.id)
      }
    },
    select: {
      assetId: true
    }
  });
  const existingAssetIds = new Set(existingTasks.map((task) => task.assetId).filter(Boolean));
  const missingAssets = assets.filter((asset) => !existingAssetIds.has(asset.id));

  if (missingAssets.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.task.createMany({
        data: missingAssets.map((asset) => ({
          projectId: dataset.projectId,
          datasetId: dataset.id,
          assetId: asset.id,
          status: TaskStatus.PENDING,
          metadata: {
            source: "dataset-generation",
            fileName: asset.fileName
          }
        }))
      });

      await tx.auditLog.create({
        data: {
          organizationId: dataset.organizationId,
          projectId: dataset.projectId,
          userId: user.id,
          action: "tasks.generated_from_dataset",
          entityType: "dataset",
          entityId: dataset.id,
          metadata: {
            requestId: getRequestId(request),
            datasetName: dataset.name,
            createdCount: missingAssets.length,
            skippedCount: existingAssetIds.size
          }
        }
      });
    });
  }

  const tasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id
    },
    include: taskIncludes,
    orderBy: [
      {
        priority: "desc"
      },
      {
        updatedAt: "desc"
      }
    ]
  });

  response.status(201).json({
    createdCount: missingAssets.length,
    skippedCount: existingAssetIds.size,
    tasks: tasks.map(serializeTask)
  });
});

router.post("/:taskId/assign-self", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "assign-self");
});

router.post("/:taskId/start", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "start");
});

router.post("/:taskId/submit", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "submit");
});

export { router as tasksRouter };

type TaskAction = "assign-self" | "start" | "submit";

async function updateTaskForUser(
  request: AuthenticatedRequest,
  response: Response,
  action: TaskAction
) {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const taskId = normalizeId(request.params.taskId);

  if (!taskId) {
    response.status(400).json({ error: "Task is required." });
    return;
  }

  const prisma = getPrismaClient();
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    include: {
      project: {
        select: {
          organizationId: true
        }
      }
    }
  });

  if (!task) {
    response.status(404).json({ error: "Task was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: task.project.organizationId,
      status: "ACTIVE"
    },
    select: {
      id: true,
      role: true
    }
  });

  if (!membership || !canWorkTasks(membership)) {
    response.status(403).json({ error: "You do not have access to this task." });
    return;
  }

  if (task.assignedToId && task.assignedToId !== user.id) {
    response.status(409).json({ error: "This task is already assigned to another user." });
    return;
  }

  const next = getTaskActionUpdate(task, action, user.id);

  if (!next.ok) {
    response.status(400).json({ error: next.error });
    return;
  }

  const updatedTask = await prisma.$transaction(async (tx) => {
    const savedTask = await tx.task.update({
      where: {
        id: task.id
      },
      data: next.data,
      include: taskIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId: savedTask.project.organizationId,
        projectId: savedTask.projectId,
        userId: user.id,
        action: `task.${action}`,
        entityType: "task",
        entityId: savedTask.id,
        metadata: {
          requestId: getRequestId(request),
          previousStatus: task.status,
          nextStatus: savedTask.status,
          assetId: savedTask.assetId,
          datasetId: savedTask.datasetId
        }
      }
    });

    return savedTask;
  });

  response.status(200).json({
    task: serializeTask(updatedTask)
  });
}

function getTaskActionUpdate(task: Task, action: TaskAction, userId: string):
  | {
      ok: true;
      data: {
        assignedToId?: string;
        status: TaskStatus;
      };
    }
  | { ok: false; error: string } {
  if (["APPROVED", "ARCHIVED"].includes(task.status)) {
    return { ok: false, error: "This task is already closed." };
  }

  if (action === "assign-self") {
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ASSIGNED) {
      return { ok: false, error: "Only pending or assigned tasks can be assigned." };
    }

    return {
      ok: true,
      data: {
        assignedToId: userId,
        status: TaskStatus.ASSIGNED
      }
    };
  }

  if (action === "start") {
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ASSIGNED) {
      return { ok: false, error: "Only pending or assigned tasks can be started." };
    }

    return {
      ok: true,
      data: {
        assignedToId: task.assignedToId ?? userId,
        status: TaskStatus.IN_PROGRESS
      }
    };
  }

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return { ok: false, error: "Only in-progress tasks can be submitted." };
  }

  return {
    ok: true,
    data: {
      assignedToId: task.assignedToId ?? userId,
      status: TaskStatus.SUBMITTED
    }
  };
}

async function getAccessibleOrganizationIds(userId: string) {
  const prisma = getPrismaClient();
  const memberships = await prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE"
    },
    select: {
      organizationId: true
    }
  });

  return [...new Set(memberships.map((membership) => membership.organizationId))];
}

const taskIncludes = {
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      organizationId: true
    }
  },
  dataset: {
    select: {
      id: true,
      name: true,
      version: true
    }
  },
  asset: {
    select: {
      id: true,
      fileName: true,
      objectKey: true,
      mimeType: true,
      fileSize: true
    }
  },
  assignedTo: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  reviewer: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

type TaskWithRelations = Task & {
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  };
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: bigint;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

function serializeTask(task: TaskWithRelations) {
  return {
    id: task.id,
    projectId: task.projectId,
    datasetId: task.datasetId,
    assetId: task.assetId,
    status: task.status,
    priority: task.priority,
    assignedToId: task.assignedToId,
    reviewerId: task.reviewerId,
    metadata: task.metadata,
    dueAt: task.dueAt,
    project: task.project,
    dataset: task.dataset,
    asset: task.asset
      ? {
          ...task.asset,
          fileSize: task.asset.fileSize.toString()
        }
      : null,
    assignedTo: task.assignedTo ? serializeUserName(task.assignedTo) : null,
    reviewer: task.reviewer ? serializeUserName(task.reviewer) : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function serializeUserName(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  };
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
