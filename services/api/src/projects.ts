import {
  AnnotationTool,
  CreatorStatus,
  DataType,
  getPrismaClient,
  GlobalRole,
  MembershipRole,
  Prisma,
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

  const serializedProjects = projects
    .map((project) => serializeProject(project, user.id))
    .filter((project) => project.canManage || project.status === ProjectStatus.ACTIVE);

  response.status(200).json({
    projects: serializedProjects
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

  const serializedProject = serializeProject(project, user.id);

  if (!serializedProject.canManage && serializedProject.status !== ProjectStatus.ACTIVE) {
    response.status(404).json({ error: "Project was not found or you do not have access." });
    return;
  }

  response.status(200).json({
    project: serializedProject
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
        annotationTemplateId: parsed.value.annotationTemplateId,
        instructions: parsed.value.instructions,
        labelingConfig: parsed.value.labelingConfig,
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

    await syncProjectLabels(tx, createdProject.id, parsed.value.labels);
    await syncProjectTools(tx, createdProject.id, parsed.value.tools);

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
    const { labels, tools, ...projectValues } = parsed.value;
    const data = {
      ...projectValues,
      ...(parsed.value.joinCodeEnabled === true && !project.joinCode ? { joinCode: await getUniqueProjectJoinCode() } : {})
    };
    const saved = await tx.project.update({
      where: {
        id: project.id
      },
      data,
      include: projectIncludes
    });

    if (labels) {
      await syncProjectLabels(tx, saved.id, labels);
    }

    if (tools) {
      await syncProjectTools(tx, saved.id, tools);
    }

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
      annotationTemplateId?: unknown;
      name?: unknown;
      description?: unknown;
      dataType?: unknown;
      accessMode?: unknown;
      memberLimit?: unknown;
      allowExternalMembers?: unknown;
      joinCodeEnabled?: unknown;
      instructions?: unknown;
      labelingConfig?: unknown;
      labels?: unknown;
      tools?: unknown;
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
      labelingConfig?: unknown;
      labels?: unknown;
      tools?: unknown;
    }
  | undefined;

type ProjectMemberBody =
  | {
      email?: unknown;
      role?: unknown;
    }
  | undefined;

type ParsedProjectLabel = {
  color: string;
  metadata?: Prisma.InputJsonObject;
  name: string;
  shortcutKey?: string;
};

type ParsedProjectTool = {
  configJson?: Prisma.InputJsonObject;
  enabled: boolean;
  tool: AnnotationTool;
};

function parseCreateProjectBody(body: CreateProjectBody):
  | {
      ok: true;
      value: {
        organizationId: string;
        workspaceId?: string;
        annotationTemplateId?: string;
        name: string;
        description?: string;
        dataType: DataType;
        accessMode: ProjectAccessMode;
        memberLimit?: number;
        allowExternalMembers: boolean;
        joinCodeEnabled: boolean;
        instructions?: string;
        labelingConfig?: Prisma.InputJsonObject;
        labels: ParsedProjectLabel[];
        tools: ParsedProjectTool[];
      };
    }
  | { ok: false; error: string } {
  const organizationId = normalizeId(body?.organizationId);
  const workspaceId = normalizeId(body?.workspaceId);
  const annotationTemplateId = normalizeId(body?.annotationTemplateId);
  const name = normalizeText(body?.name);
  const description = normalizeText(body?.description);
  const dataType = parseEnumValue(DataType, body?.dataType);
  const accessMode = parseEnumValue(ProjectAccessMode, body?.accessMode) ?? ProjectAccessMode.ORGANIZATION;
  const memberLimit = normalizeOptionalPositiveInteger(body?.memberLimit);
  const allowExternalMembers = normalizeBoolean(body?.allowExternalMembers) ?? false;
  const joinCodeEnabled = normalizeBoolean(body?.joinCodeEnabled) ?? false;
  const instructions = normalizeText(body?.instructions);
  const labelingConfig = parseLabelingConfig(body?.labelingConfig, false);
  const projectConfig = parseProjectAnnotationConfig(body?.labels, body?.tools, body?.labelingConfig, dataType);

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

  if (!labelingConfig.ok) {
    return { ok: false, error: labelingConfig.error };
  }

  if (!projectConfig.ok) {
    return { ok: false, error: projectConfig.error };
  }

  return {
    ok: true,
    value: {
      organizationId,
      workspaceId,
      annotationTemplateId,
      name,
      description,
      dataType,
      accessMode,
      memberLimit,
      allowExternalMembers,
      joinCodeEnabled,
      instructions,
      labelingConfig: labelingConfig.value ?? undefined,
      labels: projectConfig.labels,
      tools: projectConfig.tools
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
        labelingConfig?: Prisma.InputJsonObject;
        labels?: ParsedProjectLabel[];
        tools?: ParsedProjectTool[];
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
  const labelingConfig = parseLabelingConfig(body?.labelingConfig, true);
  const projectConfig = parseProjectAnnotationConfig(body?.labels, body?.tools, body?.labelingConfig, undefined);

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

  if (!labelingConfig.ok) {
    return { ok: false, error: labelingConfig.error };
  }

  if (!projectConfig.ok) {
    return { ok: false, error: projectConfig.error };
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
      ...(body?.instructions !== undefined ? { instructions } : {}),
      ...(body?.labelingConfig !== undefined ? { labelingConfig: labelingConfig.value } : {}),
      ...(body?.labelingConfig !== undefined || body?.labels !== undefined ? { labels: projectConfig.labels } : {}),
      ...(body?.labelingConfig !== undefined || body?.tools !== undefined ? { tools: projectConfig.tools } : {})
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

function parseProjectAnnotationConfig(
  labelsInput: unknown,
  toolsInput: unknown,
  configInput: unknown,
  dataType: DataType | undefined
): { ok: true; labels: ParsedProjectLabel[]; tools: ParsedProjectTool[] } | { ok: false; error: string } {
  const config = isRecord(configInput) ? configInput : {};
  const labelSource = labelsInput ?? config.labels ?? [];
  const toolSource = toolsInput ?? config.tools;
  const labels = parseProjectLabels(labelSource);
  const tools = parseProjectTools(toolSource, dataType);

  if (!labels.ok) {
    return labels;
  }

  if (!tools.ok) {
    return tools;
  }

  return {
    ok: true,
    labels: labels.value,
    tools: tools.value
  };
}

function parseProjectLabels(value: unknown): { ok: true; value: ParsedProjectLabel[] } | { ok: false; error: string } {
  const rawLabels = Array.isArray(value) ? value : [];
  const labels: ParsedProjectLabel[] = [];

  rawLabels.forEach((label, index) => {
    if (typeof label === "string") {
      const name = label.trim();

      if (name) {
        labels.push({
          color: defaultLabelColors[index % defaultLabelColors.length],
          name,
          shortcutKey: getShortcutKey(index)
        });
      }

      return;
    }

    if (!isRecord(label)) {
      return;
    }

    const name = normalizeText(label.name);

    if (!name) {
      return;
    }

    const color = normalizeText(label.color) ?? defaultLabelColors[index % defaultLabelColors.length];
    const shortcutKey = normalizeText(label.shortcutKey) ?? getShortcutKey(index);
    const metadata = isRecord(label.metadata) ? (label.metadata as Prisma.InputJsonObject) : undefined;

    labels.push({
      color,
      metadata,
      name,
      shortcutKey
    });
  });

  if (labels.length > 50) {
    return { ok: false, error: "A project can have up to 50 labels." };
  }

  if (labels.some((label) => label.name.length > 60)) {
    return { ok: false, error: "Label names must be 60 characters or fewer." };
  }

  const names = new Set(labels.map((label) => label.name.toLowerCase()));

  if (names.size !== labels.length) {
    return { ok: false, error: "Project labels must be unique." };
  }

  return {
    ok: true,
    value: labels
  };
}

function parseProjectTools(
  value: unknown,
  dataType: DataType | undefined
): { ok: true; value: ParsedProjectTool[] } | { ok: false; error: string } {
  const source = Array.isArray(value) && value.length > 0 ? value : getDefaultToolsForDataType(dataType);
  const tools = source
    .map((toolInput) => {
      if (typeof toolInput === "string") {
        const tool = parseEnumValue(AnnotationTool, toolInput);

        return tool
          ? {
              enabled: true,
              tool
            }
          : null;
      }

      if (!isRecord(toolInput)) {
        return null;
      }

      const tool = parseEnumValue(AnnotationTool, toolInput.tool);

      if (!tool) {
        return null;
      }

      return {
        configJson: isRecord(toolInput.configJson) ? (toolInput.configJson as Prisma.InputJsonObject) : undefined,
        enabled: normalizeBoolean(toolInput.enabled) ?? true,
        tool
      };
    })
    .filter((tool): tool is ParsedProjectTool => Boolean(tool));

  if (tools.length === 0) {
    return { ok: false, error: "Choose at least one annotation tool." };
  }

  const uniqueTools = new Map<AnnotationTool, ParsedProjectTool>();

  for (const tool of tools) {
    uniqueTools.set(tool.tool, tool);
  }

  return {
    ok: true,
    value: [...uniqueTools.values()]
  };
}

async function syncProjectLabels(
  tx: Prisma.TransactionClient,
  projectId: string,
  labels: ParsedProjectLabel[]
) {
  await tx.projectLabel.deleteMany({
    where: {
      projectId
    }
  });

  if (labels.length > 0) {
    await tx.projectLabel.createMany({
      data: labels.map((label) => ({
        color: label.color,
        metadata: label.metadata,
        name: label.name,
        projectId,
        shortcutKey: label.shortcutKey
      }))
    });
  }
}

async function syncProjectTools(
  tx: Prisma.TransactionClient,
  projectId: string,
  tools: ParsedProjectTool[]
) {
  await tx.projectTool.deleteMany({
    where: {
      projectId
    }
  });

  await tx.projectTool.createMany({
    data: tools.map((tool) => ({
      configJson: tool.configJson,
      enabled: tool.enabled,
      projectId,
      tool: tool.tool
    }))
  });
}

function getDefaultToolsForDataType(dataType: DataType | undefined) {
  if (dataType === DataType.TEXT || dataType === DataType.PDF) {
    return [AnnotationTool.TEXT_SPAN, AnnotationTool.CLASSIFICATION];
  }

  if (dataType === DataType.AUDIO) {
    return [AnnotationTool.AUDIO_REGION, AnnotationTool.CLASSIFICATION];
  }

  if (dataType === DataType.VIDEO) {
    return [AnnotationTool.BBOX, AnnotationTool.POLYGON, AnnotationTool.VIDEO_REGION];
  }

  if (dataType === DataType.TIME_SERIES) {
    return [AnnotationTool.TIMESERIES_RANGE, AnnotationTool.CLASSIFICATION];
  }

  return [AnnotationTool.BBOX];
}

function getShortcutKey(index: number) {
  return index >= 0 && index < 9 ? String(index + 1) : undefined;
}

function parseLabelingConfig(value: unknown, nullable: boolean):
  | { ok: true; value?: Prisma.InputJsonObject }
  | { ok: false; error: string } {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === null) {
    return nullable ? { ok: true, value: { labels: [] } } : { ok: true, value: undefined };
  }

  if (!isRecord(value)) {
    return { ok: false, error: "Labeling config must be an object." };
  }

  const labels = Array.isArray(value.labels) ? value.labels : [];
  const parsedLabels = labels
    .map((label) => {
      if (typeof label === "string") {
        return {
          name: label.trim()
        };
      }

      if (!isRecord(label)) {
        return null;
      }

      const name = normalizeText(label.name);
      const color = normalizeText(label.color);

      return name
        ? {
            name,
            ...(color ? { color } : {})
          }
        : null;
    })
    .filter((label): label is { color?: string; name: string } => Boolean(label));

  if (parsedLabels.length > 50) {
    return { ok: false, error: "A project can have up to 50 labels." };
  }

  if (parsedLabels.some((label) => label.name.length > 60)) {
    return { ok: false, error: "Label names must be 60 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      labels: parsedLabels
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

const defaultLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

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
  labels: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      name: true,
      color: true,
      shortcutKey: true,
      metadata: true,
      createdAt: true,
      updatedAt: true
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
      configJson: true,
      createdAt: true,
      updatedAt: true
    }
  },
  annotationTemplate: {
    select: {
      id: true,
      name: true,
      description: true,
      dataType: true,
      configJson: true
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
  labels: {
    id: string;
    name: string;
    color: string;
    shortcutKey: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }[];
  tools: {
    id: string;
    tool: AnnotationTool;
    enabled: boolean;
    configJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  }[];
  annotationTemplate: {
    id: string;
    name: string;
    description: string | null;
    dataType: DataType;
    configJson: unknown;
  } | null;
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
    annotationTemplateId: project.annotationTemplateId,
    instructions: project.instructions,
    labelingConfig: project.labelingConfig as Record<string, unknown> | null,
    annotationTemplate: project.annotationTemplate,
    labels: project.labels,
    tools: project.tools,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
