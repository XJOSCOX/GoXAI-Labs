import { Router } from "express";
import { getPrismaClient, GlobalRole, MembershipRole, Prisma } from "@goxai/database";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId, saveAuditLog } from "./logging.js";
import { canGenerateTasks } from "./permissions.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/audit", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const page = normalizePositiveInteger(request.query.page) ?? 1;
  const pageSize = Math.min(normalizePositiveInteger(request.query.pageSize) ?? 20, 100);
  const action = normalizeText(request.query.action);
  const entityId = normalizeText(request.query.entityId);
  const entityType = normalizeLogToken(request.query.entityType);
  const projectId = normalizeText(request.query.projectId);
  const datasetId = normalizeText(request.query.datasetId);
  const taskId = normalizeText(request.query.taskId);
  const userId = normalizeText(request.query.userId);
  const scopeWhere = await buildAuditAccessWhere(user.id, user.globalRole);

  if (!scopeWhere) {
    response.status(200).json({
      logs: [],
      page,
      pageSize,
      total: 0,
      totalPages: 1
    });
    return;
  }

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      scopeWhere,
      ...(action ? [{ action: { contains: action, mode: "insensitive" as const } }] : []),
      ...(entityId ? [{ entityId }] : []),
      ...(entityType ? [{ entityType }] : []),
      ...(projectId ? [{ projectId }] : []),
      ...(datasetId ? [{ OR: [{ entityType: "dataset", entityId: datasetId }, { metadata: { path: ["datasetId"], equals: datasetId } }] }] : []),
      ...(taskId ? [{ OR: [{ entityType: "task", entityId: taskId }, { metadata: { path: ["taskId"], equals: taskId } }] }] : []),
      ...(userId ? [{ userId }] : [])
    ]
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: {
            email: true,
            firstName: true,
            id: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.auditLog.count({ where })
  ]);

  response.status(200).json({
    logs: logs.map((log) => ({
      action: log.action,
      createdAt: log.createdAt,
      entityId: log.entityId,
      entityType: log.entityType,
      id: log.id,
      metadata: log.metadata,
      project: log.project,
      projectId: log.projectId,
      user: log.user ? serializeUserName(log.user) : null,
      userId: log.userId
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  });
});

router.post("/client", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseClientLogBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  await saveAuditLog({
    action: `client.${parsed.value.event}`,
    userId: user.id,
    entityId: parsed.value.entityId,
    entityType: parsed.value.entityType,
    metadata: {
      requestId: getRequestId(request),
      level: parsed.value.level,
      message: parsed.value.message,
      metadata: parsed.value.metadata
    }
  });

  response.status(201).json({ ok: true });
});

export { router as logsRouter };

async function buildAuditAccessWhere(userId: string, globalRole: GlobalRole): Promise<Prisma.AuditLogWhereInput | null> {
  if (globalRole === GlobalRole.SUPER_ADMIN) {
    return {};
  }

  const prisma = getPrismaClient();
  const [memberships, projectMemberships] = await Promise.all([
    prisma.membership.findMany({
      where: {
        status: "ACTIVE",
        userId
      },
      select: {
        organizationId: true,
        role: true
      }
    }),
    prisma.projectMembership.findMany({
      where: {
        status: "ACTIVE",
        userId
      },
      select: {
        projectId: true,
        role: true
      }
    })
  ]);
  const organizationIds = memberships
    .filter((membership) => canGenerateTasks({ role: membership.role as MembershipRole }))
    .map((membership) => membership.organizationId);
  const projectIds = projectMemberships
    .filter((membership) => canGenerateTasks({ role: membership.role as MembershipRole }))
    .map((membership) => membership.projectId);

  if (organizationIds.length === 0 && projectIds.length === 0) {
    return null;
  }

  return {
    OR: [
      ...(organizationIds.length > 0
        ? [
            {
              organizationId: {
                in: organizationIds
              }
            },
            {
              project: {
                organizationId: {
                  in: organizationIds
                }
              }
            }
          ]
        : []),
      ...(projectIds.length > 0
        ? [
            {
              projectId: {
                in: projectIds
              }
            }
          ]
        : [])
    ]
  };
}

function serializeUserName(user: { email: string; firstName: string | null; id: string; lastName: string | null }) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  return {
    email: user.email,
    id: user.id,
    name: name || user.email
  };
}

type ClientLogBody =
  | {
      entityId?: unknown;
      entityType?: unknown;
      event?: unknown;
      level?: unknown;
      message?: unknown;
      metadata?: unknown;
    }
  | undefined;

function parseClientLogBody(body: ClientLogBody):
  | {
      ok: true;
      value: {
        entityId?: string;
        entityType?: string;
        event: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        metadata?: unknown;
      };
    }
  | { ok: false; error: string } {
  const event = normalizeLogToken(body?.event);
  const level = parseLogLevel(body?.level);
  const message = normalizeText(body?.message);
  const entityType = normalizeLogToken(body?.entityType);
  const entityId = normalizeText(body?.entityId);

  if (!event) {
    return { ok: false, error: "Client log event is required." };
  }

  if (!level) {
    return { ok: false, error: "Client log level is required." };
  }

  if (!message) {
    return { ok: false, error: "Client log message is required." };
  }

  return {
    ok: true,
    value: {
      entityId,
      entityType,
      event,
      level,
      message: message.slice(0, 1000),
      metadata: body?.metadata
    }
  };
}

function parseLogLevel(value: unknown) {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : undefined;
}

function normalizeLogToken(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 80)
    : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizePositiveInteger(value: unknown) {
  const normalized = typeof value === "string" ? Number(value) : value;
  return Number.isInteger(normalized) && Number(normalized) > 0 ? Number(normalized) : undefined;
}
