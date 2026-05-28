import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { AIJobSummary, DatasetAIPredictionImportResult, ModelProviderSummary } from "./types";

export async function listModelProviders(session: Session, input: { organizationId?: string; projectId?: string }) {
  const params = new URLSearchParams();

  if (input.organizationId) {
    params.set("organizationId", input.organizationId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/ai/providers${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load AI providers."));
  }

  return ((await response.json()) as { providers: ModelProviderSummary[] }).providers;
}

export async function createModelProvider(
  session: Session,
  input: {
    active?: boolean;
    configJson?: Record<string, unknown> | null;
    name: string;
    organizationId?: string;
    projectId?: string;
    type: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/ai/providers", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create AI provider."));
  }

  return ((await response.json()) as { provider: ModelProviderSummary }).provider;
}

export async function updateModelProvider(
  session: Session,
  providerId: string,
  input: {
    active?: boolean;
    configJson?: Record<string, unknown> | null;
    name?: string;
    type?: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/ai/providers/${encodeURIComponent(providerId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update AI provider."));
  }

  return ((await response.json()) as { provider: ModelProviderSummary }).provider;
}

export async function listAIJobs(session: Session, input: { datasetId?: string; projectId?: string; taskId?: string }) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  if (input.taskId) {
    params.set("taskId", input.taskId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/ai/jobs${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load AI jobs."));
  }

  return ((await response.json()) as { jobs: AIJobSummary[] }).jobs;
}

export async function importAIPredictions(
  session: Session,
  input: {
    modelProviderId?: string | null;
    predictions: unknown;
    taskId: string;
    type?: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/ai/jobs/import-predictions", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to import AI predictions."));
  }

  return ((await response.json()) as { job: AIJobSummary }).job;
}

export async function generateMockAIPrediction(
  session: Session,
  input: {
    modelProviderId?: string | null;
    taskId: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/ai/jobs/mock-prediction", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate test prelabel."));
  }

  return ((await response.json()) as { job: AIJobSummary }).job;
}

export async function importDatasetAIPredictions(
  session: Session,
  input: {
    datasetId: string;
    modelProviderId?: string | null;
    predictions: unknown;
    type?: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/ai/jobs/import-dataset-predictions", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to import dataset AI predictions."));
  }

  return (await response.json()) as DatasetAIPredictionImportResult;
}

export async function generateMockDatasetAIPredictions(
  session: Session,
  input: {
    datasetId: string;
    limit?: number;
    modelProviderId?: string | null;
  }
) {
  const response = await authenticatedFetch(session, "/api/ai/jobs/mock-dataset-predictions", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate dataset test prelabels."));
  }

  return (await response.json()) as DatasetAIPredictionImportResult;
}
