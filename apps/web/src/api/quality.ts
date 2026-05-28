import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError } from "./http";
import type { QualityStatsResult } from "./types";
export async function getQualityStats(session: Session, input: { datasetId?: string; projectId?: string } = {}) {
  const params = new URLSearchParams();

  if (input.datasetId) {
    params.set("datasetId", input.datasetId);
  }

  if (input.projectId) {
    params.set("projectId", input.projectId);
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/tasks/quality${query ? `?${query}` : ""}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load quality stats."));
  }

  return ((await response.json()) as { quality: QualityStatsResult }).quality;
}
