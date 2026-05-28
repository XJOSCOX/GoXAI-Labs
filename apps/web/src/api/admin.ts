import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, getApiError, getDownloadFileName, removeEmptyValues } from "./http";
import type {
  AdminApplicationSummary,
  AdminFundingSourceSummary,
  AdminPaymentIntentDetail,
  AdminPaymentIntentSummary,
  AdminOverview,
  AdminPayoutDetail,
  AdminPayoutSummary,
  AdminUserSummary,
  DownloadFileResult,
  PlatformFeatures,
  PlatformTaskEconomics
} from "./types";
export async function getAdminOverview(session: Session) {
  const response = await authenticatedFetch(session, "/api/admin/overview");

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load admin panel."));
  }

  return (await response.json()) as AdminOverview;
}

export async function reviewAdminApplication(
  session: Session,
  type: "verification" | "creator",
  applicationId: string,
  decision: "approve" | "reject",
  reviewerNotes?: string
) {
  const response = await authenticatedFetch(
    session,
    `/api/admin/applications/${type}/${encodeURIComponent(applicationId)}/${decision}`,
    {
      method: "POST",
      body: JSON.stringify(removeEmptyValues({ reviewerNotes }))
    }
  );

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to review application."));
  }

  return ((await response.json()) as { application: AdminApplicationSummary }).application;
}

export async function updateAdminUser(
  session: Session,
  userId: string,
  input: {
    verificationStatus?: string;
    creatorStatus?: string;
    globalRole?: string;
    status?: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update user."));
  }

  return ((await response.json()) as { user: AdminUserSummary }).user;
}

export async function updateAdminFeatures(
  session: Session,
  input: {
    aiEnabled: boolean;
    payments?: Partial<PlatformFeatures["payments"]>;
  }
) {
  const response = await authenticatedFetch(session, "/api/admin/settings/features", {
    method: "PATCH",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update platform features."));
  }

  return ((await response.json()) as { features: PlatformFeatures }).features;
}

export async function updateAdminEconomics(
  session: Session,
  input: PlatformTaskEconomics & { applyToExistingTasks?: boolean }
) {
  const response = await authenticatedFetch(session, "/api/admin/settings/economics", {
    method: "PATCH",
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update platform economics."));
  }

  return (await response.json()) as {
    economics: PlatformTaskEconomics;
    existingTaskUpdate: { heldCredits: number; skippedCount: number; updatedCount: number } | null;
    mode: string;
  };
}

export async function disableAdminFundingSource(session: Session, fundingSourceId: string) {
  const response = await authenticatedFetch(session, `/api/admin/funding-sources/${encodeURIComponent(fundingSourceId)}/disable`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to disable funding source."));
  }

  return ((await response.json()) as { fundingSource: AdminFundingSourceSummary }).fundingSource;
}

export async function enableAdminFundingSource(session: Session, fundingSourceId: string) {
  const response = await authenticatedFetch(session, `/api/admin/funding-sources/${encodeURIComponent(fundingSourceId)}/enable`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to enable funding source."));
  }

  return ((await response.json()) as { fundingSource: AdminFundingSourceSummary }).fundingSource;
}

export async function cancelAdminPaymentIntent(
  session: Session,
  paymentIntentId: string,
  input: { adminNotes?: string } = {}
) {
  const response = await authenticatedFetch(session, `/api/admin/payment-intents/${encodeURIComponent(paymentIntentId)}/cancel`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to cancel payment intent."));
  }

  return ((await response.json()) as { paymentIntent: AdminPaymentIntentSummary }).paymentIntent;
}

export async function getAdminPaymentIntentDetail(session: Session, paymentIntentId: string) {
  const response = await authenticatedFetch(session, `/api/admin/payment-intents/${encodeURIComponent(paymentIntentId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load payment detail."));
  }

  return ((await response.json()) as { paymentIntent: AdminPaymentIntentDetail }).paymentIntent;
}

export async function recordAdminPaymentRefund(
  session: Session,
  paymentIntentId: string,
  input: {
    adminNotes?: string;
    amount?: number;
    providerRef: string;
  }
) {
  const response = await authenticatedFetch(session, `/api/admin/payment-intents/${encodeURIComponent(paymentIntentId)}/refund`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to record payment refund."));
  }

  return ((await response.json()) as { paymentIntent: AdminPaymentIntentSummary }).paymentIntent;
}

export async function downloadAdminPaymentReceipts(session: Session, paymentIntentId: string): Promise<DownloadFileResult> {
  const response = await authenticatedFetch(session, `/api/admin/payment-intents/${encodeURIComponent(paymentIntentId)}/receipts`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to download payment receipts."));
  }

  return {
    blob: await response.blob(),
    fileName: getDownloadFileName(response.headers.get("content-disposition")) ?? `payment-receipts-${paymentIntentId}.json`
  };
}

export async function reviewAdminPayout(
  session: Session,
  payoutId: string,
  decision: "processing" | "paid" | "cancel" | "fail",
  input: { adminNotes?: string; provider?: string; providerRef?: string } = {}
) {
  const response = await authenticatedFetch(session, `/api/admin/payouts/${encodeURIComponent(payoutId)}/${decision}`, {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to update payout."));
  }

  return ((await response.json()) as { payout: AdminPayoutSummary }).payout;
}

export async function getAdminPayoutDetail(session: Session, payoutId: string) {
  const response = await authenticatedFetch(session, `/api/admin/payouts/${encodeURIComponent(payoutId)}`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to load payout detail."));
  }

  return ((await response.json()) as { payout: AdminPayoutDetail }).payout;
}

export async function downloadAdminPayoutReceipt(session: Session, payoutId: string): Promise<DownloadFileResult> {
  const response = await authenticatedFetch(session, `/api/admin/payouts/${encodeURIComponent(payoutId)}/receipt`);

  if (!response.ok) {
    throw new Error(await getApiError(response, "Unable to download payout receipt."));
  }

  return {
    blob: await response.blob(),
    fileName: getDownloadFileName(response.headers.get("content-disposition")) ?? `payout-receipt-${payoutId}.json`
  };
}
