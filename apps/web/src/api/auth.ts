import { createClient, type Session } from "@supabase/supabase-js";
import { apiUrl, authenticatedFetch, getApiError, removeEmptyValues } from "./http";
import type { ApiUser, BackendConfig, UserApplicationSummary } from "./types";

let supabaseBrowserClientPromise: ReturnType<typeof createSupabaseBrowserClientFromApi> | null = null;
let backendConfigPromise: Promise<BackendConfig> | null = null;

export async function loadBackendConfig() {
  if (!backendConfigPromise) {
    backendConfigPromise = fetchBackendConfig();
  }

  return backendConfigPromise;
}

export async function createSupabaseBrowserClient() {
  if (supabaseBrowserClientPromise) {
    return supabaseBrowserClientPromise;
  }

  supabaseBrowserClientPromise = createSupabaseBrowserClientFromApi();

  return supabaseBrowserClientPromise;
}

async function createSupabaseBrowserClientFromApi() {
  const config = await loadBackendConfig();

  return createClient(config.supabase.url, config.supabase.anonKey);
}

async function fetchBackendConfig() {
  const response = await fetch(`${apiUrl}/api/config`);

  if (!response.ok) {
    throw new Error("Unable to load Supabase configuration from the API.");
  }

  const config = (await response.json()) as BackendConfig;

  return {
    ...config,
    economics: config.economics ?? {
      freeTaskPostingFeeCredits: 0,
      platformFeeRate: 0.3
    },
    features: config.features ?? { aiEnabled: false }
  };
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

export async function resolveLoginEmail(identifier: string) {
  const params = new URLSearchParams({ identifier });
  const response = await fetch(`${apiUrl}/api/auth/login-identifier?${params.toString()}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to resolve login email."));
  }

  return ((await response.json()) as { email: string }).email;
}

export async function updateUserProfile(
  session: Session,
  input: { firstName?: string; lastName?: string; jobTitle?: string }
) {
  const response = await authenticatedFetch(session, "/api/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update profile."));
  }

  return ((await response.json()) as { user: ApiUser }).user;
}

export async function getMyApplications(session: Session) {
  const response = await authenticatedFetch(session, "/api/applications/me");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load applications."));
  }

  return (await response.json()) as {
    verificationApplication: UserApplicationSummary | null;
    creatorApplication: UserApplicationSummary | null;
  };
}

export async function submitVerificationApplication(
  session: Session,
  input: { fullName: string; reason: string; intendedUse?: string }
) {
  const response = await authenticatedFetch(session, "/api/applications/verification", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit verification application."));
  }

  return ((await response.json()) as { application: UserApplicationSummary }).application;
}

export async function submitCreatorApplication(session: Session, input: { reason: string; intendedUse?: string }) {
  const response = await authenticatedFetch(session, "/api/applications/creator", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to submit creator application."));
  }

  return ((await response.json()) as { application: UserApplicationSummary }).application;
}
