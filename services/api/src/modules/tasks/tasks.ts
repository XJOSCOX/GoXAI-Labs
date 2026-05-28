import {
  AIJobStatus,
  AnnotationStatus,
  getPrismaClient,
  MembershipRole,
  NotificationPreferenceEvent,
  NotificationType,
  Prisma,
  ProjectAccessMode,
  ProjectStatus,
  ReviewStatus,
  TaskCreditStatus,
  TaskCreditEventType,
  TaskStatus
} from "@goxai/database";
import { Router, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { recordDatasetVersionChange } from "../datasets/datasets.js";
import { getRequestId } from "../../shared/logging.js";
import { getPlatformTaskEconomics } from "../../shared/platformEconomics.js";
import { createNotification, createNotifications } from "../notifications/notifications.js";
import { canGenerateTasks, canReviewTasks, canWorkTasks } from "../../shared/permissions.js";
import {
  buildAccessibleProjectConditions,
  buildReviewTaskWhere,
  buildTaskCreditWhere,
  buildVisibleTaskWhere,
  getEffectiveProjectMembership,
  getTaskAccessScope,
  userCanReviewProjectTasks,
  userCanWorkProjectTasks
} from "./taskAccess.js";
import { getTaskActionUpdate, type TaskAction } from "./taskActions.js";
import {
  getAnnotationApprovalCreditPoints,
  getAnnotationSubmissionCreditPoints,
  getReviewCreditPoints,
  holdCreatorCreditsEscrow,
  holdCreatorTaskEscrow,
  InsufficientCreatorBalanceError,
  resolveAnnotationUnderReviewCredit,
  settleTaskEscrowOnApproval,
  upsertTaskCreditEvent
} from "./taskCredits.js";
import {
  summarizeDatasetTaskFolders,
  summarizeProjectTaskFolders,
  summarizeTaskFolderEarnings
} from "./taskFolders.js";
import {
  getDatasetTaskAllocationPolicy,
  getDatasetTaskCreditAllocation,
  getDatasetTaskEscrowEstimate
} from "./taskFunding.js";
import { getDatasetGenerationConfigIssue } from "./taskGeneration.js";
import {
  buildTaskAssignmentNotifications,
  buildTaskNotificationMetadata,
  getTaskAssetName,
  getTaskCommentNotificationRecipients
} from "./taskNotifications.js";
import {
  buildTaskQueueFilterWhere,
  getDueSoonDate,
  getNextTaskCursorWhere,
  getTaskQueueOrderBy,
  parseTaskQueueFilters,
  summarizeTaskQueueQualityCounts,
  summarizeTaskStatsForGroups,
} from "./taskQueue.js";
import {
  buildDatasetTaskWorkflowUpdateData,
  countDatasetWorkflowAssignees,
  getDatasetPaymentPolicyLockIssue,
  getDatasetWorkflowAssignment,
  getDatasetWorkflowAssignments,
  getDefaultDatasetQualityPolicy,
  getGeneratedTaskQualityMetadata,
  getTaskPaymentEscrowCredits,
  getTaskPaymentEscrowLedgerEntryId,
  mergeDatasetPaymentPolicyDefaults,
  mergeDatasetQualityPolicyDefaults,
  mergeDatasetTaskWorkflowDefaults,
  mergeTaskPaymentMetadata,
  parseDatasetPaymentPolicyBody,
  parseDatasetQualityPolicyBody,
  parseDatasetTaskWorkflowBody,
  parseTaskWorkflowBody,
  readDatasetPaymentPolicy,
  readDatasetQualityPolicy,
  readDatasetTaskWorkflowDefaults,
  readTaskPaymentPolicy,
  serializeDatasetPaymentPolicy,
  serializeDatasetQualityPolicy,
  serializeDatasetTaskWorkflowDefaults,
  type DatasetPaymentPolicyValue,
  type DatasetQualityPolicyValue,
  type DatasetTaskWorkflowValue
} from "./taskPolicies.js";
import {
  buildConsensusTaskMetadata,
  isConsensusBelowPolicy,
  summarizeReviewQuality,
  summarizeTaskConsensus
} from "./taskQuality.js";
import {
  annotationIncludes,
  buildTaskQualityFlags,
  commentIncludes,
  getTaskPaymentCreditValue,
  getTaskPaymentCurrency,
  reviewIncludes,
  serializeAnnotation,
  serializeComment,
  serializeReview,
  serializeTask,
  serializeTaskListItem,
  serializeUserName,
  taskDetailIncludes,
  taskIncludes,
  taskListIncludes,
  type AnnotationWithRegions,
  type TaskWithDetailRelations
} from "./taskSerializers.js";
import {
  normalizeId,
  normalizePositiveInteger,
  normalizeShortText,
  parseAnnotationBody,
  parseReviewMetadata
} from "./taskValidation.js";
import {
  buildDatasetWorkflowAssignmentPlan,
  normalizeAssignmentWorkload,
  patchTaskMetadataMany,
  validateDatasetTaskWorkflowMembers
} from "./taskWorkflow.js";
import { registerTaskBulkRoutes } from "./taskBulk.js";
import { registerTaskQueueExportRoutes } from "./taskQueueExport.js";
import { registerTaskViewRoutes } from "./taskViews.js";

export {
  getDatasetTaskCreditAllocation,
  getDatasetTaskEscrowEstimate
} from "./taskFunding.js";

export {
  buildTaskQueueFilterWhere,
  getNextTaskCursorWhere,
  getTaskQueueOrderBy,
  summarizeTaskStatsForGroups
} from "./taskQueue.js";

export {
  getDatasetWorkflowAssignments,
  parseDatasetTaskWorkflowBody,
  parseTaskWorkflowBody
} from "./taskPolicies.js";

export {
  isConsensusBelowPolicy,
  summarizeReviewQuality,
  summarizeTaskConsensus
} from "./taskQuality.js";

export {
  buildTaskQualityFlags
} from "./taskSerializers.js";

export {
  getDatasetGenerationConfigIssue
} from "./taskGeneration.js";

export {
  getTaskActionUpdate,
  type TaskAction
} from "./taskActions.js";

export {
  getAnnotationApprovalCreditPoints,
  getAnnotationSubmissionCreditPoints,
  getReviewCreditPoints
} from "./taskCredits.js";

export {
  parseAnnotationBody
} from "./taskValidation.js";

const router = Router();
const datasetWorkflowTransactionOptions = {
  maxWait: 15_000,
  timeout: 60_000
};

router.use(requireAuthenticatedUser);
registerTaskBulkRoutes(router);
registerTaskQueueExportRoutes(router);
registerTaskViewRoutes(router);

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

router.get("/quality", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const scope = await getTaskAccessScope(user.id);
  const where = {
    task: buildVisibleTaskWhere(scope, { datasetId, projectId })
  };
  const creditWhere = buildTaskCreditWhere(scope, { datasetId, projectId });
  const [reviews, tasks, credits] = await Promise.all([
    prisma.review.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      take: 1000,
      include: {
        annotation: {
          select: {
            id: true,
            leadTimeSeconds: true,
            status: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            },
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
        },
        task: {
          select: {
            id: true,
            dataset: {
              select: {
                id: true,
                metadata: true,
                name: true
              }
            },
            project: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    }),
    prisma.task.findMany({
      where: buildVisibleTaskWhere(scope, { datasetId, projectId }),
      orderBy: [
        {
          priority: "desc"
        },
        {
          createdAt: "asc"
        }
      ],
      take: 1500,
      select: {
        id: true,
        createdAt: true,
        dueAt: true,
        priority: true,
        status: true,
        asset: {
          select: {
            fileName: true
          }
        },
        dataset: {
          select: {
            id: true,
            metadata: true,
            name: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        },
        annotations: {
          where: {
            status: {
              in: [AnnotationStatus.SUBMITTED, AnnotationStatus.ACCEPTED, AnnotationStatus.REJECTED]
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          select: {
            id: true,
            createdAt: true,
            leadTimeSeconds: true,
            resultJson: true,
            status: true,
            submittedAt: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            },
            userId: true,
            version: true,
            regions: {
              select: {
                confidence: true,
                geometryJson: true,
                label: true,
                metadata: true,
                type: true
              }
            }
          }
        },
        aiJobs: {
          where: {
            status: AIJobStatus.COMPLETED
          },
          select: {
            id: true,
            modelProvider: {
              select: {
                id: true,
                name: true,
                type: true
              }
            },
            outputJson: true
          }
        },
        reviews: {
          select: {
            id: true,
            status: true
          }
        }
      }
    }),
    prisma.taskCreditEvent.findMany({
      where: creditWhere,
      orderBy: {
        createdAt: "desc"
      },
      take: 5000,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        },
        dataset: {
          select: {
            id: true,
            name: true
          }
        },
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  response.status(200).json({
    quality: summarizeReviewQuality(reviews, tasks, credits)
  });
});

router.get("/folders", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);
  const queue = normalizeShortText(request.query.queue, 40);
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

    const where = queue === "review"
      ? buildReviewTaskWhere(scope, { projectId })
      : buildVisibleTaskWhere(scope, { projectId });
    const [statusGroups, earningTasks, datasets] = await Promise.all([
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
      prisma.task.findMany({
        where: {
          AND: [
            where,
            {
              datasetId: {
                not: null
              },
              status: {
                notIn: [TaskStatus.APPROVED, TaskStatus.ARCHIVED]
              }
            }
          ]
        },
        select: {
          datasetId: true,
          metadata: true
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
      datasets: summarizeDatasetTaskFolders(statusGroups, project, datasetById, summarizeTaskFolderEarnings(earningTasks, {
        groupBy: "dataset",
        mode: queue === "review" ? "review" : "work"
      })),
      project
    });
    return;
  }

  const where = queue === "review" ? buildReviewTaskWhere(scope) : buildVisibleTaskWhere(scope);
  const [statusGroups, datasetGroups, earningTasks] = await Promise.all([
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
    }),
    prisma.task.findMany({
      where: {
        AND: [
          where,
          {
            status: {
              notIn: [TaskStatus.APPROVED, TaskStatus.ARCHIVED]
            }
          }
        ]
      },
      select: {
        projectId: true,
        metadata: true
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
    projects: summarizeProjectTaskFolders(statusGroups, datasetGroups, projectById, summarizeTaskFolderEarnings(earningTasks, {
      groupBy: "project",
      mode: queue === "review" ? "review" : "work"
    }))
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

  const queueMode = queue === "review" ? "review" : "work";
  const visibleWhere = queueMode === "review"
    ? buildReviewTaskWhere(scope, { datasetId, projectId })
    : buildVisibleTaskWhere(scope, { datasetId, projectId });
  const queueFilterWhere = buildTaskQueueFilterWhere(queueFilters, {
    now: new Date(),
    queue: queueMode,
    userId: user.id
  });
  const where = {
    AND: [
      visibleWhere,
      queueFilterWhere
    ]
  };
  const queueCountBaseWhere = {
    AND: [
      visibleWhere,
      buildTaskQueueFilterWhere({ ...queueFilters, quality: undefined }, {
        now: new Date(),
        queue: queueMode,
        userId: user.id
      })
    ]
  };
  const [tasks, total, queueCounts] = await Promise.all([
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
    isPaginated ? prisma.task.count({ where }) : Promise.resolve(0),
    summarizeTaskQueueQualityCounts(prisma, queueCountBaseWhere, {
      now: new Date(),
      queue: queueMode,
      userId: user.id
    })
  ]);

  response.status(200).json({
    page: pageNumber,
    pageSize,
    tasks: tasks.map((task) => serializeTaskListItem(task, scope.membershipByOrganizationId.get(task.project.organizationId) ?? scope.membershipByProjectId.get(task.projectId))),
    total: isPaginated ? total : tasks.length,
    totalPages: isPaginated ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    queueCounts
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

  const qualityPolicy = parseDatasetQualityPolicyBody(request.body, readDatasetQualityPolicy(dataset.metadata));

  if (!qualityPolicy.ok) {
    response.status(400).json({ error: qualityPolicy.error });
    return;
  }

  const paymentPolicy = await parseDatasetPaymentPolicyForRequest(request.body, readDatasetPaymentPolicy(dataset.metadata));

  if (!paymentPolicy.ok) {
    response.status(400).json({ error: paymentPolicy.error });
    return;
  }

  const paymentPolicyLockIssue = getDatasetPaymentPolicyLockIssue(dataset.metadata, paymentPolicy.value);

  if (paymentPolicyLockIssue) {
    response.status(400).json({ error: paymentPolicyLockIssue });
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
  const assignmentPlan = await buildDatasetWorkflowAssignmentPlan(prisma, workflowDefaults.value, {
    projectId: dataset.projectId,
    taskCount: assetsToCreate.length
  });
  const escrowEstimate = getDatasetTaskEscrowEstimate(assetsToCreate.length, workflowDefaults.value, paymentPolicy.value);

  if (assetsToCreate.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        const escrow = await holdCreatorTaskEscrow(tx, {
          datasetId: dataset.id,
          description: `Hold for ${assetsToCreate.length} generated dataset task${assetsToCreate.length === 1 ? "" : "s"}.`,
          organizationId: dataset.organizationId,
          paymentPolicy: paymentPolicy.value,
          taskCount: assetsToCreate.length,
          workflow: workflowDefaults.value
        });

        await tx.task.createMany({
          data: assetsToCreate.map((asset, index) => {
            const assignedToId = getDatasetWorkflowAssignment(assignmentPlan, index);
            const paymentAllocation = getDatasetTaskCreditAllocation(index, workflowDefaults.value, paymentPolicy.value);

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
                fileName: asset.fileName,
                paymentAnnotationCredits: paymentAllocation.annotationCredits,
                paymentCurrency: paymentPolicy.value.currency,
                paymentDatasetBudgetCredits: paymentPolicy.value.datasetBudgetCredits,
                paymentEscrowCredits: paymentAllocation.credits,
                paymentEscrowLedgerEntryId: escrow.ledgerEntryId,
                paymentFreeTaskPostingFeeCredits: paymentPolicy.value.freeTaskPostingFeeCredits,
                paymentPlatformFeeCredits: paymentAllocation.platformFeeCredits,
                paymentPlatformFeeRate: paymentPolicy.value.platformFeeRate,
                paymentReviewBudgetShare: paymentPolicy.value.reviewBudgetShare,
                paymentReviewCredits: paymentAllocation.reviewCredits,
                paymentTaskBudgetBasis: paymentPolicy.value.taskBudgetBasis,
                paymentWorkerCredits: paymentAllocation.workerCredits,
                ...getGeneratedTaskQualityMetadata(qualityPolicy.value, index)
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
            metadata: mergeDatasetPaymentPolicyDefaults(
              mergeDatasetQualityPolicyDefaults(
                mergeDatasetTaskWorkflowDefaults(dataset.metadata, workflowDefaults.value),
                qualityPolicy.value
              ),
              paymentPolicy.value,
              {
                changedById: user.id,
                reason: "tasks_generated"
              }
            )
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
            escrow: escrowEstimate,
            remainingCount,
            paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
            requestedQuantity: quantity ?? "all",
            qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
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
          escrow: escrowEstimate,
          paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
          skippedCount: existingAssetIds.size,
          savedWorkflowDefaults: workflowDefaults.saveDefaults,
          qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
          workflow: serializeDatasetTaskWorkflowDefaults(workflowDefaults.value)
        },
        userId: user.id
      });
      });
    } catch (error) {
      if (error instanceof InsufficientCreatorBalanceError) {
        response.status(402).json({ error: error.message });
        return;
      }

      throw error;
    }

    void createNotifications(
      buildTaskAssignmentNotifications({
        assignmentCounts: countDatasetWorkflowAssignees(assignmentPlan),
        dataset,
        projectId: dataset.projectId,
        title: "Dataset tasks assigned"
      })
    );
  }

  if (assetsToCreate.length === 0 && workflowDefaults.saveDefaults) {
    await prisma.dataset.update({
      where: {
        id: dataset.id
      },
      data: {
        metadata: mergeDatasetPaymentPolicyDefaults(
          mergeDatasetQualityPolicyDefaults(
            mergeDatasetTaskWorkflowDefaults(dataset.metadata, workflowDefaults.value),
            qualityPolicy.value
          ),
          paymentPolicy.value
        )
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

async function getDatasetControllerContext(request: AuthenticatedRequest, response: Response) {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return null;
  }

  const datasetId = normalizeId(request.body?.datasetId);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return null;
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
    return null;
  }

  const membership = await getEffectiveProjectMembership(user.id, dataset.projectId, dataset.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({ error: "You need owner, admin, or manager access to update this dataset queue." });
    return null;
  }

  return {
    dataset,
    membership,
    prisma,
    user
  };
}

router.patch("/dataset-workflow/defaults", async (request: AuthenticatedRequest, response) => {
  const context = await getDatasetControllerContext(request, response);

  if (!context) {
    return;
  }

  const { dataset, prisma, user } = context;
  const parsed = parseDatasetTaskWorkflowBody(request.body, {
    fallback: readDatasetTaskWorkflowDefaults(dataset.metadata),
    requireWorkflow: true
  });

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const workflowValidationError = await validateDatasetTaskWorkflowMembers(parsed.value, dataset.projectId, dataset.organizationId);

  if (workflowValidationError) {
    response.status(400).json({ error: workflowValidationError });
    return;
  }

  const qualityPolicy = parseDatasetQualityPolicyBody(request.body, readDatasetQualityPolicy(dataset.metadata));

  if (!qualityPolicy.ok) {
    response.status(400).json({ error: qualityPolicy.error });
    return;
  }

  const paymentPolicy = await parseDatasetPaymentPolicyForRequest(request.body, readDatasetPaymentPolicy(dataset.metadata));

  if (!paymentPolicy.ok) {
    response.status(400).json({ error: paymentPolicy.error });
    return;
  }

  const paymentPolicyLockIssue = getDatasetPaymentPolicyLockIssue(dataset.metadata, paymentPolicy.value);

  if (paymentPolicyLockIssue) {
    response.status(400).json({ error: paymentPolicyLockIssue });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.dataset.update({
      where: {
        id: dataset.id
      },
      data: {
        metadata: mergeDatasetPaymentPolicyDefaults(
          mergeDatasetQualityPolicyDefaults(
            mergeDatasetTaskWorkflowDefaults(dataset.metadata, parsed.value),
            qualityPolicy.value
          ),
          paymentPolicy.value,
          {
            changedById: user.id,
            reason: "controller_defaults_updated"
          }
        )
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: dataset.organizationId,
        projectId: dataset.projectId,
        userId: user.id,
        action: "task.dataset_workflow.defaults_updated",
        entityType: "dataset",
        entityId: dataset.id,
        metadata: {
          requestId: getRequestId(request),
          changes: serializeDatasetTaskWorkflowDefaults(parsed.value),
          datasetName: dataset.name,
          paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
          qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
          updatedCount: 0
        }
      }
    });

    await recordDatasetVersionChange(tx, {
      datasetId: dataset.id,
      reason: "controller_defaults_updated",
      summary: {
        paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
        qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
        savedWorkflowDefaults: true,
        updatedCount: 0
      },
      userId: user.id
    });
  }, datasetWorkflowTransactionOptions);

  response.status(200).json({
    tasks: [],
    updatedCount: 0
  });
});

router.patch("/dataset-workflow/routing", async (request: AuthenticatedRequest, response) => {
  const context = await getDatasetControllerContext(request, response);

  if (!context) {
    return;
  }

  const { dataset, prisma, user } = context;
  const parsed = parseDatasetTaskWorkflowBody(request.body, {
    fallback: readDatasetTaskWorkflowDefaults(dataset.metadata),
    requireWorkflow: true
  });

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const workflowValidationError = await validateDatasetTaskWorkflowMembers(parsed.value, dataset.projectId, dataset.organizationId);

  if (workflowValidationError) {
    response.status(400).json({ error: workflowValidationError });
    return;
  }

  const activeStatuses = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED];
  let result: {
    assignmentCounts: Array<{ count: number; userId: string }>;
    count: number;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
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
      const workload = parsed.value.assignmentMode === "round_robin"
        ? await tx.task.groupBy({
            by: ["assignedToId"],
            where: {
              assignedToId: {
                in: parsed.value.assigneeIds
              },
              datasetId: {
                not: dataset.id
              },
              projectId: dataset.projectId,
              status: {
                in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]
              }
            },
            _count: {
              _all: true
            }
          })
        : [];
      const assignmentPlan = getDatasetWorkflowAssignments(parsed.value, activeTasks.length, normalizeAssignmentWorkload(workload));
      const assignmentCounts = countDatasetWorkflowAssignees(assignmentPlan);

      if (parsed.value.assignmentMode === "round_robin") {
        await Promise.all(
          activeTasks.map((task, index) => {
            const assignedToId = getDatasetWorkflowAssignment(assignmentPlan, index);

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
        const assignedToId = getDatasetWorkflowAssignment(assignmentPlan, 0);

        if (activeTasks.length > 0) {
          await tx.task.updateMany({
            where: {
              id: {
                in: activeTasks.map((task) => task.id)
              }
            },
            data: buildDatasetTaskWorkflowUpdateData(parsed.value, assignedToId)
          });
        }

        const pendingIds = activeTasks.filter((task) => task.status === TaskStatus.PENDING).map((task) => task.id);
        const assignedIds = activeTasks.filter((task) => task.status === TaskStatus.ASSIGNED).map((task) => task.id);

        if (assignedToId && pendingIds.length > 0) {
          await tx.task.updateMany({
            where: {
              id: {
                in: pendingIds
              }
            },
            data: {
              status: TaskStatus.ASSIGNED
            }
          });
        }

        if (!assignedToId && assignedIds.length > 0) {
          await tx.task.updateMany({
            where: {
              id: {
                in: assignedIds
              }
            },
            data: {
              status: TaskStatus.PENDING
            }
          });
        }
      }

      await tx.dataset.update({
        where: {
          id: dataset.id
        },
        data: {
          metadata: mergeDatasetTaskWorkflowDefaults(dataset.metadata, parsed.value)
        }
      });

      await tx.auditLog.create({
        data: {
          organizationId: dataset.organizationId,
          projectId: dataset.projectId,
          userId: user.id,
          action: "task.dataset_workflow.routing_updated",
          entityType: "dataset",
          entityId: dataset.id,
          metadata: {
            requestId: getRequestId(request),
            changes: serializeDatasetTaskWorkflowDefaults(parsed.value),
            datasetName: dataset.name,
            updatedCount: activeTasks.length
          }
        }
      });

      await recordDatasetVersionChange(tx, {
        datasetId: dataset.id,
        reason: "task_routing_updated",
        summary: {
          savedWorkflowDefaults: true,
          updatedCount: activeTasks.length,
          workflow: serializeDatasetTaskWorkflowDefaults(parsed.value)
        },
        userId: user.id
      });

      return {
        assignmentCounts,
        count: activeTasks.length
      };
    }, datasetWorkflowTransactionOptions);
  } catch (error) {
    if (isTransactionTimeoutError(error)) {
      response.status(503).json({
        error: "Applying task routing took too long. Try again in a moment; if the dataset is large, update routing before generating more tasks."
      });
      return;
    }

    throw error;
  }

  if (result.count > 0) {
    void createNotifications(
      buildTaskAssignmentNotifications({
        assignmentCounts: result.assignmentCounts,
        dataset,
        projectId: dataset.projectId,
        title: "Dataset task routing applied"
      })
    );
  }

  response.status(200).json({
    tasks: [],
    updatedCount: result.count
  });
});

router.patch("/dataset-workflow/quality", async (request: AuthenticatedRequest, response) => {
  const context = await getDatasetControllerContext(request, response);

  if (!context) {
    return;
  }

  const { dataset, prisma, user } = context;
  const qualityPolicy = parseDatasetQualityPolicyBody(request.body, readDatasetQualityPolicy(dataset.metadata));

  if (!qualityPolicy.ok) {
    response.status(400).json({ error: qualityPolicy.error });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.dataset.update({
      where: {
        id: dataset.id
      },
      data: {
        metadata: mergeDatasetQualityPolicyDefaults(dataset.metadata, qualityPolicy.value)
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: dataset.organizationId,
        projectId: dataset.projectId,
        userId: user.id,
        action: "task.dataset_workflow.quality_updated",
        entityType: "dataset",
        entityId: dataset.id,
        metadata: {
          requestId: getRequestId(request),
          datasetName: dataset.name,
          qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
          updatedCount: 0
        }
      }
    });

    await recordDatasetVersionChange(tx, {
      datasetId: dataset.id,
      reason: "quality_policy_updated",
      summary: {
        qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
        updatedCount: 0
      },
      userId: user.id
    });
  }, datasetWorkflowTransactionOptions);

  response.status(200).json({
    tasks: [],
    updatedCount: 0
  });
});

router.patch("/dataset-workflow/budget", async (request: AuthenticatedRequest, response) => {
  const context = await getDatasetControllerContext(request, response);

  if (!context) {
    return;
  }

  const { dataset, prisma, user } = context;
  const workflow = readDatasetTaskWorkflowDefaults(dataset.metadata);
  const paymentPolicy = await parseDatasetPaymentPolicyForRequest(request.body, readDatasetPaymentPolicy(dataset.metadata));

  if (!paymentPolicy.ok) {
    response.status(400).json({ error: paymentPolicy.error });
    return;
  }

  const paymentPolicyLockIssue = getDatasetPaymentPolicyLockIssue(dataset.metadata, paymentPolicy.value);

  if (paymentPolicyLockIssue) {
    response.status(400).json({ error: paymentPolicyLockIssue });
    return;
  }

  const activeStatuses = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED];

  try {
    const count = await prisma.$transaction(async (tx) => {
      const activeTasks = await tx.task.findMany({
        where: {
          datasetId: dataset.id,
          status: {
            in: activeStatuses
          }
        },
        orderBy: [
          {
            createdAt: "asc"
          },
          {
            id: "asc"
          }
        ],
        select: {
          id: true,
          metadata: true
        }
      });
      const currentPaymentPolicy = readDatasetPaymentPolicy(dataset.metadata);
      const unfundedTaskCount = activeTasks.filter((task) => !getTaskPaymentEscrowLedgerEntryId(task.metadata)).length;
      const topUpCredits = activeTasks.reduce((total, task, index) => {
        if (!getTaskPaymentEscrowLedgerEntryId(task.metadata)) {
          return total;
        }

        const allocation = getDatasetTaskCreditAllocation(index, workflow, paymentPolicy.value);

        return total + Math.max(0, allocation.credits - getTaskPaymentEscrowCredits(task.metadata, currentPaymentPolicy));
      }, 0);
      const unfundedCredits = activeTasks.reduce((total, task, index) => {
        if (getTaskPaymentEscrowLedgerEntryId(task.metadata)) {
          return total;
        }

        return total + getDatasetTaskCreditAllocation(index, workflow, paymentPolicy.value).credits;
      }, 0);
      const escrow = await holdCreatorCreditsEscrow(tx, {
        credits: unfundedCredits + topUpCredits,
        datasetId: dataset.id,
        description: `Hold for ${unfundedTaskCount} configured dataset task${unfundedTaskCount === 1 ? "" : "s"}${topUpCredits > 0 ? " and budget increase top-ups" : ""}.`,
        metadata: {
          annotationCredits: paymentPolicy.value.annotationCredits,
          datasetBudgetCredits: paymentPolicy.value.datasetBudgetCredits,
          datasetId: dataset.id,
          freeTaskPostingFeeCredits: paymentPolicy.value.freeTaskPostingFeeCredits,
          platformFeeRate: paymentPolicy.value.platformFeeRate,
          reviewBudgetShare: paymentPolicy.value.reviewBudgetShare,
          reviewCredits: paymentPolicy.value.reviewCredits,
          taskBudgetBasis: paymentPolicy.value.taskBudgetBasis,
          topUpCredits,
          totalCredits: unfundedCredits + topUpCredits,
          unfundedTaskCount
        },
        organizationId: dataset.organizationId,
        paymentPolicy: paymentPolicy.value
      });

      const metadataUpdates = new Map<string, { ids: string[]; patch: Prisma.InputJsonObject }>();

      activeTasks.forEach((task, index) => {
        const existingEscrowLedgerEntryId = getTaskPaymentEscrowLedgerEntryId(task.metadata);
        const allocation = getDatasetTaskCreditAllocation(index, workflow, paymentPolicy.value);

        if (existingEscrowLedgerEntryId && allocation.credits <= getTaskPaymentEscrowCredits(task.metadata, currentPaymentPolicy)) {
          return;
        }

        const patch: Prisma.InputJsonObject = {
          paymentAnnotationCredits: allocation.annotationCredits,
          paymentCurrency: paymentPolicy.value.currency,
          paymentDatasetBudgetCredits: paymentPolicy.value.datasetBudgetCredits,
          paymentEscrowCredits: allocation.credits,
          paymentFreeTaskPostingFeeCredits: paymentPolicy.value.freeTaskPostingFeeCredits,
          paymentPlatformFeeCredits: allocation.platformFeeCredits,
          paymentPlatformFeeRate: paymentPolicy.value.platformFeeRate,
          paymentReviewBudgetShare: paymentPolicy.value.reviewBudgetShare,
          paymentReviewCredits: allocation.reviewCredits,
          paymentTaskBudgetBasis: paymentPolicy.value.taskBudgetBasis,
          paymentWorkerCredits: allocation.workerCredits,
          ...(existingEscrowLedgerEntryId ? {} : { paymentEscrowLedgerEntryId: escrow.ledgerEntryId })
        };
        const key = JSON.stringify(patch);
        const existing = metadataUpdates.get(key);

        if (existing) {
          existing.ids.push(task.id);
        } else {
          metadataUpdates.set(key, {
            ids: [task.id],
            patch
          });
        }
      });

      for (const update of metadataUpdates.values()) {
        await patchTaskMetadataMany(tx, update.ids, update.patch);
      }

      await tx.dataset.update({
        where: {
          id: dataset.id
        },
        data: {
          metadata: mergeDatasetPaymentPolicyDefaults(dataset.metadata, paymentPolicy.value, {
            changedById: user.id,
            reason: "budget_policy_updated"
          })
        }
      });

      await tx.auditLog.create({
        data: {
          organizationId: dataset.organizationId,
          projectId: dataset.projectId,
          userId: user.id,
          action: "task.dataset_workflow.budget_updated",
          entityType: "dataset",
          entityId: dataset.id,
          metadata: {
            requestId: getRequestId(request),
            datasetName: dataset.name,
            paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
            topUpCredits,
            updatedCount: activeTasks.length
          }
        }
      });

      await recordDatasetVersionChange(tx, {
        datasetId: dataset.id,
        reason: "budget_policy_updated",
        summary: {
          paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
          topUpCredits,
          updatedCount: activeTasks.length
        },
        userId: user.id
      });

      return activeTasks.length;
    }, datasetWorkflowTransactionOptions);

    response.status(200).json({
      tasks: [],
      updatedCount: count
    });
  } catch (error) {
    if (error instanceof InsufficientCreatorBalanceError) {
      response.status(402).json({ error: error.message });
      return;
    }

    if (isTransactionTimeoutError(error)) {
      response.status(503).json({
        error: "Applying this dataset budget took too long. Try again in a moment; if the dataset is large, update the budget before generating more tasks."
      });
      return;
    }

    throw error;
  }
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

  const qualityPolicy = parseDatasetQualityPolicyBody(request.body, readDatasetQualityPolicy(dataset.metadata));

  if (!qualityPolicy.ok) {
    response.status(400).json({ error: qualityPolicy.error });
    return;
  }

  const paymentPolicy = await parseDatasetPaymentPolicyForRequest(request.body, readDatasetPaymentPolicy(dataset.metadata));

  if (!paymentPolicy.ok) {
    response.status(400).json({ error: paymentPolicy.error });
    return;
  }

  const paymentPolicyLockIssue = getDatasetPaymentPolicyLockIssue(dataset.metadata, paymentPolicy.value);

  if (paymentPolicyLockIssue) {
    response.status(400).json({ error: paymentPolicyLockIssue });
    return;
  }

  const activeStatuses = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED];
  let result: {
    assignmentCounts: Array<{ count: number; userId: string }>;
    count: number;
  };

  try {
    result = await prisma.$transaction(async (tx) => {
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
        metadata: true,
        status: true
      }
    });
    const workload = parsed.value.assignmentMode === "round_robin"
      ? await tx.task.groupBy({
          by: ["assignedToId"],
          where: {
            assignedToId: {
              in: parsed.value.assigneeIds
            },
            datasetId: {
              not: dataset.id
            },
            projectId: dataset.projectId,
            status: {
              in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]
            }
          },
          _count: {
            _all: true
          }
        })
      : [];
    const assignmentPlan = getDatasetWorkflowAssignments(parsed.value, activeTasks.length, normalizeAssignmentWorkload(workload));
    const assignmentCounts = countDatasetWorkflowAssignees(assignmentPlan);
    const unfundedTaskCount = activeTasks.filter((task) => !getTaskPaymentEscrowLedgerEntryId(task.metadata)).length;
    const topUpCredits = activeTasks.reduce((total, task, index) => {
      if (!getTaskPaymentEscrowLedgerEntryId(task.metadata)) {
        return total;
      }

      const allocation = getDatasetTaskCreditAllocation(index, parsed.value, paymentPolicy.value);

      return total + Math.max(0, allocation.credits - getTaskPaymentEscrowCredits(task.metadata, readDatasetPaymentPolicy(dataset.metadata)));
    }, 0);
    const unfundedCredits = activeTasks.reduce((total, task, index) => {
      if (getTaskPaymentEscrowLedgerEntryId(task.metadata)) {
        return total;
      }

      return total + getDatasetTaskCreditAllocation(index, parsed.value, paymentPolicy.value).credits;
    }, 0);
    const escrow = await holdCreatorCreditsEscrow(tx, {
      credits: unfundedCredits + topUpCredits,
      datasetId: dataset.id,
      description: `Hold for ${unfundedTaskCount} configured dataset task${unfundedTaskCount === 1 ? "" : "s"}${topUpCredits > 0 ? " and budget increase top-ups" : ""}.`,
      metadata: {
        annotationCredits: paymentPolicy.value.annotationCredits,
        datasetBudgetCredits: paymentPolicy.value.datasetBudgetCredits,
        datasetId: dataset.id,
        freeTaskPostingFeeCredits: paymentPolicy.value.freeTaskPostingFeeCredits,
        platformFeeRate: paymentPolicy.value.platformFeeRate,
        reviewBudgetShare: paymentPolicy.value.reviewBudgetShare,
        reviewCredits: paymentPolicy.value.reviewCredits,
        taskBudgetBasis: paymentPolicy.value.taskBudgetBasis,
        topUpCredits,
        totalCredits: unfundedCredits + topUpCredits,
        unfundedTaskCount
      },
      organizationId: dataset.organizationId,
      paymentPolicy: paymentPolicy.value
    });

    if (parsed.value.assignmentMode === "round_robin") {
      await Promise.all(
        activeTasks.map((task, index) => {
          const assignedToId = getDatasetWorkflowAssignment(assignmentPlan, index);
          const allocation = getDatasetTaskCreditAllocation(index, parsed.value, paymentPolicy.value);

          return tx.task.update({
            where: {
              id: task.id
            },
            data: {
              ...buildDatasetTaskWorkflowUpdateData(parsed.value, assignedToId),
              metadata: mergeTaskPaymentMetadata(task.metadata, getDatasetTaskAllocationPolicy(paymentPolicy.value, allocation), escrow.ledgerEntryId, allocation.credits, {
                allowIncrease: true,
                platformFeeCredits: allocation.platformFeeCredits,
                workerCredits: allocation.workerCredits
              }),
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
      const assignedToId = getDatasetWorkflowAssignment(assignmentPlan, 0);
      await Promise.all(
        activeTasks.map((task, index) => {
          const allocation = getDatasetTaskCreditAllocation(index, parsed.value, paymentPolicy.value);

          return tx.task.update({
            where: {
              id: task.id
            },
            data: {
              ...buildDatasetTaskWorkflowUpdateData(parsed.value, assignedToId),
              metadata: mergeTaskPaymentMetadata(task.metadata, getDatasetTaskAllocationPolicy(paymentPolicy.value, allocation), escrow.ledgerEntryId, allocation.credits, {
                allowIncrease: true,
                platformFeeCredits: allocation.platformFeeCredits,
                workerCredits: allocation.workerCredits
              })
            }
          });
        }
        )
      );

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
          metadata: mergeDatasetPaymentPolicyDefaults(
            mergeDatasetQualityPolicyDefaults(
              mergeDatasetTaskWorkflowDefaults(dataset.metadata, parsed.value),
              qualityPolicy.value
            ),
            paymentPolicy.value,
            {
              changedById: user.id,
              reason: "task_workflow_updated"
            }
          )
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
            paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
            qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
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
          paymentPolicy: serializeDatasetPaymentPolicy(paymentPolicy.value),
          qualityPolicy: serializeDatasetQualityPolicy(qualityPolicy.value),
          updatedCount: activeTasks.length
        },
        userId: user.id
      });
    }

    return {
      assignmentCounts,
      count: activeTasks.length
    };
    }, datasetWorkflowTransactionOptions);
  } catch (error) {
    if (error instanceof InsufficientCreatorBalanceError) {
      response.status(402).json({ error: error.message });
      return;
    }

    if (isTransactionTimeoutError(error)) {
      response.status(503).json({
        error: "Updating this dataset took too long. Try again in a moment; if the dataset is large, apply smaller task batches."
      });
      return;
    }

    throw error;
  }

  if (result.count > 0) {
    void createNotifications(
      buildTaskAssignmentNotifications({
        assignmentCounts: result.assignmentCounts,
        dataset,
        projectId: dataset.projectId,
        title: "Dataset task config applied"
      })
    );
  }

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

  if (parsed.value.assignedToId && parsed.value.assignedToId !== task.assignedToId && parsed.value.assignedToId !== user.id) {
    void createNotification({
      event: NotificationPreferenceEvent.TASK_ASSIGNED,
      userId: parsed.value.assignedToId,
      type: NotificationType.TASK_ASSIGNED,
      title: "Task assigned",
      message: `${getTaskAssetName(updatedTask)} is ready for labeling.`,
      metadata: buildTaskNotificationMetadata(updatedTask)
    });
  }

  if (parsed.value.reviewerId && parsed.value.reviewerId !== task.reviewerId && parsed.value.reviewerId !== user.id) {
    void createNotification({
      event: NotificationPreferenceEvent.REVIEW_REQUESTED,
      userId: parsed.value.reviewerId,
      type: NotificationType.REVIEW_REQUESTED,
      title: "Review queue updated",
      message: `${getTaskAssetName(updatedTask)} may need your review.`,
      metadata: buildTaskNotificationMetadata(updatedTask, "review")
    });
  }

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
  const queueMode = queue === "review" ? "review" : "work";
  const visibleWhere = queueMode === "review"
    ? buildReviewTaskWhere(scope, { datasetId, projectId })
    : buildVisibleTaskWhere(scope, { datasetId, projectId });
  const where = {
    AND: [
      visibleWhere,
      buildTaskQueueFilterWhere(taskQueueFilters, {
        now: new Date(),
        queue: queueMode,
        userId: user.id
      })
    ]
  };
  const queueFilters: Prisma.TaskWhereInput = queueMode === "review"
    ? {
        reviewerId: user.id,
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

  void createNotifications(
    getTaskCommentNotificationRecipients(access.task, user.id).map((userId) => ({
      event: NotificationPreferenceEvent.COMMENT_ADDED,
      userId,
      type: NotificationType.INFO,
      title: "New task comment",
      message: `${getTaskAssetName(access.task)} has a new comment.`,
      metadata: {
        ...buildTaskNotificationMetadata(access.task),
        commentId: comment.id
      }
    }))
  );

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
  const reviewMetadata = parseReviewMetadata(request.body);

  if (decision !== "approve" && decision !== "reject") {
    response.status(400).json({ error: "Review decision must be approve or reject." });
    return;
  }

  if (decision === "reject" && !feedback) {
    response.status(400).json({ error: "Add feedback before rejecting a task." });
    return;
  }

  if (!reviewMetadata.ok) {
    response.status(400).json({ error: reviewMetadata.error });
    return;
  }

  if (decision === "reject" && !reviewMetadata.value.reason) {
    response.status(400).json({ error: "Choose a rejection reason before sending the task back." });
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
  const qualityPolicy = readDatasetQualityPolicy(access.task.dataset?.metadata);
  const paymentPolicy = readTaskPaymentPolicy(access.task.metadata, access.task.dataset?.metadata);
  const consensus = summarizeTaskConsensus(access.task);

  if (
    decision === "approve" &&
    qualityPolicy.requireConsensusBeforeApproval &&
    consensus.hasOverlap &&
    isConsensusBelowPolicy(consensus, qualityPolicy)
  ) {
    response.status(409).json({
      error: `Consensus is below the dataset minimum. Agreement is ${Math.round(consensus.agreementRate * 100)}%, label agreement is ${Math.round(consensus.labelAgreementRate * 100)}%, and the minimum is ${Math.round(qualityPolicy.minAgreementRate * 100)}%.`
    });
    return;
  }

  const consensusMetadata = buildConsensusTaskMetadata(access.task.metadata, consensus, qualityPolicy);

  const result = await prisma.$transaction(async (tx) => {
    let review = await tx.review.create({
      data: {
        annotationId: submittedAnnotation.id,
        feedback,
        metadata: reviewMetadata.value.metadata,
        reviewerId: user.id,
        score: reviewMetadata.value.score,
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
        metadata: consensusMetadata,
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
            ...reviewMetadata.value.metadata,
            reviewId: review.id,
            reviewStatus
          },
          taskId: access.task.id,
          userId: user.id
        },
        include: commentIncludes
      });
    }

    await resolveAnnotationUnderReviewCredit(tx, {
      annotationId: submittedAnnotation.id,
      decision,
      reviewId: review.id
    });

    let paymentSettlement = null;

    if (decision === "approve") {
      await upsertTaskCreditEvent(tx, {
        annotationId: submittedAnnotation.id,
        currency: paymentPolicy.currency,
        datasetId: savedTask.datasetId,
        eventType: TaskCreditEventType.REVIEW_COMPLETED,
        metadata: {
          decision,
          reviewId: review.id,
          score: reviewMetadata.value.score,
          taskId: savedTask.id
        },
        organizationId: savedTask.project.organizationId,
        points: paymentPolicy.reviewCredits,
        projectId: savedTask.projectId,
        referenceKey: `review.completed:${review.id}`,
        reviewId: review.id,
        status: TaskCreditStatus.APPROVED,
        taskId: savedTask.id,
        userId: user.id
      });

      await upsertTaskCreditEvent(tx, {
        annotationId: submittedAnnotation.id,
        currency: paymentPolicy.currency,
        datasetId: savedTask.datasetId,
        eventType: TaskCreditEventType.ANNOTATION_APPROVED,
        metadata: {
          reviewId: review.id,
          score: reviewMetadata.value.score,
          taskId: savedTask.id
        },
        organizationId: savedTask.project.organizationId,
        points: paymentPolicy.annotationCredits,
        projectId: savedTask.projectId,
        referenceKey: `annotation.approved:${submittedAnnotation.id}`,
        reviewId: review.id,
        status: TaskCreditStatus.APPROVED,
        taskId: savedTask.id,
        userId: submittedAnnotation.userId
      });

      paymentSettlement = await settleTaskEscrowOnApproval(tx, {
        paymentPolicy,
        reviewId: review.id,
        task: savedTask
      });

      if (paymentSettlement) {
        review = await tx.review.update({
          where: {
            id: review.id
          },
          data: {
            metadata: {
              ...reviewMetadata.value.metadata,
              paymentSettlement: serializeReviewPaymentSettlement(paymentSettlement)
            }
          },
          include: reviewIncludes
        });
      }
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
          paymentSettlement: paymentSettlement ? serializeReviewPaymentSettlement(paymentSettlement) : null,
          previousStatus: access.task.status,
          reason: reviewMetadata.value.reason,
          requestId: getRequestId(request),
          reviewId: review.id
        }
      }
    });

    return {
      comment,
      paymentSettlement,
      review,
      task: savedTask
    };
  });

  if (submittedAnnotation.userId !== user.id) {
    void createNotification({
      event: decision === "approve" ? NotificationPreferenceEvent.TASK_APPROVED : NotificationPreferenceEvent.TASK_REJECTED,
      userId: submittedAnnotation.userId,
      type: decision === "approve" ? NotificationType.SUCCESS : NotificationType.WARNING,
      title: decision === "approve" ? "Task approved" : "Task needs changes",
      message: feedback || `${getTaskAssetName(result.task)} was ${decision === "approve" ? "approved" : "sent back"}.`,
      metadata: buildTaskNotificationMetadata(result.task)
    });
  }

  response.status(200).json({
    annotation: serializeAnnotation(
      result.task.annotations.find((annotation) => annotation.id === submittedAnnotation.id) ?? result.task.annotations[0] ?? null
    ),
    comment: result.comment ? serializeComment(result.comment) : null,
    review: serializeReview(result.review),
    settlement: result.paymentSettlement ? serializeReviewPaymentSettlement(result.paymentSettlement) : null,
    task: serializeTask(result.task, access.membership)
  });
});

function serializeReviewPaymentSettlement(settlement: {
  approvedCredits: number;
  currency: string;
  escrowCredits: number;
  feeCredits: number;
  refundCredits: number;
}) {
  return {
    approvedCredits: settlement.approvedCredits,
    currency: settlement.currency,
    escrowCredits: settlement.escrowCredits,
    feeCredits: settlement.feeCredits,
    refundCredits: settlement.refundCredits
  };
}

router.post("/:taskId/start", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "start");
});

router.post("/:taskId/submit", async (request: AuthenticatedRequest, response) => {
  await updateTaskForUser(request, response, "submit");
});

export { router as tasksRouter };

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
  const paymentPolicy = readTaskPaymentPolicy(access.task.metadata, access.task.dataset?.metadata);

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
          confidence: region.confidence,
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

    if (action === "submit") {
      await upsertTaskCreditEvent(tx, {
        annotationId: annotation.id,
        currency: paymentPolicy.currency,
        datasetId: access.task.datasetId,
        eventType: TaskCreditEventType.ANNOTATION_SUBMITTED,
        metadata: {
          leadTimeSeconds: parsed.value.leadTimeSeconds ?? null,
          regionCount: parsed.value.regions.length,
          resultCount: parsed.value.results.length,
          taskId: access.task.id,
          version
        },
        organizationId: access.task.project.organizationId,
        points: paymentPolicy.annotationCredits,
        projectId: access.task.projectId,
        referenceKey: `annotation.submitted:${annotation.id}`,
        status: TaskCreditStatus.UNDER_REVIEW,
        taskId: access.task.id,
        userId: user.id
      });
    }

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

  if (action === "submit" && savedTask.reviewerId && savedTask.reviewerId !== user.id) {
    void createNotification({
      event: NotificationPreferenceEvent.REVIEW_REQUESTED,
      userId: savedTask.reviewerId,
      type: NotificationType.REVIEW_REQUESTED,
      title: "Task ready for review",
      message: `${getTaskAssetName(savedTask)} was submitted.`,
      metadata: buildTaskNotificationMetadata(savedTask, "review")
    });
  }

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

  if (action === "submit" && updatedTask.reviewerId && updatedTask.reviewerId !== user.id) {
    void createNotification({
      event: NotificationPreferenceEvent.REVIEW_REQUESTED,
      userId: updatedTask.reviewerId,
      type: NotificationType.REVIEW_REQUESTED,
      title: "Task ready for review",
      message: `${getTaskAssetName(updatedTask)} was submitted.`,
      metadata: buildTaskNotificationMetadata(updatedTask, "review")
    });
  }

  response.status(200).json({
    task: serializeTask(updatedTask, effectiveMembership)
  });
}

function isTransactionTimeoutError(error: unknown) {
  return error instanceof Error &&
    error.message.includes("Transaction API error") &&
    error.message.includes("expired transaction");
}

async function parseDatasetPaymentPolicyForRequest(body: unknown, fallback: DatasetPaymentPolicyValue) {
  const parsed = parseDatasetPaymentPolicyBody(body as Parameters<typeof parseDatasetPaymentPolicyBody>[0], fallback);

  if (!parsed.ok) {
    return parsed;
  }

  const economics = await getPlatformTaskEconomics();

  return {
    ok: true as const,
    value: {
      ...parsed.value,
      freeTaskPostingFeeCredits: economics.freeTaskPostingFeeCredits,
      platformFeeRate: economics.platformFeeRate
    }
  };
}
