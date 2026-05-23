import {
  getPrismaClient,
  MembershipRole,
  OrganizationType,
  PlanTier,
  type Organization,
  type Workspace
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
    include: {
      organization: true,
      workspace: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  response.status(200).json({
    organizations: memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      type: membership.organization.type,
      planTier: membership.organization.planTier,
      role: membership.role,
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

  const prisma = getPrismaClient();
  const organizationSlug = await getUniqueOrganizationSlug(parsed.value.organizationName);
  const workspaceSlug = slugify(parsed.value.workspaceName);

  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: parsed.value.organizationName,
        slug: organizationSlug,
        type: parsed.value.organizationType,
        planTier: parsed.value.planTier,
        ownerId: user.id
      }
    });

    const workspace = await tx.workspace.create({
      data: {
        name: parsed.value.workspaceName,
        slug: workspaceSlug,
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

export { router as organizationsRouter };

type CreateOrganizationBody =
  | {
      organizationName?: unknown;
      workspaceName?: unknown;
      organizationType?: unknown;
      planTier?: unknown;
    }
  | undefined;

function parseCreateOrganizationBody(body: CreateOrganizationBody):
  | {
      ok: true;
      value: {
        organizationName: string;
        workspaceName: string;
        organizationType: OrganizationType;
        planTier: PlanTier;
      };
    }
  | { ok: false; error: string } {
  const organizationName = normalizeName(body?.organizationName);
  const workspaceName = normalizeName(body?.workspaceName) ?? "Default workspace";
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

  return {
    ok: true,
    value: {
      organizationName,
      workspaceName,
      organizationType,
      planTier
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
    type: organization.type,
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

function normalizeName(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

function parseEnumValue<T extends Record<string, string>>(
  enumValues: T,
  value: unknown,
  fallback: T[keyof T]
) {
  return typeof value === "string" && Object.values(enumValues).includes(value)
    ? (value as T[keyof T])
    : fallback;
}
