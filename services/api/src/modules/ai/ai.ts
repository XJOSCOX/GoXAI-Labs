import { Router, type NextFunction, type Response } from "express";
import {
  AIJobStatus,
  AIJobType,
  AIProviderType,
  getPrismaClient,
  Prisma,
  ProjectAccessMode,
  ProjectStatus
} from "@goxai/database";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { getRequestId, saveAuditLog } from "../../shared/logging.js";
import { canGenerateTasks, canReviewTasks, canWorkTasks } from "../../shared/permissions.js";
import { getPlatformFeatures } from "../../shared/platformFeatures.js";
import { getEffectiveProjectMembership } from "../tasks/taskAccess.js";
import { isPlainJsonObject, normalizeId, normalizeShortText, parseAnnotationBody } from "../tasks/taskValidation.js";

const router = Router();

router.use(requireAuthenticatedUser);
router.use(requireAIEnabled);

async function requireAIEnabled(_request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const features = await getPlatformFeatures();

  if (!features.aiEnabled) {
    response.status(403).json({ error: "AI features are disabled by a platform admin." });
    return;
  }

  next();
}

router.get("/providers", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);
  const organizationId = normalizeId(request.query.organizationId);
  const prisma = getPrismaClient();

  if (projectId) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        organizationId: true
      }
    });

    if (!project) {
      response.status(404).json({ error: "Project was not found." });
      return;
    }

    const membership = await getEffectiveProjectMembership(user.id, project.id, project.organizationId);

    if (!membership) {
      response.status(403).json({ error: "You do not have access to AI providers for this project." });
      return;
    }

    const providers = await prisma.modelProvider.findMany({
      where: {
        active: true,
        organizationId: project.organizationId,
        OR: [{ projectId: null }, { projectId: project.id }]
      },
      orderBy: [{ projectId: "desc" }, { name: "asc" }]
    });

    response.status(200).json({ providers: providers.map(serializeProvider) });
    return;
  }

  if (!organizationId) {
    response.status(400).json({ error: "Project or organization is required." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId,
      status: "ACTIVE",
      userId: user.id
    },
    select: {
      role: true
    }
  });

  if (!membership) {
    response.status(403).json({ error: "You do not have access to AI providers for this organization." });
    return;
  }

  const providers = await prisma.modelProvider.findMany({
    where: {
      active: true,
      organizationId
    },
    orderBy: [{ projectId: "desc" }, { name: "asc" }]
  });

  response.status(200).json({ providers: providers.map(serializeProvider) });
});

router.post("/providers", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.body?.projectId);
  const organizationId = normalizeId(request.body?.organizationId);
  const name = normalizeShortText(request.body?.name, 120);
  const type = parseEnumValue(AIProviderType, normalizeShortText(request.body?.type, 40) ?? undefined);

  if (!name) {
    response.status(400).json({ error: "Provider name is required." });
    return;
  }

  if (!type) {
    response.status(400).json({ error: "Choose a valid AI provider type." });
    return;
  }

  const prisma = getPrismaClient();
  const scope = await resolveProviderWriteScope({
    organizationId,
    projectId,
    userId: user.id
  });

  if (!scope.ok) {
    response.status(scope.status).json({ error: scope.error });
    return;
  }

  const provider = await prisma.modelProvider.create({
    data: {
      active: request.body?.active !== false,
      configJson: normalizeJsonObject(request.body?.configJson) ?? undefined,
      createdById: user.id,
      name,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      type
    }
  });

  void saveAuditLog({
    action: "ai.provider.created",
    entityId: provider.id,
    entityType: "model_provider",
    metadata: {
      name: provider.name,
      projectId: provider.projectId,
      requestId: getRequestId(request),
      type: provider.type
    },
    organizationId: provider.organizationId,
    projectId: provider.projectId ?? undefined,
    userId: user.id
  });

  response.status(201).json({ provider: serializeProvider(provider) });
});

router.patch("/providers/:providerId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const providerId = normalizeId(request.params.providerId);

  if (!providerId) {
    response.status(400).json({ error: "Provider is required." });
    return;
  }

  const prisma = getPrismaClient();
  const provider = await prisma.modelProvider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      organizationId: true,
      projectId: true
    }
  });

  if (!provider) {
    response.status(404).json({ error: "Provider was not found." });
    return;
  }

  const scope = await resolveProviderWriteScope({
    organizationId: provider.organizationId,
    projectId: provider.projectId ?? undefined,
    userId: user.id
  });

  if (!scope.ok) {
    response.status(scope.status).json({ error: scope.error });
    return;
  }

  const data: Prisma.ModelProviderUpdateInput = {};
  const name = normalizeShortText(request.body?.name, 120);
  const type = parseEnumValue(AIProviderType, normalizeShortText(request.body?.type, 40) ?? undefined);

  if (name) {
    data.name = name;
  }

  if (type) {
    data.type = type;
  }

  if (typeof request.body?.active === "boolean") {
    data.active = request.body.active;
  }

  if (Object.prototype.hasOwnProperty.call(request.body ?? {}, "configJson")) {
    data.configJson = normalizeJsonObject(request.body?.configJson) ?? Prisma.JsonNull;
  }

  const updated = await prisma.modelProvider.update({
    where: { id: provider.id },
    data
  });

  void saveAuditLog({
    action: "ai.provider.updated",
    entityId: updated.id,
    entityType: "model_provider",
    metadata: {
      active: updated.active,
      requestId: getRequestId(request),
      type: updated.type
    },
    organizationId: updated.organizationId,
    projectId: updated.projectId ?? undefined,
    userId: user.id
  });

  response.status(200).json({ provider: serializeProvider(updated) });
});

router.get("/jobs", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const taskId = normalizeId(request.query.taskId);
  const datasetId = normalizeId(request.query.datasetId);
  const projectId = normalizeId(request.query.projectId);

  if (!taskId && !datasetId && !projectId) {
    response.status(400).json({ error: "Task, dataset, or project is required." });
    return;
  }

  const access = await resolveAIReadAccess({
    datasetId,
    projectId,
    taskId,
    userId: user.id
  });

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const prisma = getPrismaClient();
  const jobs = await prisma.aIJob.findMany({
    where: {
      ...(taskId ? { taskId } : {}),
      ...(datasetId ? { datasetId } : {}),
      ...(projectId ? { projectId } : {})
    },
    include: aiJobIncludes,
    orderBy: {
      createdAt: "desc"
    },
    take: 50
  });

  response.status(200).json({ jobs: jobs.map(serializeAIJob) });
});

router.post("/jobs/import-predictions", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const taskId = normalizeId(request.body?.taskId);

  if (!taskId) {
    response.status(400).json({ error: "Task is required." });
    return;
  }

  const prisma = getPrismaClient();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      datasetId: true,
      id: true,
      project: {
        select: {
          accessMode: true,
          id: true,
          organizationId: true,
          status: true
        }
      },
      projectId: true
    }
  });

  if (!task) {
    response.status(404).json({ error: "Task was not found." });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, task.project.id, task.project.organizationId);
  const canImport = Boolean(membership && canGenerateTasks(membership));

  if (!canImport) {
    response.status(403).json({ error: "Only project managers can import AI predictions." });
    return;
  }

  const modelProviderId = normalizeId(request.body?.modelProviderId) ?? null;

  if (modelProviderId) {
    const provider = await prisma.modelProvider.findFirst({
      where: {
        active: true,
        id: modelProviderId,
        organizationId: task.project.organizationId,
        OR: [{ projectId: null }, { projectId: task.projectId }]
      },
      select: {
        id: true
      }
    });

    if (!provider) {
      response.status(400).json({ error: "Model provider is not available for this task." });
      return;
    }
  }

  const prediction = normalizePredictionEnvelope(request.body?.predictions ?? request.body?.prediction ?? request.body);

  if (!prediction.ok) {
    response.status(400).json({ error: prediction.error });
    return;
  }

  const type = parseEnumValue(AIJobType, normalizeShortText(request.body?.type, 80) ?? undefined) ?? AIJobType.LLM_PRELABEL;
  const now = new Date();
  const job = await prisma.aIJob.create({
    data: {
      completedAt: now,
      datasetId: task.datasetId,
      inputJson: {
        importedManually: true,
        modelVersion: prediction.modelVersion,
        source: prediction.source
      },
      modelProviderId,
      outputJson: {
        predictions: {
          regions: prediction.regions,
          results: prediction.results,
          score: prediction.score,
          summary: prediction.summary
        }
      },
      projectId: task.projectId,
      requestedById: user.id,
      startedAt: now,
      status: AIJobStatus.COMPLETED,
      taskId: task.id,
      type
    },
    include: aiJobIncludes
  });

  void saveAuditLog({
    action: "ai.predictions.imported",
    entityId: job.id,
    entityType: "ai_job",
    metadata: {
      datasetId: task.datasetId,
      regionCount: prediction.regions.length,
      requestId: getRequestId(request),
      taskId: task.id,
      type: job.type
    },
    organizationId: task.project.organizationId,
    projectId: task.projectId,
    userId: user.id
  });

  response.status(201).json({ job: serializeAIJob(job) });
});

router.post("/jobs/mock-prediction", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const taskId = normalizeId(request.body?.taskId);

  if (!taskId) {
    response.status(400).json({ error: "Task is required." });
    return;
  }

  const prisma = getPrismaClient();
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      asset: {
        select: {
          fileName: true
        }
      },
      dataset: {
        select: {
          labels: {
            orderBy: {
              createdAt: "asc"
            },
            select: {
              name: true
            }
          }
        }
      },
      datasetId: true,
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

  if (!task) {
    response.status(404).json({ error: "Task was not found." });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, task.project.id, task.project.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({ error: "Only project managers can generate test prelabels." });
    return;
  }

  const providerCheck = await resolveOptionalProvider({
    modelProviderId: normalizeId(request.body?.modelProviderId) ?? null,
    organizationId: task.project.organizationId,
    projectId: task.projectId
  });

  if (!providerCheck.ok) {
    response.status(providerCheck.status).json({ error: providerCheck.error });
    return;
  }

  const now = new Date();
  const prediction = buildMockPrediction(task.asset?.fileName ?? task.id, 0, task.dataset?.labels.map((label) => label.name) ?? []);
  const job = await prisma.aIJob.create({
    data: {
      completedAt: now,
      datasetId: task.datasetId,
      inputJson: {
        mock: true,
        source: "mock_prediction",
        taskId: task.id
      },
      modelProviderId: providerCheck.modelProviderId,
      outputJson: {
        predictions: prediction
      },
      projectId: task.projectId,
      requestedById: user.id,
      startedAt: now,
      status: AIJobStatus.COMPLETED,
      taskId: task.id,
      type: AIJobType.LLM_PRELABEL
    },
    include: aiJobIncludes
  });

  void saveAuditLog({
    action: "ai.mock_prediction.generated",
    entityId: job.id,
    entityType: "ai_job",
    metadata: {
      requestId: getRequestId(request),
      taskId: task.id
    },
    organizationId: task.project.organizationId,
    projectId: task.projectId,
    userId: user.id
  });

  response.status(201).json({ job: serializeAIJob(job) });
});

router.post("/jobs/import-dataset-predictions", async (request: AuthenticatedRequest, response) => {
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

  const rows = parseDatasetPredictionRows(request.body?.predictions ?? request.body?.rows ?? request.body?.payload);

  if (!rows.ok) {
    response.status(400).json({ error: rows.error });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: { id: datasetId },
    select: {
      id: true,
      labels: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          name: true
        }
      },
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
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, dataset.project.id, dataset.project.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({ error: "Only project managers can import dataset predictions." });
    return;
  }

  const modelProviderId = normalizeId(request.body?.modelProviderId) ?? null;

  if (modelProviderId) {
    const provider = await prisma.modelProvider.findFirst({
      where: {
        active: true,
        id: modelProviderId,
        organizationId: dataset.project.organizationId,
        OR: [{ projectId: null }, { projectId: dataset.projectId }]
      },
      select: {
        id: true
      }
    });

    if (!provider) {
      response.status(400).json({ error: "Model provider is not available for this dataset." });
      return;
    }
  }

  const tasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id
    },
    select: {
      asset: {
        select: {
          fileName: true,
          objectKey: true
        }
      },
      id: true,
      projectId: true
    }
  });
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const tasksByAssetName = new Map<string, (typeof tasks)[number]>();

  tasks.forEach((task) => {
    if (task.asset?.fileName) {
      tasksByAssetName.set(normalizeMatchKey(task.asset.fileName), task);
    }

    if (task.asset?.objectKey) {
      tasksByAssetName.set(normalizeMatchKey(getBaseName(task.asset.objectKey)), task);
    }
  });

  const errors: DatasetPredictionImportError[] = [];
  const matchedRows: Array<{
    matchField: "assetName" | "taskId";
    prediction: Exclude<ReturnType<typeof normalizePredictionEnvelope>, { ok: false }>;
    row: DatasetPredictionRow;
    task: (typeof tasks)[number];
  }> = [];

  rows.rows.forEach((row) => {
    const task = row.taskId ? tasksById.get(row.taskId) : row.assetName ? tasksByAssetName.get(normalizeMatchKey(row.assetName)) : undefined;

    if (!task) {
      errors.push({
        assetName: row.assetName,
        error: row.taskId || row.assetName ? "No matching task was found in this dataset." : "Row needs taskId or assetName.",
        row: row.row,
        taskId: row.taskId
      });
      return;
    }

    const prediction = normalizePredictionEnvelope(row.prediction);

    if (!prediction.ok) {
      errors.push({
        assetName: row.assetName,
        error: prediction.error,
        row: row.row,
        taskId: row.taskId ?? task.id
      });
      return;
    }

    matchedRows.push({
      matchField: row.taskId ? "taskId" : "assetName",
      prediction,
      row,
      task
    });
  });

  const type = parseEnumValue(AIJobType, normalizeShortText(request.body?.type, 80) ?? undefined) ?? AIJobType.LLM_PRELABEL;
  const now = new Date();
  const createdJobs = await prisma.$transaction(
    matchedRows.map((match) =>
      prisma.aIJob.create({
        data: {
          completedAt: now,
          datasetId: dataset.id,
          inputJson: {
            assetName: match.row.assetName,
            importedManually: true,
            matchField: match.matchField,
            modelVersion: match.prediction.modelVersion,
            row: match.row.row,
            source: match.prediction.source
          },
          modelProviderId,
          outputJson: {
            predictions: {
              regions: match.prediction.regions,
              results: match.prediction.results,
              score: match.prediction.score,
              summary: match.prediction.summary
            }
          },
          projectId: match.task.projectId,
          requestedById: user.id,
          startedAt: now,
          status: AIJobStatus.COMPLETED,
          taskId: match.task.id,
          type
        },
        include: aiJobIncludes
      })
    )
  );
  const totalRegions = matchedRows.reduce((sum, match) => sum + match.prediction.regions.length, 0);

  void saveAuditLog({
    action: "ai.dataset_predictions.imported",
    entityId: dataset.id,
    entityType: "dataset",
    metadata: {
      errorCount: errors.length,
      importedCount: createdJobs.length,
      regionCount: totalRegions,
      requestId: getRequestId(request),
      rowCount: rows.rows.length,
      type
    },
    organizationId: dataset.project.organizationId,
    projectId: dataset.projectId,
    userId: user.id
  });

  response.status(201).json({
    errors: errors.slice(0, 25),
    importedCount: createdJobs.length,
    jobs: createdJobs.map(serializeAIJob),
    rowCount: rows.rows.length,
    skippedCount: errors.length,
    totalRegions
  });
});

router.post("/jobs/mock-dataset-predictions", async (request: AuthenticatedRequest, response) => {
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
    where: { id: datasetId },
    select: {
      id: true,
      labels: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          name: true
        }
      },
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
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await getEffectiveProjectMembership(user.id, dataset.project.id, dataset.project.organizationId);

  if (!membership || !canGenerateTasks(membership)) {
    response.status(403).json({ error: "Only project managers can generate dataset test prelabels." });
    return;
  }

  const providerCheck = await resolveOptionalProvider({
    modelProviderId: normalizeId(request.body?.modelProviderId) ?? null,
    organizationId: dataset.project.organizationId,
    projectId: dataset.projectId
  });

  if (!providerCheck.ok) {
    response.status(providerCheck.status).json({ error: providerCheck.error });
    return;
  }

  const limit = normalizeMockLimit(request.body?.limit);
  const tasks = await prisma.task.findMany({
    where: {
      datasetId: dataset.id
    },
    orderBy: {
      createdAt: "asc"
    },
    take: limit,
    select: {
      asset: {
        select: {
          fileName: true
        }
      },
      id: true,
      projectId: true
    }
  });
  const now = new Date();
  const createdJobs = await prisma.$transaction(
    tasks.map((task, index) =>
      prisma.aIJob.create({
        data: {
          completedAt: now,
          datasetId: dataset.id,
          inputJson: {
            mock: true,
            source: "mock_dataset_prediction",
            taskId: task.id
          },
          modelProviderId: providerCheck.modelProviderId,
          outputJson: {
            predictions: buildMockPrediction(task.asset?.fileName ?? task.id, index, dataset.labels.map((label) => label.name))
          },
          projectId: task.projectId,
          requestedById: user.id,
          startedAt: now,
          status: AIJobStatus.COMPLETED,
          taskId: task.id,
          type: AIJobType.LLM_PRELABEL
        },
        include: aiJobIncludes
      })
    )
  );
  const totalRegions = createdJobs.reduce((total, job) => {
    const output = isPlainJsonObject(job.outputJson) && isPlainJsonObject(job.outputJson.predictions) ? job.outputJson.predictions : null;
    return total + (Array.isArray(output?.regions) ? output.regions.length : 0);
  }, 0);

  void saveAuditLog({
    action: "ai.mock_dataset_predictions.generated",
    entityId: dataset.id,
    entityType: "dataset",
    metadata: {
      importedCount: createdJobs.length,
      limit,
      regionCount: totalRegions,
      requestId: getRequestId(request)
    },
    organizationId: dataset.project.organizationId,
    projectId: dataset.projectId,
    userId: user.id
  });

  response.status(201).json({
    errors: [],
    importedCount: createdJobs.length,
    jobs: createdJobs.map(serializeAIJob),
    rowCount: tasks.length,
    skippedCount: 0,
    totalRegions
  });
});

const aiJobIncludes = {
  dataset: {
    select: {
      id: true,
      name: true
    }
  },
  modelProvider: {
    select: {
      id: true,
      name: true,
      type: true
    }
  },
  project: {
    select: {
      id: true,
      name: true
    }
  },
  requestedBy: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true
    }
  },
  task: {
    select: {
      id: true
    }
  }
} satisfies Prisma.AIJobInclude;

type AIJobWithIncludes = Prisma.AIJobGetPayload<{ include: typeof aiJobIncludes }>;

function serializeAIJob(job: AIJobWithIncludes) {
  return {
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    dataset: job.dataset,
    datasetId: job.datasetId,
    errorMessage: job.errorMessage,
    id: job.id,
    inputJson: job.inputJson,
    modelProvider: job.modelProvider,
    modelProviderId: job.modelProviderId,
    outputJson: job.outputJson,
    project: job.project,
    projectId: job.projectId,
    requestedBy: job.requestedBy ? serializeUserName(job.requestedBy) : null,
    requestedById: job.requestedById,
    startedAt: job.startedAt,
    status: job.status,
    task: job.task,
    taskId: job.taskId,
    type: job.type,
    updatedAt: job.updatedAt
  };
}

function serializeProvider(provider: {
  active: boolean;
  configJson: Prisma.JsonValue | null;
  createdAt: Date;
  createdById: string | null;
  id: string;
  name: string;
  organizationId: string;
  projectId: string | null;
  type: AIProviderType;
  updatedAt: Date;
}) {
  return {
    active: provider.active,
    configJson: provider.configJson,
    createdAt: provider.createdAt,
    createdById: provider.createdById,
    id: provider.id,
    name: provider.name,
    organizationId: provider.organizationId,
    projectId: provider.projectId,
    type: provider.type,
    updatedAt: provider.updatedAt
  };
}

function serializeUserName(user: { email: string; firstName: string | null; id: string; lastName: string | null }) {
  return {
    email: user.email,
    id: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  };
}

async function resolveProviderWriteScope(input: { organizationId?: string; projectId?: string; userId: string }):
  Promise<
    | {
        ok: true;
        organizationId: string;
        projectId: string | null;
      }
    | {
        ok: false;
        error: string;
        status: number;
      }
  > {
  const prisma = getPrismaClient();

  if (input.projectId) {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        organizationId: true
      }
    });

    if (!project) {
      return { ok: false, error: "Project was not found.", status: 404 };
    }

    const membership = await getEffectiveProjectMembership(input.userId, project.id, project.organizationId);

    if (!membership || !canGenerateTasks(membership)) {
      return { ok: false, error: "Only project managers can manage AI providers.", status: 403 };
    }

    return {
      ok: true,
      organizationId: project.organizationId,
      projectId: project.id
    };
  }

  if (!input.organizationId) {
    return { ok: false, error: "Project or organization is required.", status: 400 };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      userId: input.userId
    },
    select: {
      role: true
    }
  });

  if (!membership || !canGenerateTasks(membership)) {
    return { ok: false, error: "Only organization managers can manage AI providers.", status: 403 };
  }

  return {
    ok: true,
    organizationId: input.organizationId,
    projectId: null
  };
}

async function resolveAIReadAccess(input: { datasetId?: string; projectId?: string; taskId?: string; userId: string }):
  Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const prisma = getPrismaClient();

  const project = input.taskId
    ? await prisma.task.findUnique({
        where: { id: input.taskId },
        select: {
          project: {
            select: {
              accessMode: true,
              id: true,
              organizationId: true,
              status: true
            }
          }
        }
      }).then((task) => task?.project ?? null)
    : input.datasetId
      ? await prisma.dataset.findUnique({
          where: { id: input.datasetId },
          select: {
            project: {
              select: {
                accessMode: true,
                id: true,
                organizationId: true,
                status: true
              }
            }
          }
        }).then((dataset) => dataset?.project ?? null)
      : await prisma.project.findUnique({
          where: { id: input.projectId },
          select: {
            accessMode: true,
            id: true,
            organizationId: true,
            status: true
          }
        });

  if (!project) {
    return { ok: false, error: "AI job scope was not found.", status: 404 };
  }

  if (project.accessMode === ProjectAccessMode.PUBLIC && project.status === ProjectStatus.ACTIVE) {
    return { ok: true };
  }

  const membership = await getEffectiveProjectMembership(input.userId, project.id, project.organizationId);

  if (membership && (canWorkTasks(membership) || canReviewTasks(membership) || canGenerateTasks(membership))) {
    return { ok: true };
  }

  return { ok: false, error: "You do not have access to these AI jobs.", status: 403 };
}

async function resolveOptionalProvider(input: { modelProviderId: string | null; organizationId: string; projectId: string }):
  Promise<
    | {
        ok: true;
        modelProviderId: string | null;
      }
    | {
        ok: false;
        error: string;
        status: number;
      }
  > {
  if (!input.modelProviderId) {
    return { ok: true, modelProviderId: null };
  }

  const prisma = getPrismaClient();
  const provider = await prisma.modelProvider.findFirst({
    where: {
      active: true,
      id: input.modelProviderId,
      organizationId: input.organizationId,
      OR: [{ projectId: null }, { projectId: input.projectId }]
    },
    select: {
      id: true
    }
  });

  if (!provider) {
    return { ok: false, error: "Model provider is not available for this scope.", status: 400 };
  }

  return { ok: true, modelProviderId: provider.id };
}

function buildMockPrediction(seed: string, index: number, labels: string[] = []) {
  const offset = (hashString(seed) % 16) / 100;
  const x = Math.min(0.46, 0.2 + offset);
  const y = Math.min(0.34, 0.18 + ((index % 4) * 0.03));
  const primaryLabel = getMockLabel(labels, 0);

  return {
    regions: [
      {
        confidence: roundConfidence(0.86 - ((index % 4) * 0.04)),
        geometry: {
          height: 0.5,
          width: 0.44,
          x,
          y
        },
        label: primaryLabel,
        metadata: {
          mock: true,
          mockLabelSource: labels.length > 0 ? "dataset_label" : "fallback",
          source: "mock_prediction"
        },
        type: "BBOX" as const
      }
    ],
    results: [],
    score: 0.86,
    summary: "Test prelabel generated for workflow testing."
  };
}

function getMockLabel(labels: string[], index: number) {
  const label = labels[index]?.trim();
  return label ? label : "Test prelabel";
}

function normalizeMockLimit(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) && numberValue > 0 ? Math.min(100, numberValue) : 25;
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function roundConfidence(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function normalizePredictionEnvelope(value: unknown):
  | {
      ok: true;
      modelVersion: string | null;
      regions: PredictionRegion[];
      results: PredictionResult[];
      score: number | null;
      source: string;
      summary: string | null;
    }
  | { ok: false; error: string } {
  const envelope = Array.isArray(value) ? value[0] : value;

  if (!isPlainJsonObject(envelope)) {
    return { ok: false, error: "Prediction payload must be an object." };
  }

  const source = Array.isArray(value) ? "label_studio" : envelope.result ? "label_studio" : "manual_import";
  const regions = Array.isArray(envelope.result) ? labelStudioResultsToRegions(envelope.result, envelope.score) : envelope.regions;
  const results = Array.isArray(envelope.results) ? envelope.results : [];
  const parsed = parseAnnotationBody({
    regions,
    results
  });

  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const rawRegions = Array.isArray(regions) ? regions : [];
  const predictionRegions = parsed.value.resultJson.regions.map((region, index) => ({
    confidence: normalizeConfidence(getRecordValue(rawRegions[index], "confidence") ?? getRecordValue(rawRegions[index], "score") ?? envelope.score),
    geometry: region.geometry,
    label: region.label,
    metadata: normalizeJsonObject(getRecordValue(rawRegions[index], "metadata")),
    type: region.type
  }));

  return {
    ok: true,
    modelVersion: normalizeShortText(envelope.modelVersion ?? envelope.model_version, 160),
    regions: predictionRegions,
    results: parsed.value.results.map((result) => ({
      fromName: result.from_name,
      toName: result.to_name,
      type: result.type,
      value: result.value
    })),
    score: normalizeConfidence(envelope.score),
    source,
    summary: normalizeShortText(envelope.summary, 1000)
  };
}

type PredictionResult = {
  fromName: string;
  toName: string;
  type: string;
  value: Prisma.InputJsonObject;
};

type PredictionRegion = {
  confidence: number | null;
  geometry: Prisma.InputJsonObject;
  label: string | null;
  metadata: Prisma.InputJsonObject | null;
  type: "BBOX" | "POLYGON";
};

type DatasetPredictionImportError = {
  assetName?: string;
  error: string;
  row: number;
  taskId?: string;
};

type DatasetPredictionRow = {
  assetName?: string;
  prediction: unknown;
  row: number;
  taskId?: string;
};

export function parseDatasetPredictionRows(value: unknown):
  | {
      ok: true;
      rows: DatasetPredictionRow[];
    }
  | { ok: false; error: string } {
  const parsed = typeof value === "string" ? parseJsonLinesOrArray(value) : value;

  if (typeof parsed === "string") {
    return { ok: false, error: parsed };
  }

  const rawRows = Array.isArray(parsed)
    ? parsed
    : isPlainJsonObject(parsed) && Array.isArray(parsed.rows)
      ? parsed.rows
      : isPlainJsonObject(parsed) && Array.isArray(parsed.predictions)
        ? parsed.predictions
        : isPlainJsonObject(parsed)
          ? [parsed]
          : null;

  if (!rawRows) {
    return { ok: false, error: "Prediction import must be a JSON array, JSONL, or an object with rows." };
  }

  if (rawRows.length > 500) {
    return { ok: false, error: "Import up to 500 prediction rows at a time." };
  }

  const rows: DatasetPredictionRow[] = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    const rawRow = rawRows[index];

    if (!isPlainJsonObject(rawRow)) {
      return { ok: false, error: `Prediction row ${index + 1} must be an object.` };
    }

    const taskId = normalizeId(rawRow.taskId ?? rawRow.task_id);
    const assetName = normalizeShortText(rawRow.assetName ?? rawRow.asset_name ?? rawRow.fileName ?? rawRow.file_name, 512) ?? undefined;
    const prediction = rawRow.predictions ?? rawRow.prediction ?? rawRow;

    rows.push({
      assetName,
      prediction,
      row: index + 1,
      taskId
    });
  }

  return {
    ok: true,
    rows
  };
}

function parseJsonLinesOrArray(value: string) {
  const text = value.trim();

  if (!text) {
    return "Prediction import cannot be empty.";
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const rows = [];
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    for (let index = 0; index < lines.length; index += 1) {
      try {
        rows.push(JSON.parse(lines[index]) as unknown);
      } catch {
        return `Prediction JSONL line ${index + 1} is not valid JSON.`;
      }
    }

    return rows;
  }
}

export function labelStudioResultsToRegions(results: unknown[], score: unknown) {
  const regions: PredictionRegion[] = [];

  for (const rawResult of results) {
    if (!isPlainJsonObject(rawResult) || !isPlainJsonObject(rawResult.value)) {
      continue;
    }

    const type = normalizeShortText(rawResult.type, 80);
    const label = getLabelStudioRegionLabel(rawResult.value, type);
    const confidence = normalizeConfidence(rawResult.score ?? score);

    if (type === "rectanglelabels") {
      const x = normalizePercentNumber(rawResult.value.x);
      const y = normalizePercentNumber(rawResult.value.y);
      const width = normalizePercentNumber(rawResult.value.width);
      const height = normalizePercentNumber(rawResult.value.height);

      if (x === null || y === null || width === null || height === null) {
        continue;
      }

      regions.push({
        confidence,
        geometry: {
          height,
          width,
          x,
          y
        },
        label,
        metadata: null,
        type: "BBOX"
      });
      continue;
    }

    if (type === "polygonlabels" && Array.isArray(rawResult.value.points)) {
      const points = rawResult.value.points
        .map((point) => {
          if (!Array.isArray(point) || point.length < 2) {
            return null;
          }

          const x = normalizePercentNumber(point[0]);
          const y = normalizePercentNumber(point[1]);

          return x === null || y === null ? null : { x, y };
        })
        .filter((point): point is { x: number; y: number } => Boolean(point));

      if (points.length < 3) {
        continue;
      }

      regions.push({
        confidence,
        geometry: {
          points
        },
        label,
        metadata: null,
        type: "POLYGON"
      });
    }
  }

  return regions;
}

function getLabelStudioRegionLabel(value: Record<string, unknown>, type: string | null) {
  if (type === "rectanglelabels" && Array.isArray(value.rectanglelabels)) {
    return normalizeShortText(value.rectanglelabels[0], 120);
  }

  if (type === "polygonlabels" && Array.isArray(value.polygonlabels)) {
    return normalizeShortText(value.polygonlabels[0], 120);
  }

  return null;
}

function normalizePercentNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeJsonObject(value: unknown): Prisma.InputJsonObject | null {
  return isPlainJsonObject(value) ? (value as Prisma.InputJsonObject) : null;
}

function getRecordValue(value: unknown, key: string) {
  return isPlainJsonObject(value) ? value[key] : undefined;
}

function normalizeMatchKey(value: string) {
  return value.trim().toLowerCase();
}

function getBaseName(value: string) {
  return value.split(/[\\/]/).at(-1) ?? value;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: string | undefined) {
  return value && Object.values(enumValues).includes(value) ? (value as T[keyof T]) : undefined;
}

export { router as aiRouter };
