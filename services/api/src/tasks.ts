import {
  AnnotationTool,
  AnnotationRegionType,
  AnnotationStatus,
  getPrismaClient,
  MembershipRole,
  Prisma,
  ProjectAccessMode,
  ProjectStatus,
  ReviewStatus,
  TaskStatus,
  type Task
} from "@goxai/database";
import { Router, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { recordDatasetVersionChange } from "./datasets.js";
import { getRequestId } from "./logging.js";
import { canGenerateTasks, canReviewTasks, canWorkTasks } from "./permissions.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/stats", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(user.id);
  const where = buildVisibleTaskWhere(scope, { datasetId, projectId });
  const statusGroups = await prisma.task.groupBy({
    by: ["status", "assignedToId"],
    where,
    _count: {
      _all: true
    }
  });

  response.status(200).json({
    stats: summarizeTaskStatsForGroups(statusGroups)
  });
});

router.get("/folders", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(user.id);

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds)
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true
      }
    });

    if (!project) {
      response.status(404).json({ error: "Project was not found or you do not have access." });
      return;
    }

    const where = buildVisibleTaskWhere(scope, { projectId });
    const [statusGroups, datasets] = await Promise.all([
      prisma.task.groupBy({
        by: ["datasetId", "status", "assignedToId"],
        where: {
          ...where,
          datasetId: {
            not: null
          }
        },
        _count: {
          _all: true
        }
      }),
      prisma.dataset.findMany({
        where: {
          projectId
        },
        select: {
          id: true,
          name: true,
          version: true
        }
      })
    ]);
    const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]));

    response.status(200).json({
      datasets: summarizeDatasetTaskFolders(statusGroups, project, datasetById),
      project
    });
    return;
  }

  const where = buildVisibleTaskWhere(scope);
  const [statusGroups, datasetGroups] = await Promise.all([
    prisma.task.groupBy({
      by: ["projectId", "status", "assignedToId"],
      where,
      _count: {
        _all: true
      }
    }),
    prisma.task.groupBy({
      by: ["projectId", "datasetId"],
      where: {
        ...where,
        datasetId: {
          not: null
        }
      },
      _count: {
        _all: true
      }
    })
  ]);
  const projects = await prisma.project.findMany({
    where: {
      id: {
        in: [...new Set(statusGroups.map((group) => group.projectId))]
      }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true
    }
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));

  response.status(200).json({
    projects: summarizeProjectTaskFolders(statusGroups, datasetGroups, projectById)
  });
});

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);
  const queue = normalizeShortText(request.query.queue, 40);
  const queueFilters = parseTaskQueueFilters(request.query);
  const page = normalizePositiveInteger(request.query.page);
  const requestedPageSize = normalizePositiveInteger(request.query.pageSize);
  const isPaginated = Boolean(page || requestedPageSize);
  const pageNumber = page ?? 1;
  const pageSize = Math.min(requestedPageSize ?? 25, 100);
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(user.id);

  if (datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: datasetId,
        project: {
          OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds)
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
        OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds)
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

  const visibleWhere = queue === "review"
    ? buildReviewTaskWhere(scope, { datasetId, projectId })
    : buildVisibleTaskWhere(scope, { datasetId, projectId });
  const where = {
    AND: [
      visibleWhere,
      buildTaskQueueFilterWhere(queueFilters, {
        now: new Date(),
        userId: user.id
      })
    ]
  };
  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: taskListIncludes,
      orderBy: getTaskQueueOrderBy(),
      ...(isPaginated
        ? {
            skip: (pageNumber - 1) * pageSize,
            take: pageSize
          }
        : {})
    }),
    isPaginated ? prisma.task.count({ where }) : Promise.resolve(0)
  ]);

  response.status(200).json({
    page: pageNumber,
    pageSize,
    tasks: tasks.map((task) => serializeTaskListItem(task, scope.membershipByOrganizationId.get(task.project.organizationId) ?? scope.membershipByProjectId.get(task.projectId))),
    total: isPaginated ? total : tasks.length,
    totalPages: isPaginated ? Math.max(1, Math.ceil(total / pageSize)) : 1
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
      labelingConfig: true,
      labels: {
        select: {
          id: true
        }
      },
      name: true,
      metadata: true,
      organizationId: true,
      projectId: true,
      tools: {
        select: {
          enabled: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const configIssue = getDatasetGenerationConfigIssue(dataset);

  if (configIssue) {
    response.status(400).json({ error: configIssue });
    return;
  }

  const workflowDefaults = parseDatasetTaskWorkflowBody(request.body, {
    fallback: readDatasetTaskWorkflowDefaults(dataset.metadata),
    requireWorkflow: false
  });

  if (!workflowDefaults.ok) {
    response.status(400).json({ error: workflowDefaults.error });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, dataset.projectId, dataset.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to generate tasks for this dataset."
    });
    return;
  }

  const workflowValidationError = await validateDatasetTaskWorkflowMembers(workflowDefaults.value, dataset.projectId, dataset.organizationId);

  if (workflowValidationError) {
    response.status(400).json({ error: workflowValidationError });
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
        data: assetsToCreate.map((asset, index) => {
          const assignedToId = getDatasetWorkflowAssignee(workflowDefaults.value, index);

          return {
            projectId: dataset.projectId,
            datasetId: dataset.id,
            assetId: asset.id,
            status: assignedToId ? TaskStatus.ASSIGNED : TaskStatus.PENDING,
            assignedToId,
            reviewerId: workflowDefaults.value.reviewerId,
            priority: workflowDefaults.value.priority,
            dueAt: workflowDefaults.value.dueAt,
            metadata: {
              source: "dataset-generation",
              fileName: asset.fileName
            }
          };
        })
      });

      if (workflowDefaults.saveDefaults) {
        await tx.dataset.update({
          where: {
            id: dataset.id
          },
          data: {
            metadata: mergeDatasetTaskWorkflowDefaults(dataset.metadata, workflowDefaults.value)
          }
        });
      }

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
            skippedCount: existingAssetIds.size,
            workflow: serializeDatasetTaskWorkflowDefaults(workflowDefaults.value)
          }
        }
      });

      await recordDatasetVersionChange(tx, {
        datasetId: dataset.id,
        reason: "tasks_generated",
        summary: {
          createdCount: assetsToCreate.length,
          remainingCount,
          requestedQuantity: quantity ?? "all",
          skippedCount: existingAssetIds.size,
          savedWorkflowDefaults: workflowDefaults.saveDefaults,
          workflow: serializeDatasetTaskWorkflowDefaults(workflowDefaults.value)
        },
        userId: user.id
      });
    });
  }

  if (assetsToCreate.length === 0 && workflowDefaults.saveDefaults) {
    await prisma.dataset.update({
      where: {
        id: dataset.id
      },
      data: {
        metadata: mergeDatasetTaskWorkflowDefaults(dataset.metadata, workflowDefaults.value)
      }
    });
  }

  const tasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id
    },
    include: taskIncludes,
    orderBy: getTaskQueueOrderBy()
  });

  response.status(201).json({
    createdCount: assetsToCreate.length,
    remainingCount,
    skippedCount: existingAssetIds.size,
    tasks: tasks.map((task) => serializeTask(task, membership))
  });
});

router.patch("/dataset-workflow", async (request: AuthenticatedRequest, response) => {
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
      metadata: true,
      organizationId: true,
      projectId: true
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const parsed = parseDatasetTaskWorkflowBody(request.body, {
    fallback: readDatasetTaskWorkflowDefaults(dataset.metadata),
    requireWorkflow: true
  });

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, dataset.projectId, dataset.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({ error: "You need owner, admin, or manager access to update this dataset queue." });
    return;
  }

  const workflowValidationError = await validateDatasetTaskWorkflowMembers(parsed.value, dataset.projectId, dataset.organizationId);

  if (workflowValidationError) {
    response.status(400).json({ error: workflowValidationError });
    return;
  }

  const activeStatuses = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED];
  const result = await prisma.$transaction(async (tx) => {
    const activeTasks = await tx.task.findMany({
      where: {
        datasetId: dataset.id,
        status: {
          in: activeStatuses
        }
      },
      orderBy: getTaskQueueOrderBy(),
      select: {
        id: true,
        status: true
      }
    });

    if (parsed.value.assignmentMode === "round_robin") {
      await Promise.all(
        activeTasks.map((task, index) => {
          const assignedToId = getDatasetWorkflowAssignee(parsed.value, index);

          return tx.task.update({
            where: {
              id: task.id
            },
            data: {
              ...buildDatasetTaskWorkflowUpdateData(parsed.value, assignedToId),
              status: assignedToId && task.status === TaskStatus.PENDING
                ? TaskStatus.ASSIGNED
                : !assignedToId && task.status === TaskStatus.ASSIGNED
                  ? TaskStatus.PENDING
                  : task.status
            }
          });
        })
      );
    } else {
      const assignedToId = getDatasetWorkflowAssignee(parsed.value, 0);
      await tx.task.updateMany({
        where: {
          id: {
            in: activeTasks.map((task) => task.id)
          }
        },
        data: buildDatasetTaskWorkflowUpdateData(parsed.value, assignedToId)
      });

      if (assignedToId) {
        await tx.task.updateMany({
          where: {
            id: {
              in: activeTasks.filter((task) => task.status === TaskStatus.PENDING).map((task) => task.id)
            }
          },
          data: {
            status: TaskStatus.ASSIGNED
          }
        });
      } else {
        await tx.task.updateMany({
          where: {
            id: {
              in: activeTasks.filter((task) => task.status === TaskStatus.ASSIGNED).map((task) => task.id)
            }
          },
          data: {
            status: TaskStatus.PENDING
          }
        });
      }
    }

    if (parsed.saveDefaults) {
      await tx.dataset.update({
        where: {
          id: dataset.id
        },
        data: {
          metadata: mergeDatasetTaskWorkflowDefaults(dataset.metadata, parsed.value)
        }
      });
    }

    if (activeTasks.length > 0 || parsed.saveDefaults) {
      await tx.auditLog.create({
        data: {
          organizationId: dataset.organizationId,
          projectId: dataset.projectId,
          userId: user.id,
          action: "task.dataset_workflow.updated",
          entityType: "dataset",
          entityId: dataset.id,
          metadata: {
            requestId: getRequestId(request),
            changes: serializeDatasetTaskWorkflowDefaults(parsed.value),
            datasetName: dataset.name,
            savedWorkflowDefaults: parsed.saveDefaults,
            updatedCount: activeTasks.length
          }
        }
      });

      await recordDatasetVersionChange(tx, {
        datasetId: dataset.id,
        reason: "task_workflow_updated",
        summary: {
          savedWorkflowDefaults: parsed.saveDefaults,
          updatedCount: activeTasks.length
        },
        userId: user.id
      });
    }

    return {
      count: activeTasks.length
    };
  });

  const tasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id
    },
    include: taskIncludes,
    orderBy: getTaskQueueOrderBy()
  });

  response.status(200).json({
    tasks: tasks.map((task) => serializeTask(task, membership)),
    updatedCount: result.count
  });
});

router.post("/assign-dataset-to-self", async (request: AuthenticatedRequest, response) => {
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
      project: {
        select: {
          id: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const [membership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: dataset.organizationId,
        status: "ACTIVE"
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        userId: user.id,
        projectId: dataset.project.id,
        status: "ACTIVE"
      },
      select: {
        role: true
      }
    })
  ]);
  const effectiveMembership = membership ?? projectMembership;

  if (!effectiveMembership || !canWorkTasks(effectiveMembership)) {
    response.status(403).json({ error: "You do not have permission to work tasks in this dataset." });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.updateMany({
      where: {
        assignedToId: null,
        datasetId: dataset.id,
        status: {
          in: [TaskStatus.PENDING, TaskStatus.ASSIGNED]
        }
      },
      data: {
        assignedToId: user.id,
        status: TaskStatus.ASSIGNED
      }
    });

    if (updated.count > 0) {
      await tx.auditLog.create({
        data: {
          organizationId: dataset.organizationId,
          projectId: dataset.project.id,
          userId: user.id,
          action: "task.dataset_assigned_self",
          entityType: "dataset",
          entityId: dataset.id,
          metadata: {
            requestId: getRequestId(request),
            assignedCount: updated.count,
            datasetName: dataset.name
          }
        }
      });
    }

    return updated;
  });

  response.status(200).json({
    assignedCount: result.count
  });
});

router.get("/participants", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);

  if (!projectId) {
    response.status(400).json({ error: "Project is required." });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    select: {
      createdById: true,
      id: true,
      organizationId: true,
      organization: {
        select: {
          memberships: {
            where: {
              status: "ACTIVE"
            },
            select: {
              role: true,
              user: {
                select: {
                  email: true,
                  firstName: true,
                  id: true,
                  lastName: true
                }
              },
              userId: true
            }
          }
        }
      },
      projectMemberships: {
        where: {
          status: "ACTIVE"
        },
        select: {
          role: true,
          user: {
            select: {
              email: true,
              firstName: true,
              id: true,
              lastName: true
            }
          },
          userId: true
        }
      }
    }
  });

  if (!project) {
    response.status(404).json({ error: "Project was not found." });
    return;
  }

  const manager = await getEffectiveProjectMembership(user.id, project.id, project.organizationId);

  if (project.createdById !== user.id && (!manager || !canGenerateTasks(manager))) {
    response.status(403).json({ error: "You need manager access to view task assignment controls." });
    return;
  }

  const participants = new Map<string, {
    canReview: boolean;
    canWork: boolean;
    email: string;
    id: string;
    name: string;
    roles: Set<MembershipRole>;
  }>();

  for (const membership of [...project.organization.memberships, ...project.projectMemberships]) {
    const existing = participants.get(membership.userId);
    const roles = existing?.roles ?? new Set<MembershipRole>();
    roles.add(membership.role);
    participants.set(membership.userId, {
      canReview: [...roles].some((role) => canReviewTasks({ role })),
      canWork: [...roles].some((role) => canWorkTasks({ role })),
      email: membership.user.email,
      id: membership.user.id,
      name: serializeUserName(membership.user).name,
      roles
    });
  }

  response.status(200).json({
    participants: [...participants.values()]
      .map((participant) => ({
        canReview: participant.canReview,
        canWork: participant.canWork,
        email: participant.email,
        id: participant.id,
        name: participant.name,
        roles: [...participant.roles]
      }))
      .filter((participant) => participant.canWork || participant.canReview)
      .sort((left, right) => left.name.localeCompare(right.name))
  });
});

router.post("/:taskId/assign-self", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "assign-self");
});

router.patch("/:taskId/workflow", async (request: AuthenticatedRequest, response) => {
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

  const parsed = parseTaskWorkflowBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const task = await prisma.task.findUnique({
    where: {
      id: taskId
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
      reviewerId: true
    }
  });

  if (!task) {
    response.status(404).json({ error: "Task was not found." });
    return;
  }

  const manager = await getEffectiveProjectMembership(user.id, task.project.id, task.project.organizationId);

  if (task.project.createdById !== user.id && (!manager || !canGenerateTasks(manager))) {
    response.status(403).json({ error: "You need manager access to update this task queue." });
    return;
  }

  if (parsed.value.assignedToId !== undefined && parsed.value.assignedToId !== null) {
    const canAssign = await userCanWorkProjectTasks(parsed.value.assignedToId, task.project.id, task.project.organizationId);

    if (!canAssign) {
      response.status(400).json({ error: "Choose a project member who can work tasks." });
      return;
    }
  }

  if (parsed.value.reviewerId !== undefined && parsed.value.reviewerId !== null) {
    const canReview = await userCanReviewProjectTasks(parsed.value.reviewerId, task.project.id, task.project.organizationId);

    if (!canReview) {
      response.status(400).json({ error: "Choose a reviewer, manager, admin, or owner for review." });
      return;
    }
  }

  const updatedTask = await prisma.$transaction(async (tx) => {
    const saved = await tx.task.update({
      where: {
        id: task.id
      },
      data: parsed.value,
      include: taskIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId: saved.project.organizationId,
        projectId: saved.projectId,
        userId: user.id,
        action: "task.workflow.updated",
        entityType: "task",
        entityId: saved.id,
        metadata: {
          changes: parsed.value,
          previous: {
            assignedToId: task.assignedToId,
            dueAt: task.dueAt,
            priority: task.priority,
            reviewerId: task.reviewerId
          },
          requestId: getRequestId(request)
        }
      }
    });

    return saved;
  });

  response.status(200).json({
    task: serializeTask(updatedTask, manager ?? { role: MembershipRole.OWNER })
  });
});

router.get("/:taskId/next", async (request: AuthenticatedRequest, response) => {
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

  const datasetId = normalizeId(request.query.datasetId) ?? access.task.datasetId ?? undefined;
  const projectId = normalizeId(request.query.projectId) ?? access.task.projectId;
  const queue = normalizeShortText(request.query.queue, 40);
  const taskQueueFilters = parseTaskQueueFilters(request.query);
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(user.id);
  const visibleWhere = queue === "review"
    ? buildReviewTaskWhere(scope, { datasetId, projectId })
    : buildVisibleTaskWhere(scope, { datasetId, projectId });
  const where = {
    AND: [
      visibleWhere,
      buildTaskQueueFilterWhere(taskQueueFilters, {
        now: new Date(),
        userId: user.id
      })
    ]
  };
  const queueFilters: Prisma.TaskWhereInput = queue === "review"
    ? {
        status: {
          in: [TaskStatus.SUBMITTED, TaskStatus.REVIEWING]
        }
      }
    : {
        assignedToId: user.id,
        status: {
          in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]
        }
      };
  const nextTask = await prisma.task.findFirst({
    where: {
      AND: [
        where,
        {
          id: {
            not: access.task.id
          },
          ...queueFilters,
          OR: getNextTaskCursorWhere(access.task)
        }
      ]
    },
    include: taskListIncludes,
    orderBy: getTaskQueueOrderBy()
  });

  response.status(200).json({
    task: nextTask
      ? serializeTaskListItem(nextTask, scope.membershipByOrganizationId.get(nextTask.project.organizationId) ?? scope.membershipByProjectId.get(nextTask.projectId))
      : null
  });
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
    annotationHistory: access.task.annotations.map(serializeAnnotation),
    comments: access.task.comments.map(serializeComment),
    reviews: access.task.reviews.map(serializeReview),
    task: serializeTask(access.task, access.membership)
  });
});

router.post("/:taskId/annotation", async (request: AuthenticatedRequest, response) => {
  await saveTaskAnnotation(request, response, "draft");
});

router.post("/:taskId/annotation/submit", async (request: AuthenticatedRequest, response) => {
  await saveTaskAnnotation(request, response, "submit");
});

router.post("/:taskId/comments", async (request: AuthenticatedRequest, response) => {
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

  const body = normalizeShortText(request.body?.body, 4000);

  if (!body) {
    response.status(400).json({ error: "Comment is required." });
    return;
  }

  const access = await getTaskAccess(user.id, taskId);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  if (!access.membership || !canWorkTasks(access.membership)) {
    response.status(403).json({ error: "You do not have permission to comment on this task." });
    return;
  }

  const prisma = getPrismaClient();
  const annotationId = normalizeId(request.body?.annotationId) ?? access.annotation?.id ?? null;
  const comment = await prisma.comment.create({
    data: {
      annotationId,
      body,
      taskId: access.task.id,
      userId: user.id
    },
    include: commentIncludes
  });

  await prisma.auditLog.create({
    data: {
      organizationId: access.task.project.organizationId,
      projectId: access.task.projectId,
      userId: user.id,
      action: "task.comment.created",
      entityType: "task",
      entityId: access.task.id,
      metadata: {
        annotationId,
        commentId: comment.id,
        requestId: getRequestId(request)
      }
    }
  });

  response.status(201).json({
    comment: serializeComment(comment)
  });
});

router.post("/:taskId/review", async (request: AuthenticatedRequest, response) => {
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

  const decision = normalizeShortText(request.body?.decision, 40);
  const feedback = normalizeShortText(request.body?.feedback, 4000);

  if (decision !== "approve" && decision !== "reject") {
    response.status(400).json({ error: "Review decision must be approve or reject." });
    return;
  }

  if (decision === "reject" && !feedback) {
    response.status(400).json({ error: "Add feedback before rejecting a task." });
    return;
  }

  const access = await getTaskAccess(user.id, taskId);

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  if (!access.membership || !canReviewTasks(access.membership)) {
    response.status(403).json({ error: "You do not have permission to review this task." });
    return;
  }

  if (access.task.status !== TaskStatus.SUBMITTED && access.task.status !== TaskStatus.REVIEWING) {
    response.status(409).json({ error: "Only submitted tasks can be reviewed." });
    return;
  }

  const submittedAnnotation =
    access.task.annotations.find((annotation) => annotation.status === AnnotationStatus.SUBMITTED) ??
    access.task.annotations[0] ??
    null;

  if (!submittedAnnotation) {
    response.status(400).json({ error: "This task has no submitted annotation to review." });
    return;
  }

  const prisma = getPrismaClient();
  const reviewStatus = decision === "approve" ? ReviewStatus.APPROVED : ReviewStatus.NEEDS_CHANGES;
  const nextAnnotationStatus = decision === "approve" ? AnnotationStatus.ACCEPTED : AnnotationStatus.REJECTED;
  const nextTaskStatus = decision === "approve" ? TaskStatus.APPROVED : TaskStatus.REJECTED;

  const result = await prisma.$transaction(async (tx) => {
    const review = await tx.review.create({
      data: {
        annotationId: submittedAnnotation.id,
        feedback,
        reviewerId: user.id,
        status: reviewStatus,
        taskId: access.task.id
      },
      include: reviewIncludes
    });

    await tx.annotation.update({
      where: {
        id: submittedAnnotation.id
      },
      data: {
        status: nextAnnotationStatus
      }
    });

    const savedTask = await tx.task.update({
      where: {
        id: access.task.id
      },
      data: {
        reviewerId: user.id,
        status: nextTaskStatus
      },
      include: taskDetailIncludes
    });

    let comment = null;

    if (feedback) {
      comment = await tx.comment.create({
        data: {
          annotationId: submittedAnnotation.id,
          body: feedback,
          metadata: {
            reviewId: review.id,
            reviewStatus
          },
          taskId: access.task.id,
          userId: user.id
        },
        include: commentIncludes
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: savedTask.project.organizationId,
        projectId: savedTask.projectId,
        userId: user.id,
        action: decision === "approve" ? "task.review.approved" : "task.review.rejected",
        entityType: "task",
        entityId: savedTask.id,
        metadata: {
          annotationId: submittedAnnotation.id,
          commentId: comment?.id ?? null,
          previousStatus: access.task.status,
          requestId: getRequestId(request),
          reviewId: review.id
        }
      }
    });

    return {
      comment,
      review,
      task: savedTask
    };
  });

  response.status(200).json({
    annotation: serializeAnnotation(
      result.task.annotations.find((annotation) => annotation.id === submittedAnnotation.id) ?? result.task.annotations[0] ?? null
    ),
    comment: result.comment ? serializeComment(result.comment) : null,
    review: serializeReview(result.review),
    task: serializeTask(result.task, access.membership)
  });
});

router.post("/:taskId/start", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "start");
});

router.post("/:taskId/submit", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "submit");
});

export { router as tasksRouter };

export type TaskAction = "assign-self" | "start" | "submit";
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

  if (action === "draft" && (access.task.status === TaskStatus.SUBMITTED || access.task.status === TaskStatus.APPROVED)) {
    response.status(409).json({ error: "Submitted tasks cannot be changed by autosave." });
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

export function getTaskActionUpdate(task: Pick<Task, "assignedToId" | "status">, action: TaskAction, userId: string):
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
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.ASSIGNED && task.status !== TaskStatus.REJECTED) {
      return { ok: false, error: "Only pending, assigned, or rejected tasks can be started." };
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

async function getEffectiveProjectMembership(userId: string, projectId: string, organizationId: string) {
  const prisma = getPrismaClient();
  const [organizationMembership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        organizationId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        projectId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    })
  ]);

  return organizationMembership ?? projectMembership;
}

async function userCanWorkProjectTasks(userId: string, projectId: string, organizationId: string) {
  const membership = await getEffectiveProjectMembership(userId, projectId, organizationId);
  return Boolean(membership && canWorkTasks(membership));
}

async function userCanReviewProjectTasks(userId: string, projectId: string, organizationId: string) {
  const membership = await getEffectiveProjectMembership(userId, projectId, organizationId);
  return Boolean(membership && canReviewTasks(membership));
}

async function getTaskAccessScope(userId: string) {
  const prisma = getPrismaClient();
  const [memberships, projectMemberships] = await Promise.all([
    getActiveMemberships(userId),
    prisma.projectMembership.findMany({
      where: {
        userId,
        status: "ACTIVE"
      },
      select: {
        projectId: true,
        role: true
      }
    })
  ]);
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const projectIds = [...new Set(projectMemberships.map((membership) => membership.projectId))];

  return {
    manageableOrganizationIds: memberships.filter(canGenerateTasks).map((membership) => membership.organizationId),
    manageableProjectIds: projectMemberships.filter(canGenerateTasks).map((membership) => membership.projectId),
    membershipByOrganizationId: new Map(memberships.map((membership) => [membership.organizationId, membership])),
    membershipByProjectId: new Map(projectMemberships.map((membership) => [membership.projectId, membership])),
    organizationIds,
    projectIds,
    reviewOrganizationIds: memberships.filter(canReviewTasks).map((membership) => membership.organizationId),
    reviewProjectIds: projectMemberships.filter(canReviewTasks).map((membership) => membership.projectId)
  };
}

type TaskAccessScope = Awaited<ReturnType<typeof getTaskAccessScope>>;

function buildAccessibleProjectConditions(organizationIds: string[], projectIds: string[]): Prisma.ProjectWhereInput[] {
  return [
    ...(organizationIds.length > 0
      ? [
          {
            organizationId: {
              in: organizationIds
            }
          }
        ]
      : []),
    ...(projectIds.length > 0
      ? [
          {
            id: {
              in: projectIds
            }
          }
        ]
      : []),
    {
      accessMode: ProjectAccessMode.PUBLIC,
      status: ProjectStatus.ACTIVE
    }
  ];
}

function buildVisibleTaskWhere(scope: TaskAccessScope, filters: { datasetId?: string; projectId?: string } = {}): Prisma.TaskWhereInput {
  return {
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    OR: [
      ...(scope.manageableOrganizationIds.length > 0
        ? [
            {
              project: {
                organizationId: {
                  in: scope.manageableOrganizationIds
                }
              }
            }
          ]
        : []),
      ...(scope.manageableProjectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.manageableProjectIds
              }
            }
          ]
        : []),
      {
        project: {
          OR: buildAccessibleProjectConditions(scope.organizationIds, scope.projectIds),
          status: ProjectStatus.ACTIVE
        },
        status: {
          not: TaskStatus.ARCHIVED
        }
      }
    ]
  };
}

function buildReviewTaskWhere(scope: TaskAccessScope, filters: { datasetId?: string; projectId?: string } = {}): Prisma.TaskWhereInput {
  if (scope.reviewOrganizationIds.length === 0 && scope.reviewProjectIds.length === 0) {
    return {
      id: "__no_review_access__"
    };
  }

  return {
    ...(filters.datasetId ? { datasetId: filters.datasetId } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    status: {
      in: [TaskStatus.SUBMITTED, TaskStatus.REVIEWING]
    },
    OR: [
      ...(scope.reviewOrganizationIds.length > 0
        ? [
            {
              project: {
                organizationId: {
                  in: scope.reviewOrganizationIds
                }
              }
            }
          ]
        : []),
      ...(scope.reviewProjectIds.length > 0
        ? [
            {
              projectId: {
                in: scope.reviewProjectIds
              }
            }
          ]
        : [])
    ]
  };
}

type TaskQueueFilters = {
  assignment?: "mine" | "unassigned";
  due?: "overdue" | "soon" | "none";
  minPriority?: number;
  search?: string;
  status?: TaskStatus;
};

type TaskWorkflowBody =
  | {
      assignmentMode?: unknown;
      assignedToId?: unknown;
      assigneeIds?: unknown;
      dueAt?: unknown;
      priority?: unknown;
      reviewerId?: unknown;
      saveDefaults?: unknown;
    }
  | undefined;

type DatasetTaskAssignmentMode = "single" | "round_robin" | "unassigned";

type DatasetTaskWorkflowValue = {
  assignedToId: string | null;
  assigneeIds: string[];
  assignmentMode: DatasetTaskAssignmentMode;
  dueAt: Date | null;
  priority: number;
  reviewerId: string | null;
};

function parseTaskQueueFilters(query: Record<string, unknown>): TaskQueueFilters {
  const assignment = query.assignment === "mine" || query.assignment === "unassigned" ? query.assignment : undefined;
  const due = query.due === "overdue" || query.due === "soon" || query.due === "none" ? query.due : undefined;
  const minPriority = normalizeInteger(query.minPriority);
  const search = normalizeShortText(query.search, 160) ?? undefined;
  const status = parseTaskStatusQuery(query.status);

  return {
    ...(assignment ? { assignment } : {}),
    ...(due ? { due } : {}),
    ...(minPriority !== undefined && minPriority >= 0 && minPriority <= 10 ? { minPriority } : {}),
    ...(search ? { search } : {}),
    ...(status ? { status } : {})
  };
}

export function buildTaskQueueFilterWhere(
  filters: TaskQueueFilters,
  input: { now: Date; userId: string }
): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};

  if (filters.assignment === "mine") {
    where.assignedToId = input.userId;
  } else if (filters.assignment === "unassigned") {
    where.assignedToId = null;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.minPriority !== undefined) {
    where.priority = {
      gte: filters.minPriority
    };
  }

  if (filters.due === "overdue") {
    where.dueAt = {
      lt: input.now
    };
  } else if (filters.due === "soon") {
    const soon = new Date(input.now.getTime() + 24 * 60 * 60 * 1000);
    where.dueAt = {
      gte: input.now,
      lte: soon
    };
  } else if (filters.due === "none") {
    where.dueAt = null;
  }

  if (filters.search) {
    where.OR = [
      {
        asset: {
          fileName: {
            contains: filters.search,
            mode: "insensitive"
          }
        }
      },
      {
        dataset: {
          name: {
            contains: filters.search,
            mode: "insensitive"
          }
        }
      },
      {
        project: {
          name: {
            contains: filters.search,
            mode: "insensitive"
          }
        }
      }
    ];
  }

  return where;
}

export function parseTaskWorkflowBody(body: TaskWorkflowBody):
  | {
      ok: true;
      value: {
        assignedToId?: string | null;
        dueAt?: Date | null;
        priority?: number;
        reviewerId?: string | null;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Task workflow update is required." };
  }

  const value: {
    assignedToId?: string | null;
    dueAt?: Date | null;
    priority?: number;
    reviewerId?: string | null;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "assignedToId")) {
    const assignedToId = normalizeNullableId(body.assignedToId);

    if (assignedToId === false) {
      return { ok: false, error: "Assigned user must be a valid user id." };
    }

    value.assignedToId = assignedToId;
  }

  if (Object.prototype.hasOwnProperty.call(body, "reviewerId")) {
    const reviewerId = normalizeNullableId(body.reviewerId);

    if (reviewerId === false) {
      return { ok: false, error: "Reviewer must be a valid user id." };
    }

    value.reviewerId = reviewerId;
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    const priority = normalizeInteger(body.priority);

    if (priority === undefined || priority < 0 || priority > 10) {
      return { ok: false, error: "Priority must be a whole number from 0 to 10." };
    }

    value.priority = priority;
  }

  if (Object.prototype.hasOwnProperty.call(body, "dueAt")) {
    const dueAt = normalizeNullableDate(body.dueAt);

    if (dueAt === false) {
      return { ok: false, error: "Due date must be a valid date." };
    }

    value.dueAt = dueAt;
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "Choose at least one task workflow field to update." };
  }

  return { ok: true, value };
}

export function parseDatasetTaskWorkflowBody(
  body: TaskWorkflowBody,
  options: { fallback?: DatasetTaskWorkflowValue; requireWorkflow: boolean }
):
  | {
      ok: true;
      saveDefaults: boolean;
      value: DatasetTaskWorkflowValue;
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return options.requireWorkflow
      ? { ok: false, error: "Dataset task workflow update is required." }
      : { ok: true, saveDefaults: false, value: options.fallback ?? getDefaultDatasetTaskWorkflow() };
  }

  if (options.requireWorkflow && !hasDatasetTaskWorkflowFields(body)) {
    return { ok: false, error: "Choose at least one dataset task workflow field to update." };
  }

  const fallback = options.fallback ?? getDefaultDatasetTaskWorkflow();
  const assignmentMode = parseDatasetTaskAssignmentMode(body.assignmentMode) ?? inferDatasetTaskAssignmentMode(body, fallback);
  const assignedToId = Object.prototype.hasOwnProperty.call(body, "assignedToId")
    ? normalizeNullableId(body.assignedToId)
    : fallback.assignedToId;
  const reviewerId = Object.prototype.hasOwnProperty.call(body, "reviewerId")
    ? normalizeNullableId(body.reviewerId)
    : fallback.reviewerId;
  const assigneeIds = Object.prototype.hasOwnProperty.call(body, "assigneeIds")
    ? normalizeIdList(body.assigneeIds)
    : fallback.assigneeIds;
  const priority = Object.prototype.hasOwnProperty.call(body, "priority")
    ? normalizeInteger(body.priority)
    : fallback.priority;
  const dueAt = Object.prototype.hasOwnProperty.call(body, "dueAt")
    ? normalizeNullableDate(body.dueAt)
    : fallback.dueAt;

  if (assignedToId === false) {
    return { ok: false, error: "Assigned user must be a valid user id." };
  }

  if (reviewerId === false) {
    return { ok: false, error: "Reviewer must be a valid user id." };
  }

  if (assigneeIds === false) {
    return { ok: false, error: "Round-robin assignees must be valid user ids." };
  }

  if (priority === undefined || priority < 0 || priority > 10) {
    return { ok: false, error: "Priority must be a whole number from 0 to 10." };
  }

  if (dueAt === false) {
    return { ok: false, error: "Due date must be a valid date." };
  }

  if (assignmentMode === "single" && !assignedToId) {
    return { ok: false, error: "Choose an assignee or use Unassigned." };
  }

  if (assignmentMode === "round_robin" && assigneeIds.length === 0) {
    return { ok: false, error: "Choose at least one annotator for round-robin assignment." };
  }

  return {
    ok: true,
    saveDefaults: body.saveDefaults === true,
    value: {
      assignedToId: assignmentMode === "single" ? assignedToId : null,
      assigneeIds: assignmentMode === "round_robin" ? assigneeIds : [],
      assignmentMode,
      dueAt,
      priority,
      reviewerId
    }
  };
}

function hasDatasetTaskWorkflowFields(body: TaskWorkflowBody) {
  return Boolean(
    body &&
      typeof body === "object" &&
      ["assignedToId", "assignmentMode", "assigneeIds", "dueAt", "priority", "reviewerId", "saveDefaults"].some((field) =>
        Object.prototype.hasOwnProperty.call(body, field)
      )
  );
}

function inferDatasetTaskAssignmentMode(body: TaskWorkflowBody, fallback: DatasetTaskWorkflowValue): DatasetTaskAssignmentMode {
  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "assigneeIds")) {
    return "round_robin";
  }

  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "assignedToId")) {
    return body.assignedToId ? "single" : "unassigned";
  }

  return fallback.assignmentMode;
}

function parseDatasetTaskAssignmentMode(value: unknown): DatasetTaskAssignmentMode | undefined {
  return value === "single" || value === "round_robin" || value === "unassigned" ? value : undefined;
}

function normalizeIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return false;
  }

  const ids = [];

  for (const item of value) {
    const id = normalizeNullableId(item);

    if (!id) {
      return false;
    }

    ids.push(id);
  }

  return [...new Set(ids)];
}

function getDefaultDatasetTaskWorkflow(): DatasetTaskWorkflowValue {
  return {
    assignedToId: null,
    assigneeIds: [],
    assignmentMode: "unassigned",
    dueAt: null,
    priority: 0,
    reviewerId: null
  };
}

function readDatasetTaskWorkflowDefaults(metadata: unknown): DatasetTaskWorkflowValue {
  if (!isPlainJsonObject(metadata) || !isPlainJsonObject(metadata.taskWorkflowDefaults)) {
    return getDefaultDatasetTaskWorkflow();
  }

  const parsed = parseDatasetTaskWorkflowBody(metadata.taskWorkflowDefaults as TaskWorkflowBody, {
    fallback: getDefaultDatasetTaskWorkflow(),
    requireWorkflow: false
  });

  return parsed.ok ? parsed.value : getDefaultDatasetTaskWorkflow();
}

function serializeDatasetTaskWorkflowDefaults(value: DatasetTaskWorkflowValue) {
  return {
    assignedToId: value.assignedToId,
    assigneeIds: value.assigneeIds,
    assignmentMode: value.assignmentMode,
    dueAt: value.dueAt ? value.dueAt.toISOString() : null,
    priority: value.priority,
    reviewerId: value.reviewerId
  };
}

function mergeDatasetTaskWorkflowDefaults(metadata: unknown, value: DatasetTaskWorkflowValue) {
  const base = isPlainJsonObject(metadata) ? metadata : {};

  return {
    ...base,
    taskWorkflowDefaults: serializeDatasetTaskWorkflowDefaults(value)
  } as Prisma.InputJsonObject;
}

function getDatasetWorkflowAssignee(value: DatasetTaskWorkflowValue, index: number) {
  if (value.assignmentMode === "single") {
    return value.assignedToId;
  }

  if (value.assignmentMode === "round_robin") {
    return value.assigneeIds[index % value.assigneeIds.length] ?? null;
  }

  return null;
}

function buildDatasetTaskWorkflowUpdateData(value: DatasetTaskWorkflowValue, assignedToId: string | null): Prisma.TaskUncheckedUpdateManyInput {
  return {
    assignedToId,
    dueAt: value.dueAt,
    priority: value.priority,
    reviewerId: value.reviewerId
  };
}

async function validateDatasetTaskWorkflowMembers(value: DatasetTaskWorkflowValue, projectId: string, organizationId: string) {
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

export function getDatasetGenerationConfigIssue(dataset: {
  labelingConfig: unknown;
  labels: unknown[];
  metadata: unknown;
  tools: { enabled: boolean }[];
}) {
  const hasControllerConfig = isPlainJsonObject(dataset.metadata) && isPlainJsonObject(dataset.metadata.taskWorkflowDefaults);
  const hasTemplateConfig = dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled) && isPlainJsonObject(dataset.labelingConfig);

  if (!hasControllerConfig && !hasTemplateConfig) {
    return "Apply a controller and template config before generating tasks.";
  }

  if (!hasControllerConfig) {
    return "Apply a controller config before generating tasks.";
  }

  if (!hasTemplateConfig) {
    return "Apply a template config before generating tasks.";
  }

  return null;
}

function createTaskFolderCounters() {
  return {
    active: 0,
    approved: 0,
    done: 0,
    pending: 0,
    rejected: 0,
    review: 0,
    total: 0,
    unassigned: 0
  };
}

export function summarizeTaskStatsForGroups(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; status: TaskStatus }[]
) {
  const counters = createTaskFolderCounters();

  for (const group of statusGroups) {
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
  }

  return counters;
}

function addTaskFolderCount(
  counters: ReturnType<typeof createTaskFolderCounters>,
  input: { assignedToId: string | null; count: number; status: TaskStatus }
) {
  counters.total += input.count;

  if (!input.assignedToId) {
    counters.unassigned += input.count;
  }

  if (input.status === TaskStatus.PENDING) {
    counters.pending += input.count;
  } else if (
    input.status === TaskStatus.ASSIGNED ||
    input.status === TaskStatus.IN_PROGRESS
  ) {
    counters.active += input.count;
  } else if (input.status === TaskStatus.SUBMITTED || input.status === TaskStatus.REVIEWING) {
    counters.review += input.count;
  } else if (input.status === TaskStatus.APPROVED) {
    counters.approved += input.count;
    counters.done += input.count;
  } else if (input.status === TaskStatus.REJECTED) {
    counters.rejected += input.count;
  }
}

function summarizeProjectTaskFolders(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; projectId: string; status: TaskStatus }[],
  datasetGroups: { _count: { _all: number }; datasetId: string | null; projectId: string }[],
  projectById: Map<string, { id: string; name: string; slug: string; status: ProjectStatus }>
) {
  const countersByProjectId = new Map<string, ReturnType<typeof createTaskFolderCounters>>();
  const datasetIdsByProjectId = new Map<string, Set<string>>();

  for (const group of statusGroups) {
    const counters = countersByProjectId.get(group.projectId) ?? createTaskFolderCounters();
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
    countersByProjectId.set(group.projectId, counters);
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
        datasetCount: datasetIdsByProjectId.get(projectId)?.size ?? 0,
        projectId,
        projectName: project.name,
        projectSlug: project.slug,
        projectStatus: project.status
      };
    })
    .filter((folder): folder is NonNullable<typeof folder> => Boolean(folder))
    .sort((left, right) => right.total - left.total || left.projectName.localeCompare(right.projectName));
}

function summarizeDatasetTaskFolders(
  statusGroups: { _count: { _all: number }; assignedToId: string | null; datasetId: string | null; status: TaskStatus }[],
  project: { id: string; name: string; slug: string; status: ProjectStatus },
  datasetById: Map<string, { id: string; name: string; version: number }>
) {
  const countersByDatasetId = new Map<string, ReturnType<typeof createTaskFolderCounters>>();

  for (const group of statusGroups) {
    const datasetId = group.datasetId ?? "no-dataset";
    const counters = countersByDatasetId.get(datasetId) ?? createTaskFolderCounters();
    addTaskFolderCount(counters, {
      assignedToId: group.assignedToId,
      count: group._count._all,
      status: group.status
    });
    countersByDatasetId.set(datasetId, counters);
  }

  return [...countersByDatasetId.entries()]
    .map(([datasetId, counters]) => {
      const dataset = datasetById.get(datasetId);

      return {
        ...counters,
        datasetId,
        datasetName: dataset?.name ?? "No dataset",
        projectId: project.id,
        projectName: project.name,
        projectSlug: project.slug,
        readyLabel: dataset ? "Ready" : "Project task",
        versionLabel: dataset ? `Version ${dataset.version}` : project.name
      };
    })
    .sort((left, right) => right.total - left.total || left.datasetName.localeCompare(right.datasetName));
}

export function getNextTaskCursorWhere(task: Pick<Task, "createdAt" | "id" | "priority">): Prisma.TaskWhereInput[] {
  return [
    {
      priority: {
        lt: task.priority
      }
    },
    {
      priority: task.priority,
      createdAt: {
        gt: task.createdAt
      }
    },
    {
      createdAt: task.createdAt,
      id: {
        gt: task.id
      },
      priority: task.priority
    }
  ];
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
      height: true,
      metadata: true
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

function getTaskQueueOrderBy(): Prisma.TaskOrderByWithRelationInput[] {
  return [
    {
      priority: "desc"
    },
    {
      createdAt: "asc"
    },
    {
      id: "asc"
    }
  ];
}

const taskListIncludes = {
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
      version: true
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

const reviewIncludes = {
  annotation: {
    select: {
      id: true,
      status: true,
      version: true
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

const commentIncludes = {
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
  },
  comments: {
    orderBy: {
      createdAt: "asc"
    },
    include: commentIncludes
  },
  reviews: {
    orderBy: {
      createdAt: "desc"
    },
    include: reviewIncludes
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
    metadata: unknown;
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

type TaskListWithRelations = Task & {
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
  comments: CommentWithRelations[];
  reviews: ReviewWithRelations[];
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

type ReviewWithRelations = {
  id: string;
  annotationId: string;
  taskId: string;
  reviewerId: string;
  status: ReviewStatus;
  score: number | null;
  feedback: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  annotation: {
    id: string;
    status: AnnotationStatus;
    version: number;
  };
  reviewer: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
};

type CommentWithRelations = {
  id: string;
  taskId: string | null;
  annotationId: string | null;
  userId: string;
  parentId: string | null;
  body: string;
  resolved: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
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
    canManage: membership ? canGenerateTasks(membership) : false,
    canReview: membership ? canReviewTasks(membership) : false,
    canWork: membership ? canWorkTasks(membership) : false,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function serializeTaskListItem(task: TaskListWithRelations, membership?: { role: MembershipRole }) {
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
    dataset: task.dataset
      ? {
          ...task.dataset,
          labelingConfig: null,
          labels: [],
          tools: []
        }
      : null,
    asset: task.asset
      ? {
          ...task.asset,
          fileSize: task.asset.fileSize.toString(),
          metadata: null
        }
      : null,
    assignedTo: task.assignedTo ? serializeUserName(task.assignedTo) : null,
    reviewer: task.reviewer ? serializeUserName(task.reviewer) : null,
    canManage: membership ? canGenerateTasks(membership) : false,
    canReview: membership ? canReviewTasks(membership) : false,
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

function serializeReview(review: ReviewWithRelations) {
  return {
    annotation: review.annotation,
    annotationId: review.annotationId,
    createdAt: review.createdAt,
    feedback: review.feedback,
    id: review.id,
    metadata: review.metadata,
    reviewer: serializeUserName(review.reviewer),
    reviewerId: review.reviewerId,
    score: review.score,
    status: review.status,
    taskId: review.taskId,
    updatedAt: review.updatedAt
  };
}

function serializeComment(comment: CommentWithRelations) {
  return {
    annotationId: comment.annotationId,
    body: comment.body,
    createdAt: comment.createdAt,
    id: comment.id,
    metadata: comment.metadata,
    parentId: comment.parentId,
    resolved: comment.resolved,
    taskId: comment.taskId,
    updatedAt: comment.updatedAt,
    user: serializeUserName(comment.user),
    userId: comment.userId
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

function normalizeNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : false;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const values = Object.values(enumValues);
  return values.includes(value) ? (value as T[keyof T]) : undefined;
}

function parseTaskStatusQuery(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replaceAll("-", "_");
  return parseEnumValue(TaskStatus, normalized);
}

export function parseAnnotationBody(body: unknown):
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
        results: {
          from_name: string;
          to_name: string;
          type: string;
          value: Prisma.InputJsonObject;
        }[];
        resultJson: {
          results: {
            from_name: string;
            to_name: string;
            type: string;
            value: Prisma.InputJsonObject;
          }[];
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
  const rawResults = Array.isArray(payload.results) ? payload.results : [];

  if (rawRegions.length > 250) {
    return { ok: false, error: "Save up to 250 regions per annotation for now." };
  }

  if (rawResults.length > 250) {
    return { ok: false, error: "Save up to 250 non-region results per annotation for now." };
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
    const page = normalizePositiveInteger((geometry as Record<string, unknown>).page ?? region.page);
    const sourceName = normalizeShortText((geometry as Record<string, unknown>).sourceName ?? region.sourceName, 120);
    const ocrBlockId = normalizeShortText((geometry as Record<string, unknown>).ocrBlockId ?? region.ocrBlockId, 160);
    const text = normalizeShortText((geometry as Record<string, unknown>).text ?? region.text, 4000);

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
        ...(ocrBlockId ? { ocrBlockId } : {}),
        ...(page ? { page } : {}),
        ...(sourceName ? { sourceName } : {}),
        ...(text ? { text } : {}),
        width,
        x,
        y
      };

      regions.push({
        geometryJson,
        label,
        metadata: {
          ...(ocrBlockId ? { ocrBlockId } : {}),
          ...(page ? { page } : {}),
          ...(sourceName ? { sourceName } : {}),
          ...(text ? { text } : {}),
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
      ...(ocrBlockId ? { ocrBlockId } : {}),
      ...(page ? { page } : {}),
      points: normalizedPoints as { x: number; y: number }[],
      ...(sourceName ? { sourceName } : {}),
      ...(text ? { text } : {})
    };

    regions.push({
      geometryJson,
      label,
      metadata: {
        ...(ocrBlockId ? { ocrBlockId } : {}),
        ...(page ? { page } : {}),
        ...(sourceName ? { sourceName } : {}),
        ...(text ? { text } : {}),
        tool: "polygon"
      },
      type
    });
  }

  const leadTimeSeconds =
    typeof payload.leadTimeSeconds === "number" && Number.isFinite(payload.leadTimeSeconds) && payload.leadTimeSeconds >= 0
      ? payload.leadTimeSeconds
      : undefined;
  const results = [];

  for (const rawResult of rawResults) {
    if (!rawResult || typeof rawResult !== "object") {
      return { ok: false, error: "Each annotation result must be an object." };
    }

    const result = rawResult as Record<string, unknown>;
    const fromName = normalizeShortText(result.fromName ?? result.from_name, 120);
    const toName = normalizeShortText(result.toName ?? result.to_name, 120);
    const type = normalizeShortText(result.type, 80);
    const value = result.value;

    if (!fromName || !toName || !type || !isPlainJsonObject(value)) {
      return { ok: false, error: "Each annotation result needs fromName, toName, type, and a value object." };
    }

    results.push({
      from_name: fromName,
      to_name: toName,
      type,
      value: value as Prisma.InputJsonObject
    });
  }

  return {
    ok: true,
    value: {
      leadTimeSeconds,
      regions,
      results,
      resultJson: {
        results,
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

function normalizeShortText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function normalizeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeNullableDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date;
}
