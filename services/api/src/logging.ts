import { randomUUID } from "node:crypto";
import { getPrismaClient, type Prisma } from "@goxai/database";
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";

interface AuditLogInput {
  action: string;
  entityId?: string;
  entityType?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  organizationId?: string;
  projectId?: string;
  userAgent?: string;
  userId?: string;
  workspaceId?: string;
}

interface RequestWithLogContext extends AuthenticatedRequest {
  requestId?: string;
}

export function apiRequestLogger(request: RequestWithLogContext, response: Response, next: NextFunction) {
  const requestId = randomUUID();
  const startedAt = performance.now();
  request.requestId = requestId;
  response.setHeader("X-Request-Id", requestId);

  response.on("finish", () => {
    const durationMs = Math.round(performance.now() - startedAt);

    void saveAuditLog({
      action: "api.request",
      userId: request.currentUser?.id,
      ipAddress: getClientIp(request),
      userAgent: request.header("user-agent"),
      metadata: {
        requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs,
        ok: response.statusCode < 400,
        contentLength: response.getHeader("content-length") ?? null,
        origin: request.header("origin") ?? null,
        referer: request.header("referer") ?? null,
        query: sanitizeValue(request.query),
        params: sanitizeValue(request.params),
        body: sanitizeValue(request.body)
      }
    });
  });

  next();
}

export function getRequestId(request: Request) {
  return (request as RequestWithLogContext).requestId;
}

export async function logApiException(request: RequestWithLogContext, error: unknown) {
  await saveAuditLog({
    action: "api.exception",
    userId: request.currentUser?.id,
    ipAddress: getClientIp(request),
    userAgent: request.header("user-agent"),
    metadata: {
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      error: serializeError(error)
    }
  });
}

export async function saveAuditLog(input: AuditLogInput) {
  try {
    const prisma = getPrismaClient();

    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityId: input.entityId,
        entityType: input.entityType,
        ipAddress: input.ipAddress,
        metadata: sanitizeValue(input.metadata ?? {}) as Prisma.InputJsonValue,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userAgent: input.userAgent,
        userId: input.userId,
        workspaceId: input.workspaceId
      }
    });
  } catch (error) {
    console.error("Unable to save audit log", error);
  }
}

function getClientIp(request: Request) {
  const forwardedFor = request.header("x-forwarded-for")?.split(",")[0]?.trim();

  return forwardedFor || request.ip;
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split("\n").slice(0, 8).join("\n")
    };
  }

  return {
    message: String(error)
  };
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitiveKey(key) ? "[redacted]" : sanitizeValue(item)
      ])
    );
  }

  return value;
}

function isSensitiveKey(key: string) {
  return /authorization|cookie|password|secret|token|accessKey|access_key|keyHash/i.test(key);
}
