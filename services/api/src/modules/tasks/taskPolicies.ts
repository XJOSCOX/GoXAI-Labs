import { Prisma } from "@goxai/database";
import { getCreditAmount } from "./taskFunding.js";
export type TaskWorkflowBody =
  | {
      assignmentMode?: unknown;
      assignedToId?: unknown;
      assigneeIds?: unknown;
      annotationCredits?: unknown;
      currency?: unknown;
      datasetBudgetCredits?: unknown;
      dueAt?: unknown;
      freeTaskPostingFeeCredits?: unknown;
      autoSampleReview?: unknown;
      minAgreementRate?: unknown;
      minQualityScore?: unknown;
      priority?: unknown;
      platformFeeRate?: unknown;
      requireConsensusBeforeApproval?: unknown;
      reviewBudgetShare?: unknown;
      reviewCredits?: unknown;
      reviewerId?: unknown;
      samplingTargetRate?: unknown;
      saveDefaults?: unknown;
      taskBudgetBasis?: unknown;
    }
  | undefined;

export type DatasetTaskAssignmentMode = "single" | "round_robin" | "unassigned";

export type DatasetTaskWorkflowValue = {
  assignedToId: string | null;
  assigneeIds: string[];
  assignmentMode: DatasetTaskAssignmentMode;
  dueAt: Date | null;
  priority: number;
  reviewerId: string | null;
};

export type DatasetQualityPolicyValue = {
  autoSampleReview: boolean;
  minAgreementRate: number;
  minQualityScore: number;
  requireConsensusBeforeApproval: boolean;
  samplingTargetRate: number;
};

export type DatasetPaymentPolicyValue = {
  annotationCredits: number;
  currency: string;
  datasetBudgetCredits: number;
  freeTaskPostingFeeCredits: number;
  platformFeeRate: number;
  reviewBudgetShare: number;
  reviewCredits: number;
  taskBudgetBasis: number;
};

export type AssignmentWorkloadInput = Array<{ count: number; userId: string }>;

export function parseTaskWorkflowBody(body: TaskWorkflowBody):
  | {
      ok: true;
      value: {
        assignedToId?: string | null;
        dueAt?: Date | null;
        priority?: number;
        reviewerId?: string | null;
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Task workflow update is required." };
  }

  const value: {
    assignedToId?: string | null;
    dueAt?: Date | null;
    priority?: number;
    reviewerId?: string | null;
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, "assignedToId")) {
    const assignedToId = normalizeNullableId(body.assignedToId);

    if (assignedToId === false) {
      return { ok: false, error: "Assigned user must be a valid user id." };
    }

    value.assignedToId = assignedToId;
  }

  if (Object.prototype.hasOwnProperty.call(body, "reviewerId")) {
    const reviewerId = normalizeNullableId(body.reviewerId);

    if (reviewerId === false) {
      return { ok: false, error: "Reviewer must be a valid user id." };
    }

    value.reviewerId = reviewerId;
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    const priority = normalizeInteger(body.priority);

    if (priority === undefined || priority < 0 || priority > 10) {
      return { ok: false, error: "Priority must be a whole number from 0 to 10." };
    }

    value.priority = priority;
  }

  if (Object.prototype.hasOwnProperty.call(body, "dueAt")) {
    const dueAt = normalizeNullableDate(body.dueAt);

    if (dueAt === false) {
      return { ok: false, error: "Due date must be a valid date." };
    }

    value.dueAt = dueAt;
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: "Choose at least one task workflow field to update." };
  }

  return { ok: true, value };
}

export function parseDatasetTaskWorkflowBody(
  body: TaskWorkflowBody,
  options: { fallback?: DatasetTaskWorkflowValue; requireWorkflow: boolean }
):
  | {
      ok: true;
      saveDefaults: boolean;
      value: DatasetTaskWorkflowValue;
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return options.requireWorkflow
      ? { ok: false, error: "Dataset task workflow update is required." }
      : { ok: true, saveDefaults: false, value: options.fallback ?? getDefaultDatasetTaskWorkflow() };
  }

  if (options.requireWorkflow && !hasDatasetTaskWorkflowFields(body)) {
    return { ok: false, error: "Choose at least one dataset task workflow field to update." };
  }

  const fallback = options.fallback ?? getDefaultDatasetTaskWorkflow();
  const assignmentMode = parseDatasetTaskAssignmentMode(body.assignmentMode) ?? inferDatasetTaskAssignmentMode(body, fallback);
  const assignedToId = Object.prototype.hasOwnProperty.call(body, "assignedToId")
    ? normalizeNullableId(body.assignedToId)
    : fallback.assignedToId;
  const reviewerId = Object.prototype.hasOwnProperty.call(body, "reviewerId")
    ? normalizeNullableId(body.reviewerId)
    : fallback.reviewerId;
  const assigneeIds = Object.prototype.hasOwnProperty.call(body, "assigneeIds")
    ? normalizeIdList(body.assigneeIds)
    : fallback.assigneeIds;
  const priority = Object.prototype.hasOwnProperty.call(body, "priority")
    ? normalizeInteger(body.priority)
    : fallback.priority;
  const dueAt = Object.prototype.hasOwnProperty.call(body, "dueAt")
    ? normalizeNullableDate(body.dueAt)
    : fallback.dueAt;

  if (assignedToId === false) {
    return { ok: false, error: "Assigned user must be a valid user id." };
  }

  if (reviewerId === false) {
    return { ok: false, error: "Reviewer must be a valid user id." };
  }

  if (assigneeIds === false) {
    return { ok: false, error: "Round-robin assignees must be valid user ids." };
  }

  if (priority === undefined || priority < 0 || priority > 10) {
    return { ok: false, error: "Priority must be a whole number from 0 to 10." };
  }

  if (dueAt === false) {
    return { ok: false, error: "Due date must be a valid date." };
  }

  if (assignmentMode === "single" && !assignedToId) {
    return { ok: false, error: "Choose an assignee or use Unassigned." };
  }

  if (assignmentMode === "round_robin" && assigneeIds.length === 0) {
    return { ok: false, error: "Choose at least one annotator for round-robin assignment." };
  }

  return {
    ok: true,
    saveDefaults: body.saveDefaults === true,
    value: {
      assignedToId: assignmentMode === "single" ? assignedToId : null,
      assigneeIds: assignmentMode === "round_robin" ? assigneeIds : [],
      assignmentMode,
      dueAt,
      priority,
      reviewerId
    }
  };
}

function hasDatasetTaskWorkflowFields(body: TaskWorkflowBody) {
  return Boolean(
    body &&
      typeof body === "object" &&
      [
        "assignedToId",
        "assignmentMode",
        "assigneeIds",
        "annotationCredits",
        "currency",
        "datasetBudgetCredits",
        "autoSampleReview",
        "dueAt",
        "minAgreementRate",
        "minQualityScore",
        "priority",
        "requireConsensusBeforeApproval",
        "reviewBudgetShare",
        "reviewCredits",
        "reviewerId",
        "samplingTargetRate",
        "saveDefaults",
        "taskBudgetBasis"
      ].some((field) => Object.prototype.hasOwnProperty.call(body, field))
  );
}

function inferDatasetTaskAssignmentMode(body: TaskWorkflowBody, fallback: DatasetTaskWorkflowValue): DatasetTaskAssignmentMode {
  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "assigneeIds")) {
    return "round_robin";
  }

  if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "assignedToId")) {
    return body.assignedToId ? "single" : "unassigned";
  }

  return fallback.assignmentMode;
}

function parseDatasetTaskAssignmentMode(value: unknown): DatasetTaskAssignmentMode | undefined {
  return value === "single" || value === "round_robin" || value === "unassigned" ? value : undefined;
}

function normalizeIdList(value: unknown) {
  if (!Array.isArray(value)) {
    return false;
  }

  const ids = [];

  for (const item of value) {
    const id = normalizeNullableId(item);

    if (!id) {
      return false;
    }

    ids.push(id);
  }

  return [...new Set(ids)];
}

function getDefaultDatasetTaskWorkflow(): DatasetTaskWorkflowValue {
  return {
    assignedToId: null,
    assigneeIds: [],
    assignmentMode: "unassigned",
    dueAt: null,
    priority: 0,
    reviewerId: null
  };
}

export function readDatasetTaskWorkflowDefaults(metadata: unknown): DatasetTaskWorkflowValue {
  if (!isPlainJsonObject(metadata) || !isPlainJsonObject(metadata.taskWorkflowDefaults)) {
    return getDefaultDatasetTaskWorkflow();
  }

  const parsed = parseDatasetTaskWorkflowBody(metadata.taskWorkflowDefaults as TaskWorkflowBody, {
    fallback: getDefaultDatasetTaskWorkflow(),
    requireWorkflow: false
  });

  return parsed.ok ? parsed.value : getDefaultDatasetTaskWorkflow();
}

export function serializeDatasetTaskWorkflowDefaults(value: DatasetTaskWorkflowValue) {
  return {
    assignedToId: value.assignedToId,
    assigneeIds: value.assigneeIds,
    assignmentMode: value.assignmentMode,
    dueAt: value.dueAt ? value.dueAt.toISOString() : null,
    priority: value.priority,
    reviewerId: value.reviewerId
  };
}

export function mergeDatasetTaskWorkflowDefaults(metadata: unknown, value: DatasetTaskWorkflowValue) {
  const base = isPlainJsonObject(metadata) ? metadata : {};

  return {
    ...base,
    taskWorkflowDefaults: serializeDatasetTaskWorkflowDefaults(value)
  } as Prisma.InputJsonObject;
}

export function getDefaultDatasetQualityPolicy(): DatasetQualityPolicyValue {
  return {
    autoSampleReview: true,
    minAgreementRate: 0.8,
    minQualityScore: 75,
    requireConsensusBeforeApproval: false,
    samplingTargetRate: 0.2
  };
}

export function readDatasetQualityPolicy(metadata: unknown): DatasetQualityPolicyValue {
  if (!isPlainJsonObject(metadata) || !isPlainJsonObject(metadata.qualityPolicy)) {
    return getDefaultDatasetQualityPolicy();
  }

  const parsed = parseDatasetQualityPolicyBody(metadata.qualityPolicy as TaskWorkflowBody, getDefaultDatasetQualityPolicy());

  return parsed.ok ? parsed.value : getDefaultDatasetQualityPolicy();
}

export function parseDatasetQualityPolicyBody(
  body: TaskWorkflowBody,
  fallback: DatasetQualityPolicyValue = getDefaultDatasetQualityPolicy()
):
  | { ok: true; value: DatasetQualityPolicyValue }
  | { ok: false; error: string } {
  const record = body && typeof body === "object" ? body : {};
  const samplingTargetRate = parsePercentInput(record.samplingTargetRate, fallback.samplingTargetRate);
  const minAgreementRate = parsePercentInput(record.minAgreementRate, fallback.minAgreementRate);
  const minQualityScore = parseQualityScoreInput(record.minQualityScore, fallback.minQualityScore);

  if (samplingTargetRate === false) {
    return { ok: false, error: "Review sampling target must be a number from 0 to 100." };
  }

  if (minAgreementRate === false) {
    return { ok: false, error: "Minimum agreement must be a number from 0 to 100." };
  }

  if (minQualityScore === false) {
    return { ok: false, error: "Minimum quality score must be a whole number from 0 to 100." };
  }

  return {
    ok: true,
    value: {
      autoSampleReview: parseBooleanInput(record.autoSampleReview, fallback.autoSampleReview),
      minAgreementRate,
      minQualityScore,
      requireConsensusBeforeApproval: parseBooleanInput(record.requireConsensusBeforeApproval, fallback.requireConsensusBeforeApproval),
      samplingTargetRate
    }
  };
}

export function serializeDatasetQualityPolicy(value: DatasetQualityPolicyValue) {
  return {
    autoSampleReview: value.autoSampleReview,
    minAgreementRate: value.minAgreementRate,
    minQualityScore: value.minQualityScore,
    requireConsensusBeforeApproval: value.requireConsensusBeforeApproval,
    samplingTargetRate: value.samplingTargetRate
  };
}

export function mergeDatasetQualityPolicyDefaults(metadata: unknown, value: DatasetQualityPolicyValue) {
  const base = isPlainJsonObject(metadata) ? metadata : {};

  return {
    ...base,
    qualityPolicy: serializeDatasetQualityPolicy(value)
  } as Prisma.InputJsonObject;
}

export function getDefaultDatasetPaymentPolicy(): DatasetPaymentPolicyValue {
  return {
    annotationCredits: 0,
    currency: "USD",
    datasetBudgetCredits: 0,
    freeTaskPostingFeeCredits: 0,
    platformFeeRate: 0.3,
    reviewBudgetShare: 0,
    reviewCredits: 0,
    taskBudgetBasis: 1
  };
}

export function readDatasetPaymentPolicy(metadata: unknown): DatasetPaymentPolicyValue {
  if (!isPlainJsonObject(metadata) || !isPlainJsonObject(metadata.paymentPolicy)) {
    return getDefaultDatasetPaymentPolicy();
  }

  const parsed = parseDatasetPaymentPolicyBody(metadata.paymentPolicy as TaskWorkflowBody, getDefaultDatasetPaymentPolicy());

  return parsed.ok ? parsed.value : getDefaultDatasetPaymentPolicy();
}

export function readTaskPaymentPolicy(taskMetadata: unknown, datasetMetadata: unknown): DatasetPaymentPolicyValue {
  const fallback = readDatasetPaymentPolicy(datasetMetadata);

  if (!isPlainJsonObject(taskMetadata)) {
    return fallback;
  }

  const annotationCredits = parseCreditInput(taskMetadata.paymentAnnotationCredits, fallback.annotationCredits);
  const reviewCredits = parseCreditInput(taskMetadata.paymentReviewCredits, fallback.reviewCredits);
  const currency = parseCurrencyInput(taskMetadata.paymentCurrency, fallback.currency);
  const platformFeeRate = parsePercentInput(taskMetadata.paymentPlatformFeeRate, fallback.platformFeeRate);
  const freeTaskPostingFeeCredits = parseCreditInput(taskMetadata.paymentFreeTaskPostingFeeCredits, fallback.freeTaskPostingFeeCredits);
  const safeAnnotationCredits = annotationCredits === false ? fallback.annotationCredits : annotationCredits;
  const safeReviewCredits = reviewCredits === false ? fallback.reviewCredits : reviewCredits;
  const safePlatformFeeRate = platformFeeRate === false ? fallback.platformFeeRate : platformFeeRate;
  const safeFreeTaskPostingFeeCredits = freeTaskPostingFeeCredits === false ? fallback.freeTaskPostingFeeCredits : freeTaskPostingFeeCredits;
  const escrowCredits = getTaskPaymentEscrowCredits(taskMetadata, {
    annotationCredits: safeAnnotationCredits,
    currency: currency ?? fallback.currency,
    datasetBudgetCredits: fallback.datasetBudgetCredits,
    freeTaskPostingFeeCredits: safeFreeTaskPostingFeeCredits,
    platformFeeRate: safePlatformFeeRate,
    reviewBudgetShare: fallback.reviewBudgetShare,
    reviewCredits: safeReviewCredits,
    taskBudgetBasis: fallback.taskBudgetBasis
  });
  const cappedReviewCredits = Math.min(safeReviewCredits, Math.max(0, escrowCredits - safeAnnotationCredits));

  return {
    annotationCredits: safeAnnotationCredits,
    currency: currency ?? fallback.currency,
    datasetBudgetCredits: fallback.datasetBudgetCredits,
    freeTaskPostingFeeCredits: safeFreeTaskPostingFeeCredits,
    platformFeeRate: safePlatformFeeRate,
    reviewBudgetShare: fallback.reviewBudgetShare,
    reviewCredits: cappedReviewCredits,
    taskBudgetBasis: fallback.taskBudgetBasis
  };
}

export function parseDatasetPaymentPolicyBody(
  body: TaskWorkflowBody,
  fallback: DatasetPaymentPolicyValue = getDefaultDatasetPaymentPolicy()
):
  | { ok: true; value: DatasetPaymentPolicyValue }
  | { ok: false; error: string } {
  const record = body && typeof body === "object" ? body : {};
  const annotationCredits = parseCreditInput(record.annotationCredits, fallback.annotationCredits);
  const reviewCredits = parseCreditInput(record.reviewCredits, fallback.reviewCredits);
  const datasetBudgetCredits = parseCreditInput(record.datasetBudgetCredits, fallback.datasetBudgetCredits);
  const freeTaskPostingFeeCredits = parseCreditInput(record.freeTaskPostingFeeCredits, fallback.freeTaskPostingFeeCredits);
  const platformFeeRate = parsePercentInput(record.platformFeeRate, fallback.platformFeeRate);
  const reviewBudgetShare = parsePercentInput(record.reviewBudgetShare, fallback.reviewBudgetShare);
  const taskBudgetBasis = parsePositiveIntegerInput(record.taskBudgetBasis, fallback.taskBudgetBasis);
  const currency = parseCurrencyInput(record.currency, fallback.currency);

  if (annotationCredits === false) {
    return { ok: false, error: "Approved annotation credits must be a whole number from 0 to 1,000,000." };
  }

  if (reviewCredits === false) {
    return { ok: false, error: "Approved review credits must be a whole number from 0 to 1,000,000." };
  }

  if (datasetBudgetCredits === false) {
    return { ok: false, error: "Dataset budget credits must be a whole number from 0 to 1,000,000." };
  }

  if (freeTaskPostingFeeCredits === false) {
    return { ok: false, error: "Free task posting fee credits must be a whole number from 0 to 1,000,000." };
  }

  if (platformFeeRate === false) {
    return { ok: false, error: "Platform fee rate must be a number from 0 to 100." };
  }

  if (reviewBudgetShare === false) {
    return { ok: false, error: "Review budget share must be a number from 0 to 100." };
  }

  if (taskBudgetBasis === false) {
    return { ok: false, error: "Task budget basis must be a whole number greater than 0." };
  }

  if (!currency) {
    return { ok: false, error: "Currency must be a 3-letter code like USD." };
  }

  return {
    ok: true,
    value: {
      annotationCredits,
      currency,
      datasetBudgetCredits,
      freeTaskPostingFeeCredits,
      platformFeeRate,
      reviewBudgetShare,
      reviewCredits,
      taskBudgetBasis
    }
  };
}

export function serializeDatasetPaymentPolicy(value: DatasetPaymentPolicyValue) {
  return {
    annotationCredits: value.annotationCredits,
    currency: value.currency,
    datasetBudgetCredits: value.datasetBudgetCredits,
    freeTaskPostingFeeCredits: value.freeTaskPostingFeeCredits,
    platformFeeRate: value.platformFeeRate,
    reviewBudgetShare: value.reviewBudgetShare,
    reviewCredits: value.reviewCredits,
    taskBudgetBasis: value.taskBudgetBasis
  };
}

export function getDatasetPaymentPolicyLockIssue(metadata: unknown, next: DatasetPaymentPolicyValue) {
  const current = readDatasetPaymentPolicy(metadata);

  if (current.datasetBudgetCredits > 0 && next.datasetBudgetCredits < current.datasetBudgetCredits) {
    return `Dataset budget cannot be reduced after it is set. Current budget is ${getCreditAmount(current.datasetBudgetCredits)} ${current.currency}; use an equal or higher amount.`;
  }

  if (current.datasetBudgetCredits > 0 && next.currency !== current.currency) {
    return `Dataset budget currency cannot change after pricing is set. Current currency is ${current.currency}.`;
  }

  return null;
}

export function mergeDatasetPaymentPolicyDefaults(
  metadata: unknown,
  value: DatasetPaymentPolicyValue,
  history?: {
    changedById?: string | null;
    reason: string;
  }
) {
  const base = isPlainJsonObject(metadata) ? metadata : {};
  const previousPolicy = readDatasetPaymentPolicy(metadata);
  const nextPolicy = serializeDatasetPaymentPolicy(value);
  const policyChanged = hasDatasetPaymentPolicyChanged(previousPolicy, value);
  const historyEntries = Array.isArray(base.paymentPolicyHistory)
    ? base.paymentPolicyHistory.filter(isPlainJsonObject).slice(-49)
    : [];

  return {
    ...base,
    paymentPolicy: nextPolicy,
    ...(history && policyChanged
      ? {
          paymentPolicyHistory: [
            ...historyEntries,
            {
              changedAt: new Date().toISOString(),
              changedById: history.changedById ?? null,
              from: serializeDatasetPaymentPolicy(previousPolicy),
              reason: history.reason,
              to: nextPolicy
            }
          ]
        }
      : {})
  } as Prisma.InputJsonObject;
}

function hasDatasetPaymentPolicyChanged(current: DatasetPaymentPolicyValue, next: DatasetPaymentPolicyValue) {
  return current.annotationCredits !== next.annotationCredits ||
    current.currency !== next.currency ||
    current.datasetBudgetCredits !== next.datasetBudgetCredits ||
    current.freeTaskPostingFeeCredits !== next.freeTaskPostingFeeCredits ||
    current.platformFeeRate !== next.platformFeeRate ||
    current.reviewBudgetShare !== next.reviewBudgetShare ||
    current.reviewCredits !== next.reviewCredits ||
    current.taskBudgetBasis !== next.taskBudgetBasis;
}

export function getTaskPaymentEscrowLedgerEntryId(metadata: unknown) {
  if (!isPlainJsonObject(metadata)) {
    return null;
  }

  return typeof metadata.paymentEscrowLedgerEntryId === "string" && metadata.paymentEscrowLedgerEntryId
    ? metadata.paymentEscrowLedgerEntryId
    : null;
}

export function getTaskPaymentEscrowCredits(metadata: unknown, fallback: DatasetPaymentPolicyValue) {
  if (isPlainJsonObject(metadata)) {
    const credits = typeof metadata.paymentEscrowCredits === "number"
      ? metadata.paymentEscrowCredits
      : typeof metadata.paymentEscrowCredits === "string" && metadata.paymentEscrowCredits.trim()
        ? Number(metadata.paymentEscrowCredits)
        : NaN;

    if (Number.isInteger(credits) && credits >= 0) {
      return credits;
    }
  }

  return fallback.annotationCredits + fallback.reviewCredits;
}

export function mergeTaskPaymentMetadata(
  metadata: unknown,
  paymentPolicy: DatasetPaymentPolicyValue,
  escrowLedgerEntryId: string | null,
  escrowCredits: number,
  options: {
    allowIncrease?: boolean;
    platformFeeCredits?: number;
    workerCredits?: number;
  } = {}
): Prisma.InputJsonObject {
  const base = isPlainJsonObject(metadata) ? metadata : {};
  const existingEscrowLedgerEntryId = getTaskPaymentEscrowLedgerEntryId(metadata);

  if (existingEscrowLedgerEntryId) {
    const currentEscrowCredits = getTaskPaymentEscrowCredits(metadata, paymentPolicy);

    if (!options.allowIncrease || escrowCredits <= currentEscrowCredits) {
      return base as Prisma.InputJsonObject;
    }

    return {
      ...base,
      paymentAnnotationCredits: paymentPolicy.annotationCredits,
      paymentCurrency: paymentPolicy.currency,
      paymentDatasetBudgetCredits: paymentPolicy.datasetBudgetCredits,
      paymentEscrowCredits: escrowCredits,
      paymentFreeTaskPostingFeeCredits: paymentPolicy.freeTaskPostingFeeCredits,
      ...(options.platformFeeCredits === undefined ? {} : { paymentPlatformFeeCredits: options.platformFeeCredits }),
      paymentPlatformFeeRate: paymentPolicy.platformFeeRate,
      paymentReviewBudgetShare: paymentPolicy.reviewBudgetShare,
      paymentReviewCredits: paymentPolicy.reviewCredits,
      paymentTaskBudgetBasis: paymentPolicy.taskBudgetBasis,
      ...(options.workerCredits === undefined ? {} : { paymentWorkerCredits: options.workerCredits })
    } as Prisma.InputJsonObject;
  }

  return {
    ...base,
    paymentAnnotationCredits: paymentPolicy.annotationCredits,
    paymentCurrency: paymentPolicy.currency,
    paymentDatasetBudgetCredits: paymentPolicy.datasetBudgetCredits,
    paymentEscrowCredits: escrowCredits,
    paymentEscrowLedgerEntryId: escrowLedgerEntryId,
    paymentFreeTaskPostingFeeCredits: paymentPolicy.freeTaskPostingFeeCredits,
    ...(options.platformFeeCredits === undefined ? {} : { paymentPlatformFeeCredits: options.platformFeeCredits }),
    paymentPlatformFeeRate: paymentPolicy.platformFeeRate,
    paymentReviewBudgetShare: paymentPolicy.reviewBudgetShare,
    paymentReviewCredits: paymentPolicy.reviewCredits,
    paymentTaskBudgetBasis: paymentPolicy.taskBudgetBasis,
    ...(options.workerCredits === undefined ? {} : { paymentWorkerCredits: options.workerCredits })
  } as Prisma.InputJsonObject;
}

function parseCreditInput(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 1_000_000 ? numberValue : false;
}

function parsePositiveIntegerInput(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(numberValue) && numberValue > 0 && numberValue <= 1_000_000 ? numberValue : false;
}

function parseCurrencyInput(value: unknown, fallback: string) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    return null;
  }

  const currency = value.trim().toUpperCase();

  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function parsePercentInput(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = numberValue > 1 ? numberValue / 100 : numberValue;

  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1 ? normalized : false;
}

function parseQualityScoreInput(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 100 ? numberValue : false;
}

function parseBooleanInput(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value === "true" || value === "1" || value === "on";
  }

  return fallback;
}

function normalizeNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : false;
}

function normalizeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeNullableDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function getGeneratedTaskQualityMetadata(policy: DatasetQualityPolicyValue, index: number) {
  if (!policy.autoSampleReview || policy.samplingTargetRate <= 0) {
    return {};
  }

  const interval = Math.max(1, Math.round(1 / policy.samplingTargetRate));

  return index % interval === 0
    ? {
        qualitySampled: true,
        qualitySampleReason: "dataset_sampling_policy"
      }
    : {};
}

export function getDatasetWorkflowAssignments(
  value: DatasetTaskWorkflowValue,
  taskCount: number,
  workload: AssignmentWorkloadInput = []
) {
  if (taskCount <= 0) {
    return [];
  }

  if (value.assignmentMode === "single") {
    return Array.from({ length: taskCount }, () => value.assignedToId);
  }

  if (value.assignmentMode === "round_robin") {
    const workloadByUserId = new Map(workload.map((item) => [item.userId, item.count]));
    const assignees = value.assigneeIds.map((userId, index) => ({
      index,
      userId,
      workload: workloadByUserId.get(userId) ?? 0
    }));
    const assignments: Array<string | null> = [];

    for (let index = 0; index < taskCount; index += 1) {
      assignees.sort((left, right) => left.workload - right.workload || left.index - right.index);
      const selected = assignees[0];

      if (!selected) {
        assignments.push(null);
        continue;
      }

      assignments.push(selected.userId);
      selected.workload += 1;
    }

    return assignments;
  }

  return Array.from({ length: taskCount }, () => null);
}

export function getDatasetWorkflowAssignment(assignments: Array<string | null>, index: number) {
  return assignments[index] ?? null;
}

export function countDatasetWorkflowAssignees(assignments: Array<string | null>) {
  const counts = new Map<string, number>();

  for (const assignedToId of assignments) {
    if (assignedToId) {
      counts.set(assignedToId, (counts.get(assignedToId) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([userId, count]) => ({
    count,
    userId
  }));
}

export function buildDatasetTaskWorkflowUpdateData(value: DatasetTaskWorkflowValue, assignedToId: string | null): Prisma.TaskUncheckedUpdateManyInput {
  return {
    assignedToId,
    dueAt: value.dueAt,
    priority: value.priority,
    reviewerId: value.reviewerId
  };
}

