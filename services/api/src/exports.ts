import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  AnnotationStatus,
  ExportStatus,
  getPrismaClient,
  Prisma,
  ProjectStatus,
  StorageProvider,
  TaskStatus
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId, saveAuditLog } from "./logging.js";
import { canGenerateTasks } from "./permissions.js";
import { createR2Client, getR2Config } from "./r2.js";

const router = Router();

router.use(requireAuthenticatedUser);

const exportFormats = {
  COCO: {
    extension: "json",
    mimeType: "application/json"
  },
  ASR_JSONL: {
    extension: "jsonl",
    mimeType: "application/x-ndjson"
  },
  CONLL_2003: {
    extension: "conll",
    mimeType: "text/plain"
  },
  CSV: {
    extension: "csv",
    mimeType: "text/csv"
  },
  JSON: {
    extension: "json",
    mimeType: "application/json"
  },
  JSON_MIN: {
    extension: "json",
    mimeType: "application/json"
  },
  PASCAL_VOC: {
    extension: "zip",
    mimeType: "application/zip"
  },
  TSV: {
    extension: "tsv",
    mimeType: "text/tab-separated-values"
  },
  YOLO: {
    extension: "zip",
    mimeType: "application/zip"
  }
} as const;

type ExportFormat = keyof typeof exportFormats;

const sourceFileExportFormats = new Set<ExportFormat>(["COCO", "PASCAL_VOC", "YOLO"]);

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);
  const datasetId = normalizeId(request.query.datasetId);

  if (!projectId && !datasetId) {
    response.status(400).json({ error: "Project or dataset is required." });
    return;
  }

  const prisma = getPrismaClient();
  const access = await getExportScopeAccess(user.id, { datasetId, projectId });

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  const exportJobs = await prisma.exportJob.findMany({
    where: {
      projectId: access.project.id,
      ...(access.dataset ? { datasetId: access.dataset.id } : {})
    },
    include: exportJobIncludes,
    orderBy: {
      createdAt: "desc"
    },
    take: 25
  });

  response.status(200).json({
    exports: exportJobs.map(serializeExportJob)
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateExportBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  const prisma = getPrismaClient();
  const access = await getExportScopeAccess(user.id, {
    datasetId: parsed.value.datasetId,
    projectId: parsed.value.projectId
  });

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  if (!access.canExport) {
    response.status(403).json({ error: "You need owner, admin, or manager access to export approved annotations." });
    return;
  }

  const exportJob = await prisma.exportJob.create({
    data: {
      projectId: access.project.id,
      datasetId: access.dataset?.id,
      requestedById: user.id,
      format: parsed.value.format,
      status: ExportStatus.QUEUED,
      metadata: {
        include: "approved_annotations",
        includeSourceFiles: parsed.value.includeSourceFiles,
        format: parsed.value.format,
        requestId: getRequestId(request)
      }
    },
    include: exportJobIncludes
  });

  try {
    const startedAt = new Date();
    await prisma.exportJob.update({
      where: {
        id: exportJob.id
      },
      data: {
        startedAt,
        status: ExportStatus.RUNNING
      }
    });

    const client = createR2Client(config.value);
    const tasks = await loadApprovedExportTasks(access.project.id, access.dataset?.id);
    await hydrateMissingImageDimensions(tasks, client, config.value.bucket);
    const exportPayload = buildApprovedAnnotationsExportPayload({
      dataset: access.dataset,
      exportedAt: new Date(),
      exportJobId: exportJob.id,
      project: access.project,
      tasks
    });
    const sourceBundle = parsed.value.includeSourceFiles && sourceFileExportFormats.has(parsed.value.format)
      ? await buildImageSourceFileBundle(exportPayload, client, config.value.bucket)
      : undefined;
    const exportFile = buildApprovedAnnotationsExportFile({
      datasetName: access.dataset?.name,
      format: parsed.value.format,
      includeSourceFiles: parsed.value.includeSourceFiles,
      imageFileNameByTaskId: sourceBundle?.imageFileNameByTaskId,
      payload: exportPayload,
      projectSlug: access.project.slug,
      sourceFiles: sourceBundle?.files
    });
    const exportBuffer = Buffer.isBuffer(exportFile.content) ? exportFile.content : Buffer.from(exportFile.content, "utf8");
    const objectKey = buildExportObjectKey({
      datasetId: access.dataset?.id,
      exportJobId: exportJob.id,
      format: parsed.value.format,
      includeSourceFiles: parsed.value.includeSourceFiles,
      projectId: access.project.id
    });

    await client.send(
      new PutObjectCommand({
        Body: exportBuffer,
        Bucket: config.value.bucket,
        ContentLength: exportBuffer.byteLength,
        ContentType: exportFile.mimeType,
        Key: objectKey
      })
    );

    const completed = await prisma.$transaction(async (tx) => {
      const outputAsset = await tx.storageAsset.create({
        data: {
          organizationId: access.project.organizationId,
          projectId: access.project.id,
          datasetId: access.dataset?.id,
          uploadedById: user.id,
          provider: StorageProvider.R2,
          bucket: config.value.bucket,
          objectKey,
          fileName: exportFile.fileName,
          mimeType: exportFile.mimeType,
          fileSize: BigInt(exportBuffer.byteLength),
          metadata: {
            exportJobId: exportJob.id,
            format: parsed.value.format,
            includeSourceFiles: parsed.value.includeSourceFiles,
            include: "approved_annotations",
            schemaVersion: exportPayload.schemaVersion,
            taskCount: exportPayload.taskCount,
            annotationCount: exportPayload.annotationCount
          }
        }
      });

      return tx.exportJob.update({
        where: {
          id: exportJob.id
        },
        data: {
          completedAt: new Date(),
          metadata: {
            include: "approved_annotations",
            format: parsed.value.format,
            includeSourceFiles: parsed.value.includeSourceFiles,
            requestId: getRequestId(request),
            taskCount: exportPayload.taskCount,
            annotationCount: exportPayload.annotationCount,
            outputBytes: exportBuffer.byteLength
          },
          outputAssetId: outputAsset.id,
          status: ExportStatus.COMPLETED
        },
        include: exportJobIncludes
      });
    });

    void saveAuditLog({
      action: "export.completed",
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      userId: user.id,
      entityType: "export_job",
      entityId: exportJob.id,
      metadata: {
        requestId: getRequestId(request),
        datasetId: access.dataset?.id,
        format: parsed.value.format,
        includeSourceFiles: parsed.value.includeSourceFiles,
        outputAssetId: completed.outputAssetId,
        taskCount: exportPayload.taskCount,
        annotationCount: exportPayload.annotationCount
      }
    });

    response.status(201).json({
      export: serializeExportJob(completed)
    });
  } catch (error) {
    const failed = await prisma.exportJob.update({
      where: {
        id: exportJob.id
      },
      data: {
        completedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unable to create export.",
        status: ExportStatus.FAILED
      },
      include: exportJobIncludes
    });

    void saveAuditLog({
      action: "export.failed",
      organizationId: access.project.organizationId,
      projectId: access.project.id,
      userId: user.id,
      entityType: "export_job",
      entityId: exportJob.id,
      metadata: {
        requestId: getRequestId(request),
        datasetId: access.dataset?.id,
        error: failed.errorMessage
      }
    });

    response.status(500).json({
      error: failed.errorMessage ?? "Unable to create export.",
      export: serializeExportJob(failed)
    });
  }
});

router.get("/:exportId/download-url", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const exportId = normalizeId(request.params.exportId);

  if (!exportId) {
    response.status(400).json({ error: "Export is required." });
    return;
  }

  const config = getR2Config();

  if (!config.ok) {
    response.status(503).json({ error: config.error });
    return;
  }

  const prisma = getPrismaClient();
  const exportJob = await prisma.exportJob.findUnique({
    where: {
      id: exportId
    },
    include: exportJobIncludes
  });

  if (!exportJob) {
    response.status(404).json({ error: "Export was not found." });
    return;
  }

  const access = await getExportScopeAccess(user.id, {
    datasetId: exportJob.datasetId ?? undefined,
    projectId: exportJob.projectId
  });

  if (!access.ok) {
    response.status(access.status).json({ error: access.error });
    return;
  }

  if (!exportJob.outputAsset) {
    response.status(409).json({ error: "Export output is not ready yet." });
    return;
  }

  if (exportJob.outputAsset.provider !== StorageProvider.R2) {
    response.status(400).json({ error: "Only R2 export assets support signed download URLs right now." });
    return;
  }

  const expiresInSeconds = 60 * 10;
  const client = createR2Client(config.value);
  const downloadUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: exportJob.outputAsset.bucket,
      Key: exportJob.outputAsset.objectKey,
      ResponseContentDisposition: `attachment; filename="${exportJob.outputAsset.fileName.replaceAll("\"", "")}"`,
      ResponseContentType: exportJob.outputAsset.mimeType
    }),
    { expiresIn: expiresInSeconds }
  );

  void saveAuditLog({
    action: "export.download_url.created",
    organizationId: access.project.organizationId,
    projectId: access.project.id,
    userId: user.id,
    entityType: "export_job",
    entityId: exportJob.id,
    metadata: {
      requestId: getRequestId(request),
      outputAssetId: exportJob.outputAsset.id,
      expiresInSeconds
    }
  });

  response.status(200).json({
    downloadUrl,
    expiresInSeconds,
    export: serializeExportJob(exportJob)
  });
});

export { router as exportsRouter };

const exportJobIncludes = {
  dataset: {
    select: {
      id: true,
      name: true,
      version: true
    }
  },
  outputAsset: {
    select: {
      id: true,
      bucket: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      objectKey: true,
      provider: true
    }
  },
  project: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  requestedBy: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  }
} as const;

const exportAnnotationStatuses: AnnotationStatus[] = [AnnotationStatus.ACCEPTED, AnnotationStatus.SUBMITTED];

const exportTaskIncludes = Prisma.validator<Prisma.TaskInclude>()({
  annotations: {
    where: {
      status: {
        in: exportAnnotationStatuses
      }
    },
    orderBy: {
      version: "desc"
    },
    select: {
      id: true,
      resultJson: true,
      leadTimeSeconds: true,
      status: true,
      submittedAt: true,
      user: {
        select: {
          email: true,
          firstName: true,
          id: true,
          lastName: true
        }
      },
      regions: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          confidence: true,
          geometryJson: true,
          id: true,
          label: true,
          metadata: true,
          type: true
        }
      },
      version: true
    }
  },
  asset: {
    select: {
      fileName: true,
      fileSize: true,
      bucket: true,
      height: true,
      id: true,
      metadata: true,
      mimeType: true,
      objectKey: true,
      width: true
    }
  },
  reviews: {
    orderBy: {
      createdAt: "desc"
    },
    select: {
      feedback: true,
      id: true,
      reviewer: {
        select: {
          email: true,
          firstName: true,
          id: true,
          lastName: true
        }
      },
      score: true,
      status: true,
      updatedAt: true
    }
  }
});

type ExportJobWithRelations = Prisma.ExportJobGetPayload<{
  include: typeof exportJobIncludes;
}>;

type ApprovedExportTask = {
  annotations: {
    id: string;
    leadTimeSeconds: number | null;
    regions: {
      confidence: number | null;
      geometryJson: unknown;
      id: string;
      label: string | null;
      metadata: unknown;
      type: string;
    }[];
    resultJson: unknown;
    status: string;
    submittedAt: Date | null;
    user: {
      email: string;
      firstName: string | null;
      id: string;
      lastName: string | null;
    };
    version: number;
  }[];
  asset: {
    bucket: string;
    fileName: string;
    fileSize: bigint;
    height: number | null;
    id: string;
    metadata: unknown;
    mimeType: string;
    objectKey: string;
    width: number | null;
  } | null;
  id: string;
  metadata: unknown;
  reviews: {
    feedback: string | null;
    id: string;
    reviewer: {
      email: string;
      firstName: string | null;
      id: string;
      lastName: string | null;
    };
    score: number | null;
    status: string;
    updatedAt: Date;
  }[];
  status: string;
};

type ExportScopeProject = {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdById: string;
};

type ExportScopeDataset = {
  id: string;
  name: string;
  version: number;
  labelingConfig: unknown;
  labels: {
    color: string;
    id: string;
    name: string;
    shortcutKey: string | null;
  }[];
  tools: {
    configJson: unknown;
    enabled: boolean;
    id: string;
    tool: string;
  }[];
} | null;

type CreateExportBody =
  | {
      datasetId?: unknown;
      format?: unknown;
      includeSourceFiles?: unknown;
      projectId?: unknown;
    }
  | undefined;

function parseCreateExportBody(body: CreateExportBody):
  | {
      ok: true;
      value: {
        datasetId?: string;
        format: ExportFormat;
        includeSourceFiles: boolean;
        projectId?: string;
      };
    }
  | { ok: false; error: string } {
  const projectId = normalizeId(body?.projectId);
  const datasetId = normalizeId(body?.datasetId);
  const format = parseExportFormat(body?.format);

  if (!projectId && !datasetId) {
    return { ok: false, error: "Project or dataset is required." };
  }

  if (!format) {
    return { ok: false, error: "Choose JSON, JSON_MIN, CSV, TSV, COCO, YOLO, PASCAL_VOC, CONLL_2003, or ASR_JSONL." };
  }

  return {
    ok: true,
    value: {
      datasetId,
      format,
      includeSourceFiles: body?.includeSourceFiles === true,
      projectId
    }
  };
}

function parseExportFormat(value: unknown): ExportFormat | null {
  const normalized = typeof value === "string" && value.trim().length > 0
    ? value.trim().toUpperCase().replaceAll("-", "_")
    : "JSON";

  return normalized in exportFormats ? (normalized as ExportFormat) : null;
}

async function getExportScopeAccess(
  userId: string,
  input: { datasetId?: string; projectId?: string }
): Promise<
  | {
      ok: true;
      canExport: boolean;
      dataset: ExportScopeDataset;
      project: ExportScopeProject;
    }
  | { ok: false; error: string; status: number }
> {
  const prisma = getPrismaClient();

  if (input.datasetId) {
    const dataset = await prisma.dataset.findFirst({
      where: {
        id: input.datasetId,
        ...(input.projectId ? { projectId: input.projectId } : {})
      },
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
            color: true,
            id: true,
            name: true,
            shortcutKey: true
          }
        },
        tools: {
          orderBy: {
            createdAt: "asc"
          },
          select: {
            configJson: true,
            enabled: true,
            id: true,
            tool: true
          }
        },
        project: {
          select: {
            createdById: true,
            id: true,
            name: true,
            organizationId: true,
            slug: true,
            status: true
          }
        }
      }
    });

    if (!dataset) {
      return { ok: false, error: "Dataset was not found.", status: 404 };
    }

    const access = await getProjectExportAccess(userId, dataset.project);

    if (!access.hasAccess) {
      return { ok: false, error: "You do not have access to this dataset.", status: 403 };
    }

    return {
      ok: true,
      canExport: access.canExport,
      dataset: {
        id: dataset.id,
        labelingConfig: dataset.labelingConfig,
        labels: dataset.labels,
        name: dataset.name,
        tools: dataset.tools.map((tool) => ({
          ...tool,
          tool: tool.tool
        })),
        version: dataset.version
      },
      project: dataset.project
    };
  }

  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      status: ProjectStatus.ACTIVE
    },
    select: {
      createdById: true,
      id: true,
      name: true,
      organizationId: true,
      slug: true
    }
  });

  if (!project) {
    return { ok: false, error: "Project was not found.", status: 404 };
  }

  const access = await getProjectExportAccess(userId, project);

  if (!access.hasAccess) {
    return { ok: false, error: "You do not have access to this project.", status: 403 };
  }

  return {
    ok: true,
    canExport: access.canExport,
    dataset: null,
    project
  };
}

async function getProjectExportAccess(userId: string, project: ExportScopeProject) {
  const prisma = getPrismaClient();
  const [membership, projectMembership] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        organizationId: project.organizationId,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    }),
    prisma.projectMembership.findFirst({
      where: {
        projectId: project.id,
        status: "ACTIVE",
        userId
      },
      select: {
        role: true
      }
    })
  ]);

  const canExport = Boolean(
    project.createdById === userId ||
      (membership && canGenerateTasks(membership)) ||
      (projectMembership && canGenerateTasks(projectMembership))
  );

  return {
    canExport,
    hasAccess: Boolean(project.createdById === userId || membership || projectMembership)
  };
}

async function loadApprovedExportTasks(projectId: string, datasetId?: string) {
  const prisma = getPrismaClient();

  return prisma.task.findMany({
    where: {
      projectId,
      ...(datasetId ? { datasetId } : {}),
      status: TaskStatus.APPROVED
    },
    include: exportTaskIncludes,
    orderBy: [
      {
        createdAt: "asc"
      },
      {
        id: "asc"
      }
    ]
  });
}

async function hydrateMissingImageDimensions(tasks: ApprovedExportTask[], client: ReturnType<typeof createR2Client>, fallbackBucket: string) {
  const missingImageTasks = tasks.filter((task) => task.asset?.mimeType.startsWith("image/") && (!task.asset.width || !task.asset.height));

  if (missingImageTasks.length === 0) {
    return;
  }

  const prisma = getPrismaClient();

  for (const task of missingImageTasks) {
    if (!task.asset) {
      continue;
    }

    const object = await client.send(
      new GetObjectCommand({
        Bucket: fallbackBucket,
        Key: task.asset.objectKey
      })
    );
    const buffer = await streamToBuffer(object.Body);
    const dimensions = parseImageDimensions(buffer, task.asset.mimeType);

    if (!dimensions) {
      continue;
    }

    task.asset.width = dimensions.width;
    task.asset.height = dimensions.height;

    await prisma.storageAsset.update({
      where: {
        id: task.asset.id
      },
      data: dimensions
    });
  }
}

export function buildApprovedAnnotationsExportPayload(input: {
  dataset: ExportScopeDataset;
  exportedAt: Date;
  exportJobId: string;
  project: ExportScopeProject;
  tasks: ApprovedExportTask[];
}) {
  const tasks = input.tasks.map((task) => ({
    annotations: task.annotations.map((annotation) => ({
      id: annotation.id,
      leadTimeSeconds: annotation.leadTimeSeconds,
      regions: annotation.regions,
      result: annotation.resultJson,
      status: annotation.status,
      submittedAt: annotation.submittedAt,
      user: serializeUserName(annotation.user),
      version: annotation.version
    })),
    asset: task.asset
      ? {
          ...task.asset,
          fileSize: task.asset.fileSize.toString()
        }
      : null,
    data: buildTaskData(task),
    id: task.id,
    metadata: task.metadata,
    reviews: task.reviews.map((review) => ({
      feedback: review.feedback,
      id: review.id,
      reviewer: serializeUserName(review.reviewer),
      score: review.score,
      status: review.status,
      updatedAt: review.updatedAt
    })),
    status: task.status
  }));

  return {
    annotationCount: tasks.reduce((total, task) => total + task.annotations.length, 0),
    dataset: input.dataset
      ? {
          id: input.dataset.id,
          labelingConfig: input.dataset.labelingConfig,
          labels: input.dataset.labels,
          name: input.dataset.name,
          tools: input.dataset.tools,
          version: input.dataset.version
        }
      : null,
    exportJobId: input.exportJobId,
    exportedAt: input.exportedAt.toISOString(),
    format: "JSON",
    include: "approved_annotations",
    project: {
      id: input.project.id,
      name: input.project.name,
      slug: input.project.slug
    },
    schemaVersion: 1,
    taskCount: tasks.length,
    tasks
  };
}

type ApprovedAnnotationsExportPayload = ReturnType<typeof buildApprovedAnnotationsExportPayload>;

export function buildApprovedAnnotationsExportFile(input: {
  datasetName?: string;
  format: ExportFormat;
  imageFileNameByTaskId?: Map<string, string>;
  includeSourceFiles?: boolean;
  payload: ApprovedAnnotationsExportPayload;
  projectSlug: string;
  sourceFiles?: Record<string, Buffer>;
}) {
  const definition = getExportFileDefinition(input.format, input.includeSourceFiles);
  const content = serializeExportPayload(input.payload, input.format, {
    imageFileNameByTaskId: input.imageFileNameByTaskId,
    includeSourceFiles: input.includeSourceFiles,
    sourceFiles: input.sourceFiles
  });

  return {
    content,
    fileName: buildExportFileName(input.projectSlug, input.datasetName, input.format, input.includeSourceFiles),
    mimeType: definition.mimeType
  };
}

export function buildExportObjectKey(input: { datasetId?: string; exportJobId: string; format?: ExportFormat; includeSourceFiles?: boolean; projectId: string }) {
  const scope = input.datasetId ? `datasets/${input.datasetId}` : "project";
  const extension = getExportFileDefinition(input.format ?? "JSON", input.includeSourceFiles).extension;
  return `exports/${input.projectId}/${scope}/${input.exportJobId}.${extension}`;
}

export function buildExportFileName(projectSlug: string, datasetName?: string, format: ExportFormat = "JSON", includeSourceFiles = false) {
  const scope = datasetName ? toSafeFileName(datasetName) : "project";
  const stamp = new Date().toISOString().slice(0, 10);
  const formatSlug = toSafeFileName(format.toLowerCase());
  const suffix = includeSourceFiles && sourceFileExportFormats.has(format) ? `${formatSlug}-with-sources` : formatSlug;
  return `${toSafeFileName(projectSlug)}-${scope}-approved-annotations-${suffix}-${stamp}.${getExportFileDefinition(format, includeSourceFiles).extension}`;
}

function getExportFileDefinition(format: ExportFormat, includeSourceFiles = false) {
  if (includeSourceFiles && sourceFileExportFormats.has(format)) {
    return {
      extension: "zip",
      mimeType: "application/zip"
    };
  }

  return exportFormats[format];
}

function serializeExportPayload(
  payload: ApprovedAnnotationsExportPayload,
  format: ExportFormat,
  options: {
    imageFileNameByTaskId?: Map<string, string>;
    includeSourceFiles?: boolean;
    sourceFiles?: Record<string, Buffer>;
  } = {}
) {
  if (format === "JSON") {
    return JSON.stringify(payload, null, 2);
  }

  if (format === "JSON_MIN") {
    return JSON.stringify(buildJsonMinExport(payload), null, 2);
  }

  if (format === "COCO") {
    const coco = JSON.stringify(buildCocoExport(payload, options.imageFileNameByTaskId), null, 2);

    if (options.includeSourceFiles) {
      return createStoredZip({
        "annotations/instances_default.json": coco,
        "manifest.json": JSON.stringify(buildImageExportManifest(payload, getImageExportTasks(payload), "COCO", options.imageFileNameByTaskId), null, 2),
        ...(options.sourceFiles ?? {})
      });
    }

    return coco;
  }

  if (format === "YOLO") {
    return buildYoloExport(payload, options.sourceFiles, options.imageFileNameByTaskId);
  }

  if (format === "PASCAL_VOC") {
    return buildPascalVocExport(payload, options.sourceFiles, options.imageFileNameByTaskId);
  }

  if (format === "CONLL_2003") {
    return buildConll2003Export(payload);
  }

  if (format === "ASR_JSONL") {
    return buildAsrJsonlExport(payload);
  }

  if (format === "CSV") {
    return buildTabularExport(payload, ",");
  }

  return buildTabularExport(payload, "\t");
}

type ExportRegion = ApprovedAnnotationsExportPayload["tasks"][number]["annotations"][number]["regions"][number];
type ExportTask = ApprovedAnnotationsExportPayload["tasks"][number];

type ImageExportTask = ExportTask & {
  asset: NonNullable<ExportTask["asset"]> & {
    height: number;
    width: number;
  };
};

type NormalizedBox = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type NormalizedPoint = {
  x: number;
  y: number;
};

function buildCocoExport(payload: ApprovedAnnotationsExportPayload, imageFileNameByTaskId = buildImageFileNameMap(getImageExportTasks(payload))) {
  const tasks = getImageExportTasks(payload);
  const categories = buildExportCategories(payload, tasks);
  const categoryIdByLabel = new Map(categories.map((category) => [category.name, category.id]));
  let annotationId = 1;

  return {
    annotations: tasks.flatMap((task, imageIndex) =>
      getTaskExportRegions(task).map((region) => {
        const label = getRegionLabel(region);
        const categoryId = categoryIdByLabel.get(label) ?? 1;
        const box = getRegionBox(region);
        const pixelBox = toPixelBox(box, task.asset.width, task.asset.height);
        const segmentation = getRegionPolygon(region)?.map((point) => [
          roundNumber(point.x * task.asset.width),
          roundNumber(point.y * task.asset.height)
        ]).flat() ?? [];

        return {
          area: roundNumber(pixelBox.width * pixelBox.height),
          bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
          category_id: categoryId,
          id: annotationId++,
          image_id: imageIndex + 1,
          iscrowd: 0,
          segmentation: segmentation.length >= 6 ? [segmentation] : []
        };
      })
    ),
    categories,
    images: tasks.map((task, index) => ({
      file_name: imageFileNameByTaskId.get(task.id) ?? task.asset.fileName,
      height: task.asset.height,
      id: index + 1,
      width: task.asset.width
    })),
    info: {
      dataset: payload.dataset?.name ?? payload.project.name,
      description: "GoXAI Lab COCO export",
      exported_at: payload.exportedAt,
      version: String(payload.schemaVersion)
    },
    licenses: []
  };
}

function buildYoloExport(payload: ApprovedAnnotationsExportPayload, sourceFiles: Record<string, Buffer> = {}, imageFileNameByTaskId = buildImageFileNameMap(getImageExportTasks(payload))) {
  const tasks = getImageExportTasks(payload);
  const categories = buildExportCategories(payload, tasks);
  const classIndexByLabel = new Map(categories.map((category, index) => [category.name, index]));
  const files: Record<string, string | Buffer> = {
    "classes.txt": `${categories.map((category) => category.name).join("\n")}\n`,
    "data.yaml": [
      "path: .",
      "train: images",
      "val: images",
      "names:",
      ...categories.map((category, index) => `  ${index}: ${quoteYamlString(category.name)}`),
      ""
    ].join("\n"),
    "manifest.json": JSON.stringify(buildImageExportManifest(payload, tasks, "YOLO", imageFileNameByTaskId), null, 2),
    ...sourceFiles
  };

  for (const task of tasks) {
    const exportFileName = imageFileNameByTaskId.get(task.id) ?? task.asset.fileName;
    const labelFile = `labels/${toFileStem(exportFileName)}.txt`;
    const lines = getTaskExportRegions(task).map((region) => {
      const classIndex = classIndexByLabel.get(getRegionLabel(region)) ?? 0;
      const polygon = getRegionPolygon(region);

      if (polygon) {
        return [classIndex, ...polygon.flatMap((point) => [roundNumber(point.x, 6), roundNumber(point.y, 6)])].join(" ");
      }

      const box = getRegionBox(region);
      return [
        classIndex,
        roundNumber(box.x + box.width / 2, 6),
        roundNumber(box.y + box.height / 2, 6),
        roundNumber(box.width, 6),
        roundNumber(box.height, 6)
      ].join(" ");
    });

    files[labelFile] = `${lines.join("\n")}${lines.length ? "\n" : ""}`;
  }

  return createStoredZip(files);
}

function buildPascalVocExport(payload: ApprovedAnnotationsExportPayload, sourceFiles: Record<string, Buffer> = {}, imageFileNameByTaskId = buildImageFileNameMap(getImageExportTasks(payload))) {
  const tasks = getImageExportTasks(payload);
  const files: Record<string, string | Buffer> = {
    "manifest.json": JSON.stringify(buildImageExportManifest(payload, tasks, "Pascal VOC", imageFileNameByTaskId), null, 2),
    ...sourceFiles
  };

  for (const task of tasks) {
    const exportFileName = imageFileNameByTaskId.get(task.id) ?? task.asset.fileName;
    files[`annotations/${toFileStem(exportFileName)}.xml`] = buildPascalVocXml(task, exportFileName);
  }

  return createStoredZip(files);
}

function buildPascalVocXml(task: ImageExportTask, exportFileName = task.asset.fileName) {
  const objects = getTaskExportRegions(task).map((region) => {
    const box = toPixelBox(getRegionBox(region), task.asset.width, task.asset.height);
    const xmin = Math.max(0, Math.round(box.x));
    const ymin = Math.max(0, Math.round(box.y));
    const xmax = Math.min(task.asset.width, Math.round(box.x + box.width));
    const ymax = Math.min(task.asset.height, Math.round(box.y + box.height));

    return [
      "  <object>",
      `    <name>${escapeXml(getRegionLabel(region))}</name>`,
      "    <pose>Unspecified</pose>",
      "    <truncated>0</truncated>",
      "    <difficult>0</difficult>",
      "    <bndbox>",
      `      <xmin>${xmin}</xmin>`,
      `      <ymin>${ymin}</ymin>`,
      `      <xmax>${xmax}</xmax>`,
      `      <ymax>${ymax}</ymax>`,
      "    </bndbox>",
      "  </object>"
    ].join("\n");
  });

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<annotation>",
    "  <folder>images</folder>",
    `  <filename>${escapeXml(exportFileName)}</filename>`,
    "  <source>",
    `    <database>${escapeXml(task.asset.objectKey)}</database>`,
    "  </source>",
    "  <size>",
    `    <width>${task.asset.width}</width>`,
    `    <height>${task.asset.height}</height>`,
    "    <depth>3</depth>",
    "  </size>",
    "  <segmented>0</segmented>",
    ...objects,
    "</annotation>",
    ""
  ].join("\n");
}

function buildConll2003Export(payload: ApprovedAnnotationsExportPayload) {
  const documents = payload.tasks
    .map((task) => {
      const text = getTaskTextValue(task);

      if (!text) {
        return null;
      }

      const spans = getTaskTextSpans(task);
      const tokens = tokenizeForConll(text);

      if (tokens.length === 0) {
        return null;
      }

      return [
        `# task_id = ${task.id}`,
        task.asset ? `# asset = ${task.asset.fileName}` : null,
        ...tokens.map((token) => `${token.text} ${getConllTag(token, spans)}`),
        ""
      ].filter((line): line is string => line !== null).join("\n");
    })
    .filter((document): document is string => Boolean(document));

  if (documents.length === 0) {
    throw new Error("CoNLL 2003 export needs text task data. Structured text imports should include a text field.");
  }

  return `${documents.join("\n")}\n`;
}

function buildAsrJsonlExport(payload: ApprovedAnnotationsExportPayload) {
  const rows = payload.tasks.map((task) => {
    const annotation = task.annotations[0] ?? null;
    const responses = annotation ? getAnnotationControlValues(annotation) : {};
    const transcript = getPreferredTextResponse(responses);

    return {
      annotation_id: annotation?.id ?? null,
      asset: task.asset
        ? {
            file_name: task.asset.fileName,
            id: task.asset.id,
            mime_type: task.asset.mimeType,
            object_key: task.asset.objectKey
          }
        : null,
      data: task.data,
      responses,
      task_id: task.id,
      transcript
    };
  });

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function getTaskTextValue(task: ExportTask) {
  const candidate =
    getStringFromRecord(task.data, "text") ??
    getStringFromRecord(task.data, "content") ??
    getStringFromRecord(task.data, "document") ??
    getStringFromRecord(task.metadata, "text") ??
    getStringFromRecord(task.metadata, "content") ??
    getStringFromRecord(task.asset?.metadata, "text") ??
    getStringFromRecord(task.asset?.metadata, "content");

  if (!candidate) {
    return null;
  }

  if (task.asset && candidate === task.asset.objectKey) {
    return null;
  }

  return candidate;
}

function getTaskTextSpans(task: ExportTask) {
  const annotation = task.annotations[0];

  if (!annotation) {
    return [];
  }

  return annotation.regions.flatMap((region) => {
    if (region.type !== "TEXT_SPAN" || !isPlainObject(region.geometryJson)) {
      return [];
    }

    const start = readTextOffset(region.geometryJson.start) ?? readTextOffset(region.geometryJson.startOffset) ?? readTextOffset(region.geometryJson.start_offset);
    const end = readTextOffset(region.geometryJson.end) ?? readTextOffset(region.geometryJson.endOffset) ?? readTextOffset(region.geometryJson.end_offset);

    if (start === null || end === null || end <= start) {
      return [];
    }

    return [
      {
        end,
        label: getRegionLabel(region),
        start
      }
    ];
  });
}

function tokenizeForConll(text: string) {
  return Array.from(text.matchAll(/\S+/g)).map((match) => ({
    end: (match.index ?? 0) + match[0].length,
    start: match.index ?? 0,
    text: match[0]
  }));
}

function getConllTag(
  token: { end: number; start: number },
  spans: { end: number; label: string; start: number }[]
) {
  const span = spans.find((candidate) => token.start < candidate.end && token.end > candidate.start);

  if (!span) {
    return "O";
  }

  return `${token.start <= span.start ? "B" : "I"}-${toConllLabel(span.label)}`;
}

function toConllLabel(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "LABEL";
}

function getPreferredTextResponse(responses: Record<string, unknown>) {
  const preferredKeys = ["transcription", "transcript", "answer", "summary", "response", "text"];

  for (const key of preferredKeys) {
    const value = getResponseTextValue(responses[key]);

    if (value) {
      return value;
    }
  }

  for (const value of Object.values(responses)) {
    const text = getResponseTextValue(value);

    if (text) {
      return text;
    }
  }

  return "";
}

function getResponseTextValue(value: unknown) {
  if (!isPlainObject(value)) {
    return "";
  }

  const text = value.text;

  if (Array.isArray(text)) {
    return text.filter((item): item is string => typeof item === "string").join("\n").trim();
  }

  if (typeof text === "string") {
    return text.trim();
  }

  return "";
}

function getStringFromRecord(record: unknown, key: string) {
  return isPlainObject(record) && typeof record[key] === "string" && record[key].trim() ? record[key].trim() : null;
}

function readTextOffset(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function buildImageExportManifest(payload: ApprovedAnnotationsExportPayload, tasks: ImageExportTask[], format: string, imageFileNameByTaskId = buildImageFileNameMap(tasks)) {
  return {
    dataset: payload.dataset
      ? {
          id: payload.dataset.id,
          name: payload.dataset.name,
          version: payload.dataset.version
        }
      : null,
    exportedAt: payload.exportedAt,
    format,
    project: payload.project,
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
      asset: {
        exportFileName: imageFileNameByTaskId.get(task.id) ?? task.asset.fileName,
        fileName: task.asset.fileName,
        height: task.asset.height,
        id: task.asset.id,
        mimeType: task.asset.mimeType,
        objectKey: task.asset.objectKey,
        width: task.asset.width
      },
      regionCount: getTaskExportRegions(task).length,
      taskId: task.id
    }))
  };
}

function getImageExportTasks(payload: ApprovedAnnotationsExportPayload): ImageExportTask[] {
  const tasks = payload.tasks.filter((task) => task.asset?.mimeType.startsWith("image/"));
  const missingDimensions = tasks.filter((task) => !task.asset?.width || !task.asset.height);

  if (missingDimensions.length > 0) {
    throw new Error(
      `Image training exports need image width and height. Missing dimensions for ${missingDimensions
        .slice(0, 3)
        .map((task) => task.asset?.fileName ?? task.id)
        .join(", ")}${missingDimensions.length > 3 ? "..." : ""}.`
    );
  }

  return tasks as ImageExportTask[];
}

async function buildImageSourceFileBundle(
  payload: ApprovedAnnotationsExportPayload,
  client: ReturnType<typeof createR2Client>,
  fallbackBucket: string
) {
  const tasks = getImageExportTasks(payload);
  const imageFileNameByTaskId = buildImageFileNameMap(tasks);
  const files: Record<string, Buffer> = {};

  for (const task of tasks) {
    const fileName = imageFileNameByTaskId.get(task.id) ?? task.asset.fileName;
    const object = await client.send(
      new GetObjectCommand({
        Bucket: task.asset.bucket || fallbackBucket,
        Key: task.asset.objectKey
      })
    );

    files[`images/${fileName}`] = await streamToBuffer(object.Body);
  }

  return {
    files,
    imageFileNameByTaskId
  };
}

function buildImageFileNameMap(tasks: ImageExportTask[]) {
  const usedNames = new Set<string>();
  const fileNameByTaskId = new Map<string, string>();

  for (const task of tasks) {
    const candidate = toSafeExportFileName(task.asset.fileName);
    const extension = getFileExtension(candidate);
    const stem = extension ? candidate.slice(0, -extension.length - 1) : candidate;
    let fileName = candidate;
    let counter = 2;

    while (usedNames.has(fileName.toLowerCase())) {
      fileName = extension ? `${stem}-${counter}.${extension}` : `${stem}-${counter}`;
      counter += 1;
    }

    usedNames.add(fileName.toLowerCase());
    fileNameByTaskId.set(task.id, fileName);
  }

  return fileNameByTaskId;
}

function buildExportCategories(payload: ApprovedAnnotationsExportPayload, tasks: ImageExportTask[]) {
  const labels = [
    ...(payload.dataset?.labels.map((label) => label.name) ?? []),
    ...tasks.flatMap((task) => getTaskExportRegions(task).map(getRegionLabel))
  ];
  const uniqueLabels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const categoryNames = uniqueLabels.length > 0 ? uniqueLabels : ["Object"];

  return categoryNames.map((name, index) => ({
    id: index + 1,
    name,
    supercategory: "object"
  }));
}

function getTaskExportRegions(task: ExportTask) {
  const annotation = task.annotations[0];

  if (!annotation) {
    return [];
  }

  return annotation.regions.filter((region) => region.type === "BBOX" || region.type === "POLYGON");
}

function getRegionLabel(region: ExportRegion) {
  return region.label?.trim() || "Object";
}

function getRegionBox(region: ExportRegion): NormalizedBox {
  const polygon = getRegionPolygon(region);

  if (polygon) {
    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
      height: clampUnit(maxY - minY),
      width: clampUnit(maxX - minX),
      x: clampUnit(minX),
      y: clampUnit(minY)
    };
  }

  if (!isPlainObject(region.geometryJson)) {
    return { height: 0, width: 0, x: 0, y: 0 };
  }

  return {
    height: readUnitNumber(region.geometryJson.height),
    width: readUnitNumber(region.geometryJson.width),
    x: readUnitNumber(region.geometryJson.x),
    y: readUnitNumber(region.geometryJson.y)
  };
}

function getRegionPolygon(region: ExportRegion): NormalizedPoint[] | null {
  if (region.type !== "POLYGON" || !isPlainObject(region.geometryJson) || !Array.isArray(region.geometryJson.points)) {
    return null;
  }

  const points = region.geometryJson.points
    .map((point) => {
      if (!isPlainObject(point)) {
        return null;
      }

      return {
        x: readUnitNumber(point.x),
        y: readUnitNumber(point.y)
      };
    })
    .filter((point): point is NormalizedPoint => Boolean(point));

  return points.length >= 3 ? points : null;
}

function toPixelBox(box: NormalizedBox, width: number, height: number) {
  return {
    height: roundNumber(box.height * height),
    width: roundNumber(box.width * width),
    x: roundNumber(box.x * width),
    y: roundNumber(box.y * height)
  };
}

function readUnitNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? clampUnit(value) : 0;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function roundNumber(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildJsonMinExport(payload: ApprovedAnnotationsExportPayload) {
  return payload.tasks.map((task) => {
    const firstAnnotation = task.annotations[0] ?? null;
    const controlValues = firstAnnotation ? getAnnotationControlValues(firstAnnotation) : {};
    const record: Record<string, unknown> = {
      ...task.data,
      ...controlValues
    };

    if (firstAnnotation?.regions.length) {
      record.regions = firstAnnotation.regions.map((region) => ({
        geometry: region.geometryJson,
        label: region.label,
        type: region.type
      }));
    }

    if (task.annotations.length > 1) {
      record.annotations = task.annotations.map((annotation) => ({
        ...getAnnotationControlValues(annotation),
        regions: annotation.regions.map((region) => ({
          geometry: region.geometryJson,
          label: region.label,
          type: region.type
        }))
      }));
    }

    return record;
  });
}

function buildTabularExport(payload: ApprovedAnnotationsExportPayload, delimiter: "," | "\t") {
  const columns = [
    "project_id",
    "project_name",
    "dataset_id",
    "dataset_name",
    "task_id",
    "asset_id",
    "asset_file_name",
    "asset_object_key",
    "asset_mime_type",
    "annotation_id",
    "annotation_status",
    "annotator_email",
    "labels",
    "regions_json",
    "results_json",
    "reviews_json"
  ];
  const rows = payload.tasks.flatMap((task) => {
    const annotations = task.annotations.length > 0 ? task.annotations : [null];

    return annotations.map((annotation) => ({
      annotation_id: annotation?.id ?? "",
      annotation_status: annotation?.status ?? "",
      annotator_email: annotation?.user.email ?? "",
      asset_file_name: task.asset?.fileName ?? "",
      asset_id: task.asset?.id ?? "",
      asset_mime_type: task.asset?.mimeType ?? "",
      asset_object_key: task.asset?.objectKey ?? "",
      dataset_id: payload.dataset?.id ?? "",
      dataset_name: payload.dataset?.name ?? "",
      labels: annotation ? [...new Set(annotation.regions.map((region) => region.label).filter(Boolean))].join("|") : "",
      project_id: payload.project.id,
      project_name: payload.project.name,
      regions_json: annotation ? JSON.stringify(annotation.regions) : "",
      results_json: annotation ? JSON.stringify(annotation.result) : "",
      reviews_json: JSON.stringify(task.reviews),
      task_id: task.id
    }));
  });

  return [
    columns.map((column) => escapeDelimitedValue(column, delimiter)).join(delimiter),
    ...rows.map((row) => columns.map((column) => escapeDelimitedValue(row[column as keyof typeof row], delimiter)).join(delimiter))
  ].join("\n");
}

function getAnnotationControlValues(annotation: ApprovedAnnotationsExportPayload["tasks"][number]["annotations"][number]) {
  const values: Record<string, unknown> = {};
  const results = isPlainObject(annotation.result) && Array.isArray(annotation.result.results) ? annotation.result.results : [];

  for (const result of results) {
    if (!isPlainObject(result)) {
      continue;
    }

    const fromName = typeof result.from_name === "string" ? result.from_name : typeof result.fromName === "string" ? result.fromName : null;

    if (!fromName || !isPlainObject(result.value)) {
      continue;
    }

    values[fromName] = result.value;
  }

  return values;
}

function buildTaskData(task: ApprovedExportTask) {
  if (task.asset && isPlainObject(task.asset.metadata) && isPlainObject(task.asset.metadata.data)) {
    return task.asset.metadata.data;
  }

  if (!task.asset) {
    return {};
  }

  const sourceKey = getSourceDataKey(task.asset.mimeType);

  return {
    [sourceKey]: task.asset.objectKey
  };
}

function getSourceDataKey(mimeType: string) {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("text/")) {
    return "text";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  return "asset";
}

function escapeDelimitedValue(value: unknown, delimiter: "," | "\t") {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
  const needsQuotes = text.includes("\"") || text.includes("\n") || text.includes("\r") || text.includes(delimiter);

  if (!needsQuotes) {
    return text;
  }

  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function createStoredZip(files: Record<string, string | Buffer>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [rawName, rawContent] of Object.entries(files)) {
    const name = rawName.replaceAll("\\", "/").replace(/^\/+/, "");
    const nameBuffer = Buffer.from(name, "utf8");
    const content = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(rawContent, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.byteLength, 18);
    localHeader.writeUInt32LE(content.byteLength, 22);
    localHeader.writeUInt16LE(nameBuffer.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.byteLength, 20);
    centralHeader.writeUInt32LE(content.byteLength, 24);
    centralHeader.writeUInt16LE(nameBuffer.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.byteLength + nameBuffer.byteLength + content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localDirectory.byteLength, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localDirectory, centralDirectory, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function quoteYamlString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function toFileStem(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return toSafeFileName(withoutExtension);
}

function toSafeExportFileName(fileName: string) {
  const extension = getFileExtension(fileName);
  const stem = extension ? fileName.slice(0, -extension.length - 1) : fileName;
  const safeStem = toSafeFileName(stem);

  return extension ? `${safeStem}.${extension}` : safeStem;
}

function getFileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match?.[1] ?? "";
}

async function streamToBuffer(body: unknown) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (typeof body === "object" && "transformToByteArray" in body && typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  const chunks: Buffer[] = [];

  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

function parseImageDimensions(buffer: Buffer, mimeType: string) {
  return parsePngDimensions(buffer) ?? parseJpegDimensions(buffer) ?? parseGifDimensions(buffer) ?? parseWebpDimensions(buffer, mimeType);
}

function parsePngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[12] !== 0x49 ||
    buffer[13] !== 0x48 ||
    buffer[14] !== 0x44 ||
    buffer[15] !== 0x52
  ) {
    return null;
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16)
  };
}

function parseGifDimensions(buffer: Buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") {
    return null;
  }

  return {
    height: buffer.readUInt16LE(8),
    width: buffer.readUInt16LE(6)
  };
}

function parseJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    if (length < 2) {
      return null;
    }

    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return null;
}

function parseWebpDimensions(buffer: Buffer, mimeType: string) {
  if (mimeType !== "image/webp" || buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      height: buffer.readUIntLE(27, 3) + 1,
      width: buffer.readUIntLE(24, 3) + 1
    };
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      height: buffer.readUInt16LE(28) & 0x3fff,
      width: buffer.readUInt16LE(26) & 0x3fff
    };
  }

  if (chunk === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1
    };
  }

  return null;
}

function serializeExportJob(exportJob: ExportJobWithRelations) {
  return {
    completedAt: exportJob.completedAt,
    createdAt: exportJob.createdAt,
    dataset: exportJob.dataset,
    datasetId: exportJob.datasetId,
    errorMessage: exportJob.errorMessage,
    format: exportJob.format,
    id: exportJob.id,
    metadata: exportJob.metadata,
    outputAsset: exportJob.outputAsset
      ? {
          ...exportJob.outputAsset,
          fileSize: exportJob.outputAsset.fileSize.toString()
        }
      : null,
    outputAssetId: exportJob.outputAssetId,
    project: exportJob.project,
    projectId: exportJob.projectId,
    requestedBy: exportJob.requestedBy ? serializeUserName(exportJob.requestedBy) : null,
    requestedById: exportJob.requestedById,
    startedAt: exportJob.startedAt,
    status: exportJob.status,
    updatedAt: exportJob.updatedAt
  };
}

function serializeUserName(user: {
  email: string;
  firstName: string | null;
  id: string;
  lastName: string | null;
}) {
  return {
    email: user.email,
    id: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
  };
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toSafeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "export";
}
