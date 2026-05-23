import {
  DatasetStatus,
  getPrismaClient,
  MembershipRole,
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
  const memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE"
    },
    select: {
      organizationId: true
    }
  });
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];

  if (organizationIds.length === 0) {
    response.status(200).json({ datasets: [] });
    return;
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

  const datasets = await prisma.dataset.findMany({
    where: {
      organizationId: {
        in: organizationIds
      },
      ...(projectId ? { projectId } : {})
    },
    include: {
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
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  response.status(200).json({
    datasets: datasets.map((dataset) => serializeDataset(dataset, user.id))
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
      organization: {
        memberships: {
          some: {
            userId: user.id,
            status: "ACTIVE"
          }
        }
      }
    },
    include: {
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
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found or you do not have access." });
    return;
  }

  response.status(200).json({
    dataset: serializeDataset(dataset, user.id)
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

  const updatedDataset = await prisma.$transaction(async (tx) => {
    const saved = await tx.dataset.update({
      where: {
        id: dataset.id
      },
      data: parsed.value,
      include: datasetIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId: saved.organizationId,
        projectId: saved.projectId,
        userId: user.id,
        action: "dataset.updated",
        entityType: "dataset",
        entityId: saved.id,
        metadata: parsed.value
      }
    });

    return saved;
  });

  response.status(200).json({
    dataset: serializeDataset(updatedDataset, user.id)
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
      status?: unknown;
    }
  | undefined;

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
        status?: DatasetStatus;
      };
    }
  | { ok: false; error: string } {
  const name = normalizeText(body?.name);
  const description = normalizeNullableText(body?.description);
  const status = parseEnumValue(DatasetStatus, body?.status);

  if (name && name.length > 120) {
    return { ok: false, error: "Dataset name must be 120 characters or fewer." };
  }

  if (description && description.length > 500) {
    return { ok: false, error: "Dataset description must be 500 characters or fewer." };
  }

  if (body?.status && !status) {
    return { ok: false, error: "Choose a valid dataset status." };
  }

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(body?.description !== undefined ? { description } : {}),
      ...(status ? { status } : {})
    }
  };
}

const datasetIncludes = {
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
    createdById: string;
    projectMemberships: {
      userId: string;
      role: MembershipRole;
      status: string;
    }[];
  };
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
    metadata: dataset.metadata,
    organization: dataset.organization,
    project,
    canManage,
    canManageAssets: canManage,
    canGenerateTasks: canManage,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt
  };
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

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : undefined;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
