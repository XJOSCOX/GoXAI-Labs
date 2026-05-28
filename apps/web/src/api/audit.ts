import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { AuditCleanupResult, AuditLogsResult } from "./types";
export async function listAuditLogs(
  session: Session,
  input: {
    action?: string;
    datasetId?: string;
    entityId?: string;
    entityType?: string;
    includeTechnical?: boolean;
    page?: number;
    pageSize?: number;
    projectId?: string;
    taskId?: string;
    userId?: string;
  } = {}
) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value));
    }
  }

  const response = await authenticatedFetch(session, `/api/logs/audit${params.toString() ? `?${params.toString()}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load audit activity."));
  }

  return (await response.json()) as AuditLogsResult;
}

export async function cleanupNoisyAuditLogs(
  session: Session,
  input: { before?: string; confirm?: string; dryRun?: boolean } = {}
) {
  const response = await authenticatedFetch(session, "/api/logs/audit/cleanup-noise", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to clean audit activity."));
  }

  return (await response.json()) as AuditCleanupResult;
}
