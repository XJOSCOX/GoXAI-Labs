import {
  CreatorStatus,
  getPrismaClient,
  GlobalRole,
  MembershipRole,
  type Membership,
  OrganizationAccessMode,
  OrganizationType,
  PlanTier,
  type Organization,
  type Workspace
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import {
  canDeleteOrganization,
  canGrantOwnerRole,
  canManageMembers,
  canUpdateOrganization
} from "./permissions.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  let memberships = await prisma.membership.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE"
    },
    include: {
      organization: true,
      workspace: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const ownerMembershipsToRepair = memberships.filter(
    (membership) => membership.organization.ownerId === user.id && membership.role !== MembershipRole.OWNER
  );

  if (ownerMembershipsToRepair.length > 0) {
    await prisma.membership.updateMany({
      where: {
        id: {
          in: ownerMembershipsToRepair.map((membership) => membership.id)
        }
      },
      data: {
        role: MembershipRole.OWNER,
        status: "ACTIVE"
      }
    });

    memberships = await prisma.membership.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE"
      },
      include: {
        organization: true,
        workspace: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
  }

  const organizationIds = memberships.map((membership) => membership.organizationId);
  const [membershipCounts, ownerCounts, projectCounts, datasetCounts] = await Promise.all([
    prisma.membership.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: {
          in: organizationIds
        },
        status: "ACTIVE"
      },
      _count: {
        _all: true
      }
    }),
    prisma.membership.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: {
          in: organizationIds
        },
        role: "OWNER",
        status: "ACTIVE"
      },
      _count: {
        _all: true
      }
    }),
    prisma.project.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: {
          in: organizationIds
        }
      },
      _count: {
        _all: true
      }
    }),
    prisma.dataset.groupBy({
      by: ["organizationId"],
      where: {
        organizationId: {
          in: organizationIds
        }
      },
      _count: {
        _all: true
      }
    })
  ]);
  const getCount = (rows: Array<{ organizationId: string; _count: { _all: number } }>, organizationId: string) =>
    rows.find((row) => row.organizationId === organizationId)?._count._all ?? 0;

  response.status(200).json({
    organizations: memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      email: membership.organization.email,
      description: membership.organization.description,
      onboardingComplete: membership.organization.onboardingComplete,
      type: membership.organization.type,
      accessMode: membership.organization.accessMode,
      joinCodeEnabled: membership.organization.joinCodeEnabled,
      planTier: membership.organization.planTier,
      role: membership.role,
      counts: {
        owners: getCount(ownerCounts, membership.organizationId),
        members: getCount(membershipCounts, membership.organizationId),
        projects: getCount(projectCounts, membership.organizationId),
        datasets: getCount(datasetCounts, membership.organizationId)
      },
      workspace: membership.workspace
        ? {
            id: membership.workspace.id,
            name: membership.workspace.name,
            slug: membership.workspace.slug
          }
        : null,
      createdAt: membership.organization.createdAt,
      updatedAt: membership.organization.updatedAt
    }))
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCreateOrganizationBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  if (user.globalRole !== GlobalRole.SUPER_ADMIN && user.creatorStatus !== CreatorStatus.APPROVED) {
    response.status(403).json({
      error: "You need approved creator rights before creating an organization."
    });
    return;
  }

  const prisma = getPrismaClient();

  if (parsed.value.organizationEmail) {
    const existingOrganizationEmail = await prisma.organization.findUnique({
      where: {
        email: parsed.value.organizationEmail
      },
      select: {
        id: true
      }
    });

    if (existingOrganizationEmail) {
      response.status(409).json({ error: "That organization email is already in use." });
      return;
    }
  }

  const organizationSlug = await getUniqueOrganizationSlug(parsed.value.organizationName);
  const workspaceSlug = slugify(parsed.value.workspaceName);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: parsed.value.organizationName,
        slug: organizationSlug,
        email: parsed.value.organizationEmail,
        description: parsed.value.description,
        type: parsed.value.organizationType,
        accessMode: OrganizationAccessMode.INVITE_ONLY,
        joinCode: createHumanCode("ORG", 3),
        joinCodeEnabled: false,
        planTier: parsed.value.planTier,
        ownerId: user.id,
        onboardingComplete: true,
        onboardingJson: {
          createdFrom: "app",
          accessMode: OrganizationAccessMode.INVITE_ONLY,
          completed: true
        }
      }
    });

    const workspace = await tx.workspace.create({
      data: {
        name: parsed.value.workspaceName,
        slug: workspaceSlug,
        description: parsed.value.description,
        organizationId: organization.id
      }
    });

    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        workspaceId: workspace.id,
        role: MembershipRole.OWNER,
        status: "ACTIVE",
        joinedAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        userId: user.id,
        action: "organization.created",
        entityType: "organization",
        entityId: organization.id,
        metadata: {
          organizationName: organization.name,
          workspaceName: workspace.name,
          membershipId: membership.id
        }
      }
    });

    return { organization, workspace };
  });

  response.status(201).json({
    organization: serializeOrganization(result.organization),
    workspace: serializeWorkspace(result.workspace)
  });
});

router.post("/join-code", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const code = normalizeName(request.body?.code)?.toUpperCase();

  if (!code) {
    response.status(400).json({ error: "Join code is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organization = await prisma.organization.findUnique({
    where: {
      joinCode: code
    },
    include: {
      workspaces: {
        orderBy: {
          createdAt: "asc"
        },
        take: 1
      }
    }
  });

  if (!organization || !organization.joinCodeEnabled || organization.accessMode === "PRIVATE") {
    response.status(404).json({ error: "Join code is not valid or is no longer active." });
    return;
  }

  const workspace = organization.workspaces[0] ?? null;
  const membership = await prisma.$transaction(async (tx) => {
    const existing = await tx.membership.findFirst({
      where: {
        userId: user.id,
        organizationId: organization.id
      }
    });

    if (existing) {
      return tx.membership.update({
        where: {
          id: existing.id
        },
        data: {
          role: existing.role === MembershipRole.OWNER ? MembershipRole.OWNER : MembershipRole.VIEWER,
          status: "ACTIVE",
          workspaceId: existing.workspaceId ?? workspace?.id,
          joinedAt: existing.joinedAt ?? new Date()
        }
      });
    }

    const created = await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        workspaceId: workspace?.id,
        role: MembershipRole.VIEWER,
        status: "ACTIVE",
        joinedAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace?.id,
        userId: user.id,
        action: "organization.joined_with_code",
        entityType: "organization",
        entityId: organization.id,
        metadata: {
          membershipId: created.id
        }
      }
    });

    return created;
  });

  response.status(200).json({
    organization: serializeOrganization(organization),
    membershipId: membership.id
  });
});

router.get("/:organizationId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);

  if (!organizationId) {
    response.status(400).json({ error: "Organization is required." });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId,
      status: "ACTIVE"
    }
  });

  if (!membership) {
    response.status(404).json({ error: "Organization was not found or you do not have access." });
    return;
  }

  const organization = await prisma.organization.findUnique({
    where: {
      id: organizationId
    },
    include: organizationDetailIncludes
  });

  if (!organization) {
    response.status(404).json({ error: "Organization was not found." });
    return;
  }

  response.status(200).json({
    organization: serializeOrganizationDetail(organization, membership.role)
  });
});

router.patch("/:organizationId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);

  if (!organizationId) {
    response.status(400).json({ error: "Organization is required." });
    return;
  }

  const parsed = parseUpdateOrganizationBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await requireActiveMembership(user.id, organizationId);

  if (!membership || !canUpdateOrganization(membership)) {
    response.status(403).json({ error: "You need owner or admin access to edit this organization." });
    return;
  }

  if (parsed.value.email) {
    const existingOrganizationEmail = await prisma.organization.findUnique({
      where: {
        email: parsed.value.email
      },
      select: {
        id: true
      }
    });

    if (existingOrganizationEmail && existingOrganizationEmail.id !== organizationId) {
      response.status(409).json({ error: "That organization email is already in use." });
      return;
    }
  }

  const organization = await prisma.$transaction(async (tx) => {
    const { completeOnboarding, ...organizationData } = parsed.value;
    const currentOrganization = await tx.organization.findUnique({
      where: {
        id: organizationId
      },
      select: {
        joinCode: true
      }
    });
    const updated = await tx.organization.update({
      where: {
        id: organizationId
      },
      data: {
        ...organizationData,
        ...(organizationData.joinCodeEnabled === true && !currentOrganization?.joinCode
          ? { joinCode: createHumanCode("ORG", 3) }
          : {}),
        ...(completeOnboarding
          ? {
              onboardingComplete: true,
              onboardingJson: {
                completed: true,
                completedAt: new Date().toISOString(),
                completedById: user.id
              }
            }
          : {})
      },
      include: organizationDetailIncludes
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: "organization.updated",
        entityType: "organization",
        entityId: organizationId,
        metadata: parsed.value
      }
    });

    return updated;
  });

  response.status(200).json({
    organization: serializeOrganizationDetail(organization, membership.role)
  });
});

router.delete("/:organizationId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);

  if (!organizationId) {
    response.status(400).json({ error: "Organization is required." });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await requireActiveMembership(user.id, organizationId);

  if (!membership || !canDeleteOrganization(membership)) {
    response.status(403).json({ error: "Only an owner can delete an organization." });
    return;
  }

  const counts = await prisma.organization.findUnique({
    where: {
      id: organizationId
    },
    select: {
      _count: {
        select: {
          projects: true,
          datasets: true,
          assets: true
        }
      }
    }
  });

  if (!counts) {
    response.status(404).json({ error: "Organization was not found." });
    return;
  }

  if (counts._count.projects > 0 || counts._count.datasets > 0 || counts._count.assets > 0) {
    response.status(409).json({
      error: "Only empty organizations can be deleted. Archive projects and datasets instead."
    });
    return;
  }

  await prisma.organization.delete({
    where: {
      id: organizationId
    }
  });

  response.status(204).send();
});

router.post("/:organizationId/members", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);

  if (!organizationId) {
    response.status(400).json({ error: "Organization is required." });
    return;
  }

  const parsed = parseMemberBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const manager = await requireActiveMembership(user.id, organizationId);

  if (!manager || !canManageMembers(manager)) {
    response.status(403).json({ error: "You need owner or admin access to add members." });
    return;
  }

  if (parsed.value.role === MembershipRole.OWNER && !canGrantOwnerRole(manager)) {
    response.status(403).json({ error: "Only an owner can grant the owner role." });
    return;
  }

  const prisma = getPrismaClient();
  const targetUser = await prisma.user.findUnique({
    where: {
      email: parsed.value.email
    },
    select: {
      id: true
    }
  });

  if (!targetUser) {
    response.status(404).json({ error: "That user must sign up before they can be added as a member." });
    return;
  }

  if (targetUser.id === user.id) {
    response.status(409).json({
      error: "You are already part of this organization. Use ownership transfer or account settings instead of adding yourself."
    });
    return;
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      organizationId
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true
    }
  });

  const existing = await prisma.membership.findFirst({
    where: {
      userId: targetUser.id,
      organizationId
    }
  });

  const membership = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.membership.update({
          where: {
            id: existing.id
          },
          data: {
            role: parsed.value.role,
            status: "ACTIVE",
            workspaceId: existing.workspaceId ?? workspace?.id,
            joinedAt: existing.joinedAt ?? new Date()
          },
          include: membershipIncludes
        })
      : await tx.membership.create({
          data: {
            userId: targetUser.id,
            organizationId,
            workspaceId: workspace?.id,
            role: parsed.value.role,
            status: "ACTIVE",
            invitedById: user.id,
            joinedAt: new Date()
          },
          include: membershipIncludes
        });

    await tx.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: existing ? "membership.reactivated" : "membership.created",
        entityType: "membership",
        entityId: saved.id,
        metadata: {
          email: parsed.value.email,
          role: parsed.value.role
        }
      }
    });

    return saved;
  });

  response.status(existing ? 200 : 201).json({
    membership: serializeMembership(membership)
  });
});

router.patch("/:organizationId/members/:membershipId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);
  const membershipId = normalizeId(request.params.membershipId);

  if (!organizationId || !membershipId) {
    response.status(400).json({ error: "Organization and membership are required." });
    return;
  }

  const parsed = parseMemberBody(request.body, false);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const manager = await requireActiveMembership(user.id, organizationId);

  if (!manager || !canManageMembers(manager)) {
    response.status(403).json({ error: "You need owner or admin access to edit members." });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      id: membershipId,
      organizationId
    }
  });

  if (!membership) {
    response.status(404).json({ error: "Membership was not found." });
    return;
  }

  if (membership.userId === user.id) {
    response.status(409).json({
      error: "You cannot edit your own organization membership. Ask another owner to make role changes or transfer ownership."
    });
    return;
  }

  if ((membership.role === MembershipRole.OWNER || parsed.value.role === MembershipRole.OWNER) && !canGrantOwnerRole(manager)) {
    response.status(403).json({ error: "Only an owner can grant or remove the owner role." });
    return;
  }

  if (membership.role === MembershipRole.OWNER && parsed.value.role !== MembershipRole.OWNER) {
    const ownerCount = await prisma.membership.count({
      where: {
        organizationId,
        status: "ACTIVE",
        role: MembershipRole.OWNER
      }
    });

    if (ownerCount <= 1) {
      response.status(409).json({ error: "An organization must keep at least one owner." });
      return;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: {
        id: organizationId
      },
      select: {
        ownerId: true
      }
    });

    if (
      organization?.ownerId === membership.userId &&
      membership.role === MembershipRole.OWNER &&
      parsed.value.role !== MembershipRole.OWNER
    ) {
      const replacementOwner = await tx.membership.findFirst({
        where: {
          organizationId,
          status: "ACTIVE",
          role: MembershipRole.OWNER,
          userId: {
            not: membership.userId
          }
        },
        orderBy: {
          createdAt: "asc"
        },
        select: {
          userId: true
        }
      });

      if (replacementOwner) {
        await tx.organization.update({
          where: {
            id: organizationId
          },
          data: {
            ownerId: replacementOwner.userId
          }
        });
      }
    }

    return tx.membership.update({
      where: {
        id: membershipId
      },
      data: {
        role: parsed.value.role
      },
      include: membershipIncludes
    });
  });

  response.status(200).json({
    membership: serializeMembership(updated)
  });
});

router.delete("/:organizationId/members/:membershipId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const organizationId = normalizeId(request.params.organizationId);
  const membershipId = normalizeId(request.params.membershipId);

  if (!organizationId || !membershipId) {
    response.status(400).json({ error: "Organization and membership are required." });
    return;
  }

  const manager = await requireActiveMembership(user.id, organizationId);

  if (!manager || !canManageMembers(manager)) {
    response.status(403).json({ error: "You need owner or admin access to remove members." });
    return;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      id: membershipId,
      organizationId
    }
  });

  if (!membership) {
    response.status(404).json({ error: "Membership was not found." });
    return;
  }

  if (membership.role === MembershipRole.OWNER && !canGrantOwnerRole(manager)) {
    response.status(403).json({ error: "Only an owner can remove another owner." });
    return;
  }

  if (membership.userId === user.id && membership.role === MembershipRole.OWNER) {
    response.status(409).json({
      error: "Organization owners cannot remove themselves. Add or choose another owner to transfer ownership."
    });
    return;
  }

  if (membership.role === MembershipRole.OWNER) {
    const ownerCount = await prisma.membership.count({
      where: {
        organizationId,
        status: "ACTIVE",
        role: MembershipRole.OWNER
      }
    });

    if (ownerCount <= 1) {
      response.status(409).json({ error: "An organization must keep at least one owner." });
      return;
    }
  }

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: {
        id: organizationId
      },
      select: {
        ownerId: true
      }
    });

    if (organization?.ownerId === membership.userId && membership.role === MembershipRole.OWNER) {
      const replacementOwner = await tx.membership.findFirst({
        where: {
          organizationId,
          status: "ACTIVE",
          role: MembershipRole.OWNER,
          userId: {
            not: membership.userId
          }
        },
        orderBy: {
          createdAt: "asc"
        },
        select: {
          userId: true
        }
      });

      if (replacementOwner) {
        await tx.organization.update({
          where: {
            id: organizationId
          },
          data: {
            ownerId: replacementOwner.userId
          }
        });
      }
    }

    await tx.membership.update({
      where: {
        id: membershipId
      },
      data: {
        status: "REMOVED"
      }
    });
  });

  response.status(204).send();
});

export { router as organizationsRouter };

type CreateOrganizationBody =
  | {
      organizationName?: unknown;
      workspaceName?: unknown;
      organizationEmail?: unknown;
      description?: unknown;
      organizationType?: unknown;
      planTier?: unknown;
    }
  | undefined;

type UpdateOrganizationBody =
  | {
      name?: unknown;
      email?: unknown;
      description?: unknown;
      type?: unknown;
      accessMode?: unknown;
      joinCodeEnabled?: unknown;
      planTier?: unknown;
      completeOnboarding?: unknown;
    }
  | undefined;

type MemberBody =
  | {
      email?: unknown;
      role?: unknown;
    }
  | undefined;

function parseCreateOrganizationBody(body: CreateOrganizationBody):
  | {
      ok: true;
      value: {
        organizationName: string;
        workspaceName: string;
        organizationEmail?: string;
        description?: string;
        organizationType: OrganizationType;
        planTier: PlanTier;
      };
    }
  | { ok: false; error: string } {
  const organizationName = normalizeName(body?.organizationName);
  const workspaceName = normalizeName(body?.workspaceName) ?? "Default workspace";
  const organizationEmail = normalizeEmail(body?.organizationEmail);
  const description = normalizeLongText(body?.description);
  const organizationType = parseEnumValue(OrganizationType, body?.organizationType, OrganizationType.COMPANY);
  const planTier = parseEnumValue(PlanTier, body?.planTier, PlanTier.FREE);

  if (!organizationName) {
    return { ok: false, error: "Organization name is required." };
  }

  if (organizationName.length > 120) {
    return { ok: false, error: "Organization name must be 120 characters or fewer." };
  }

  if (workspaceName.length > 120) {
    return { ok: false, error: "Workspace name must be 120 characters or fewer." };
  }

  if (organizationEmail && !isValidEmail(organizationEmail)) {
    return { ok: false, error: "Enter a valid organization email." };
  }

  if (description && description.length > 800) {
    return { ok: false, error: "Organization description must be 800 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      organizationName,
      workspaceName,
      organizationEmail,
      description,
      organizationType,
      planTier
    }
  };
}

function parseUpdateOrganizationBody(body: UpdateOrganizationBody):
  | {
      ok: true;
      value: {
        name?: string;
        email?: string | null;
        description?: string | null;
        type?: OrganizationType;
        accessMode?: OrganizationAccessMode;
        joinCodeEnabled?: boolean;
        planTier?: PlanTier;
        completeOnboarding?: boolean;
      };
    }
  | { ok: false; error: string } {
  const name = normalizeName(body?.name);
  const email = normalizeNullableEmail(body?.email);
  const description = normalizeNullableLongText(body?.description);
  const type = parseOptionalEnumValue(OrganizationType, body?.type);
  const accessMode = parseOptionalEnumValue(OrganizationAccessMode, body?.accessMode);
  const joinCodeEnabled = typeof body?.joinCodeEnabled === "boolean" ? body.joinCodeEnabled : undefined;
  const planTier = parseOptionalEnumValue(PlanTier, body?.planTier);
  const completeOnboarding = body?.completeOnboarding === true;

  if (name && name.length > 120) {
    return { ok: false, error: "Organization name must be 120 characters or fewer." };
  }

  if (body?.type && !type) {
    return { ok: false, error: "Choose a valid organization type." };
  }

  if (body?.accessMode && !accessMode) {
    return { ok: false, error: "Choose a valid organization access mode." };
  }

  if (email === false) {
    return { ok: false, error: "Enter a valid organization email." };
  }

  if (description === false) {
    return { ok: false, error: "Organization description must be 800 characters or fewer." };
  }

  if (body?.planTier && !planTier) {
    return { ok: false, error: "Choose a valid plan tier." };
  }

  return {
    ok: true,
    value: {
      ...(name ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(type ? { type } : {}),
      ...(accessMode ? { accessMode } : {}),
      ...(joinCodeEnabled !== undefined ? { joinCodeEnabled } : {}),
      ...(planTier ? { planTier } : {}),
      ...(completeOnboarding ? { completeOnboarding } : {})
    }
  };
}

function parseMemberBody(body: MemberBody, requireEmail = true):
  | {
      ok: true;
      value: {
        email?: string;
        role: MembershipRole;
      };
    }
  | { ok: false; error: string } {
  const email = normalizeEmail(body?.email);
  const role = parseOptionalEnumValue(MembershipRole, body?.role);

  if (requireEmail && !email) {
    return { ok: false, error: "Member email is required." };
  }

  if (!role) {
    return { ok: false, error: "Choose a valid member role." };
  }

  return {
    ok: true,
    value: {
      email,
      role
    }
  };
}

async function getUniqueOrganizationSlug(name: string) {
  const prisma = getPrismaClient();
  const base = slugify(name);
  let slug = base;
  let suffix = 1;

  while (await prisma.organization.findUnique({ where: { slug } })) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }

  return slug;
}

function serializeOrganization(organization: Organization) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    email: organization.email,
    description: organization.description,
    onboardingComplete: organization.onboardingComplete,
    type: organization.type,
    accessMode: organization.accessMode,
    joinCode: organization.joinCode,
    joinCodeEnabled: organization.joinCodeEnabled,
    planTier: organization.planTier,
    ownerId: organization.ownerId,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt
  };
}

function serializeWorkspace(workspace: Workspace) {
  return {
    id: workspace.id,
    organizationId: workspace.organizationId,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
}

const membershipIncludes = {
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true
    }
  },
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  }
} as const;

const organizationDetailIncludes = {
  _count: {
    select: {
      datasets: true,
      memberships: {
        where: {
          status: "ACTIVE"
        }
      },
      projects: true
    }
  },
  workspaces: true,
  memberships: {
    where: {
      status: "ACTIVE"
    },
    include: membershipIncludes,
    orderBy: {
      createdAt: "asc"
    }
  }
} as const;

type OrganizationDetail = Organization & {
  workspaces: Workspace[];
  _count: {
    datasets: number;
    memberships: number;
    projects: number;
  };
  memberships: Array<Membership & {
    user: {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
    };
    workspace: {
      id: string;
      name: string;
      slug: string;
    } | null;
  }>;
};

type MembershipWithUser = Membership & {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
};

function serializeOrganizationDetail(organization: OrganizationDetail, currentUserRole: MembershipRole) {
  return {
    ...serializeOrganization(organization),
    currentUserRole,
    counts: {
      owners: organization.memberships.filter((membership) => membership.role === MembershipRole.OWNER).length,
      members: organization._count.memberships,
      projects: organization._count.projects,
      datasets: organization._count.datasets
    },
    workspaces: organization.workspaces.map(serializeWorkspace),
    memberships: organization.memberships.map(serializeMembership)
  };
}

function serializeMembership(membership: MembershipWithUser) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    workspaceId: membership.workspaceId,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.joinedAt,
    user: {
      id: membership.user.id,
      email: membership.user.email,
      name: [membership.user.firstName, membership.user.lastName].filter(Boolean).join(" ") || membership.user.email
    },
    workspace: membership.workspace,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt
  };
}

async function requireActiveMembership(userId: string, organizationId: string) {
  const prisma = getPrismaClient();

  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      organizationId,
      status: "ACTIVE"
    }
  });

  if (!membership) {
    return null;
  }

  const organization = await prisma.organization.findUnique({
    where: {
      id: organizationId
    },
    select: {
      ownerId: true
    }
  });

  if (organization?.ownerId === userId && membership.role !== MembershipRole.OWNER) {
    return prisma.membership.update({
      where: {
        id: membership.id
      },
      data: {
        role: MembershipRole.OWNER,
        status: "ACTIVE"
      }
    });
  }

  return membership;
}

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : undefined;
}

function normalizeNullableEmail(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return false;
  }

  const email = value.trim().toLowerCase();

  if (!email) {
    return null;
  }

  return isValidEmail(email) ? email : false;
}

function normalizeLongText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeNullableLongText(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    return false;
  }

  const text = value.trim();

  if (!text) {
    return null;
  }

  return text.length <= 800 ? text : false;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 72) || "workspace"
  );
}

function createHumanCode(prefix: string, groups: number) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(groups * 5);
  globalThis.crypto.getRandomValues(bytes);
  const chunks: string[] = [];

  for (let groupIndex = 0; groupIndex < groups; groupIndex += 1) {
    let chunk = "";

    for (let offset = 0; offset < 5; offset += 1) {
      chunk += alphabet[bytes[groupIndex * 5 + offset] % alphabet.length];
    }

    chunks.push(chunk);
  }

  return [prefix, ...chunks].join("-");
}

function parseEnumValue<T extends Record<string, string>>(
  enumValues: T,
  value: unknown,
  fallback: T[keyof T]
) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : fallback;
}

function parseOptionalEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : undefined;
}
