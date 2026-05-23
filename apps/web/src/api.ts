import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

export interface ApiUser {
  id: string;
  supabaseAuthId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  globalRole: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendConfig {
  supabase: {
    url: string;
    anonKey: string;
  };
}

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

let supabaseBrowserClientPromise: Promise<SupabaseClient> | null = null;

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  type: string;
  planTier: string;
  role: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrganizationInput {
  organizationName: string;
  workspaceName: string;
  organizationType: string;
  planTier: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  slug: string;
  description: string | null;
  dataType: string;
  status: string;
  instructions: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  organizationId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  dataType: string;
  instructions?: string;
}

export interface DatasetSummary {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  metadata: Record<string, unknown> | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    dataType: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateDatasetInput {
  projectId: string;
  name: string;
  description?: string;
}

export interface AssetSummary {
  id: string;
  organizationId: string;
  projectId: string | null;
  datasetId: string | null;
  provider: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetInput {
  datasetId: string;
  bucket?: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum?: string;
  width?: string;
  height?: string;
  duration?: string;
}

export interface AssetUploadRequest {
  datasetId: string;
  objectKey?: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
}

export interface AssetUploadUrl {
  upload: {
    uploadUrl: string;
    method: "PUT";
    expiresInSeconds: number;
    headers: Record<string, string>;
  };
  asset: CreateAssetInput;
}

export interface AssetAccessUrl {
  accessUrl: string;
  expiresInSeconds: number;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  datasetId: string | null;
  assetId: string | null;
  status: string;
  priority: number;
  assignedToId: string | null;
  reviewerId: string | null;
  metadata: Record<string, unknown> | null;
  dueAt: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
  };
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: string;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  reviewer: {
    id: string;
    email: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateTasksResult {
  createdCount: number;
  skippedCount: number;
  tasks: TaskSummary[];
}

export interface ClientLogInput {
  entityId?: string;
  entityType?: string;
  event: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export async function createSupabaseBrowserClient() {
  if (supabaseBrowserClientPromise) {
    return supabaseBrowserClientPromise;
  }

  supabaseBrowserClientPromise = createSupabaseBrowserClientFromApi();

  return supabaseBrowserClientPromise;
}

async function createSupabaseBrowserClientFromApi() {
  const response = await fetch(`${apiUrl}/api/config`);

  if (!response.ok) {
    throw new Error("Unable to load Supabase configuration from the API.");
  }

  const config = (await response.json()) as BackendConfig;

  return createClient(config.supabase.url, config.supabase.anonKey);
}

export async function syncAuthenticatedUser(session: Session) {
  const response = await fetch(`${apiUrl}/api/auth/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to sync authenticated user.");
  }

  return ((await response.json()) as { user: ApiUser }).user;
}

export async function listOrganizations(session: Session) {
  const response = await authenticatedFetch(session, "/api/organizations");

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to load organizations.");
  }

  return ((await response.json()) as { organizations: OrganizationSummary[] }).organizations;
}

export async function createOrganization(session: Session, input: CreateOrganizationInput) {
  const response = await authenticatedFetch(session, "/api/organizations", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Unable to create organization.");
  }

  return (await response.json()) as {
    organization: {
      id: string;
      name: string;
      slug: string;
      type: string;
      planTier: string;
    };
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
}

export async function listProjects(session: Session) {
  const response = await authenticatedFetch(session, "/api/projects");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load projects."));
  }

  return ((await response.json()) as { projects: ProjectSummary[] }).projects;
}

export async function getProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function createProject(session: Session, input: CreateProjectInput) {
  const response = await authenticatedFetch(session, "/api/projects", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

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

export async function listAssets(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/assets${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load assets."));
  }

  return ((await response.json()) as { assets: AssetSummary[] }).assets;
}

export async function createAsset(session: Session, input: CreateAssetInput) {
  const response = await authenticatedFetch(session, "/api/assets", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to register asset."));
  }

  return ((await response.json()) as { asset: AssetSummary }).asset;
}

export async function createAssetUploadUrl(session: Session, input: AssetUploadRequest) {
  const response = await authenticatedFetch(session, "/api/assets/upload-url", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create R2 upload URL."));
  }

  return (await response.json()) as AssetUploadUrl;
}

export async function getAssetAccessUrl(session: Session, assetId: string) {
  const response = await authenticatedFetch(session, `/api/assets/${encodeURIComponent(assetId)}/access-url`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create asset access URL."));
  }

  return (await response.json()) as AssetAccessUrl;
}

export async function listTasks(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load tasks."));
  }

  return ((await response.json()) as { tasks: TaskSummary[] }).tasks;
}

export async function generateTasksFromDataset(session: Session, datasetId: string) {
  const response = await authenticatedFetch(session, "/api/tasks/generate-from-dataset", {
    method: "POST",
    body: JSON.stringify({ datasetId })
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to generate tasks."));
  }

  return (await response.json()) as GenerateTasksResult;
}

export async function assignTaskToSelf(session: Session, taskId: string) {
  return updateTask(session, taskId, "assign-self");
}

export async function startTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "start");
}

export async function submitTask(session: Session, taskId: string) {
  return updateTask(session, taskId, "submit");
}

export async function uploadFileToSignedUrl(file: File, upload: AssetUploadUrl["upload"]) {
  let response: Response;

  try {
    response = await fetch(upload.uploadUrl, {
      method: upload.method,
      headers: upload.headers,
      body: file
    });
  } catch (error) {
    throw new Error(
      "R2 upload could not reach Cloudflare. Check the bucket CORS policy for http://localhost:5173, confirm R2_ENDPOINT uses the r2.cloudflarestorage.com endpoint, then run pnpm check:r2-cors."
    );
  }

  if (!response.ok) {
    throw new Error(
      `R2 upload failed with status ${response.status}. Check the bucket CORS settings and R2 credentials, then run pnpm check:r2-cors.`
    );
  }
}

export async function logClientEvent(session: Session, input: ClientLogInput) {
  const response = await authenticatedFetch(session, "/api/logs/client", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save client log."));
  }
}

function authenticatedFetch(session: Session, path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

async function updateTask(session: Session, taskId: string, action: "assign-self" | "start" | "submit") {
  const response = await authenticatedFetch(session, `/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update task."));
  }

  return ((await response.json()) as { task: TaskSummary }).task;
}

async function getApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  return payload.error ?? fallback;
}

function removeEmptyValues<T extends object>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== "")
  );
}

export type { SupabaseClient };
