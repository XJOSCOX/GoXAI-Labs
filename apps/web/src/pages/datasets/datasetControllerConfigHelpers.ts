import type { DatasetSummary, PlatformTaskEconomics, TaskWorkflowInput } from "../../api";

export const priorityPresets = [
  { label: "Normal", value: "0" },
  { label: "High", value: "5" },
  { label: "Urgent", value: "10" }
];

export type DatasetTaskAssignmentMode = NonNullable<TaskWorkflowInput["assignmentMode"]>;

export type DatasetWorkflowDraft = {
  assignedToId: string;
  assigneeIds: string[];
  assignmentMode: DatasetTaskAssignmentMode;
  dueAt: string;
  priority: string;
  reviewerId: string;
};

export type DatasetQualityDraft = {
  autoSampleReview: boolean;
  minAgreementRate: string;
  minQualityScore: string;
  requireConsensusBeforeApproval: boolean;
  samplingTargetRate: string;
};

export type DatasetPaymentDraft = {
  datasetBudget: string;
  currency: string;
  reviewShare: string;
};

export type DatasetBudgetPreview = {
  annotationCredits: number;
  baseGrossTaskCredits: number;
  baseWorkerTaskCredits: number;
  bonusTaskCount: number;
  datasetBudgetCredits: number;
  grossBonusTaskCount: number;
  platformFeeCredits: number;
  perTaskCredits: number;
  reviewCredits: number;
  taskBudgetBasis: number;
  totalReservedCredits: number;
  unusedCredits: number;
  workerBonusTaskCount: number;
  workerBudgetCredits: number;
};

export const defaultTaskEconomics: PlatformTaskEconomics = {
  freeTaskPostingFeeCredits: 0,
  platformFeeRate: 0.3
};

export type DatasetPaymentHistoryEntry = {
  changedAt: string;
  changedById: string | null;
  fromBudgetCredits: number;
  reason: string;
  toBudgetCredits: number;
};

export function getDatasetWorkflowDraft(dataset: DatasetSummary): DatasetWorkflowDraft {
  const defaults = isRecord(dataset.metadata) && isRecord(dataset.metadata.taskWorkflowDefaults) ? dataset.metadata.taskWorkflowDefaults : null;
  const assignedToId = getOptionalString(defaults?.assignedToId);
  const assigneeIds = Array.isArray(defaults?.assigneeIds)
    ? [...new Set(defaults.assigneeIds.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : [];
  const assignmentMode = getDatasetAssignmentMode(defaults?.assignmentMode, assignedToId, assigneeIds);

  return {
    assignedToId: assignmentMode === "single" ? assignedToId : "",
    assigneeIds: assignmentMode === "round_robin" ? assigneeIds : [],
    assignmentMode,
    dueAt: getDateTimeLocalValue(defaults?.dueAt),
    priority: getPriorityDraftValue(defaults?.priority),
    reviewerId: getOptionalString(defaults?.reviewerId)
  };
}

export function getDatasetQualityDraft(dataset: DatasetSummary): DatasetQualityDraft {
  const policy = isRecord(dataset.metadata) && isRecord(dataset.metadata.qualityPolicy) ? dataset.metadata.qualityPolicy : null;

  return {
    autoSampleReview: getOptionalBoolean(policy?.autoSampleReview, true),
    minAgreementRate: getPercentDraftValue(policy?.minAgreementRate, 80),
    minQualityScore: getQualityScoreDraftValue(policy?.minQualityScore, 75),
    requireConsensusBeforeApproval: getOptionalBoolean(policy?.requireConsensusBeforeApproval, false),
    samplingTargetRate: getPercentDraftValue(policy?.samplingTargetRate, 20)
  };
}

export function getDatasetPaymentDraft(dataset: DatasetSummary): DatasetPaymentDraft {
  const policy = isRecord(dataset.metadata) && isRecord(dataset.metadata.paymentPolicy) ? dataset.metadata.paymentPolicy : null;
  const taskBudgetBasis = getDatasetBudgetTaskBasis(dataset);
  const annotationCredits = getCreditNumber(policy?.annotationCredits);
  const reviewCredits = getCreditNumber(policy?.reviewCredits);
  const savedBudgetCredits = getCreditNumber(policy?.datasetBudgetCredits);
  const datasetBudgetCredits = savedBudgetCredits > 0 ? savedBudgetCredits : (annotationCredits + reviewCredits) * taskBudgetBasis;
  const savedReviewShare = getPercentNumber(policy?.reviewBudgetShare);
  const computedReviewShare = annotationCredits + reviewCredits > 0 ? Math.round((reviewCredits / (annotationCredits + reviewCredits)) * 100) : 20;

  return {
    currency: getCurrencyDraftValue(policy?.currency),
    datasetBudget: formatMoneyDraft(datasetBudgetCredits / 100),
    reviewShare: String(savedReviewShare ?? computedReviewShare)
  };
}

export function buildDatasetControllerInput({
  dataset,
  economics = defaultTaskEconomics,
  payment,
  quality,
  workflow
}: {
  dataset: DatasetSummary;
  economics?: PlatformTaskEconomics;
  payment: DatasetPaymentDraft;
  quality: DatasetQualityDraft;
  workflow: DatasetWorkflowDraft;
}):
  | { ok: true; preview: DatasetBudgetPreview; value: TaskWorkflowInput }
  | { ok: false; error: string } {
  const priority = workflow.priority.trim() === "" ? 0 : Number(workflow.priority);
  const samplingTargetRate = Number(quality.samplingTargetRate);
  const minAgreementRate = Number(quality.minAgreementRate);
  const minQualityScore = Number(quality.minQualityScore);
  const currency = payment.currency.trim().toUpperCase();
  const budget = parseMoneyInput(payment.datasetBudget);
  const reviewShare = payment.reviewShare.trim() === "" ? 0 : Number(payment.reviewShare);

  if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
    return { ok: false, error: "Priority must be a whole number from 0 to 10." };
  }

  if (!Number.isFinite(samplingTargetRate) || samplingTargetRate < 0 || samplingTargetRate > 100) {
    return { ok: false, error: "Review sampling target must be a number from 0 to 100." };
  }

  if (!Number.isFinite(minAgreementRate) || minAgreementRate < 0 || minAgreementRate > 100) {
    return { ok: false, error: "Minimum agreement must be a number from 0 to 100." };
  }

  if (!Number.isInteger(minQualityScore) || minQualityScore < 0 || minQualityScore > 100) {
    return { ok: false, error: "Minimum quality score must be a whole number from 0 to 100." };
  }

  if (!budget.ok || budget.credits > 1_000_000) {
    return { ok: false, error: "Dataset budget must be a dollar amount from 0.00 to 10,000.00." };
  }

  const currentBudgetCredits = getSavedDatasetBudgetCredits(dataset);

  if (currentBudgetCredits > 0 && budget.credits < currentBudgetCredits) {
    return {
      ok: false,
      error: `Dataset budget cannot be reduced after it is set. Current budget is ${formatCurrency(currentBudgetCredits / 100, currency)}.`
    };
  }

  if (!Number.isFinite(reviewShare) || reviewShare < 0 || reviewShare > 100) {
    return { ok: false, error: "Review budget share must be a number from 0 to 100." };
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Currency must be a 3-letter code like USD." };
  }

  let dueAt: string | null = null;

  if (workflow.dueAt) {
    const dueDate = new Date(workflow.dueAt);

    if (Number.isNaN(dueDate.getTime())) {
      return { ok: false, error: "Due date must be a valid date." };
    }

    dueAt = dueDate.toISOString();
  }

  if (workflow.assignmentMode === "single" && !workflow.assignedToId) {
    return { ok: false, error: "Choose an assignee or switch assignment mode to Unassigned." };
  }

  if (workflow.assignmentMode === "round_robin" && workflow.assigneeIds.length === 0) {
    return { ok: false, error: "Choose at least one annotator for round-robin assignment." };
  }

  const preview = getDatasetBudgetPreview(dataset, workflow, payment, economics);

  if (budget.credits > 0 && preview.perTaskCredits < 1) {
    return {
      ok: false,
      error: `Dataset budget is too small for ${preview.taskBudgetBasis} task${preview.taskBudgetBasis === 1 ? "" : "s"}. Use at least ${formatCurrency(preview.taskBudgetBasis / 100, currency)}.`
    };
  }

  return {
    ok: true,
    preview,
    value: {
      annotationCredits: preview.annotationCredits,
      assignedToId: workflow.assignmentMode === "single" ? workflow.assignedToId : null,
      assigneeIds: workflow.assignmentMode === "round_robin" ? workflow.assigneeIds : [],
      assignmentMode: workflow.assignmentMode,
      currency,
      datasetBudgetCredits: preview.datasetBudgetCredits,
      dueAt,
      autoSampleReview: quality.autoSampleReview,
      minAgreementRate,
      minQualityScore,
      priority,
      requireConsensusBeforeApproval: quality.requireConsensusBeforeApproval,
      reviewBudgetShare: reviewShare,
      reviewCredits: preview.reviewCredits,
      reviewerId: workflow.reviewerId || null,
      samplingTargetRate,
      saveDefaults: true,
      taskBudgetBasis: preview.taskBudgetBasis
    }
  };
}

export function buildDatasetRoutingInput(workflow: DatasetWorkflowDraft): { ok: true; value: TaskWorkflowInput } | { ok: false; error: string } {
  const priority = workflow.priority.trim() === "" ? 0 : Number(workflow.priority);
  const dueAt = getParsedDueDate(workflow.dueAt);

  if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
    return { ok: false, error: "Priority must be a whole number from 0 to 10." };
  }

  if (dueAt === false) {
    return { ok: false, error: "Due date must be a valid date." };
  }

  if (workflow.assignmentMode === "single" && !workflow.assignedToId) {
    return { ok: false, error: "Choose an assignee or switch assignment mode to Unassigned." };
  }

  if (workflow.assignmentMode === "round_robin" && workflow.assigneeIds.length === 0) {
    return { ok: false, error: "Choose at least one annotator for round-robin assignment." };
  }

  return {
    ok: true,
    value: {
      assignedToId: workflow.assignmentMode === "single" ? workflow.assignedToId : null,
      assigneeIds: workflow.assignmentMode === "round_robin" ? workflow.assigneeIds : [],
      assignmentMode: workflow.assignmentMode,
      dueAt,
      priority,
      reviewerId: workflow.reviewerId || null,
      saveDefaults: true
    }
  };
}

export function buildDatasetQualityInput(quality: DatasetQualityDraft): { ok: true; value: TaskWorkflowInput } | { ok: false; error: string } {
  const samplingTargetRate = Number(quality.samplingTargetRate);
  const minAgreementRate = Number(quality.minAgreementRate);
  const minQualityScore = Number(quality.minQualityScore);

  if (!Number.isFinite(samplingTargetRate) || samplingTargetRate < 0 || samplingTargetRate > 100) {
    return { ok: false, error: "Review sampling target must be a number from 0 to 100." };
  }

  if (!Number.isFinite(minAgreementRate) || minAgreementRate < 0 || minAgreementRate > 100) {
    return { ok: false, error: "Minimum agreement must be a number from 0 to 100." };
  }

  if (!Number.isInteger(minQualityScore) || minQualityScore < 0 || minQualityScore > 100) {
    return { ok: false, error: "Minimum quality score must be a whole number from 0 to 100." };
  }

  return {
    ok: true,
    value: {
      autoSampleReview: quality.autoSampleReview,
      minAgreementRate,
      minQualityScore,
      requireConsensusBeforeApproval: quality.requireConsensusBeforeApproval,
      samplingTargetRate,
      saveDefaults: true
    }
  };
}

export function buildDatasetBudgetInput({
  dataset,
  economics = defaultTaskEconomics,
  payment,
  workflow
}: {
  dataset: DatasetSummary;
  economics?: PlatformTaskEconomics;
  payment: DatasetPaymentDraft;
  workflow: Pick<DatasetWorkflowDraft, "reviewerId">;
}): { ok: true; preview: DatasetBudgetPreview; value: TaskWorkflowInput } | { ok: false; error: string } {
  const currency = payment.currency.trim().toUpperCase();
  const budget = parseMoneyInput(payment.datasetBudget);
  const reviewShare = payment.reviewShare.trim() === "" ? 0 : Number(payment.reviewShare);

  if (!budget.ok || budget.credits > 1_000_000) {
    return { ok: false, error: "Dataset budget must be a dollar amount from 0.00 to 10,000.00." };
  }

  const currentBudgetCredits = getSavedDatasetBudgetCredits(dataset);

  if (currentBudgetCredits > 0 && budget.credits < currentBudgetCredits) {
    return {
      ok: false,
      error: `Dataset budget cannot be reduced after it is set. Current budget is ${formatCurrency(currentBudgetCredits / 100, currency)}.`
    };
  }

  if (!Number.isFinite(reviewShare) || reviewShare < 0 || reviewShare > 100) {
    return { ok: false, error: "Review budget share must be a number from 0 to 100." };
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "Currency must be a 3-letter code like USD." };
  }

  const preview = getDatasetBudgetPreview(dataset, workflow, payment, economics);

  if (budget.credits > 0 && preview.perTaskCredits < 1) {
    return {
      ok: false,
      error: `Dataset budget is too small for ${preview.taskBudgetBasis} task${preview.taskBudgetBasis === 1 ? "" : "s"}. Use at least ${formatCurrency(preview.taskBudgetBasis / 100, currency)}.`
    };
  }

  return {
    ok: true,
    preview,
    value: {
      annotationCredits: preview.annotationCredits,
      currency,
      datasetBudgetCredits: preview.datasetBudgetCredits,
      reviewBudgetShare: reviewShare,
      reviewCredits: preview.reviewCredits,
      saveDefaults: true,
      taskBudgetBasis: preview.taskBudgetBasis
    }
  };
}

export function getDatasetBudgetPreview(
  dataset: DatasetSummary,
  workflow: Pick<DatasetWorkflowDraft, "reviewerId">,
  payment: DatasetPaymentDraft,
  economics: PlatformTaskEconomics = defaultTaskEconomics
): DatasetBudgetPreview {
  const taskBudgetBasis = getDatasetBudgetTaskBasis(dataset);
  const budget = parseMoneyInput(payment.datasetBudget);
  const datasetBudgetCredits = budget.ok ? budget.credits : 0;
  const reviewShare = Number(payment.reviewShare);
  const safeReviewShare = Number.isFinite(reviewShare) && reviewShare >= 0 && reviewShare <= 100 ? reviewShare : 0;
  const platformFeeRate = Math.max(0, Math.min(1, economics.platformFeeRate));
  const freeTaskPostingFeeCredits = Math.max(0, Math.floor(economics.freeTaskPostingFeeCredits));
  const workerBudgetCredits = datasetBudgetCredits > 0 ? Math.floor(datasetBudgetCredits * (1 - platformFeeRate)) : 0;
  const platformFeeCredits = datasetBudgetCredits > 0 ? Math.max(0, datasetBudgetCredits - workerBudgetCredits) : freeTaskPostingFeeCredits * taskBudgetBasis;
  const totalReservedCredits = datasetBudgetCredits > 0 ? datasetBudgetCredits : platformFeeCredits;
  const baseGrossTaskCredits = taskBudgetBasis > 0 ? Math.floor(datasetBudgetCredits / taskBudgetBasis) : 0;
  const grossBonusTaskCount = taskBudgetBasis > 0 ? datasetBudgetCredits % taskBudgetBasis : 0;
  const baseWorkerTaskCredits = taskBudgetBasis > 0 ? Math.floor(workerBudgetCredits / taskBudgetBasis) : 0;
  const workerBonusTaskCount = taskBudgetBasis > 0 ? workerBudgetCredits % taskBudgetBasis : 0;
  const reviewCredits = workflow.reviewerId ? Math.floor(baseWorkerTaskCredits * (safeReviewShare / 100)) : 0;
  const annotationCredits = Math.max(0, baseWorkerTaskCredits - reviewCredits);

  return {
    annotationCredits,
    baseGrossTaskCredits,
    baseWorkerTaskCredits,
    bonusTaskCount: workerBonusTaskCount,
    datasetBudgetCredits,
    grossBonusTaskCount,
    platformFeeCredits,
    perTaskCredits: baseWorkerTaskCredits,
    reviewCredits,
    taskBudgetBasis,
    totalReservedCredits,
    unusedCredits: 0,
    workerBonusTaskCount,
    workerBudgetCredits
  };
}

export function getDatasetBudgetTaskBasis(dataset: DatasetSummary) {
  const taskCount = typeof dataset.counts?.taskCount === "number" ? dataset.counts.taskCount : 0;
  const assetCount = typeof dataset.counts?.assetCount === "number" ? dataset.counts.assetCount : 0;

  return Math.max(taskCount || assetCount || 0, 1);
}

export function getSavedDatasetBudgetCredits(dataset: DatasetSummary) {
  const policy = isRecord(dataset.metadata) && isRecord(dataset.metadata.paymentPolicy) ? dataset.metadata.paymentPolicy : null;

  return getCreditNumber(policy?.datasetBudgetCredits);
}

export function getDatasetPaymentHistory(dataset: DatasetSummary): DatasetPaymentHistoryEntry[] {
  const history = isRecord(dataset.metadata) && Array.isArray(dataset.metadata.paymentPolicyHistory)
    ? dataset.metadata.paymentPolicyHistory
    : [];

  return history
    .filter(isRecord)
    .map((entry) => {
      const from = isRecord(entry.from) ? entry.from : {};
      const to = isRecord(entry.to) ? entry.to : {};

      return {
        changedAt: typeof entry.changedAt === "string" ? entry.changedAt : "",
        changedById: typeof entry.changedById === "string" ? entry.changedById : null,
        fromBudgetCredits: getCreditNumber(from.datasetBudgetCredits),
        reason: typeof entry.reason === "string" ? entry.reason : "payment_policy_updated",
        toBudgetCredits: getCreditNumber(to.datasetBudgetCredits)
      };
    })
    .filter((entry) => entry.changedAt && entry.toBudgetCredits >= 0)
    .reverse();
}

export function getPriorityMeaning(value: string) {
  const priority = Number(value);

  if (Number.isFinite(priority) && priority >= 10) {
    return {
      description: "Use 10 for urgent work. Higher priority appears first in task queues.",
      title: "Urgent priority"
    };
  }

  if (Number.isFinite(priority) && priority >= 5) {
    return {
      description: "Use 5 for important work that should appear before normal tasks.",
      title: "High priority"
    };
  }

  return {
    description: "Use 0 for normal work. The allowed range is 0 to 10.",
    title: "Normal priority"
  };
}

export function isDatasetControllerConfigured(dataset: DatasetSummary) {
  return isRecord(dataset.metadata) && isRecord(dataset.metadata.taskWorkflowDefaults);
}

export function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(amount);
}

function getDatasetAssignmentMode(value: unknown, assignedToId: string, assigneeIds: string[]): DatasetTaskAssignmentMode {
  if (value === "single" || value === "round_robin" || value === "unassigned") {
    return value;
  }

  if (assigneeIds.length > 0) {
    return "round_robin";
  }

  return assignedToId ? "single" : "unassigned";
}

function getOptionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getOptionalBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function getPercentDraftValue(value: unknown, fallback: number) {
  const percent = typeof value === "number" ? (value <= 1 ? value * 100 : value) : typeof value === "string" && value.trim() ? Number(value) : fallback;

  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? String(Math.round(percent)) : String(fallback);
}

function getPercentNumber(value: unknown) {
  const percent = typeof value === "number" ? (value <= 1 ? value * 100 : value) : typeof value === "string" && value.trim() ? Number(value) : NaN;

  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent) : null;
}

function getQualityScoreDraftValue(value: unknown, fallback: number) {
  const score = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;

  return Number.isInteger(score) && score >= 0 && score <= 100 ? String(score) : String(fallback);
}

function getPriorityDraftValue(value: unknown) {
  const priority = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;

  return Number.isInteger(priority) && priority >= 0 && priority <= 10 ? String(priority) : "0";
}

function getCreditNumber(value: unknown) {
  const credits = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;

  return Number.isInteger(credits) && credits >= 0 && credits <= 1_000_000 ? credits : 0;
}

function getCurrencyDraftValue(value: unknown) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "USD";

  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function getDateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getParsedDueDate(value: string): string | null | false {
  if (!value) {
    return null;
  }

  const dueDate = new Date(value);

  if (Number.isNaN(dueDate.getTime())) {
    return false;
  }

  return dueDate.toISOString();
}

function parseMoneyInput(value: string): { ok: true; credits: number } | { ok: false; credits: 0 } {
  const normalized = value.trim();

  if (normalized === "") {
    return { ok: true, credits: 0 };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, credits: 0 };
  }

  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, credits: 0 };
  }

  return { ok: true, credits: Math.round(amount * 100) };
}

function formatMoneyDraft(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
