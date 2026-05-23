import {
  createSupabaseUserClient,
  getPrismaClient,
  getSupabaseConfig,
  GlobalRole,
  MembershipRole,
  OrganizationType,
  PlanTier
} from "@goxai/database";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  currentUser?: Awaited<ReturnType<typeof syncUserFromAccessToken>>;
}

export async function getUserFromAccessToken(accessToken: string) {
  const config = getSupabaseConfig();
  const supabase = createSupabaseUserClient(accessToken, config);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    throw error;
  }

  return data.user;
}

export async function syncUserFromAccessToken(accessToken: string) {
  const authUser = await getUserFromAccessToken(accessToken);

  if (!authUser.email) {
    throw new Error("Supabase user is missing an email address.");
  }

  const prisma = getPrismaClient();
  const profile = getUserProfile(authUser);
  const now = new Date();
  const [userCount, superAdminCount, existingUser, firstUser] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: {
        globalRole: GlobalRole.SUPER_ADMIN
      }
    }),
    prisma.user.findUnique({
      where: {
        supabaseAuthId: authUser.id
      },
      select: {
        id: true
      }
    }),
    prisma.user.findFirst({
      orderBy: {
        createdAt: "asc"
      },
      select: {
        id: true
      }
    })
  ]);
  const shouldBootstrapOwner =
    userCount === 0 || (superAdminCount === 0 && existingUser?.id === firstUser?.id);

  const user = await prisma.user.upsert({
    where: {
      supabaseAuthId: authUser.id
    },
    create: {
      supabaseAuthId: authUser.id,
      email: authUser.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      jobTitle: profile.jobTitle,
      avatarUrl: profile.avatarUrl,
      globalRole: shouldBootstrapOwner ? GlobalRole.SUPER_ADMIN : GlobalRole.USER,
      lastLoginAt: now
    },
    update: {
      email: authUser.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      jobTitle: profile.jobTitle,
      avatarUrl: profile.avatarUrl,
      ...(shouldBootstrapOwner ? { globalRole: GlobalRole.SUPER_ADMIN } : {}),
      lastLoginAt: now
    }
  });

  await createSignupOrganizationIfNeeded(user.id, authUser.user_metadata);

  return user;
}

export function getBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || null;
}

export async function requireAuthenticatedUser(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
) {
  const accessToken = getBearerToken(request.header("authorization"));

  if (!accessToken) {
    response.status(401).json({
      error: "Missing bearer token."
    });
    return;
  }

  try {
    request.currentUser = await syncUserFromAccessToken(accessToken);
    next();
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Unable to verify Supabase token."
    });
  }
}

function getUserProfile(user: {
  user_metadata: Record<string, unknown>;
}) {
  const metadata = user.user_metadata;
  const fullName = getMetadataString(metadata.name) ?? getMetadataString(metadata.full_name);
  const [firstFromName, ...restFromName] = fullName?.split(" ").filter(Boolean) ?? [];
  const lastName = getMetadataString(metadata.last_name) ?? restFromName.join(" ");

  return {
    firstName: getMetadataString(metadata.first_name) ?? firstFromName,
    lastName: lastName || undefined,
    jobTitle: getMetadataString(metadata.job_title),
    avatarUrl: getMetadataString(metadata.avatar_url) ?? getMetadataString(metadata.picture)
  };
}

function getMetadataString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

async function createSignupOrganizationIfNeeded(userId: string, metadata: Record<string, unknown>) {
  if (getMetadataString(metadata.signup_type) !== "organization") {
    return;
  }

  const organizationName = getMetadataString(metadata.organization_name);

  if (!organizationName) {
    return;
  }

  const prisma = getPrismaClient();
  const existingMembership = await prisma.membership.findFirst({
    where: {
      userId,
      status: "ACTIVE"
    },
    select: {
      id: true
    }
  });

  if (existingMembership) {
    return;
  }

  const organizationEmail = normalizeEmail(getMetadataString(metadata.organization_email));

  if (organizationEmail) {
    const existingOrganizationEmail = await prisma.organization.findUnique({
      where: {
        email: organizationEmail
      },
      select: {
        id: true
      }
    });

    if (existingOrganizationEmail) {
      throw new Error("That organization email is already in use.");
    }
  }

  const organizationSlug = await getUniqueOrganizationSlug(organizationName);
  const workspaceName = getMetadataString(metadata.workspace_name) ?? "Main workspace";
  const workspaceSlug = slugify(workspaceName);
  const organizationType = parseEnumValue(
    OrganizationType,
    getMetadataString(metadata.organization_type),
    OrganizationType.COMPANY
  );
  const planTier = parseEnumValue(PlanTier, getMetadataString(metadata.plan_tier), PlanTier.FREE);
  const organizationDescription = getMetadataString(metadata.organization_description);
  const jobTitle = getMetadataString(metadata.job_title);

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: organizationName,
        slug: organizationSlug,
        email: organizationEmail,
        description: organizationDescription,
        type: organizationType,
        planTier,
        ownerId: userId,
        onboardingComplete: false,
        onboardingJson: {
          signupType: "organization",
          founderTitle: jobTitle,
          organizationEmail,
          createdFrom: "signup",
          completed: false
        }
      }
    });

    const workspace = await tx.workspace.create({
      data: {
        name: workspaceName,
        slug: workspaceSlug,
        description: organizationDescription,
        organizationId: organization.id
      }
    });

    const membership = await tx.membership.create({
      data: {
        userId,
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
        userId,
        action: "organization.created_from_signup",
        entityType: "organization",
        entityId: organization.id,
        metadata: {
          organizationName,
          organizationEmail,
          membershipId: membership.id
        }
      }
    });
  });
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

function normalizeEmail(value: string | undefined) {
  return value?.toLowerCase();
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
  value: string | undefined,
  fallback: T[keyof T]
) {
  return value && Object.values(enumValues).includes(value) ? (value as T[keyof T]) : fallback;
}
