import {
  CreatorStatus,
  DataType,
  getPrismaClient,
  GlobalRole,
  MembershipRole,
  ProjectAccessMode,
  ProjectStatus,
  type Project
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId } from "./logging.js";
import { canCreateOrganizationProjects, canManageProjectScope } from "./permissions.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

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

  const projects = await prisma.project.findMany({
    where: {
      OR: [
        {
          accessMode: ProjectAccessMode.PUBLIC
        },
        {
          organizationId: {
            in: organizationIds
          }
        },
        {
          id: {
            in: projectIds
          }
        }
      ]
    },
    include: projectIncludes,
    orderBy: {
      updatedAt: "desc"
    }
  });

  response.status(200).json({
    projects: projects.map((project) => serializeProject(project, user.id))
  });
});

router.post("/join-code", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const code = normalizeText(request.body?.code)?.toUpperCase();

  if (!code) {
    response.status(400).json({ error: "Project join code is required." });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findUnique({
    where: {
      joinCode: code
    },
    include: projectIncludes
  });

  if (!project || !project.joinCodeEnabled || project.accessMode === ProjectAccessMode.PRIVATE) {
    response.status(404).json({ error: "Project join code is not valid or is no longer active." });
    return;
  }

  const organizationMembership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: project.organizationId,
      status: "ACTIVE"
    }
  });

  if (!organizationMembership && !project.allowExternalMembers) {
    response.status(403).json({ error: "This project only accepts members from its organization." });
    return;
  }

  if (project.memberLimit !== null && project._count.projectMemberships >= project.memberLimit) {
    response.status(409).json({ error: "This project has reached its member limit." });
    return;
  }

  await prisma.projectMembership.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: user.id
      }
    },
    update: {
      status: "ACTIVE",
      joinedAt: new Date()
    },
    create: {
      projectId: project.id,
      userId: user.id,
      role: MembershipRole.ANNOTATOR,
      status: "ACTIVE",
      joinedAt: new Date()
    }
  });

  const joinedProject = await prisma.project.findUniqueOrThrow({
    where: {
      id: project.id
    },
    include: projectIncludes
  });

  response.status(200).json({
    project: serializeProject(joinedProject, user.id)
  });
});

router.get("/:projectId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

  if (!projectId) {
    response.status(400).json({ error: "Project is required." });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        {
          accessMode: ProjectAccessMode.PUBLIC
        },
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
        }
      ]
    },
    include: projectIncludes
  });

  if (!project) {
    response.status(404).json({ error: "Project was not found or you do not have access." });
    return;
  }

  response.status(200).json({
    project: serializeProject(project, user.id)
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

  if (user.globalRole !== GlobalRole.SUPER_ADMIN && user.creatorStatus !== CreatorStatus.APPROVED) {
    response.status(403).json({
      error: "You need approved creator rights before creating a project."
    });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId: parsed.value.organizationId,
      status: "ACTIVE"
    }
  });

  if (!membership || !canCreateOrganizationProjects(membership)) {
    response.status(403).json({
      error: "Only an organization owner can create projects in this organization."
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
        accessMode: parsed.value.accessMode,
        memberLimit: parsed.value.memberLimit,
        allowExternalMembers: parsed.value.allowExternalMembers,
        joinCode: parsed.value.joinCodeEnabled ? await getUniqueProjectJoinCode() : null,
        joinCodeEnabled: parsed.value.joinCodeEnabled,
        instructions: parsed.value.instructions,
        createdById: user.id
      },
      include: projectIncludes
    });

    await tx.projectMembership.create({
      data: {
        projectId: createdProject.id,
        userId: user.id,
        role: MembershipRole.OWNER,
        status: "ACTIVE",
        joinedAt: new Date()
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
          dataType: createdProject.dataType,
          accessMode: createdProject.accessMode
        }
      }
    });

    return tx.project.findUniqueOrThrow({
      where: {
        id: createdProject.id
      },
      include: projectIncludes
    });
  });

  response.status(201).json({
    project: serializeProject(project, user.id)
  });
});

router.patch("/:projectId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

  if (!projectId) {
    response.status(400).json({ error: "Project is required." });
    return;
  }

  const parsed = parseUpdateProjectBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      joinCode: true
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
    response.status(403).json({ error: "You need project owner or admin access to edit this project." });
    return;
  }

  const updatedProject = await prisma.$transaction(async (tx) => {
    const data = {
      ...parsed.value,
      ...(parsed.value.joinCodeEnabled === true && !project.joinCode ? { joinCode: await getUniqueProjectJoinCode() } : {})
    };
    const saved = await tx.project.update({
      where: {
        id: project.id
      },
      data,
      include: projectIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId: saved.organizationId,
        workspaceId: saved.workspaceId,
        projectId: saved.id,
        userId: user.id,
        action: "project.updated",
        entityType: "project",
        entityId: saved.id,
        metadata: data
      }
    });

    return saved;
  });

  response.status(200).json({
    project: serializeProject(updatedProject, user.id)
  });
});

router.post("/:projectId/members", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

  if (!projectId) {
    response.status(400).json({ error: "Project is required." });
    return;
  }

  const parsed = parseProjectMemberBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const project = await prisma.project.findUnique({
    where: {
      id: projectId
    },
    include: projectIncludes
  });

  if (!project) {
    response.status(404).json({ error: "Project was not found." });
    return;
  }

  const manager = await prisma.projectMembership.findFirst({
    where: {
      userId: user.id,
      projectId: project.id,
      status: "ACTIVE"
    }
  });

  if (project.createdById !== user.id && (!manager || !canManageProjectScope(manager))) {
    response.status(403).json({ error: "You need project owner or admin access to invite project members." });
    return;
  }

  const targetUser = await prisma.user.findUnique({
    where: {
      email: parsed.value.email
    },
    select: {
      id: true
    }
  });

  if (!targetUser) {
    response.status(404).json({ error: "That user must sign up before they can be invited to a project." });
    return;
  }

  const organizationMembership = await prisma.membership.findFirst({
    where: {
      userId: targetUser.id,
      organizationId: project.organizationId,
      status: "ACTIVE"
    }
  });

  if (!organizationMembership && !project.allowExternalMembers) {
    response.status(403).json({ error: "This project does not allow members outside the organization." });
    return;
  }

  const existing = await prisma.projectMembership.findUnique({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: targetUser.id
      }
    }
  });

  if (!existing && project.memberLimit !== null && project._count.projectMemberships >= project.memberLimit) {
    response.status(409).json({ error: "This project has reached its member limit." });
    return;
  }

  await prisma.projectMembership.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: targetUser.id
      }
    },
    update: {
      role: parsed.value.role,
      status: "ACTIVE",
      invitedById: user.id,
      joinedAt: existing?.joinedAt ?? new Date()
    },
    create: {
      projectId: project.id,
      userId: targetUser.id,
      role: parsed.value.role,
      status: "ACTIVE",
      invitedById: user.id,
      joinedAt: new Date()
    }
  });

  const savedProject = await prisma.project.findUniqueOrThrow({
    where: {
      id: project.id
    },
    include: projectIncludes
  });

  response.status(existing ? 200 : 201).json({
    project: serializeProject(savedProject, user.id)
  });
});

router.post("/:projectId/archive", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

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
      id: true,
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
    response.status(403).json({ error: "You need project owner or admin access to archive this project." });
    return;
  }

  const archivedProject = await prisma.project.update({
    where: {
      id: project.id
    },
    data: {
      status: ProjectStatus.ARCHIVED
    },
    include: projectIncludes
  });

  response.status(200).json({
    project: serializeProject(archivedProject, user.id)
  });
});

router.post("/:projectId/restore", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

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
      id: true,
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
    response.status(403).json({ error: "You need project owner or admin access to restore this project." });
    return;
  }

  const restoredProject = await prisma.project.update({
    where: {
      id: project.id
    },
    data: {
      status: ProjectStatus.DRAFT
    },
    include: projectIncludes
  });

  response.status(200).json({
    project: serializeProject(restoredProject, user.id)
  });
});

router.delete("/:projectId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const projectId = normalizeId(request.params.projectId);

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
      id: true,
      name: true,
      organizationId: true,
      workspaceId: true,
      createdById: true,
      _count: {
        select: {
          datasets: true,
          assets: true
        }
      }
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
    response.status(403).json({ error: "You need project owner or admin access to delete this project." });
    return;
  }

  if (project._count.datasets > 0) {
    response.status(409).json({
      error: "Delete this project's datasets before deleting the project."
    });
    return;
  }

  if (project._count.assets > 0) {
    response.status(409).json({
      error: "Delete this project's registered files before deleting the project."
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        userId: user.id,
        action: "project.deleted",
        entityType: "project",
        entityId: project.id,
        metadata: {
          requestId: getRequestId(request),
          name: project.name
        }
      }
    });

    await tx.project.delete({
      where: {
        id: project.id
      }
    });
  });

  response.status(200).json({
    deleted: true
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
      accessMode?: unknown;
      memberLimit?: unknown;
      allowExternalMembers?: unknown;
      joinCodeEnabled?: unknown;
      instructions?: unknown;
    }
  | undefined;

type UpdateProjectBody =
  | {
      name?: unknown;
      description?: unknown;
      status?: unknown;
      accessMode?: unknown;
      memberLimit?: unknown;
      allowExternalMembers?: unknown;
      joinCodeEnabled?: unknown;
      instructions?: unknown;
    }
  | undefined;

type ProjectMemberBody =
  | {
      email?: unknown;
      role?: unknown;
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
        accessMode: ProjectAccessMode;
        memberLimit?: number;
        allowExternalMembers: boolean;
        joinCodeEnabled: boolean;
        instructions?: string;
      };
    }
  | { ok: false; error: string } {
  const organizationId = normalizeId(body?.organizationId);
  const workspaceId = normalizeId(body?.workspaceId);
  const name = normalizeText(body?.name);
  const description = normalizeText(body?.description);
  const dataType = parseEnumValue(DataType, body?.dataType);
  const accessMode = parseEnumValue(ProjectAccessMode, body?.accessMode) ?? ProjectAccessMode.ORGANIZATION;
  const memberLimit = normalizeOptionalPositiveInteger(body?.memberLimit);
  const allowExternalMembers = normalizeBoolean(body?.allowExternalMembers) ?? false;
  const joinCodeEnabled = normalizeBoolean(body?.joinCodeEnabled) ?? false;
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

  if (memberLimit === false) {
    return { ok: false, error: "Member limit must be a whole number between 1 and 100000." };
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
      accessMode,
      memberLimit,
      allowExternalMembers,
      joinCodeEnabled,
      instructions
    }
  };
}

function parseUpdateProjectBody(body: UpdateProjectBody):
  | {
      ok: true;
      value: {
        name?: string;
        description?: string | null;
        status?: ProjectStatus;
        accessMode?: ProjectAccessMode;
        memberLimit?: number | null;
        allowExternalMembers?: boolean;
        joinCodeEnabled?: boolean;
        instructions?: string | null;
      };
    }
  | { ok: false; error: string } {
  const name = normalizeText(body?.name);
  const description = normalizeNullableText(body?.description);
  const instructions = normalizeNullableText(body?.instructions);
  const status = parseEnumValue(ProjectStatus, body?.status);
  const accessMode = parseEnumValue(ProjectAccessMode, body?.accessMode);
  const memberLimit = normalizeNullablePositiveInteger(body?.memberLimit);
  const allowExternalMembers = normalizeBoolean(body?.allowExternalMembers);
  const joinCodeEnabled = normalizeBoolean(body?.joinCodeEnabled);

  if (name && name.length > 120) {
    return { ok: false, error: "Project name must be 120 characters or fewer." };
  }

  if (description && description.length > 500) {
    return { ok: false, error: "Project description must be 500 characters or fewer." };
  }

  if (instructions && instructions.length > 4000) {
    return { ok: false, error: "Instructions must be 4000 characters or fewer." };
  }

  if (body?.status && !status) {
    return { ok: false, error: "Choose a valid project status." };
  }

  if (body?.accessMode && !accessMode) {
    return { ok: false, error: "Choose a valid project privacy mode." };
  }

  if (memberLimit === false) {
    return { ok: false, error: "Member limit must be a whole number between 1 and 100000." };
  }

  if (allowExternalMembers === null || joinCodeEnabled === null) {
    return { ok: false, error: "Project access toggles must be true or false." };
  }

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(body?.description !== undefined ? { description } : {}),
      ...(status ? { status } : {}),
      ...(accessMode ? { accessMode } : {}),
      ...(body?.memberLimit !== undefined ? { memberLimit } : {}),
      ...(allowExternalMembers !== undefined ? { allowExternalMembers } : {}),
      ...(joinCodeEnabled !== undefined ? { joinCodeEnabled } : {}),
      ...(body?.instructions !== undefined ? { instructions } : {})
    }
  };
}

function parseProjectMemberBody(body: ProjectMemberBody):
  | {
      ok: true;
      value: {
        email: string;
        role: MembershipRole;
      };
    }
  | { ok: false; error: string } {
  const email = normalizeEmail(body?.email);
  const role = parseEnumValue(MembershipRole, body?.role) ?? MembershipRole.ANNOTATOR;

  if (!email) {
    return { ok: false, error: "Member email is required." };
  }

  if (!isValidEmail(email)) {
    return { ok: false, error: "Enter a valid member email." };
  }

  return {
    ok: true,
    value: {
      email,
      role
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

async function getUniqueProjectJoinCode() {
  const prisma = getPrismaClient();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `PRJ-${randomCodePart()}-${randomCodePart()}-${randomCodePart()}`;
    const existing = await prisma.project.findUnique({
      where: {
        joinCode: code
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      return code;
    }
  }

  throw new Error("Unable to generate a unique project join code.");
}

function randomCodePart() {
  return Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, "X");
}

const projectIncludes = {
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
  },
  projectMemberships: {
    select: {
      userId: true,
      role: true,
      status: true
    }
  },
  _count: {
    select: {
      projectMemberships: true,
      datasets: true,
      tasks: true
    }
  }
} as const;

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
  projectMemberships: {
    userId: string;
    role: MembershipRole;
    status: string;
  }[];
  _count: {
    projectMemberships: number;
    datasets: number;
    tasks: number;
  };
};

function serializeProject(project: ProjectWithRelations, currentUserId?: string) {
  const currentMembership = currentUserId
    ? project.projectMemberships.find((membership) => membership.userId === currentUserId && membership.status === "ACTIVE")
    : undefined;
  const canManage = Boolean(
    currentUserId && (project.createdById === currentUserId || (currentMembership && canManageProjectScope(currentMembership)))
  );

  return {
    id: project.id,
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    createdById: project.createdById,
    name: project.name,
    slug: project.slug,
    description: project.description,
    dataType: project.dataType,
    status: project.status,
    accessMode: project.accessMode,
    memberLimit: project.memberLimit,
    allowExternalMembers: project.allowExternalMembers,
    joinCode: project.joinCode,
    joinCodeEnabled: project.joinCodeEnabled,
    instructions: project.instructions,
    currentUserRole: currentMembership?.role ?? null,
    canManage,
    canCreateDataset: canManage,
    counts: {
      members: project._count.projectMemberships,
      datasets: project._count.datasets,
      tasks: project._count.tasks
    },
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

function normalizeNullableText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function normalizeOptionalPositiveInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return normalizePositiveInteger(value);
}

function normalizeNullablePositiveInteger(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  return normalizePositiveInteger(value);
}

function normalizePositiveInteger(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;

  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 100000) {
    return false;
  }

  return numberValue;
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
