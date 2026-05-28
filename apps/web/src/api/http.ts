import type { Session } from "@supabase/supabase-js";

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown = null
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function authenticatedFetch(session: Session, path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers
    }
  });
}

export async function getApiError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  return payload.error ?? fallback;
}

export async function buildApiRequestError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  return new ApiRequestError(payload.error ?? fallback, response.status, payload);
}

export async function ensureOk(response: Response, fallback: string) {
  if (!response.ok) {
    throw await buildApiRequestError(response, fallback);
  }
}

export function removeEmptyValues<T extends object>(input: T) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== "")
  );
}

export function getDownloadFileName(contentDisposition: string | null) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);

  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);

  return asciiMatch?.[1] ?? null;
}
