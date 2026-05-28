import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { CreateProjectInput, ProjectSummary, UpdateProjectInput } from "./types";
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

export async function updateProject(session: Session, projectId: string, input: UpdateProjectInput) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function archiveProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}/archive`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to archive project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function restoreProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}/restore`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to restore project."));
  }

  return ((await response.json()) as { project: ProjectSummary }).project;
}

export async function deleteProject(session: Session, projectId: string) {
  const response = await authenticatedFetch(session, `/api/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete project."));
  }

  return (await response.json()) as { deleted: boolean };
}
