import type { Session } from "@supabase/supabase-js";
import { authenticatedFetch, ensureOk, getDownloadFileName, removeEmptyValues } from "./http";
import type {
  CreatorLedgerFilter,
  CreatorLedgerPageResult,
  CreatorWalletExportFormat,
  CreatorWalletFundingSourceDetail,
  CreatorWalletFundingSourceSummary,
  CreatorWalletPlaidBankLinkResult,
  CreatorWalletPlaidLinkTokenResult,
  CreatorWalletPayPalCaptureResult,
  CreatorWalletPayPalOrderResult,
  CreatorWalletPaymentIntentSummary,
  CreatorWalletStripeCheckoutResult,
  CreatorWalletStripeCompleteResult,
  CreatorWalletSummary,
  CreatorWalletTopUpResult,
  DownloadFileResult,
  WalletReceiptSummary,
  WorkerWalletSummary,
  WorkerWithdrawalResult
} from "./types";
export async function getCreatorWalletSummary(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/creator-summary");

  await ensureOk(response, "Unable to load creator wallet.");

  return ((await response.json()) as { wallet: CreatorWalletSummary }).wallet;
}

export async function topUpCreatorWallet(
  session: Session,
  input: { amount: number; currency?: string; organizationId?: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-top-up", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  await ensureOk(response, "Unable to top up creator wallet.");

  return (await response.json()) as CreatorWalletTopUpResult;
}

export async function createCreatorPayPalOrder(
  session: Session,
  input: { amount: number; currency?: string; organizationId?: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-paypal-order", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  await ensureOk(response, "Unable to start PayPal checkout.");

  return (await response.json()) as CreatorWalletPayPalOrderResult;
}

export async function captureCreatorPayPalOrder(
  session: Session,
  input: { orderId: string; paymentIntentId: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-paypal-capture", {
    method: "POST",
    body: JSON.stringify(input)
  });

  await ensureOk(response, "Unable to capture PayPal checkout.");

  return (await response.json()) as CreatorWalletPayPalCaptureResult;
}

export async function cancelCreatorPayPalOrder(session: Session, input: { paymentIntentId: string }) {
  const response = await authenticatedFetch(session, "/api/billing/creator-paypal-cancel", {
    method: "POST",
    body: JSON.stringify(input)
  });

  await ensureOk(response, "Unable to cancel PayPal checkout.");

  return ((await response.json()) as { paymentIntent: CreatorWalletPaymentIntentSummary }).paymentIntent;
}

export async function createCreatorStripeCheckoutSession(
  session: Session,
  input: { amount: number; currency?: string; organizationId?: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-stripe-checkout-session", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  await ensureOk(response, "Unable to start Stripe checkout.");

  return (await response.json()) as CreatorWalletStripeCheckoutResult;
}

export async function createCreatorStripeAchCheckoutSession(
  session: Session,
  input: { amount: number; currency?: string; fundingSourceId: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-stripe-ach-checkout-session", {
    method: "POST",
    body: JSON.stringify(removeEmptyValues(input))
  });

  await ensureOk(response, "Unable to start ACH checkout.");

  return (await response.json()) as CreatorWalletStripeCheckoutResult;
}

export async function completeCreatorStripeCheckout(
  session: Session,
  input: { paymentIntentId: string; sessionId: string }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-stripe-complete", {
    method: "POST",
    body: JSON.stringify(input)
  });

  await ensureOk(response, "Unable to confirm Stripe checkout.");

  return (await response.json()) as CreatorWalletStripeCompleteResult;
}

export async function cancelCreatorStripeCheckout(session: Session, input: { paymentIntentId: string }) {
  const response = await authenticatedFetch(session, "/api/billing/creator-stripe-cancel", {
    method: "POST",
    body: JSON.stringify(input)
  });

  await ensureOk(response, "Unable to cancel Stripe checkout.");

  return ((await response.json()) as { paymentIntent: CreatorWalletPaymentIntentSummary }).paymentIntent;
}

export async function createCreatorPlaidLinkToken(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/creator-plaid-link-token", {
    method: "POST"
  });

  await ensureOk(response, "Unable to start Plaid bank link.");

  return (await response.json()) as CreatorWalletPlaidLinkTokenResult;
}

export async function linkCreatorPlaidStripeBankAccount(
  session: Session,
  input: {
    accountId: string;
    accountMask?: string;
    accountName?: string;
    accountSubtype?: string;
    accountType?: string;
    institutionName?: string;
    organizationId?: string;
    publicToken: string;
  }
) {
  const response = await authenticatedFetch(session, "/api/billing/creator-plaid-stripe-bank-token", {
    method: "POST",
    body: JSON.stringify(input)
  });

  await ensureOk(response, "Unable to link bank account.");

  return (await response.json()) as CreatorWalletPlaidBankLinkResult;
}

export async function listCreatorFundingSources(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/creator-funding-sources");

  await ensureOk(response, "Unable to load funding sources.");

  return ((await response.json()) as { fundingSources: CreatorWalletFundingSourceSummary[] }).fundingSources;
}

export async function getCreatorFundingSourceDetail(session: Session, fundingSourceId: string) {
  const response = await authenticatedFetch(session, `/api/billing/creator-funding-sources/${encodeURIComponent(fundingSourceId)}`);

  await ensureOk(response, "Unable to load funding source.");

  return (await response.json()) as CreatorWalletFundingSourceDetail;
}

export async function disableCreatorFundingSource(session: Session, fundingSourceId: string) {
  const response = await authenticatedFetch(session, `/api/billing/creator-funding-sources/${encodeURIComponent(fundingSourceId)}/disable`, {
    method: "POST"
  });

  await ensureOk(response, "Unable to disable funding source.");

  return ((await response.json()) as { fundingSource: CreatorWalletFundingSourceSummary }).fundingSource;
}

export async function listCreatorPaymentIntents(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/creator-payment-intents");

  await ensureOk(response, "Unable to load wallet payments.");

  return ((await response.json()) as { paymentIntents: CreatorWalletPaymentIntentSummary[] }).paymentIntents;
}

export async function downloadCreatorWalletExport(
  session: Session,
  format: CreatorWalletExportFormat
): Promise<DownloadFileResult> {
  const response = await authenticatedFetch(session, `/api/billing/creator-ledger-export?format=${format}`);

  await ensureOk(response, "Unable to export creator wallet ledger.");

  return {
    blob: await response.blob(),
    fileName: getDownloadFileName(response.headers.get("content-disposition")) ?? `creator-wallet-ledger.${format}`
  };
}

export async function listCreatorWalletLedger(
  session: Session,
  input: {
    filter?: CreatorLedgerFilter;
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}
) {
  const params = new URLSearchParams();

  if (input.filter && input.filter !== "all") {
    params.set("filter", input.filter);
  }

  if (input.page) {
    params.set("page", String(input.page));
  }

  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }

  if (input.search?.trim()) {
    params.set("search", input.search.trim());
  }

  const query = params.toString();
  const response = await authenticatedFetch(session, `/api/billing/creator-ledger${query ? `?${query}` : ""}`);

  await ensureOk(response, "Unable to load creator wallet ledger.");

  return (await response.json()) as CreatorLedgerPageResult;
}

export async function getWorkerWalletSummary(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/worker-summary");

  await ensureOk(response, "Unable to load worker wallet.");

  return ((await response.json()) as { wallet: WorkerWalletSummary }).wallet;
}

export async function requestWorkerWithdrawal(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/worker-withdrawal", {
    method: "POST"
  });

  await ensureOk(response, "Unable to request withdrawal.");

  return (await response.json()) as WorkerWithdrawalResult;
}

export async function listWalletReceipts(session: Session) {
  const response = await authenticatedFetch(session, "/api/billing/receipts");

  await ensureOk(response, "Unable to load wallet receipts.");

  return ((await response.json()) as { receipts: WalletReceiptSummary[] }).receipts;
}

export async function downloadWalletReceipt(session: Session, receiptId: string): Promise<DownloadFileResult> {
  const response = await authenticatedFetch(session, `/api/billing/receipts/${encodeURIComponent(receiptId)}/download`);

  await ensureOk(response, "Unable to download wallet receipt.");

  return {
    blob: await response.blob(),
    fileName: getDownloadFileName(response.headers.get("content-disposition")) ?? `wallet-receipt-${receiptId}.json`
  };
}
