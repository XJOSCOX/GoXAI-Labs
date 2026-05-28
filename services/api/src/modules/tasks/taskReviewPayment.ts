import { LedgerEntryType } from "@goxai/database";

type ReviewSettlementLedgerEntry = {
  currency: string;
  metadata: unknown;
  type: LedgerEntryType;
};

type ReviewForPaymentBackfill = {
  id: string;
  metadata: unknown;
};

type TaskForPaymentBackfill = {
  metadata: unknown;
};

type PaymentSettlement = {
  approvedCredits: number;
  currency: string;
  escrowCredits: number;
  feeCredits: number;
  refundCredits: number;
};

export function backfillReviewPaymentSettlements<TReview extends ReviewForPaymentBackfill>(
  reviews: TReview[],
  input: {
    ledgerEntries: ReviewSettlementLedgerEntry[];
    task: TaskForPaymentBackfill;
  }
) {
  if (reviews.length === 0 || input.ledgerEntries.length === 0) {
    return reviews;
  }

  return reviews.map((review) => {
    const metadata = isRecord(review.metadata) ? review.metadata : {};

    if (isRecord(metadata.paymentSettlement)) {
      return review;
    }

    const settlement = buildReviewPaymentSettlement(review.id, input.task, input.ledgerEntries);

    if (!settlement) {
      return review;
    }

    return {
      ...review,
      metadata: {
        ...metadata,
        paymentSettlement: settlement
      }
    };
  });
}

function buildReviewPaymentSettlement(
  reviewId: string,
  task: TaskForPaymentBackfill,
  ledgerEntries: ReviewSettlementLedgerEntry[]
): PaymentSettlement | null {
  const matchingEntries = ledgerEntries.filter((entry) => {
    const metadata = isRecord(entry.metadata) ? entry.metadata : {};
    return metadata.reviewId === reviewId;
  });

  if (matchingEntries.length === 0) {
    return null;
  }

  let approvedCredits = 0;
  let feeCredits = 0;
  let refundCredits = 0;
  let escrowCredits = 0;
  const currency = matchingEntries[0]?.currency ?? getTaskPaymentCurrency(task.metadata);

  for (const entry of matchingEntries) {
    const metadata = isRecord(entry.metadata) ? entry.metadata : {};

    if (entry.type === LedgerEntryType.RELEASE) {
      approvedCredits += getCreditValue(metadata.approvedCredits);
    }

    if (entry.type === LedgerEntryType.FEE) {
      feeCredits += getCreditValue(metadata.feeCredits);
    }

    if (entry.type === LedgerEntryType.REFUND) {
      refundCredits += getCreditValue(metadata.refundCredits);
      escrowCredits = Math.max(escrowCredits, getCreditValue(metadata.escrowCredits));
    }
  }

  const inferredEscrowCredits = approvedCredits + feeCredits + refundCredits;
  escrowCredits = Math.max(escrowCredits, inferredEscrowCredits);

  if (inferredEscrowCredits <= 0) {
    return null;
  }

  return {
    approvedCredits,
    currency,
    escrowCredits,
    feeCredits,
    refundCredits
  };
}

function getTaskPaymentCurrency(metadata: unknown) {
  const record = isRecord(metadata) ? metadata : {};
  return typeof record.paymentCurrency === "string" && record.paymentCurrency.trim()
    ? record.paymentCurrency
    : "USD";
}

function getCreditValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
