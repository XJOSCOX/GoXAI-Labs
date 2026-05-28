import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError } from "./http";
import type { NotificationPreferenceSummary, NotificationsResult, NotificationSummary } from "./types";
export async function listNotifications(
  session: Session,
  input: { pageSize?: number; unreadOnly?: boolean } = {}
) {
  const params = new URLSearchParams();

  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }

  if (input.unreadOnly) {
    params.set("unreadOnly", "true");
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/notifications${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load notifications."));
  }

  return (await response.json()) as NotificationsResult;
}

export async function markNotificationRead(session: Session, notificationId: string) {
  const response = await authenticatedFetch(session, `/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update notification."));
  }

  return ((await response.json()) as { notification: NotificationSummary }).notification;
}

export async function markAllNotificationsRead(session: Session) {
  const response = await authenticatedFetch(session, "/api/notifications/mark-all-read", {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update notifications."));
  }

  return (await response.json()) as { updatedCount: number };
}

export async function getNotificationPreferences(session: Session) {
  const response = await authenticatedFetch(session, "/api/notifications/preferences");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load notification preferences."));
  }

  return ((await response.json()) as { preferences: NotificationPreferenceSummary[] }).preferences;
}

export async function updateNotificationPreferences(
  session: Session,
  preferences: Array<{ email: boolean; event: string; inApp: boolean }>
) {
  const response = await authenticatedFetch(session, "/api/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify({ preferences })
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update notification preferences."));
  }

  return ((await response.json()) as { preferences: NotificationPreferenceSummary[] }).preferences;
}
