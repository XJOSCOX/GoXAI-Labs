import {
  getPrismaClient,
  NotificationPreferenceEvent,
  NotificationType,
  Prisma,
  type Notification,
  type NotificationPreference
} from "@goxai/database";
import { Router } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";

const router = Router();

router.use(requireAuthenticatedUser);

export interface NotificationInput {
  userId?: string | null;
  event?: NotificationPreferenceEvent;
  type?: NotificationType;
  title: string;
  message?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

const notificationPreferenceDefaults: Array<{
  description: string;
  email: boolean;
  event: NotificationPreferenceEvent;
  inApp: boolean;
  label: string;
}> = [
  {
    description: "When tasks are assigned directly or through dataset workflow.",
    email: false,
    event: NotificationPreferenceEvent.TASK_ASSIGNED,
    inApp: true,
    label: "Task assigned"
  },
  {
    description: "When an annotation is submitted and ready for review.",
    email: false,
    event: NotificationPreferenceEvent.REVIEW_REQUESTED,
    inApp: true,
    label: "Review requested"
  },
  {
    description: "When your submitted task is approved.",
    email: false,
    event: NotificationPreferenceEvent.TASK_APPROVED,
    inApp: true,
    label: "Task approved"
  },
  {
    description: "When your submitted task needs changes.",
    email: false,
    event: NotificationPreferenceEvent.TASK_REJECTED,
    inApp: true,
    label: "Task rejected"
  },
  {
    description: "When an export finishes successfully.",
    email: false,
    event: NotificationPreferenceEvent.EXPORT_COMPLETED,
    inApp: true,
    label: "Export completed"
  },
  {
    description: "When an export fails and needs attention.",
    email: false,
    event: NotificationPreferenceEvent.EXPORT_FAILED,
    inApp: true,
    label: "Export failed"
  },
  {
    description: "When someone comments on a task you are assigned to or reviewing.",
    email: false,
    event: NotificationPreferenceEvent.COMMENT_ADDED,
    inApp: true,
    label: "Task comments"
  },
  {
    description: "Important platform and account updates.",
    email: false,
    event: NotificationPreferenceEvent.SYSTEM,
    inApp: true,
    label: "System updates"
  }
];

router.get("/", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const pageSize = clampPageSize(request.query.pageSize);
  const unreadOnly = request.query.unreadOnly === "true";
  const prisma = getPrismaClient();
  const where = {
    userId: user.id,
    ...(unreadOnly ? { readAt: null } : {})
  };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      take: pageSize
    }),
    prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null
      }
    })
  ]);

  response.status(200).json({
    notifications: notifications.map(serializeNotification),
    unreadCount
  });
});

router.patch("/:notificationId/read", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const notificationId = normalizeId(request.params.notificationId);

  if (!notificationId) {
    response.status(400).json({ error: "Notification is required." });
    return;
  }

  const prisma = getPrismaClient();
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId: user.id
    }
  });

  if (!notification) {
    response.status(404).json({ error: "Notification was not found." });
    return;
  }

  const saved = notification.readAt
    ? notification
    : await prisma.notification.update({
        where: {
          id: notification.id
        },
        data: {
          readAt: new Date()
        }
      });

  response.status(200).json({
    notification: serializeNotification(saved)
  });
});

router.post("/mark-all-read", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const result = await prisma.notification.updateMany({
    where: {
      userId: user.id,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });

  response.status(200).json({
    updatedCount: result.count
  });
});

router.get("/preferences", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  response.status(200).json({
    preferences: await getUserNotificationPreferences(user.id)
  });
});

router.patch("/preferences", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const parsed = parseNotificationPreferenceUpdates(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();

  await prisma.$transaction(
    parsed.value.map((preference) =>
      prisma.notificationPreference.upsert({
        where: {
          userId_event: {
            event: preference.event,
            userId: user.id
          }
        },
        create: {
          userId: user.id,
          event: preference.event,
          inApp: preference.inApp,
          email: preference.email
        },
        update: {
          inApp: preference.inApp,
          email: preference.email
        }
      })
    )
  );

  response.status(200).json({
    preferences: await getUserNotificationPreferences(user.id)
  });
});

export async function createNotification(input: NotificationInput) {
  if (!input.userId) {
    return null;
  }

  const prisma = getPrismaClient();
  const event = input.event ?? inferNotificationPreferenceEvent(input.type ?? NotificationType.INFO);
  const allowed = await isInAppNotificationEnabled(input.userId, event);

  if (!allowed) {
    return null;
  }

  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type ?? NotificationType.INFO,
      title: input.title.slice(0, 160),
      message: input.message?.slice(0, 600) ?? null,
      metadata: input.metadata ?? Prisma.JsonNull
    }
  });
}

export async function createNotifications(inputs: NotificationInput[]) {
  const validInputs = inputs.filter((input) => input.userId);

  if (validInputs.length === 0) {
    return [];
  }

  return Promise.all(validInputs.map((input) => createNotification(input)));
}

export async function getUserNotificationPreferences(userId: string) {
  const prisma = getPrismaClient();
  const savedPreferences = await prisma.notificationPreference.findMany({
    where: {
      userId
    }
  });

  return mergeNotificationPreferences(savedPreferences);
}

async function isInAppNotificationEnabled(userId: string, event: NotificationPreferenceEvent) {
  const prisma = getPrismaClient();
  const savedPreference = await prisma.notificationPreference.findUnique({
    where: {
      userId_event: {
        event,
        userId
      }
    }
  });

  return savedPreference?.inApp ?? getDefaultNotificationPreference(event).inApp;
}

function serializeNotification(notification: Notification) {
  const metadata = toRecord(notification.metadata);

  return {
    id: notification.id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    readAt: notification.readAt,
    metadata,
    actionUrl: getActionUrl(metadata),
    actionLabel: getActionLabel(notification.type, metadata),
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt
  };
}

function getActionUrl(metadata: Record<string, unknown> | null) {
  if (!metadata) {
    return null;
  }

  if (typeof metadata.actionUrl === "string" && metadata.actionUrl.startsWith("/")) {
    return metadata.actionUrl;
  }

  if (typeof metadata.taskId === "string") {
    return `/tasks/${encodeURIComponent(metadata.taskId)}`;
  }

  if (typeof metadata.datasetId === "string") {
    return `/datasets/${encodeURIComponent(metadata.datasetId)}`;
  }

  if (typeof metadata.projectId === "string") {
    return `/projects/${encodeURIComponent(metadata.projectId)}`;
  }

  return null;
}

function getActionLabel(type: NotificationType, metadata: Record<string, unknown> | null) {
  if (type === NotificationType.REVIEW_REQUESTED) {
    return "Open review";
  }

  if (type === NotificationType.TASK_ASSIGNED) {
    return "Open task";
  }

  if (typeof metadata?.exportId === "string") {
    return type === NotificationType.ERROR ? "View export" : "View export";
  }

  if (typeof metadata?.datasetId === "string") {
    return "Open dataset";
  }

  if (typeof metadata?.projectId === "string") {
    return "Open project";
  }

  return "Open";
}

function inferNotificationPreferenceEvent(type: NotificationType) {
  if (type === NotificationType.TASK_ASSIGNED) {
    return NotificationPreferenceEvent.TASK_ASSIGNED;
  }

  if (type === NotificationType.REVIEW_REQUESTED) {
    return NotificationPreferenceEvent.REVIEW_REQUESTED;
  }

  if (type === NotificationType.ERROR) {
    return NotificationPreferenceEvent.SYSTEM;
  }

  return NotificationPreferenceEvent.SYSTEM;
}

function mergeNotificationPreferences(savedPreferences: NotificationPreference[]) {
  const savedByEvent = new Map(savedPreferences.map((preference) => [preference.event, preference]));

  return notificationPreferenceDefaults.map((defaultPreference) => {
    const saved = savedByEvent.get(defaultPreference.event);

    return {
      description: defaultPreference.description,
      email: saved?.email ?? defaultPreference.email,
      event: defaultPreference.event,
      inApp: saved?.inApp ?? defaultPreference.inApp,
      label: defaultPreference.label,
      updatedAt: saved?.updatedAt ?? null
    };
  });
}

function getDefaultNotificationPreference(event: NotificationPreferenceEvent) {
  return notificationPreferenceDefaults.find((preference) => preference.event === event) ?? notificationPreferenceDefaults.at(-1)!;
}

function parseNotificationPreferenceUpdates(body: unknown):
  | {
      ok: true;
      value: Array<{
        email: boolean;
        event: NotificationPreferenceEvent;
        inApp: boolean;
      }>;
    }
  | { ok: false; error: string } {
  const preferences = isPlainObject(body) && Array.isArray(body.preferences) ? body.preferences : null;

  if (!preferences) {
    return { ok: false, error: "Preferences are required." };
  }

  const value: Array<{ email: boolean; event: NotificationPreferenceEvent; inApp: boolean }> = [];

  for (const item of preferences) {
    if (!isPlainObject(item)) {
      return { ok: false, error: "Preference rows must be objects." };
    }

    const event = parseNotificationPreferenceEvent(item.event);

    if (!event) {
      return { ok: false, error: "Choose a valid notification event." };
    }

    value.push({
      email: item.email === true,
      event,
      inApp: item.inApp !== false
    });
  }

  return { ok: true, value };
}

function parseNotificationPreferenceEvent(value: unknown) {
  return typeof value === "string" && value in NotificationPreferenceEvent
    ? (value as NotificationPreferenceEvent)
    : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clampPageSize(value: unknown) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : 20;

  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(50, Math.max(1, parsed));
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export { router as notificationsRouter };
