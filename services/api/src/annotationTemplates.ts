import { DataType, getPrismaClient, GlobalRole, MembershipRole, Prisma } from "@goxai/database";
import { Router, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId } from "./logging.js";

const router = Router();

router.use(requireAuthenticatedUser);

router.get("/categories", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const categories = await prisma.annotationCategory.findMany({
    orderBy: [
      {
        organizationId: "asc"
      },
      {
        name: "asc"
      }
    ],
    include: categoryIncludes
  });

  response.status(200).json({
    categories: categories.map((category) => serializeCategory(category, canManageOwnedRecord(user, category.createdById)))
  });
});

router.post("/categories", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseCategoryBody(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  if (!(await canCreateInScope(user.id, user.globalRole, parsed.value.organizationId ?? null))) {
    response.status(403).json({ error: "You need super admin or organization owner/admin access to create categories." });
    return;
  }

  const prisma = getPrismaClient();
  const categoryName = parsed.value.name ?? "";

  try {
    const created = await prisma.annotationCategory.create({
      data: {
        createdById: user.id,
        description: parsed.value.description,
        name: categoryName,
        organizationId: parsed.value.organizationId ?? null
      }
    });
    const category = await prisma.annotationCategory.findUniqueOrThrow({
      where: {
        id: created.id
      },
      include: categoryIncludes
    });

    await prisma.auditLog.create({
      data: {
        organizationId: category.organizationId,
        userId: user.id,
        action: "annotation_category.created",
        entityId: category.id,
        entityType: "annotation_category",
        metadata: {
          requestId: getRequestId(request)
        }
      }
    });

    response.status(201).json({ category: serializeCategory(category, true) });
  } catch (reason) {
    if (reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2002") {
      response.status(409).json({ error: "A category with this name already exists in that scope." });
      return;
    }

    throw reason;
  }
});

router.patch("/categories/:categoryId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const categoryId = normalizeId(request.params.categoryId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!categoryId) {
    response.status(400).json({ error: "Category is required." });
    return;
  }

  const parsed = parseCategoryBody(request.body, true);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.annotationCategory.findUnique({
    where: {
      id: categoryId
    },
    select: {
      createdById: true,
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Category was not found." });
    return;
  }

  if (!canManageOwnedRecord(user, existing.createdById)) {
    response.status(403).json({ error: "You can only edit categories you created." });
    return;
  }

  const category = await prisma.annotationCategory.update({
    where: {
      id: categoryId
    },
    data: parsed.value,
    include: categoryIncludes
  });

  await prisma.auditLog.create({
    data: {
      organizationId: category.organizationId,
      userId: user.id,
      action: "annotation_category.updated",
      entityId: category.id,
      entityType: "annotation_category",
      metadata: {
        requestId: getRequestId(request)
      }
    }
  });

  response.status(200).json({ category: serializeCategory(category, true) });
});

router.delete("/categories/:categoryId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const categoryId = normalizeId(request.params.categoryId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!categoryId) {
    response.status(400).json({ error: "Category is required." });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.annotationCategory.findUnique({
    where: {
      id: categoryId
    },
    select: {
      createdById: true,
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Category was not found." });
    return;
  }

  if (!canManageOwnedRecord(user, existing.createdById)) {
    response.status(403).json({ error: "You can only delete categories you created." });
    return;
  }

  await prisma.annotationCategory.delete({
    where: {
      id: categoryId
    }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: existing.organizationId,
      userId: user.id,
      action: "annotation_category.deleted",
      entityId: categoryId,
      entityType: "annotation_category",
      metadata: {
        requestId: getRequestId(request)
      }
    }
  });

  response.status(200).json({ deleted: true });
});

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const templates = await prisma.annotationTemplate.findMany({
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
    templates: templates.map((template) => serializeTemplate(template, canManageOwnedRecord(user, template.createdById)))
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
  const category = await prisma.annotationCategory.findUnique({
    where: {
      id: parsed.value.categoryId
    },
    select: {
      createdById: true,
      organizationId: true
    }
  });

  if (!category) {
    response.status(404).json({ error: "Choose a valid category before creating a template." });
    return;
  }

  if (!canManageOwnedRecord(user, category.createdById)) {
    response.status(403).json({ error: "You can only add templates to categories you created." });
    return;
  }

  try {
    const template = await prisma.annotationTemplate.create({
      data: {
        categoryId: parsed.value.categoryId,
        configJson: parsed.value.configJson ?? {},
        createdById: user.id,
        dataType: parsed.value.dataType ?? DataType.IMAGE,
        description: parsed.value.description,
        name: parsed.value.name ?? "Untitled template",
        organizationId: category.organizationId
      },
      include: templateIncludes
    });

    await prisma.auditLog.create({
      data: {
        organizationId: template.organizationId,
        userId: user.id,
        action: "annotation_template.created",
        entityId: template.id,
        entityType: "annotation_template",
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
      createdById: true,
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Template was not found." });
    return;
  }

  if (!canManageOwnedRecord(user, existing.createdById)) {
    response.status(403).json({ error: "You can only edit templates you created." });
    return;
  }

  let nextOrganizationId: string | null | undefined;

  if (parsed.value.categoryId) {
    const category = await prisma.annotationCategory.findUnique({
      where: {
        id: parsed.value.categoryId
      },
      select: {
        createdById: true,
        organizationId: true
      }
    });

    if (!category) {
      response.status(404).json({ error: "Choose a valid category before updating a template." });
      return;
    }

    if (!canManageOwnedRecord(user, category.createdById)) {
      response.status(403).json({ error: "You can only move templates into categories you created." });
      return;
    }

    nextOrganizationId = category.organizationId;
  }

  const template = await prisma.annotationTemplate.update({
    where: {
      id: templateId
    },
    data: {
      ...parsed.value,
      ...(nextOrganizationId !== undefined ? { organizationId: nextOrganizationId } : {})
    },
    include: templateIncludes
  });

  await prisma.auditLog.create({
    data: {
      organizationId: template.organizationId,
      userId: user.id,
      action: "annotation_template.updated",
      entityId: template.id,
      entityType: "annotation_template",
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
      createdById: true,
      organizationId: true
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Template was not found." });
    return;
  }

  if (!canManageOwnedRecord(user, existing.createdById)) {
    response.status(403).json({ error: "You can only delete templates you created." });
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
      entityId: templateId,
      entityType: "annotation_template",
      metadata: {
        requestId: getRequestId(request)
      }
    }
  });

  response.status(200).json({ deleted: true });
});

async function canCreateInScope(userId: string, globalRole: GlobalRole, organizationId: string | null) {
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

function canManageOwnedRecord(user: NonNullable<AuthenticatedRequest["currentUser"]>, createdById: string | null) {
  return user.globalRole === GlobalRole.SUPER_ADMIN || createdById === user.id;
}

const categoryIncludes = {
  createdBy: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true
    }
  },
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  _count: {
    select: {
      templates: true
    }
  }
} as const satisfies Prisma.AnnotationCategoryInclude;

const templateIncludes = {
  category: {
    select: {
      id: true,
      name: true,
      organizationId: true
    }
  },
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

function serializeCategory(
  category: Prisma.AnnotationCategoryGetPayload<{ include: typeof categoryIncludes }>,
  canManage: boolean
) {
  return {
    canManage,
    createdAt: category.createdAt.toISOString(),
    createdBy: category.createdBy
      ? {
          email: category.createdBy.email,
          id: category.createdBy.id,
          name: [category.createdBy.firstName, category.createdBy.lastName].filter(Boolean).join(" ") || category.createdBy.email
        }
      : null,
    description: category.description,
    id: category.id,
    name: category.name,
    organization: category.organization,
    organizationId: category.organizationId,
    templateCount: category._count.templates,
    updatedAt: category.updatedAt.toISOString()
  };
}

function serializeTemplate(
  template: Prisma.AnnotationTemplateGetPayload<{ include: typeof templateIncludes }>,
  canManage: boolean
) {
  return {
    canManage,
    category: template.category,
    categoryId: template.categoryId,
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

function parseCategoryBody(body: unknown, partial = false) {
  if (!body || typeof body !== "object") {
    return { ok: false as const, error: "Category payload is required." };
  }

  const record = body as Record<string, unknown>;
  const name = normalizeText(record.name);
  const description = normalizeOptionalText(record.description);
  const organizationId = normalizeOptionalText(record.organizationId);

  if (!partial && !name) {
    return { ok: false as const, error: "Category name is required." };
  }

  return {
    ok: true as const,
    value: {
      ...(name ? { name } : {}),
      ...(record.description !== undefined ? { description } : {}),
      ...(record.organizationId !== undefined ? { organizationId: organizationId ?? null } : {})
    }
  };
}

function parseTemplateBody(body: unknown, partial = false) {
  if (!body || typeof body !== "object") {
    return { ok: false as const, error: "Template payload is required." };
  }

  const record = body as Record<string, unknown>;
  const name = normalizeText(record.name);
  const description = normalizeOptionalText(record.description);
  const categoryId = normalizeText(record.categoryId);
  const dataType = parseEnum(record.dataType, DataType);
  const configJson = parseConfigJson(record.configJson);

  if (!partial && !name) {
    return { ok: false as const, error: "Template name is required." };
  }

  if (!partial && !categoryId) {
    return { ok: false as const, error: "Template category is required." };
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
      ...(categoryId ? { categoryId } : {}),
      ...(name ? { name } : {}),
      ...(record.description !== undefined ? { description } : {}),
      ...(dataType ? { dataType } : {}),
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
