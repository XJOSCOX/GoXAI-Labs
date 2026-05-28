import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError } from "./http";
import type { ClientLogInput } from "./types";
export async function logClientEvent(session: Session, input: ClientLogInput) {
  const response = await authenticatedFetch(session, "/api/logs/client", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to save client log."));
  }
}
