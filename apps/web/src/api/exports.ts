import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { ExportDownloadUrl, ExportFormat, ExportJobSummary } from "./types";
export async function listExportJobs(session: Session, input: { datasetId?: string; projectId?: string }) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/exports${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load exports."));
  }

  return ((await response.json()) as { exports: ExportJobSummary[] }).exports;
}

export async function createExportJob(session: Session, input: { datasetId?: string; format?: ExportFormat; includeSourceFiles?: boolean; projectId?: string }) {
  const response = await authenticatedFetch(session, "/api/exports", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues({ ...input, format: input.format ?? "JSON" }))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create export."));
  }

  return ((await response.json()) as { export: ExportJobSummary }).export;
}

export async function getExportDownloadUrl(session: Session, exportId: string) {
  const response = await authenticatedFetch(session, `/api/exports/${encodeURIComponent(exportId)}/download-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create export download URL."));
  }

  return (await response.json()) as ExportDownloadUrl;
}
