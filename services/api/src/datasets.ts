import {
  DatasetStatus,
  getPrismaClient,
  type Dataset
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";

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
          dataType: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  response.status(200).json({
    datasets: datasets.map(serializeDataset)
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
          dataType: true
        }
      }
    }
  });

  if (!dataset) {
    response.status(404).json({ error: "Dataset was not found or you do not have access." });
    return;
  }

  response.status(200).json({
    dataset: serializeDataset(dataset)
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
      organizationId: true
    }
  });

  if (!project) {
    response.status(404).json({ error: "Project was not found." });
    return;
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: project.organizationId,
      status: "ACTIVE",
      role: {
        in: ["OWNER", "ADMIN", "MANAGER"]
      }
    }
  });

  if (!membership) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to create datasets in this project."
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
            dataType: true
          }
        }
      }
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
    dataset: serializeDataset(dataset)
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
  };
};

function serializeDataset(dataset: DatasetWithRelations) {
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
    project: dataset.project,
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
