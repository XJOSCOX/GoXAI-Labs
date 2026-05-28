import type { TaskFolderEarningSummary, TaskSummary } from "../../../api";

export type TaskReviewSettlementDisplay = {
  currency: string;
  escrowCredits: number;
  escrowText: string;
  platformFeeCredits: number;
  platformFeeText: string;
  refundCredits: number;
  refundText: string;
  workerCredits: number;
  workerText: string;
};

export function getTaskPaymentDisplay(task: TaskSummary, mode: "review" | "work" = "work") {
  const payment = task.payment ?? {
    annotationCredits: 0,
    currency: "USD",
    platformFeeCredits: 0,
    reviewCredits: 0,
    totalCredits: 0,
    workerCredits: 0
  };
  const activeCredits = mode === "review" ? payment.reviewCredits : payment.annotationCredits;
  const label = mode === "review" ? "Review" : "Task";

  return {
    activeCredits,
    activeText: formatTaskCredits(activeCredits, payment.currency),
    label,
    totalCredits: payment.totalCredits,
    totalText: formatTaskCredits(payment.totalCredits, payment.currency)
  };
}

export function getTaskReviewSettlementDisplay(task: TaskSummary): TaskReviewSettlementDisplay {
  const payment = task.payment ?? {
    annotationCredits: 0,
    currency: "USD",
    platformFeeCredits: 0,
    reviewCredits: 0,
    totalCredits: 0,
    workerCredits: 0
  };
  const currency = payment.currency;
  const workerCredits = Math.max(0, payment.workerCredits || payment.annotationCredits + payment.reviewCredits);
  const platformFeeCredits = Math.max(0, payment.platformFeeCredits);
  const escrowCredits = Math.max(0, payment.totalCredits || workerCredits + platformFeeCredits);
  const refundCredits = Math.max(0, escrowCredits - workerCredits - platformFeeCredits);

  return {
    currency,
    escrowCredits,
    escrowText: formatTaskCredits(escrowCredits, currency),
    platformFeeCredits,
    platformFeeText: formatTaskCredits(platformFeeCredits, currency),
    refundCredits,
    refundText: formatTaskCredits(refundCredits, currency),
    workerCredits,
    workerText: formatTaskCredits(workerCredits, currency)
  };
}

export function formatReviewSettlementMessage(settlement: TaskReviewSettlementDisplay) {
  return `Worker credited ${settlement.workerText}, platform fee ${settlement.platformFeeText}, creator refund ${settlement.refundText}.`;
}

export function formatTaskCredits(credits: number, currency: string) {
  const safeCredits = Number.isFinite(credits) ? Math.max(0, credits) : 0;
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";

  return new Intl.NumberFormat("en-US", {
    currency: safeCurrency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(safeCredits / 100);
}

export function formatTaskFolderEarnings(earnings: TaskFolderEarningSummary[]) {
  if (earnings.length === 0) {
    return formatTaskCredits(0, "USD");
  }

  const visible = earnings.slice(0, 2).map((item) => formatTaskCredits(item.credits, item.currency));

  if (earnings.length > visible.length) {
    visible.push(`+${earnings.length - visible.length} more`);
  }

  return visible.join(" / ");
}
