import {
  AnnotationTool,
  AnnotationRegionType,
  AnnotationStatus,
  getPrismaClient,
  MembershipRole,
  Prisma,
  ProjectAccessMode,
  ProjectStatus,
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
  const [memberships, projectMemberships] = await Promise.all([
    getActiveMemberships(user.id),
    prisma.projectMembership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE"
      },
      select: {
        projectId: true,
        role: true
      }
    })
  ]);
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const membershipByOrganizationId = new Map(memberships.map((membership) => [membership.organizationId, membership]));
  const projectIds = [...new Set(projectMemberships.map((membership) => membership.projectId))];
  const membershipByProjectId = new Map(projectMemberships.map((membership) => [membership.projectId, membership]));

  if (organizationIds.length === 0 && projectIds.length === 0 && !datasetId && !projectId) {
    response.status(200).json({ tasks: [] });
    return;
  }

  if (datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: datasetId,
        project: {
          OR: [
            {
              organizationId: {
                in: organizationIds
              }
            },
            {
              id: {
                in: projectIds
              }
            },
            {
              accessMode: ProjectAccessMode.PUBLIC,
              status: ProjectStatus.ACTIVE
            }
          ]
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
        OR: [
          {
            organizationId: {
              in: organizationIds
            }
          },
          {
            id: {
              in: projectIds
            }
          },
          {
            accessMode: ProjectAccessMode.PUBLIC,
            status: ProjectStatus.ACTIVE
          }
        ]
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
        OR: [
          {
            organizationId: {
              in: organizationIds
            }
          },
          {
            id: {
              in: projectIds
            }
          },
          {
            accessMode: ProjectAccessMode.PUBLIC,
            status: ProjectStatus.ACTIVE
          }
        ]
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

  const visibleTasks = tasks.filter((task) => {
    const membership = membershipByOrganizationId.get(task.project.organizationId) ?? membershipByProjectId.get(task.projectId);
    return Boolean(
      (membership && canGenerateTasks(membership)) ||
        (task.project.status === ProjectStatus.ACTIVE && task.status !== TaskStatus.ARCHIVED)
    );
  });

  response.status(200).json({
    tasks: visibleTasks.map((task) =>
      serializeTask(task, membershipByOrganizationId.get(task.project.organizationId) ?? membershipByProjectId.get(task.projectId))
    )
  });
});

router.post("/generate-from-dataset", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.body?.datasetId);
  const hasQuantity = Object.prototype.hasOwnProperty.call(request.body ?? {}, "quantity");
  const quantity = normalizePositiveInteger(request.body?.quantity);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return;
  }

  if (hasQuantity && !quantity) {
    response.status(400).json({ error: "Quantity must be a whole number greater than 0." });
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
    orderBy: {
      createdAt: "asc"
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
  const assetsToCreate = quantity ? missingAssets.slice(0, quantity) : missingAssets;
  const remainingCount = Math.max(0, missingAssets.length - assetsToCreate.length);

  if (assetsToCreate.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.task.createMany({
        data: assetsToCreate.map((asset) => ({
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
            createdCount: assetsToCreate.length,
            remainingCount,
            requestedQuantity: quantity ?? "all",
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
    createdCount: assetsToCreate.length,
    remainingCount,
    skippedCount: existingAssetIds.size,
    tasks: tasks.map((task) => serializeTask(task, membership))
  });
});

router.post("/:taskId/assign-self", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "assign-self");
});

router.get("/:taskId", async (request: AuthenticatedRequest, response) => {
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

  const access = await getTaskAccess(user.id, taskId);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  response.status(200).json({
    annotation: serializeAnnotation(access.annotation),
    task: serializeTask(access.task, access.membership)
  });
});

router.post("/:taskId/annotation", async (request: AuthenticatedRequest, response) => {
  await saveTaskAnnotation(request, response, "draft");
});

router.post("/:taskId/annotation/submit", async (request: AuthenticatedRequest, response) => {
  await saveTaskAnnotation(request, response, "submit");
});

router.post("/:taskId/start", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "start");
});

router.post("/:taskId/submit", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "submit");
});

export { router as tasksRouter };

type TaskAction = "assign-self" | "start" | "submit";
type AnnotationAction = "draft" | "submit";

async function getTaskAccess(userId: string, taskId: string):
  Promise<
    | {
        ok: true;
        annotation: AnnotationWithRegions | null;
        membership?: { role: MembershipRole };
        task: TaskWithDetailRelations;
      }
    | { ok: false; error: string; status: number }
  > {
  const prisma = getPrismaClient();
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
    },
    include: taskDetailIncludes
  });

  if (!task) {
    return { ok: false, error: "Task was not found.", status: 404 };
  }

  const [membership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        userId,
        organizationId: task.project.organizationId,
        status: "ACTIVE"
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        userId,
        projectId: task.projectId,
        status: "ACTIVE"
      },
      select: {
        role: true
      }
    })
  ]);
  const effectiveMembership = membership ?? projectMembership ?? undefined;
  const canManage = Boolean(effectiveMembership && canGenerateTasks(effectiveMembership));
  const canReadActivePublicTask = task.project.accessMode === ProjectAccessMode.PUBLIC && task.project.status === ProjectStatus.ACTIVE;

  if (!effectiveMembership && !canReadActivePublicTask) {
    return { ok: false, error: "You do not have access to this task.", status: 403 };
  }

  if (!canManage && (task.project.status !== ProjectStatus.ACTIVE || task.status === TaskStatus.ARCHIVED)) {
    return { ok: false, error: "Task was not found or you do not have access.", status: 404 };
  }

  const annotation =
    task.annotations.find((item) => item.userId === userId && item.status === AnnotationStatus.DRAFT) ??
    task.annotations.find((item) => item.userId === userId) ??
    task.annotations[0] ??
    null;

  return {
    ok: true,
    annotation,
    membership: effectiveMembership,
    task
  };
}

async function saveTaskAnnotation(request: AuthenticatedRequest, response: Response, action: AnnotationAction) {
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

  const access = await getTaskAccess(user.id, taskId);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  if (!access.membership || !canWorkTasks(access.membership)) {
    response.status(403).json({ error: "You do not have permission to annotate this task." });
    return;
  }

  if (access.task.assignedToId && access.task.assignedToId !== user.id) {
    response.status(409).json({ error: "This task is assigned to another user." });
    return;
  }

  const parsed = parseAnnotationBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const status = action === "submit" ? AnnotationStatus.SUBMITTED : AnnotationStatus.DRAFT;
  const submittedAt = action === "submit" ? new Date() : null;
  const existingDraft = access.annotation?.status === AnnotationStatus.DRAFT ? access.annotation : null;
  const version = existingDraft ? existingDraft.version : Math.max(0, ...access.task.annotations.map((annotation) => annotation.version)) + 1;

  const savedAnnotation = await prisma.$transaction(async (tx) => {
    const annotation = existingDraft
      ? await tx.annotation.update({
          where: {
            id: existingDraft.id
          },
          data: {
            leadTimeSeconds: parsed.value.leadTimeSeconds,
            resultJson: parsed.value.resultJson,
            status,
            submittedAt
          }
        })
      : await tx.annotation.create({
          data: {
            leadTimeSeconds: parsed.value.leadTimeSeconds,
            projectId: access.task.projectId,
            resultJson: parsed.value.resultJson,
            status,
            submittedAt,
            taskId: access.task.id,
            userId: user.id,
            version
          }
        });

    await tx.annotationRegion.deleteMany({
      where: {
        annotationId: annotation.id
      }
    });

    if (parsed.value.regions.length > 0) {
      await tx.annotationRegion.createMany({
        data: parsed.value.regions.map((region) => ({
          annotationId: annotation.id,
          geometryJson: region.geometryJson,
          label: region.label,
          metadata: region.metadata as Prisma.InputJsonObject,
          type: region.type
        }))
      });
    }

    if (action === "submit") {
      await tx.task.update({
        where: {
          id: access.task.id
        },
        data: {
          assignedToId: access.task.assignedToId ?? user.id,
          status: TaskStatus.SUBMITTED
        }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: access.task.project.organizationId,
        projectId: access.task.projectId,
        userId: user.id,
        action: action === "submit" ? "annotation.submitted" : "annotation.saved",
        entityType: "annotation",
        entityId: annotation.id,
        metadata: {
          requestId: getRequestId(request),
          regionCount: parsed.value.regions.length,
          taskId: access.task.id,
          version
        }
      }
    });

    return tx.annotation.findUniqueOrThrow({
      where: {
        id: annotation.id
      },
      include: annotationIncludes
    });
  });

  const savedTask = await prisma.task.findUniqueOrThrow({
    where: {
      id: access.task.id
    },
    include: taskDetailIncludes
  });

  response.status(action === "submit" ? 200 : 201).json({
    annotation: serializeAnnotation(savedAnnotation),
    task: serializeTask(savedTask, access.membership)
  });
}

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
          id: true,
          organizationId: true
        }
      }
    }
  });

  if (!task) {
    response.status(404).json({ error: "Task was not found." });
    return;
  }

  const [membership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: task.project.organizationId,
        status: "ACTIVE"
      },
      select: {
        id: true,
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        userId: user.id,
        projectId: task.project.id,
        status: "ACTIVE"
      },
      select: {
        id: true,
        role: true
      }
    })
  ]);
  const effectiveMembership = membership ?? projectMembership;

  if (!effectiveMembership || !canWorkTasks(effectiveMembership)) {
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
    task: serializeTask(updatedTask, effectiveMembership)
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

async function getActiveMemberships(userId: string) {
  const prisma = getPrismaClient();
  return prisma.membership.findMany({
    where: {
      userId,
      status: "ACTIVE"
    },
    select: {
      organizationId: true,
      role: true
    }
  });
}

const taskIncludes = {
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      organizationId: true,
      status: true,
      accessMode: true
    }
  },
  dataset: {
    select: {
      id: true,
      name: true,
      version: true,
      labelingConfig: true,
      labels: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          id: true,
          name: true,
          color: true,
          shortcutKey: true,
          metadata: true
        }
      },
      tools: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          id: true,
          tool: true,
          enabled: true,
          configJson: true
        }
      }
    }
  },
  asset: {
    select: {
      id: true,
      fileName: true,
      objectKey: true,
      mimeType: true,
      fileSize: true,
      width: true,
      height: true
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

const annotationIncludes = {
  regions: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      type: true,
      label: true,
      geometryJson: true,
      confidence: true,
      metadata: true,
      createdAt: true,
      updatedAt: true
    }
  },
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

const taskDetailIncludes = {
  ...taskIncludes,
  annotations: {
    orderBy: {
      version: "desc"
    },
    include: annotationIncludes
  }
} as const;

type TaskWithRelations = Task & {
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    status: ProjectStatus;
    accessMode: ProjectAccessMode;
  };
  dataset: {
    id: string;
    name: string;
    version: number;
    labelingConfig: unknown;
    labels: {
      id: string;
      name: string;
      color: string;
      shortcutKey: string | null;
      metadata: unknown;
    }[];
    tools: {
      id: string;
      tool: AnnotationTool;
      enabled: boolean;
      configJson: unknown;
    }[];
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: bigint;
    width: number | null;
    height: number | null;
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

type TaskWithDetailRelations = TaskWithRelations & {
  annotations: AnnotationWithRegions[];
};

type AnnotationWithRegions = {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  status: AnnotationStatus;
  resultJson: unknown;
  leadTimeSeconds: number | null;
  version: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  regions: {
    id: string;
    type: AnnotationRegionType;
    label: string | null;
    geometryJson: unknown;
    confidence: number | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }[];
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

function serializeTask(task: TaskWithRelations, membership?: { role: MembershipRole }) {
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
    canWork: membership ? canWorkTasks(membership) : false,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function serializeAnnotation(annotation: AnnotationWithRegions | null) {
  if (!annotation) {
    return null;
  }

  return {
    id: annotation.id,
    taskId: annotation.taskId,
    projectId: annotation.projectId,
    userId: annotation.userId,
    status: annotation.status,
    resultJson: annotation.resultJson,
    leadTimeSeconds: annotation.leadTimeSeconds,
    version: annotation.version,
    submittedAt: annotation.submittedAt,
    user: serializeUserName(annotation.user),
    regions: annotation.regions.map((region) => ({
      id: region.id,
      type: region.type,
      label: region.label,
      geometryJson: region.geometryJson,
      confidence: region.confidence,
      metadata: region.metadata,
      createdAt: region.createdAt,
      updatedAt: region.updatedAt
    })),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt
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

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const values = Object.values(enumValues);
  return values.includes(value) ? (value as T[keyof T]) : undefined;
}

function parseAnnotationBody(body: unknown):
  | {
      ok: true;
      value: {
        leadTimeSeconds?: number;
        regions: {
          geometryJson: Prisma.InputJsonObject;
          label: string | null;
          metadata: Record<string, unknown>;
          type: AnnotationRegionType;
        }[];
        resultJson: {
          regions: {
            geometry: Prisma.InputJsonObject;
            label: string | null;
            type: "BBOX" | "POLYGON";
          }[];
        };
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Annotation payload is required." };
  }

  const payload = body as Record<string, unknown>;
  const rawRegions = Array.isArray(payload.regions) ? payload.regions : [];

  if (rawRegions.length > 250) {
    return { ok: false, error: "Save up to 250 regions per annotation for now." };
  }

  const regions = [];

  for (const rawRegion of rawRegions) {
    if (!rawRegion || typeof rawRegion !== "object") {
      return { ok: false, error: "Each annotation region must be an object." };
    }

    const region = rawRegion as Record<string, unknown>;
    const type = parseEnumValue(AnnotationRegionType, region.type) ?? AnnotationRegionType.BBOX;
    const geometry = region.geometry;

    if (!geometry || typeof geometry !== "object") {
      return { ok: false, error: "Each annotation region needs geometry." };
    }

    const label = typeof region.label === "string" && region.label.trim() ? region.label.trim().slice(0, 120) : null;

    if (type === AnnotationRegionType.BBOX) {
      const box = geometry as Record<string, unknown>;
      const x = normalizeUnitNumber(box.x);
      const y = normalizeUnitNumber(box.y);
      const width = normalizeUnitNumber(box.width);
      const height = normalizeUnitNumber(box.height);

      if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
        return { ok: false, error: "Bounding boxes must use normalized x, y, width, and height values." };
      }

      const geometryJson = {
        height,
        width,
        x,
        y
      };

      regions.push({
        geometryJson,
        label,
        metadata: {
          tool: "bbox"
        },
        type
      });
      continue;
    }

    if (type !== AnnotationRegionType.POLYGON) {
      return { ok: false, error: "This annotation tool is not supported yet." };
    }

    const points = Array.isArray((geometry as Record<string, unknown>).points)
      ? ((geometry as Record<string, unknown>).points as unknown[])
      : [];

    if (points.length < 3 || points.length > 200) {
      return { ok: false, error: "Polygons must have between 3 and 200 points." };
    }

    const normalizedPoints = points.map((point) => {
      if (!point || typeof point !== "object") {
        return null;
      }

      const record = point as Record<string, unknown>;
      const x = normalizeUnitNumber(record.x);
      const y = normalizeUnitNumber(record.y);

      return x === null || y === null ? null : { x, y };
    });

    if (normalizedPoints.some((point) => point === null)) {
      return { ok: false, error: "Polygon points must use normalized x and y values." };
    }

    const geometryJson = {
      points: normalizedPoints as { x: number; y: number }[]
    };

    regions.push({
      geometryJson,
      label,
      metadata: {
        tool: "polygon"
      },
      type
    });
  }

  const leadTimeSeconds =
    typeof payload.leadTimeSeconds === "number" && Number.isFinite(payload.leadTimeSeconds) && payload.leadTimeSeconds >= 0
      ? payload.leadTimeSeconds
      : undefined;

  return {
    ok: true,
    value: {
      leadTimeSeconds,
      regions,
      resultJson: {
        regions: regions.map((region) => ({
          geometry: region.geometryJson,
          label: region.label,
          type: region.type === AnnotationRegionType.POLYGON ? "POLYGON" : "BBOX"
        }))
      }
    }
  };
}

function normalizeUnitNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
