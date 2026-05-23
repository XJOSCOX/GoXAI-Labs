import { createSupabaseUserClient, getSupabaseConfig } from "@goxai/database";

export async function getUserFromAccessToken(accessToken: string) {
  const config = getSupabaseConfig();
  const supabase = createSupabaseUserClient(accessToken, config);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    throw error;
  }

  return data.user;
}
