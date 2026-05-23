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

export async function createSupabaseBrowserClient() {
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

export type { SupabaseClient };
