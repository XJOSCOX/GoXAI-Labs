import {
  ApplicationStatus,
  CreatorStatus,
  getPrismaClient,
  GlobalRole,
  VerificationStatus
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { getRequestId } from "../../shared/logging.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/me", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const [verificationApplication, creatorApplication] = await Promise.all([
    prisma.verificationApplication.findFirst({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.creatorApplication.findFirst({
      where: {
        userId: user.id
      },
      orderBy: {
        createdAt: "desc"
      }
    })
  ]);

  response.status(200).json({
    verificationApplication: verificationApplication ? serializeApplication(verificationApplication) : null,
    creatorApplication: creatorApplication ? serializeApplication(creatorApplication) : null
  });
});

router.post("/verification", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (user.verificationStatus === VerificationStatus.VERIFIED || user.isVerified) {
    response.status(409).json({ error: "This account is already verified." });
    return;
  }

  const parsed = parseApplicationBody(request.body, { fullName: true });

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const existingPending = await prisma.verificationApplication.findFirst({
    where: {
      userId: user.id,
      status: {
        in: [ApplicationStatus.SUBMITTED, ApplicationStatus.REVIEWING]
      }
    },
    select: {
      id: true
    }
  });

  if (existingPending) {
    response.status(409).json({ error: "A verification application is already pending review." });
    return;
  }

  const application = await prisma.$transaction(async (tx) => {
    const saved = await tx.verificationApplication.create({
      data: {
        userId: user.id,
        fullName: parsed.value.fullName,
        reason: parsed.value.reason,
        intendedUse: parsed.value.intendedUse
      }
    });

    await tx.user.update({
      where: {
        id: user.id
      },
      data: {
        verificationStatus: VerificationStatus.PENDING
      }
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "verification_application.submitted",
        entityType: "verification_application",
        entityId: saved.id,
        metadata: {
          requestId: getRequestId(request)
        }
      }
    });

    return saved;
  });

  response.status(201).json({
    application: serializeApplication(application)
  });
});

router.post("/creator", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const verified = user.globalRole === GlobalRole.SUPER_ADMIN || user.verificationStatus === VerificationStatus.VERIFIED || user.isVerified;

  if (!verified) {
    response.status(403).json({ error: "Your account must be verified before applying for creator rights." });
    return;
  }

  if (user.creatorStatus === CreatorStatus.APPROVED) {
    response.status(409).json({ error: "Creator rights are already approved for this account." });
    return;
  }

  const parsed = parseApplicationBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const existingPending = await prisma.creatorApplication.findFirst({
    where: {
      userId: user.id,
      status: {
        in: [ApplicationStatus.SUBMITTED, ApplicationStatus.REVIEWING]
      }
    },
    select: {
      id: true
    }
  });

  if (existingPending) {
    response.status(409).json({ error: "A creator application is already pending review." });
    return;
  }

  const application = await prisma.$transaction(async (tx) => {
    const saved = await tx.creatorApplication.create({
      data: {
        userId: user.id,
        reason: parsed.value.reason,
        intendedUse: parsed.value.intendedUse
      }
    });

    await tx.user.update({
      where: {
        id: user.id
      },
      data: {
        creatorStatus: CreatorStatus.PENDING
      }
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "creator_application.submitted",
        entityType: "creator_application",
        entityId: saved.id,
        metadata: {
          requestId: getRequestId(request)
        }
      }
    });

    return saved;
  });

  response.status(201).json({
    application: serializeApplication(application)
  });
});

function parseApplicationBody(body: unknown, options: { fullName?: boolean } = {}):
  | {
      ok: true;
      value: {
        fullName?: string;
        reason: string;
        intendedUse?: string;
      };
    }
  | { ok: false; error: string } {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fullName = normalizeText(value.fullName);
  const reason = normalizeText(value.reason);
  const intendedUse = normalizeText(value.intendedUse);

  if (options.fullName && !fullName) {
    return { ok: false, error: "Full name is required." };
  }

  if (!reason) {
    return { ok: false, error: "Reason is required." };
  }

  if (reason.length > 1200) {
    return { ok: false, error: "Reason must be 1200 characters or fewer." };
  }

  if (intendedUse && intendedUse.length > 1200) {
    return { ok: false, error: "Intended use must be 1200 characters or fewer." };
  }

  return {
    ok: true,
    value: {
      fullName,
      reason,
      intendedUse
    }
  };
}

function serializeApplication(application: {
  id: string;
  userId: string;
  status: ApplicationStatus;
  reason: string;
  intendedUse: string | null;
  reviewerNotes: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: application.id,
    userId: application.userId,
    status: application.status,
    reason: application.reason,
    intendedUse: application.intendedUse,
    reviewerNotes: application.reviewerNotes,
    reviewedAt: application.reviewedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export { router as applicationsRouter };
