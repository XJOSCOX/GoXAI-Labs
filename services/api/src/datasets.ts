import {
  AnnotationTool,
  DatasetStatus,
  getPrismaClient,
  MembershipRole,
  Prisma,
  ProjectAccessMode,
  ProjectStatus,
  StorageProvider,
  type Dataset
} from "@goxai/database";
import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId } from "./logging.js";
import { canManageProjectScope } from "./permissions.js";
import { createR2Client, getR2Config } from "./r2.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.query.projectId);
  const prisma = getPrismaClient();
  const [memberships, projectMemberships] = await Promise.all([
    prisma.membership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE"
      },
      select: {
        organizationId: true
      }
    }),
    prisma.projectMembership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE"
      },
      select: {
        projectId: true
      }
    })
  ]);
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const projectIds = [...new Set(projectMemberships.map((membership) => membership.projectId))];

  if (organizationIds.length === 0 && projectIds.length === 0 && !projectId) {
    response.status(200).json({ datasets: [] });
    return;
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

  const datasets = await prisma.dataset.findMany({
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
      ...(projectId ? { projectId } : {})
    },
    include: datasetIncludes,
    orderBy: {
      updatedAt: "desc"
    }
  });

  const serializedDatasets = datasets
    .map((dataset) => serializeDataset(dataset, user.id))
    .filter(
      (dataset) =>
        dataset.canManage ||
        Boolean(projectId && dataset.project.status === ProjectStatus.ACTIVE && dataset.status === DatasetStatus.READY)
    );

  response.status(200).json({
    datasets: serializedDatasets
  });
});

router.get("/:datasetId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findFirst({
    where: {
      id: datasetId,
      project: {
        OR: [
          {
            organization: {
              memberships: {
                some: {
                  userId: user.id,
                  status: "ACTIVE"
                }
              }
            }
          },
          {
            projectMemberships: {
              some: {
                userId: user.id,
                status: "ACTIVE"
              }
            }
          },
          {
            accessMode: ProjectAccessMode.PUBLIC,
            status: ProjectStatus.ACTIVE
          }
        ]
      }
    },
    include: datasetIncludes
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found or you do not have access." });
    return;
  }

  const serializedDataset = serializeDataset(dataset, user.id);

  if (!serializedDataset.canManage) {
    response.status(403).json({
      error: "Dataset details are only available to project owners and admins. Open the project tasks instead."
    });
    return;
  }

  response.status(200).json({
    dataset: serializedDataset
  });
});

router.get("/:datasetId/versions", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

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
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to view dataset versions." });
    return;
  }

  const versions = await prisma.datasetVersion.findMany({
    where: {
      datasetId: dataset.id
    },
    include: {
      createdBy: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      }
    },
    orderBy: {
      version: "desc"
    }
  });

  response.status(200).json({
    versions: versions.map(serializeDatasetVersion)
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateDatasetBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findUnique({
    where: {
      id: parsed.value.projectId
    },
    select: {
      id: true,
      name: true,
      organizationId: true,
      createdById: true
    }
  });

  if (!project) {
    response.status(404).json({ error: "Project was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: project.id,
      status: "ACTIVE"
    }
  });

  if (project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({
      error: "You need project owner or admin access to create datasets in this project."
    });
    return;
  }

  const dataset = await prisma.$transaction(async (tx) => {
    const createdDataset = await tx.dataset.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        name: parsed.value.name,
        description: parsed.value.description,
        status: DatasetStatus.DRAFT,
        createdById: user.id
      },
      include: datasetIncludes
    });

    await createDatasetVersionSnapshot(tx, {
      datasetId: createdDataset.id,
      reason: "dataset_created",
      summary: {
        projectName: project.name
      },
      userId: user.id,
      version: createdDataset.version
    });

    await tx.auditLog.create({
      data: {
        organizationId: createdDataset.organizationId,
        projectId: createdDataset.projectId,
        userId: user.id,
        action: "dataset.created",
        entityType: "dataset",
        entityId: createdDataset.id,
        metadata: {
          name: createdDataset.name,
          projectName: project.name
        }
      }
    });

    return createdDataset;
  });

  response.status(201).json({
    dataset: serializeDataset(dataset, user.id)
  });
});

router.patch("/:datasetId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return;
  }

  const parsed = parseUpdateDatasetBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: datasetId
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      labelingConfig: true,
      labels: {
        select: {
          id: true
        }
      },
      tools: {
        where: {
          enabled: true
        },
        select: {
          id: true
        }
      },
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to edit this dataset." });
    return;
  }

  if (parsed.value.annotationTemplateId) {
    const template = await prisma.annotationTemplate.findUnique({
      where: {
        id: parsed.value.annotationTemplateId
      },
      select: {
        organizationId: true
      }
    });

    if (!template) {
      response.status(400).json({ error: "Choose a valid annotation template for this dataset." });
      return;
    }

    if (template.organizationId && template.organizationId !== dataset.organizationId) {
      response.status(403).json({ error: "This annotation template belongs to another organization." });
      return;
    }
  }

  if (
    parsed.value.status === DatasetStatus.READY &&
    !hasDatasetLabelConfig({
      labelsCount: parsed.value.labels?.length ?? dataset.labels.length,
      toolsCount: parsed.value.tools?.filter((tool) => tool.enabled).length ?? dataset.tools.length,
      labelingConfig: parsed.value.labelingConfig ?? dataset.labelingConfig
    })
  ) {
    response.status(400).json({
      error: "Set this dataset's labeling configuration before making it ready."
    });
    return;
  }

  const updatedDataset = await prisma.$transaction(async (tx) => {
    const { labels, tools, ...datasetValues } = parsed.value;
    const saved = await tx.dataset.update({
      where: {
        id: dataset.id
      },
      data: datasetValues,
      include: datasetIncludes
    });

    if (labels) {
      await syncDatasetLabels(tx, saved.id, labels);
    }

    if (tools) {
      await syncDatasetTools(tx, saved.id, tools);
    }

    if (hasDatasetVersionChange(parsed.value)) {
      await recordDatasetVersionChange(tx, {
        datasetId: saved.id,
        reason: getDatasetUpdateReason(parsed.value),
        summary: {
          changedFields: Object.keys(parsed.value).filter((key) => key !== "labels" && key !== "tools"),
          labelsChanged: Boolean(labels),
          toolsChanged: Boolean(tools)
        },
        userId: user.id
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: saved.organizationId,
        projectId: saved.projectId,
        userId: user.id,
        action: "dataset.updated",
        entityType: "dataset",
        entityId: saved.id,
        metadata: datasetValues
      }
    });

    return tx.dataset.findUniqueOrThrow({
      where: {
        id: saved.id
      },
      include: datasetIncludes
    });
  });

  response.status(200).json({
    dataset: serializeDataset(updatedDataset, user.id)
  });
});

router.post("/:datasetId/versions/:version/rollback", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);
  const version = normalizePositiveInteger(request.params.version);

  if (!datasetId) {
    response.status(400).json({ error: "Dataset is required." });
    return;
  }

  if (!version) {
    response.status(400).json({ error: "Choose a valid dataset version." });
    return;
  }

  const prisma = getPrismaClient();
  const dataset = await prisma.dataset.findUnique({
    where: {
      id: datasetId
    },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to rollback this dataset." });
    return;
  }

  const targetVersion = await prisma.datasetVersion.findUnique({
    where: {
      datasetId_version: {
        datasetId: dataset.id,
        version
      }
    }
  });

  if (!targetVersion) {
    response.status(404).json({ error: "Dataset version was not found." });
    return;
  }

  const rollbackState = parseDatasetSnapshotForRollback(targetVersion.snapshotJson);

  if (!rollbackState.ok) {
    response.status(400).json({ error: rollbackState.error });
    return;
  }

  const restoredDataset = await prisma.$transaction(async (tx) => {
    const nextVersion = await getNextDatasetVersion(tx, dataset.id);
    const restoredTemplate = rollbackState.value.annotationTemplateId
      ? await tx.annotationTemplate.findFirst({
          where: {
            id: rollbackState.value.annotationTemplateId,
            OR: [
              {
                organizationId: null
              },
              {
                organizationId: dataset.organizationId
              }
            ]
          },
          select: {
            id: true
          }
        })
      : null;

    await tx.dataset.update({
      where: {
        id: dataset.id
      },
      data: {
        annotationTemplateId: restoredTemplate?.id ?? null,
        description: rollbackState.value.description,
        labelingConfig: rollbackState.value.labelingConfig,
        metadata: rollbackState.value.metadata,
        name: rollbackState.value.name,
        status: rollbackState.value.status,
        version: nextVersion
      }
    });

    await syncDatasetLabels(tx, dataset.id, rollbackState.value.labels);
    await syncDatasetTools(tx, dataset.id, rollbackState.value.tools);

    await createDatasetVersionSnapshot(tx, {
      datasetId: dataset.id,
      reason: "rollback",
      summary: {
        restoredFromVersion: version
      },
      userId: user.id,
      version: nextVersion
    });

    await tx.auditLog.create({
      data: {
        organizationId: dataset.organizationId,
        projectId: dataset.projectId,
        userId: user.id,
        action: "dataset.version_rolled_back",
        entityType: "dataset",
        entityId: dataset.id,
        metadata: {
          requestId: getRequestId(request),
          restoredFromVersion: version,
          newVersion: nextVersion
        }
      }
    });

    return tx.dataset.findUniqueOrThrow({
      where: {
        id: dataset.id
      },
      include: datasetIncludes
    });
  });

  response.status(200).json({
    dataset: serializeDataset(restoredDataset, user.id)
  });
});

router.post("/:datasetId/archive", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

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
      organizationId: true,
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to archive this dataset." });
    return;
  }

  const archivedDataset = await prisma.dataset.update({
    where: {
      id: dataset.id
    },
    data: {
      status: DatasetStatus.ARCHIVED
    },
    include: datasetIncludes
  });

  response.status(200).json({
    dataset: serializeDataset(archivedDataset, user.id)
  });
});

router.post("/:datasetId/restore", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

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
      organizationId: true,
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to restore this dataset." });
    return;
  }

  const restoredDataset = await prisma.dataset.update({
    where: {
      id: dataset.id
    },
    data: {
      status: DatasetStatus.DRAFT
    },
    include: datasetIncludes
  });

  response.status(200).json({
    dataset: serializeDataset(restoredDataset, user.id)
  });
});

router.delete("/:datasetId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const datasetId = normalizeId(request.params.datasetId);

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
      projectId: true,
      project: {
        select: {
          createdById: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found." });
    return;
  }

  const membership = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: dataset.projectId,
      status: "ACTIVE"
    }
  });

  if (dataset.project.createdById !== user.id && (!membership || !canManageProjectScope(membership))) {
    response.status(403).json({ error: "You need project owner or admin access to delete this dataset." });
    return;
  }

  const assets = await prisma.storageAsset.findMany({
    where: {
      datasetId: dataset.id
    },
    select: {
      id: true,
      provider: true,
      bucket: true,
      objectKey: true
    }
  });
  const r2Assets = assets.filter((asset) => asset.provider === StorageProvider.R2);

  if (r2Assets.length > 0) {
    const config = getR2Config();

    if (!config.ok) {
      response.status(503).json({ error: config.error });
      return;
    }

    const client = createR2Client(config.value);
    const buckets = [...new Set(r2Assets.map((asset) => asset.bucket))];

    for (const bucket of buckets) {
      const bucketAssets = r2Assets.filter((asset) => asset.bucket === bucket);

      for (const batch of chunkArray(bucketAssets, 1000)) {
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((asset) => ({
                Key: asset.objectKey
              })),
              Quiet: true
            }
          })
        );

        if (result.Errors && result.Errors.length > 0) {
          response.status(502).json({
            error: `R2 refused to delete ${result.Errors.length} object${result.Errors.length === 1 ? "" : "s"}.`
          });
          return;
        }
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedTasks = await tx.task.deleteMany({
      where: {
        datasetId: dataset.id
      }
    });

    const deletedAssets = await tx.storageAsset.deleteMany({
      where: {
        datasetId: dataset.id
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: dataset.organizationId,
        projectId: dataset.projectId,
        userId: user.id,
        action: "dataset.deleted",
        entityType: "dataset",
        entityId: dataset.id,
        metadata: {
          requestId: getRequestId(request),
          name: dataset.name,
          deletedAssetCount: deletedAssets.count,
          deletedTaskCount: deletedTasks.count,
          r2ObjectCount: r2Assets.length
        }
      }
    });

    await tx.dataset.delete({
      where: {
        id: dataset.id
      }
    });

    return {
      deletedAssetCount: deletedAssets.count,
      deletedTaskCount: deletedTasks.count
    };
  });

  response.status(200).json({
    deleted: true,
    ...result
  });
});

export { router as datasetsRouter };

type CreateDatasetBody =
  | {
      projectId?: unknown;
      name?: unknown;
      description?: unknown;
    }
  | undefined;

type UpdateDatasetBody =
  | {
      name?: unknown;
      description?: unknown;
      annotationTemplateId?: unknown;
      status?: unknown;
      labelingConfig?: unknown;
      labels?: unknown;
      tools?: unknown;
    }
  | undefined;

type ParsedDatasetLabel = {
  color: string;
  metadata?: Prisma.InputJsonObject;
  name: string;
  shortcutKey?: string;
};

type ParsedDatasetTool = {
  configJson?: Prisma.InputJsonObject;
  enabled: boolean;
  tool: AnnotationTool;
};

function parseCreateDatasetBody(body: CreateDatasetBody):
  | {
      ok: true;
      value: {
        projectId: string;
        name: string;
        description?: string;
      };
    }
  | { ok: false; error: string } {
  const projectId = normalizeId(body?.projectId);
  const name = normalizeText(body?.name);
  const description = normalizeText(body?.description);

  if (!projectId) {
    return { ok: false, error: "Project is required." };
  }

  if (!name) {
    return { ok: false, error: "Dataset name is required." };
  }

  if (name.length > 120) {
    return { ok: false, error: "Dataset name must be 120 characters or fewer." };
  }

  if (description && description.length > 500) {
    return { ok: false, error: "Dataset description must be 500 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      projectId,
      name,
      description
    }
  };
}

function parseUpdateDatasetBody(body: UpdateDatasetBody):
  | {
      ok: true;
      value: {
        name?: string;
        description?: string | null;
        annotationTemplateId?: string | null;
        status?: DatasetStatus;
        labelingConfig?: Prisma.InputJsonObject;
        labels?: ParsedDatasetLabel[];
        tools?: ParsedDatasetTool[];
      };
    }
  | { ok: false; error: string } {
  const name = normalizeText(body?.name);
  const description = normalizeNullableText(body?.description);
  const annotationTemplateId = normalizeNullableText(body?.annotationTemplateId);
  const status = parseEnumValue(DatasetStatus, body?.status);
  const labelingConfig = parseLabelingConfig(body?.labelingConfig);
  const annotationConfig = parseDatasetAnnotationConfig(body?.labels, body?.tools, body?.labelingConfig);

  if (name && name.length > 120) {
    return { ok: false, error: "Dataset name must be 120 characters or fewer." };
  }

  if (description && description.length > 500) {
    return { ok: false, error: "Dataset description must be 500 characters or fewer." };
  }

  if (body?.status && !status) {
    return { ok: false, error: "Choose a valid dataset status." };
  }

  if (!labelingConfig.ok) {
    return { ok: false, error: labelingConfig.error };
  }

  if (!annotationConfig.ok) {
    return { ok: false, error: annotationConfig.error };
  }

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(body?.description !== undefined ? { description } : {}),
      ...(body?.annotationTemplateId !== undefined ? { annotationTemplateId } : {}),
      ...(status ? { status } : {}),
      ...(labelingConfig.value ? { labelingConfig: labelingConfig.value } : {}),
      ...(body?.labels !== undefined ? { labels: annotationConfig.labels } : {}),
      ...(body?.tools !== undefined ? { tools: annotationConfig.tools } : {})
    }
  };
}

const datasetIncludes = {
  annotationTemplate: {
    select: {
      id: true,
      name: true,
      description: true,
      dataType: true,
      configJson: true
    }
  },
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
  },
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  project: {
    select: {
      id: true,
      name: true,
      slug: true,
      dataType: true,
      status: true,
      createdById: true,
      projectMemberships: {
        select: {
          userId: true,
          role: true,
          status: true
        }
      }
    }
  }
} as const;

type DatasetWithRelations = Dataset & {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    dataType: string;
    status: ProjectStatus;
    createdById: string;
    projectMemberships: {
      userId: string;
      role: MembershipRole;
    status: string;
    }[];
  };
  annotationTemplate: {
    id: string;
    name: string;
    description: string | null;
    dataType: string;
    configJson: unknown;
  } | null;
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
};

function serializeDataset(dataset: DatasetWithRelations, currentUserId?: string) {
  const membership = currentUserId
    ? dataset.project.projectMemberships.find((item) => item.userId === currentUserId && item.status === "ACTIVE")
    : undefined;
  const canManage = Boolean(
    currentUserId && (dataset.project.createdById === currentUserId || (membership && canManageProjectScope(membership)))
  );
  const { projectMemberships: _projectMemberships, ...project } = dataset.project;

  return {
    id: dataset.id,
    organizationId: dataset.organizationId,
    projectId: dataset.projectId,
    name: dataset.name,
    description: dataset.description,
    version: dataset.version,
    status: dataset.status,
    annotationTemplateId: dataset.annotationTemplateId,
    labelingConfig: dataset.labelingConfig,
    metadata: dataset.metadata,
    annotationTemplate: dataset.annotationTemplate,
    labels: dataset.labels,
    tools: dataset.tools,
    organization: dataset.organization,
    project,
    canManage,
    canManageAssets: canManage,
    canGenerateTasks: canManage,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt
  };
}

type DatasetVersionWithRelations = {
  id: string;
  datasetId: string;
  version: number;
  snapshotJson: unknown;
  createdAt: Date;
  createdById: string | null;
  createdBy: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

function serializeDatasetVersion(version: DatasetVersionWithRelations) {
  return {
    id: version.id,
    datasetId: version.datasetId,
    version: version.version,
    summary: summarizeDatasetVersionSnapshot(version.snapshotJson),
    createdBy: version.createdBy,
    createdById: version.createdById,
    createdAt: version.createdAt
  };
}

export function summarizeDatasetVersionSnapshot(snapshotJson: unknown) {
  const snapshot = isRecord(snapshotJson) ? snapshotJson : {};
  const dataset = isRecord(snapshot.dataset) ? snapshot.dataset : {};
  const template = isRecord(snapshot.template) ? snapshot.template : {};
  const labels = Array.isArray(snapshot.labels) ? snapshot.labels : [];
  const tools = Array.isArray(snapshot.tools) ? snapshot.tools : [];
  const assets = isRecord(snapshot.assets) ? snapshot.assets : {};
  const tasks = isRecord(snapshot.tasks) ? snapshot.tasks : {};
  const summary = isRecord(snapshot.summary) ? snapshot.summary : {};
  const reason = typeof snapshot.reason === "string" ? snapshot.reason : "snapshot";

  return {
    reason,
    labelCount: labels.length,
    toolCount: tools.filter((tool) => isRecord(tool) && tool.enabled !== false).length,
    assetCount: typeof assets.count === "number" ? assets.count : 0,
    taskCount: typeof tasks.count === "number" ? tasks.count : 0,
    datasetName: typeof dataset.name === "string" ? dataset.name : "Dataset snapshot",
    datasetStatus: typeof dataset.status === "string" ? dataset.status : "DRAFT",
    templateName: typeof template.name === "string" ? template.name : null,
    restoredFromVersion: typeof summary.restoredFromVersion === "number" ? summary.restoredFromVersion : null
  };
}

type SnapshotDataset = Dataset & {
  annotationTemplate: {
    id: string;
    name: string;
    description: string | null;
    dataType: string;
    configJson: unknown;
  } | null;
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
  assets: {
    id: string;
    objectKey: string;
    fileName: string;
    mimeType: string;
    fileSize: bigint;
    width: number | null;
    height: number | null;
    duration: number | null;
    createdAt: Date;
  }[];
  tasks: {
    id: string;
    assetId: string | null;
    status: string;
    assignedToId: string | null;
    reviewerId: string | null;
    priority: number;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }[];
};

const datasetSnapshotIncludes = {
  annotationTemplate: {
    select: {
      id: true,
      name: true,
      description: true,
      dataType: true,
      configJson: true
    }
  },
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
  },
  assets: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      objectKey: true,
      fileName: true,
      mimeType: true,
      fileSize: true,
      width: true,
      height: true,
      duration: true,
      createdAt: true
    }
  },
  tasks: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      assetId: true,
      status: true,
      assignedToId: true,
      reviewerId: true,
      priority: true,
      metadata: true,
      createdAt: true,
      updatedAt: true
    }
  }
} as const;

export async function recordDatasetVersionChange(
  tx: Prisma.TransactionClient,
  input: {
    datasetId: string;
    reason: string;
    summary?: Prisma.InputJsonObject;
    userId?: string;
  }
) {
  const nextVersion = await getNextDatasetVersion(tx, input.datasetId);

  await tx.dataset.update({
    where: {
      id: input.datasetId
    },
    data: {
      version: nextVersion
    }
  });

  await createDatasetVersionSnapshot(tx, {
    ...input,
    version: nextVersion
  });

  return nextVersion;
}

export async function createDatasetVersionSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    datasetId: string;
    reason: string;
    summary?: Prisma.InputJsonObject;
    userId?: string;
    version: number;
  }
) {
  const dataset = await tx.dataset.findUnique({
    where: {
      id: input.datasetId
    },
    include: datasetSnapshotIncludes
  });

  if (!dataset) {
    return null;
  }

  const snapshotJson = buildDatasetSnapshot(dataset as SnapshotDataset, {
    reason: input.reason,
    summary: input.summary,
    version: input.version
  });

  return tx.datasetVersion.upsert({
    where: {
      datasetId_version: {
        datasetId: input.datasetId,
        version: input.version
      }
    },
    create: {
      datasetId: input.datasetId,
      version: input.version,
      snapshotJson,
      ...(input.userId ? { createdById: input.userId } : {})
    },
    update: {
      snapshotJson,
      ...(input.userId ? { createdById: input.userId } : {})
    }
  });
}

async function getNextDatasetVersion(tx: Prisma.TransactionClient, datasetId: string) {
  const [dataset, latestVersion] = await Promise.all([
    tx.dataset.findUnique({
      where: {
        id: datasetId
      },
      select: {
        version: true
      }
    }),
    tx.datasetVersion.aggregate({
      where: {
        datasetId
      },
      _max: {
        version: true
      }
    })
  ]);

  return Math.max(dataset?.version ?? 0, latestVersion._max.version ?? 0) + 1;
}

function buildDatasetSnapshot(
  dataset: SnapshotDataset,
  input: {
    reason: string;
    summary?: Prisma.InputJsonObject;
    version: number;
  }
): Prisma.InputJsonObject {
  const taskStatusCounts = dataset.tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, {});

  const snapshot = {
    schemaVersion: 1,
    reason: input.reason,
    summary: input.summary ?? {},
    capturedAt: new Date().toISOString(),
    version: input.version,
    dataset: {
      id: dataset.id,
      organizationId: dataset.organizationId,
      projectId: dataset.projectId,
      name: dataset.name,
      description: dataset.description,
      version: input.version,
      status: dataset.status,
      annotationTemplateId: dataset.annotationTemplateId,
      labelingConfig: dataset.labelingConfig,
      metadata: dataset.metadata
    },
    template: dataset.annotationTemplate
      ? {
          id: dataset.annotationTemplate.id,
          name: dataset.annotationTemplate.name,
          description: dataset.annotationTemplate.description,
          dataType: dataset.annotationTemplate.dataType,
          configJson: dataset.annotationTemplate.configJson
        }
      : null,
    labels: dataset.labels.map((label) => ({
      name: label.name,
      color: label.color,
      shortcutKey: label.shortcutKey,
      metadata: label.metadata
    })),
    tools: dataset.tools.map((tool) => ({
      tool: tool.tool,
      enabled: tool.enabled,
      configJson: tool.configJson
    })),
    assets: {
      count: dataset.assets.length,
      items: dataset.assets.map((asset) => ({
        id: asset.id,
        objectKey: asset.objectKey,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        fileSize: asset.fileSize.toString(),
        width: asset.width,
        height: asset.height,
        duration: asset.duration,
        createdAt: asset.createdAt.toISOString()
      }))
    },
    tasks: {
      count: dataset.tasks.length,
      byStatus: taskStatusCounts,
      items: dataset.tasks.map((task) => ({
        id: task.id,
        assetId: task.assetId,
        status: task.status,
        assignedToId: task.assignedToId,
        reviewerId: task.reviewerId,
        priority: task.priority,
        metadata: task.metadata,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString()
      }))
    }
  };

  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonObject;
}

function parseDatasetSnapshotForRollback(snapshotJson: unknown):
  | {
      ok: true;
      value: {
        annotationTemplateId: string | null;
        description: string | null;
        labelingConfig: Prisma.InputJsonObject | typeof Prisma.JsonNull;
        labels: ParsedDatasetLabel[];
        metadata: Prisma.InputJsonObject | typeof Prisma.JsonNull;
        name: string;
        status: DatasetStatus;
        tools: ParsedDatasetTool[];
      };
    }
  | { ok: false; error: string } {
  if (!isRecord(snapshotJson)) {
    return { ok: false, error: "This dataset version does not contain a readable snapshot." };
  }

  const dataset = isRecord(snapshotJson.dataset) ? snapshotJson.dataset : null;

  if (!dataset) {
    return { ok: false, error: "This dataset version is missing dataset configuration." };
  }

  const name = normalizeText(dataset.name);
  const status = parseEnumValue(DatasetStatus, dataset.status);
  const labels = parseDatasetLabels(snapshotJson.labels);
  const tools = parseDatasetTools(snapshotJson.tools);

  if (!name) {
    return { ok: false, error: "This dataset version has an invalid name." };
  }

  if (!status) {
    return { ok: false, error: "This dataset version has an invalid status." };
  }

  if (!labels.ok) {
    return labels;
  }

  if (!tools.ok) {
    return tools;
  }

  return {
    ok: true,
    value: {
      annotationTemplateId: typeof dataset.annotationTemplateId === "string" ? dataset.annotationTemplateId : null,
      description: typeof dataset.description === "string" ? dataset.description : null,
      labelingConfig: isRecord(dataset.labelingConfig) ? (dataset.labelingConfig as Prisma.InputJsonObject) : Prisma.JsonNull,
      labels: labels.labels,
      metadata: isRecord(dataset.metadata) ? (dataset.metadata as Prisma.InputJsonObject) : Prisma.JsonNull,
      name,
      status,
      tools: tools.tools
    }
  };
}

function hasDatasetVersionChange(value: {
  annotationTemplateId?: string | null;
  description?: string | null;
  labelingConfig?: Prisma.InputJsonObject;
  labels?: ParsedDatasetLabel[];
  name?: string;
  status?: DatasetStatus;
  tools?: ParsedDatasetTool[];
}) {
  return Object.keys(value).length > 0;
}

function getDatasetUpdateReason(value: {
  annotationTemplateId?: string | null;
  labelingConfig?: Prisma.InputJsonObject;
  labels?: ParsedDatasetLabel[];
  tools?: ParsedDatasetTool[];
}) {
  return value.annotationTemplateId !== undefined || value.labelingConfig !== undefined || value.labels !== undefined || value.tools !== undefined
    ? "template_config_updated"
    : "dataset_details_updated";
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNullableText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : undefined;
}

function parseLabelingConfig(value: unknown): { ok: true; value?: Prisma.InputJsonObject } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Labeling config must be an object." };
  }

  return { ok: true, value: value as Prisma.InputJsonObject };
}

function parseDatasetAnnotationConfig(
  labelsInput: unknown,
  toolsInput: unknown,
  labelingConfigInput: unknown
):
  | {
      ok: true;
      labels: ParsedDatasetLabel[];
      tools: ParsedDatasetTool[];
    }
  | { ok: false; error: string } {
  const labels = labelsInput === undefined ? parseLabelsFromLabelingConfig(labelingConfigInput) : parseDatasetLabels(labelsInput);
  const tools = toolsInput === undefined ? parseToolsFromLabelingConfig(labelingConfigInput) : parseDatasetTools(toolsInput);

  if (!labels.ok) {
    return labels;
  }

  if (!tools.ok) {
    return tools;
  }

  return {
    ok: true,
    labels: labels.labels,
    tools: tools.tools
  };
}

function parseDatasetLabels(value: unknown): { ok: true; labels: ParsedDatasetLabel[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Labels must be an array." };
  }

  if (value.length > 100) {
    return { ok: false, error: "A dataset can have up to 100 labels." };
  }

  const labels: ParsedDatasetLabel[] = [];
  const names = new Set<string>();
  const shortcuts = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each label must be an object." };
    }

    const label = item as Record<string, unknown>;
    const name = normalizeText(label.name);
    const color = normalizeText(label.color) ?? fallbackLabelColors[index % fallbackLabelColors.length];
    const shortcutKey = normalizeText(label.shortcutKey);

    if (!name) {
      return { ok: false, error: "Every label needs a name." };
    }

    if (name.length > 80) {
      return { ok: false, error: "Label names must be 80 characters or fewer." };
    }

    if (names.has(name.toLowerCase())) {
      return { ok: false, error: `Duplicate label: ${name}.` };
    }

    if (shortcutKey) {
      if (!/^[A-Za-z0-9]$/.test(shortcutKey)) {
        return { ok: false, error: "Label shortcuts must be one letter or number." };
      }

      if (shortcuts.has(shortcutKey.toLowerCase())) {
        return { ok: false, error: `Duplicate shortcut: ${shortcutKey}.` };
      }

      shortcuts.add(shortcutKey.toLowerCase());
    }

    names.add(name.toLowerCase());
    labels.push({
      color,
      name,
      ...(shortcutKey ? { shortcutKey } : {}),
      ...(isPlainJsonObject(label.metadata) ? { metadata: label.metadata as Prisma.InputJsonObject } : {})
    });
  }

  return { ok: true, labels };
}

function parseDatasetTools(value: unknown): { ok: true; tools: ParsedDatasetTool[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "Annotation tools must be an array." };
  }

  const tools: ParsedDatasetTool[] = [];
  const seen = new Set<AnnotationTool>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each annotation tool must be an object." };
    }

    const toolConfig = item as Record<string, unknown>;
    const tool = parseEnumValue(AnnotationTool, toolConfig.tool);

    if (!tool) {
      return { ok: false, error: "Choose a valid annotation tool." };
    }

    if (seen.has(tool)) {
      continue;
    }

    seen.add(tool);
    tools.push({
      tool,
      enabled: normalizeBoolean(toolConfig.enabled) ?? true,
      ...(isPlainJsonObject(toolConfig.configJson) ? { configJson: toolConfig.configJson as Prisma.InputJsonObject } : {})
    });
  }

  return { ok: true, tools };
}

function parseLabelsFromLabelingConfig(value: unknown): { ok: true; labels: ParsedDatasetLabel[] } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("labels" in value)) {
    return { ok: true, labels: [] };
  }

  return parseDatasetLabels((value as { labels?: unknown }).labels);
}

function parseToolsFromLabelingConfig(value: unknown): { ok: true; tools: ParsedDatasetTool[] } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("tools" in value)) {
    return { ok: true, tools: [] };
  }

  return parseDatasetTools((value as { tools?: unknown }).tools);
}

function hasDatasetLabelConfig({
  labelingConfig,
  labelsCount,
  toolsCount
}: {
  labelingConfig: unknown;
  labelsCount: number;
  toolsCount: number;
}) {
  return labelsCount > 0 && toolsCount > 0 && Boolean(labelingConfig && typeof labelingConfig === "object");
}

async function syncDatasetLabels(tx: Prisma.TransactionClient, datasetId: string, labels: ParsedDatasetLabel[]) {
  await tx.datasetLabel.deleteMany({
    where: {
      datasetId
    }
  });

  if (labels.length === 0) {
    return;
  }

  await tx.datasetLabel.createMany({
    data: labels.map((label) => ({
      datasetId,
      name: label.name,
      color: label.color,
      shortcutKey: label.shortcutKey,
      metadata: label.metadata
    }))
  });
}

async function syncDatasetTools(tx: Prisma.TransactionClient, datasetId: string, tools: ParsedDatasetTool[]) {
  await tx.datasetTool.deleteMany({
    where: {
      datasetId
    }
  });

  if (tools.length === 0) {
    return;
  }

  await tx.datasetTool.createMany({
    data: tools.map((tool) => ({
      datasetId,
      tool: tool.tool,
      enabled: tool.enabled,
      configJson: tool.configJson
    }))
  });
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (["true", "1", "on"].includes(value.toLowerCase())) {
      return true;
    }

    if (["false", "0", "off"].includes(value.toLowerCase())) {
      return false;
    }
  }

  return undefined;
}

function isPlainJsonObject(value: unknown): value is Prisma.InputJsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const fallbackLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
