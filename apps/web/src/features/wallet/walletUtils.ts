import { type CreatorLedgerFilter, type CreatorLedgerPageResult, type WorkerWalletSummary } from "../../api";

export const walletPageSize = 8;

export type WalletView = "creator" | "worker";
export type WalletQueryUpdate = {
  filter?: CreatorLedgerFilter;
  page?: number;
  search?: string;
  view?: WalletView;
};
export type CreatorWalletLedger = CreatorLedgerPageResult;
export type CreatorWalletSnapshot = NonNullable<CreatorWalletLedger["wallet"]>;

export const walletLedgerFilters: Array<{ label: string; value: CreatorLedgerFilter }> = [
  { label: "All", value: "all" },
  { label: "Top-ups", value: "credit" },
  { label: "Escrow", value: "escrow" },
  { label: "Paid", value: "paid" },
  { label: "Fees", value: "fee" },
  { label: "Refunds", value: "refund" }
];

export function getWalletView(value: string | null): WalletView {
  return value === "worker" ? "worker" : "creator";
}

export function getLedgerFilter(value: string | null): CreatorLedgerFilter {
  return walletLedgerFilters.some((option) => option.value === value) ? (value as CreatorLedgerFilter) : "all";
}

export function getPageParam(value: string | null) {
  const page = value ? Number(value) : 1;

  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function formatCreatorLedgerType(type: string) {
  if (type === "CREDIT") {
    return "Top-up";
  }

  if (type === "HOLD") {
    return "Escrow hold";
  }

  if (type === "RELEASE") {
    return "Worker payment";
  }

  if (type === "FEE") {
    return "Platform fee";
  }

  if (type === "REFUND") {
    return "Refund";
  }

  return formatEnumText(type);
}

export function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatEnumText(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function emptyWorkerWallet(): WorkerWalletSummary {
  return {
    approvedBalance: 0,
    approvedCreditCount: 0,
    availableBalance: 0,
    availableCreditCount: 0,
    currency: "USD",
    holdDays: 7,
    nextAvailableAt: null,
    paidWithdrawalBalance: 0,
    pendingWithdrawalBalance: 0,
    pendingWithdrawalCount: 0,
    payouts: [],
    recentEvents: [],
    totalEarnedBalance: 0,
    underReviewBalance: 0,
    underReviewCreditCount: 0,
    withdrawnBalance: 0
  };
}
