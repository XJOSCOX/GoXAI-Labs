import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export { createPrismaClient, getPrismaClient } from "./prisma.js";
export type * from "@prisma/client";

export type SupabaseEnvironment = Record<string, string | undefined>;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  databaseUrl?: string;
  missing: string[];
  isConfigured: boolean;
}

const REQUIRED_PUBLIC_KEYS = ["SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;

export function getSupabaseConfig(env: SupabaseEnvironment = process.env): SupabaseConfig {
  const url = env.SUPABASE_URL?.trim() ?? "";
  const anonKey = env.SUPABASE_ANON_KEY?.trim() ?? "";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  const values = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey
  };

  const missing = REQUIRED_PUBLIC_KEYS.filter((key) => values[key].length === 0);

  return {
    url,
    anonKey,
    serviceRoleKey: serviceRoleKey || undefined,
    databaseUrl: databaseUrl || undefined,
    missing,
    isConfigured: missing.length === 0
  };
}

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient {
  assertSupabaseConfigured(config);

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function createSupabaseUserClient(
  accessToken: string,
  config: SupabaseConfig
): SupabaseClient {
  assertSupabaseConfigured(config);

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

export function createSupabaseAdminClient(config: SupabaseConfig): SupabaseClient {
  assertSupabaseConfigured(config);

  if (!config.serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin Supabase operations.");
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function assertSupabaseConfigured(config: SupabaseConfig): void {
  if (!config.isConfigured) {
    throw new Error(`Missing Supabase environment variables: ${config.missing.join(", ")}`);
  }
}
