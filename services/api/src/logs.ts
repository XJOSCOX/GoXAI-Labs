import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "./auth.js";
import { getRequestId, saveAuditLog } from "./logging.js";

const router = Router();

router.use(requireAuthenticatedUser);

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
