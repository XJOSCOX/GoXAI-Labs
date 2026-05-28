export type DatasetTaskPaymentPolicy = {
  annotationCredits: number;
  currency: string;
  datasetBudgetCredits: number;
  freeTaskPostingFeeCredits?: number;
  platformFeeRate?: number;
  reviewBudgetShare: number;
  reviewCredits: number;
  taskBudgetBasis: number;
};

export type DatasetTaskWorkflowPaymentScope = {
  reviewerId: string | null;
};

export type DatasetTaskCreditAllocation = {
  annotationCredits: number;
  credits: number;
  platformFeeCredits: number;
  reviewCredits: number;
  workerCredits: number;
};

const CREDIT_CENTS_PER_CREDIT = 1;

export function getCreditAmount(credits: number) {
  return ((Math.max(0, credits) * CREDIT_CENTS_PER_CREDIT) / 100).toFixed(2);
}

export function getDatasetTaskEscrowEstimate(
  taskCount: number,
  workflow: DatasetTaskWorkflowPaymentScope,
  paymentPolicy: DatasetTaskPaymentPolicy
) {
  let credits = 0;

  for (let index = 0; index < Math.max(0, taskCount); index += 1) {
    credits += getDatasetTaskCreditAllocation(index, workflow, paymentPolicy).credits;
  }

  return {
    amount: getCreditAmount(credits),
    credits,
    currency: paymentPolicy.currency
  };
}

export function getDatasetTaskCreditAllocation(
  taskIndex: number,
  workflow: DatasetTaskWorkflowPaymentScope,
  paymentPolicy: DatasetTaskPaymentPolicy
): DatasetTaskCreditAllocation {
  const safeTaskIndex = Math.max(0, Math.floor(taskIndex));
  const taskBudgetBasis = Math.max(1, paymentPolicy.taskBudgetBasis);
  const feeRate = Math.max(0, Math.min(1, paymentPolicy.platformFeeRate ?? 0));
  const grossCredits = paymentPolicy.datasetBudgetCredits > 0
    ? getDistributedCredits(paymentPolicy.datasetBudgetCredits, safeTaskIndex, taskBudgetBasis)
    : paymentPolicy.annotationCredits + (workflow.reviewerId ? paymentPolicy.reviewCredits : 0);
  const workerCredits = paymentPolicy.datasetBudgetCredits > 0
    ? getDistributedCredits(Math.floor(paymentPolicy.datasetBudgetCredits * (1 - feeRate)), safeTaskIndex, taskBudgetBasis)
    : grossCredits;
  const platformFeeCredits = paymentPolicy.datasetBudgetCredits > 0
    ? Math.max(0, grossCredits - workerCredits)
    : workerCredits > 0
      ? Math.ceil(workerCredits * feeRate)
      : paymentPolicy.freeTaskPostingFeeCredits ?? 0;
  const credits = Math.max(0, workerCredits + platformFeeCredits);
  const reviewCredits = workflow.reviewerId ? Math.min(workerCredits, Math.floor(workerCredits * paymentPolicy.reviewBudgetShare)) : 0;
  const annotationCredits = Math.max(0, workerCredits - reviewCredits);

  return {
    annotationCredits,
    credits,
    platformFeeCredits,
    reviewCredits,
    workerCredits
  };
}

export function getDatasetTaskAllocationPolicy(
  paymentPolicy: DatasetTaskPaymentPolicy,
  allocation: DatasetTaskCreditAllocation
): DatasetTaskPaymentPolicy & { freeTaskPostingFeeCredits: number; platformFeeRate: number } {
  return {
    ...paymentPolicy,
    annotationCredits: allocation.annotationCredits,
    freeTaskPostingFeeCredits: paymentPolicy.freeTaskPostingFeeCredits ?? 0,
    platformFeeRate: paymentPolicy.platformFeeRate ?? 0,
    reviewCredits: allocation.reviewCredits
  };
}

function getDistributedCredits(totalCredits: number, taskIndex: number, taskBudgetBasis: number) {
  const safeTotalCredits = Math.max(0, Math.floor(totalCredits));
  const safeTaskBudgetBasis = Math.max(1, Math.floor(taskBudgetBasis));
  const baseCredits = Math.floor(safeTotalCredits / safeTaskBudgetBasis);
  const bonusCredits = taskIndex < safeTotalCredits % safeTaskBudgetBasis ? 1 : 0;

  return baseCredits + bonusCredits;
}
