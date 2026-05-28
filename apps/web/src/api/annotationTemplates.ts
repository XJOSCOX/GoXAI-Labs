import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { AnnotationCategorySummary, AnnotationTemplateSummary, BuiltInAnnotationTemplateGroup, BuiltInAnnotationTemplateSummary } from "./types";
export async function listAnnotationTemplates(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load annotation templates."));
  }

  return ((await response.json()) as { templates: AnnotationTemplateSummary[] }).templates;
}

export async function listBuiltInAnnotationTemplates(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/builtins");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load built-in annotation templates."));
  }

  return (await response.json()) as {
    groups: BuiltInAnnotationTemplateGroup[];
    templates: BuiltInAnnotationTemplateSummary[];
  };
}

export async function listAnnotationCategories(session: Session) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/categories");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load annotation categories."));
  }

  return ((await response.json()) as { categories: AnnotationCategorySummary[] }).categories;
}

export async function createAnnotationCategory(
  session: Session,
  input: {
    description?: string;
    name: string;
    organizationId?: string | null;
  }
) {
  const response = await authenticatedFetch(session, "/api/annotation-templates/categories", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create annotation category."));
  }

  return ((await response.json()) as { category: AnnotationCategorySummary }).category;
}

export async function updateAnnotationCategory(
  session: Session,
  categoryId: string,
  input: {
    description?: string;
    name?: string;
  }
) {
  const response = await authenticatedFetch(
    session,
    `/api/annotation-templates/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(removeEmptyValues(input))
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update annotation category."));
  }

  return ((await response.json()) as { category: AnnotationCategorySummary }).category;
}

export async function deleteAnnotationCategory(session: Session, categoryId: string) {
  const response = await authenticatedFetch(
    session,
    `/api/annotation-templates/categories/${encodeURIComponent(categoryId)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete annotation category."));
  }

  return (await response.json()) as { deleted: boolean };
}

export async function createAnnotationTemplate(
  session: Session,
  input: {
    categoryId: string;
    configJson: Record<string, unknown>;
    dataType: string;
    description?: string;
    name: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/annotation-templates", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to create annotation template."));
  }

  return ((await response.json()) as { template: AnnotationTemplateSummary }).template;
}

export async function updateAnnotationTemplate(
  session: Session,
  templateId: string,
  input: {
    categoryId?: string;
    configJson?: Record<string, unknown>;
    dataType?: string;
    description?: string;
    name?: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/annotation-templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update annotation template."));
  }

  return ((await response.json()) as { template: AnnotationTemplateSummary }).template;
}

export async function deleteAnnotationTemplate(session: Session, templateId: string) {
  const response = await authenticatedFetch(session, `/api/annotation-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to delete annotation template."));
  }

  return (await response.json()) as { deleted: boolean };
}
