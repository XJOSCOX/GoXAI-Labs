import {
  ApplicationStatus,
  CreatorStatus,
  getPrismaClient,
  GlobalRole,
  UserStatus,
  VerificationStatus
} from "@goxai/database";
import { Router, type NextFunction, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId } from "./logging.js";

const router = Router();

router.use(requireAuthenticatedUser);
router.use(requireSuperAdmin);

router.get("/overview", async (_request: AuthenticatedRequest, response) => {
  const prisma = getPrismaClient();
  const [users, verificationApplications, creatorApplications, counts] = await Promise.all([
    prisma.user.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 80,
      select: userSelect
    }),
    prisma.verificationApplication.findMany({
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    prisma.creatorApplication.findMany({
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.VERIFIED } }),
      prisma.user.count({ where: { creatorStatus: CreatorStatus.PENDING } }),
      prisma.user.count({ where: { creatorStatus: CreatorStatus.APPROVED } }),
      prisma.organization.count(),
      prisma.project.count(),
      prisma.dataset.count()
    ])
  ]);

  response.status(200).json({
    counts: {
      users: counts[0],
      pendingVerification: counts[1],
      verifiedUsers: counts[2],
      pendingCreators: counts[3],
      approvedCreators: counts[4],
      organizations: counts[5],
      projects: counts[6],
      datasets: counts[7]
    },
    users: users.map(serializeAdminUser),
    verificationApplications: verificationApplications.map((application) => serializeAdminApplication(application, "verification")),
    creatorApplications: creatorApplications.map((application) => serializeAdminApplication(application, "creator"))
  });
});

router.patch("/users/:userId", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const userId = normalizeId(request.params.userId);

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!userId) {
    response.status(400).json({ error: "User is required." });
    return;
  }

  const parsed = parseUserUpdate(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const updated = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      ...parsed.value,
      ...(parsed.value.verificationStatus === VerificationStatus.VERIFIED
        ? { isVerified: true, verifiedAt: new Date(), verifiedById: admin.id }
        : {}),
      ...(parsed.value.verificationStatus && parsed.value.verificationStatus !== VerificationStatus.VERIFIED
        ? { isVerified: false, verifiedAt: null, verifiedById: null }
        : {})
    },
    select: userSelect
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "admin.user.updated",
      entityType: "user",
      entityId: updated.id,
      metadata: {
        requestId: getRequestId(request),
        update: parsed.value
      }
    }
  });

  response.status(200).json({
    user: serializeAdminUser(updated)
  });
});

router.post("/applications/:type/:applicationId/:decision", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const type = request.params.type;
  const applicationId = normalizeId(request.params.applicationId);
  const decision = request.params.decision;
  const reviewerNotes = normalizeText(request.body?.reviewerNotes) ?? null;

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (type !== "verification" && type !== "creator") {
    response.status(400).json({ error: "Application type must be verification or creator." });
    return;
  }

  if (!applicationId) {
    response.status(400).json({ error: "Application is required." });
    return;
  }

  if (decision !== "approve" && decision !== "reject") {
    response.status(400).json({ error: "Decision must be approve or reject." });
    return;
  }

  const prisma = getPrismaClient();
  const reviewedAt = new Date();
  const nextStatus = decision === "approve" ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED;

  if (type === "verification") {
    const application = await prisma.verificationApplication.findUnique({
      where: {
        id: applicationId
      }
    });

    if (!application) {
      response.status(404).json({ error: "Verification application was not found." });
      return;
    }

    const saved = await prisma.$transaction(async (tx) => {
      const reviewed = await tx.verificationApplication.update({
        where: {
          id: application.id
        },
        data: {
          status: nextStatus,
          reviewerId: admin.id,
          reviewerNotes,
          reviewedAt
        },
        include: {
          user: {
            select: userSelect
          }
        }
      });

      await tx.user.update({
        where: {
          id: application.userId
        },
        data:
          decision === "approve"
            ? {
                isVerified: true,
                verificationStatus: VerificationStatus.VERIFIED,
                verifiedAt: reviewedAt,
                verifiedById: admin.id
              }
            : {
                isVerified: false,
                verificationStatus: VerificationStatus.REJECTED,
                verifiedAt: null,
                verifiedById: null
              }
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: `verification_application.${decision === "approve" ? "approved" : "rejected"}`,
          entityType: "verification_application",
          entityId: application.id,
          metadata: {
            requestId: getRequestId(request),
            applicantId: application.userId
          }
        }
      });

      return reviewed;
    });

    response.status(200).json({
      application: serializeAdminApplication(saved, "verification")
    });
    return;
  }

  const application = await prisma.creatorApplication.findUnique({
    where: {
      id: applicationId
    }
  });

  if (!application) {
    response.status(404).json({ error: "Creator application was not found." });
    return;
  }

  const saved = await prisma.$transaction(async (tx) => {
    const reviewed = await tx.creatorApplication.update({
      where: {
        id: application.id
      },
      data: {
        status: nextStatus,
        reviewerId: admin.id,
        reviewerNotes,
        reviewedAt
      },
      include: {
        user: {
          select: userSelect
        }
      }
    });

    await tx.user.update({
      where: {
        id: application.userId
      },
      data: {
        creatorStatus: decision === "approve" ? CreatorStatus.APPROVED : CreatorStatus.REJECTED
      }
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: `creator_application.${decision === "approve" ? "approved" : "rejected"}`,
        entityType: "creator_application",
        entityId: application.id,
        metadata: {
          requestId: getRequestId(request),
          applicantId: application.userId
        }
      }
    });

    return reviewed;
  });

  response.status(200).json({
    application: serializeAdminApplication(saved, "creator")
  });
});

function requireSuperAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (user.globalRole !== GlobalRole.SUPER_ADMIN) {
    response.status(403).json({ error: "Super admin access is required." });
    return;
  }

  next();
}

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  isVerified: true,
  verificationStatus: true,
  creatorStatus: true,
  globalRole: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const;

function parseUserUpdate(body: unknown):
  | {
      ok: true;
      value: {
        verificationStatus?: VerificationStatus;
        creatorStatus?: CreatorStatus;
        globalRole?: GlobalRole;
        status?: UserStatus;
      };
    }
  | { ok: false; error: string } {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const verificationStatus = parseEnumValue(VerificationStatus, value.verificationStatus);
  const creatorStatus = parseEnumValue(CreatorStatus, value.creatorStatus);
  const globalRole = parseEnumValue(GlobalRole, value.globalRole);
  const status = parseEnumValue(UserStatus, value.status);

  if (value.verificationStatus !== undefined && !verificationStatus) {
    return { ok: false, error: "Choose a valid verification status." };
  }

  if (value.creatorStatus !== undefined && !creatorStatus) {
    return { ok: false, error: "Choose a valid creator status." };
  }

  if (value.globalRole !== undefined && !globalRole) {
    return { ok: false, error: "Choose a valid global role." };
  }

  if (value.status !== undefined && !status) {
    return { ok: false, error: "Choose a valid user status." };
  }

  return {
    ok: true,
    value: {
      ...(verificationStatus ? { verificationStatus } : {}),
      ...(creatorStatus ? { creatorStatus } : {}),
      ...(globalRole ? { globalRole } : {}),
      ...(status ? { status } : {})
    }
  };
}

function serializeAdminApplication(
  application: {
    id: string;
    userId: string;
    status: ApplicationStatus;
    reason: string;
    intendedUse: string | null;
    reviewerNotes: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user?: Parameters<typeof serializeAdminUser>[0];
  },
  type: "verification" | "creator"
) {
  return {
    id: application.id,
    type,
    userId: application.userId,
    user: application.user ? serializeAdminUser(application.user) : null,
    status: application.status,
    reason: application.reason,
    intendedUse: application.intendedUse,
    reviewerNotes: application.reviewerNotes,
    reviewedAt: application.reviewedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

function serializeAdminUser(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  isVerified: boolean;
  verificationStatus: VerificationStatus;
  creatorStatus: CreatorStatus;
  globalRole: GlobalRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
    jobTitle: user.jobTitle,
    isVerified: user.isVerified,
    verificationStatus: user.verificationStatus,
    creatorStatus: user.creatorStatus,
    globalRole: user.globalRole,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value) ? (value as T[keyof T]) : undefined;
}

export { router as adminRouter };
