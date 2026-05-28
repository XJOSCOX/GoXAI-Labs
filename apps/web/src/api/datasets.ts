import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { CreateDatasetInput, DatasetSummary, DatasetVersionSummary, UpdateDatasetInput } from "./types";
export async function listDatasets(session: Session, projectId?: string) {
  const params = new URLSearchParams();

  if (projectId) {
    params.set("projectId", projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/datasets${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load datasets."));
  }

  return ((await response.json()) as { datasets: DatasetSummary[] }).datasets;
}

export async function getDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function createDataset(session: Session, input: CreateDatasetInput) {
  const response = await authenticatedFetch(session, "/api/datasets", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function updateDataset(session: Session, datasetId: string, input: UpdateDatasetInput) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function listDatasetVersions(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/versions`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load dataset versions."));
  }

  return ((await response.json()) as { versions: DatasetVersionSummary[] }).versions;
}

export async function rollbackDatasetVersion(session: Session, datasetId: string, version: number) {
  const response = await authenticatedFetch(
    session,
    `/api/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(String(version))}/rollback`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to rollback dataset version."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function archiveDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to archive dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function restoreDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}/restore`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to restore dataset."));
  }

  return ((await response.json()) as { dataset: DatasetSummary }).dataset;
}

export async function deleteDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, `/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete dataset."));
  }

  return (await response.json()) as {
    deleted: boolean;
    deletedAssetCount: number;
    deletedTaskCount: number;
  };
}
