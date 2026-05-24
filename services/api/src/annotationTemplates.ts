import { DataType, getPrismaClient, GlobalRole, MembershipRole, Prisma } from "@goxai/database";
import { Router, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId } from "./logging.js";

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
  const organizationIds = memberships.map((membership) => membership.organizationId);
  const templates = await prisma.annotationTemplate.findMany({
    where: {
      OR: [
        {
          organizationId: null
        },
        {
          organizationId: {
            in: organizationIds
          }
        }
      ]
    },
    orderBy: [
      {
        organizationId: "asc"
      },
      {
        updatedAt: "desc"
      }
    ],
    include: templateIncludes
  });

  response.status(200).json({
    templates: templates.map((template) => serializeTemplate(template, user.globalRole === GlobalRole.SUPER_ADMIN))
  });
});

router.post("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseTemplateBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const organizationId = parsed.value.organizationId ?? null;

  if (!(await canManageTemplate(user.id, user.globalRole, organizationId))) {
    response.status(403).json({ error: "You need super admin or organization owner/admin access to manage templates." });
    return;
  }

  try {
    const template = await prisma.annotationTemplate.create({
      data: {
        configJson: parsed.value.configJson ?? {},
        createdById: user.id,
        dataType: parsed.value.dataType ?? DataType.IMAGE,
        description: parsed.value.description,
        name: parsed.value.name ?? "Untitled template",
        organizationId
      },
      include: templateIncludes
    });

    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: "annotation_template.created",
        entityType: "annotation_template",
        entityId: template.id,
        metadata: {
          requestId: getRequestId(request)
        }
      }
    });

    response.status(201).json({ template: serializeTemplate(template, true) });
  } catch (reason) {
    if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2002") {
      response.status(409).json({ error: "A template with this name already exists in that scope." });
      return;
    }

    throw reason;
  }
});

router.patch("/:templateId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const templateId = normalizeId(request.params.templateId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!templateId) {
    response.status(400).json({ error: "Template is required." });
    return;
  }

  const parsed = parseTemplateBody(request.body, true);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.annotationTemplate.findUnique({
    where: {
      id: templateId
    },
    select: {
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Template was not found." });
    return;
  }

  if (!(await canManageTemplate(user.id, user.globalRole, existing.organizationId))) {
    response.status(403).json({ error: "You need super admin or organization owner/admin access to manage templates." });
    return;
  }

  const template = await prisma.annotationTemplate.update({
    where: {
      id: templateId
    },
    data: parsed.value,
    include: templateIncludes
  });

  await prisma.auditLog.create({
    data: {
      organizationId: template.organizationId,
      userId: user.id,
      action: "annotation_template.updated",
      entityType: "annotation_template",
      entityId: template.id,
      metadata: {
        requestId: getRequestId(request)
      }
    }
  });

  response.status(200).json({ template: serializeTemplate(template, true) });
});

router.delete("/:templateId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const templateId = normalizeId(request.params.templateId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!templateId) {
    response.status(400).json({ error: "Template is required." });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.annotationTemplate.findUnique({
    where: {
      id: templateId
    },
    select: {
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Template was not found." });
    return;
  }

  if (!(await canManageTemplate(user.id, user.globalRole, existing.organizationId))) {
    response.status(403).json({ error: "You need super admin or organization owner/admin access to manage templates." });
    return;
  }

  await prisma.annotationTemplate.delete({
    where: {
      id: templateId
    }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: existing.organizationId,
      userId: user.id,
      action: "annotation_template.deleted",
      entityType: "annotation_template",
      entityId: templateId,
      metadata: {
        requestId: getRequestId(request)
      }
    }
  });

  response.status(200).json({ deleted: true });
});

async function canManageTemplate(userId: string, globalRole: GlobalRole, organizationId: string | null) {
  if (globalRole === GlobalRole.SUPER_ADMIN) {
    return true;
  }

  if (!organizationId) {
    return false;
  }

  const prisma = getPrismaClient();
  const membership = await prisma.membership.findFirst({
    where: {
      organizationId,
      status: "ACTIVE",
      userId
    },
    select: {
      role: true
    }
  });

  return Boolean(membership && (membership.role === MembershipRole.OWNER || membership.role === MembershipRole.ADMIN));
}

const templateIncludes = {
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  createdBy: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true
    }
  }
} as const satisfies Prisma.AnnotationTemplateInclude;

function serializeTemplate(
  template: Prisma.AnnotationTemplateGetPayload<{ include: typeof templateIncludes }>,
  canManage: boolean
) {
  return {
    canManage,
    configJson: template.configJson,
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy
      ? {
          email: template.createdBy.email,
          id: template.createdBy.id,
          name: [template.createdBy.firstName, template.createdBy.lastName].filter(Boolean).join(" ") || template.createdBy.email
        }
      : null,
    dataType: template.dataType,
    description: template.description,
    id: template.id,
    name: template.name,
    organization: template.organization,
    organizationId: template.organizationId,
    updatedAt: template.updatedAt.toISOString()
  };
}

function parseTemplateBody(body: unknown, partial = false) {
  if (!body || typeof body !== "object") {
    return { ok: false as const, error: "Template payload is required." };
  }

  const record = body as Record<string, unknown>;
  const name = normalizeText(record.name);
  const description = normalizeOptionalText(record.description);
  const organizationId = normalizeOptionalText(record.organizationId);
  const dataType = parseEnum(record.dataType, DataType);
  const configJson = parseConfigJson(record.configJson);

  if (!partial && !name) {
    return { ok: false as const, error: "Template name is required." };
  }

  if (!partial && !dataType) {
    return { ok: false as const, error: "Data type is required." };
  }

  if (!configJson.ok) {
    return { ok: false as const, error: configJson.error };
  }

  return {
    ok: true as const,
    value: {
      ...(name ? { name } : {}),
      ...(record.description !== undefined ? { description } : {}),
      ...(dataType ? { dataType } : {}),
      ...(record.organizationId !== undefined ? { organizationId: organizationId ?? null } : {}),
      ...(record.configJson !== undefined ? { configJson: configJson.value } : {})
    }
  };
}

function parseConfigJson(value: unknown) {
  if (value === undefined) {
    return { ok: true as const, value: undefined };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false as const, error: "Template config must be an object." };
  }

  return { ok: true as const, value: value as Prisma.InputJsonObject };
}

function parseEnum<T extends Record<string, string>>(value: unknown, enumValues: T) {
  return typeof value === "string" && Object.values(enumValues).includes(value) ? (value as T[keyof T]) : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export { router as annotationTemplatesRouter };
