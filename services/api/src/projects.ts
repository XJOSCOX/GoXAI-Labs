import {
  DataType,
  getPrismaClient,
  ProjectStatus,
  type Project
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
    response.status(200).json({ projects: [] });
    return;
  }

  const projects = await prisma.project.findMany({
    where: {
      organizationId: {
        in: organizationIds
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
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  response.status(200).json({
    projects: projects.map(serializeProject)
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateProjectBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: parsed.value.organizationId,
      status: "ACTIVE",
      role: {
        in: ["OWNER", "ADMIN", "MANAGER"]
      }
    }
  });

  if (!membership) {
    response.status(403).json({
      error: "You need owner, admin, or manager access to create projects in this organization."
    });
    return;
  }

  if (parsed.value.workspaceId) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: parsed.value.workspaceId,
        organizationId: parsed.value.organizationId
      },
      select: {
        id: true
      }
    });

    if (!workspace) {
      response.status(400).json({ error: "Workspace does not belong to the selected organization." });
      return;
    }
  }

  const slug = await getUniqueProjectSlug(parsed.value.organizationId, parsed.value.name);
  const project = await prisma.$transaction(async (tx) => {
    const createdProject = await tx.project.create({
      data: {
        organizationId: parsed.value.organizationId,
        workspaceId: parsed.value.workspaceId,
        name: parsed.value.name,
        slug,
        description: parsed.value.description,
        dataType: parsed.value.dataType,
        status: ProjectStatus.DRAFT,
        instructions: parsed.value.instructions,
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
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: createdProject.organizationId,
        workspaceId: createdProject.workspaceId,
        projectId: createdProject.id,
        userId: user.id,
        action: "project.created",
        entityType: "project",
        entityId: createdProject.id,
        metadata: {
          name: createdProject.name,
          dataType: createdProject.dataType
        }
      }
    });

    return createdProject;
  });

  response.status(201).json({
    project: serializeProject(project)
  });
});

export { router as projectsRouter };

type CreateProjectBody =
  | {
      organizationId?: unknown;
      workspaceId?: unknown;
      name?: unknown;
      description?: unknown;
      dataType?: unknown;
      instructions?: unknown;
    }
  | undefined;

function parseCreateProjectBody(body: CreateProjectBody):
  | {
      ok: true;
      value: {
        organizationId: string;
        workspaceId?: string;
        name: string;
        description?: string;
        dataType: DataType;
        instructions?: string;
      };
    }
  | { ok: false; error: string } {
  const organizationId = normalizeId(body?.organizationId);
  const workspaceId = normalizeId(body?.workspaceId);
  const name = normalizeText(body?.name);
  const description = normalizeText(body?.description);
  const dataType = parseEnumValue(DataType, body?.dataType);
  const instructions = normalizeText(body?.instructions);

  if (!organizationId) {
    return { ok: false, error: "Organization is required." };
  }

  if (!name) {
    return { ok: false, error: "Project name is required." };
  }

  if (name.length > 120) {
    return { ok: false, error: "Project name must be 120 characters or fewer." };
  }

  if (description && description.length > 500) {
    return { ok: false, error: "Project description must be 500 characters or fewer." };
  }

  if (!dataType) {
    return { ok: false, error: "Choose a valid project data type." };
  }

  if (instructions && instructions.length > 4000) {
    return { ok: false, error: "Instructions must be 4000 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      organizationId,
      workspaceId,
      name,
      description,
      dataType,
      instructions
    }
  };
}

async function getUniqueProjectSlug(organizationId: string, name: string) {
  const prisma = getPrismaClient();
  const base = slugify(name);
  let slug = base;
  let suffix = 1;

  while (await prisma.project.findUnique({ where: { organizationId_slug: { organizationId, slug } } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  return slug;
}

type ProjectWithRelations = Project & {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

function serializeProject(project: ProjectWithRelations) {
  return {
    id: project.id,
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    dataType: project.dataType,
    status: project.status,
    instructions: project.instructions,
    organization: project.organization,
    workspace: project.workspace,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 72) || "project"
  );
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : undefined;
}
