import {
  LedgerEntryType,
  ReviewStatus,
  TaskCreditEventType,
  TaskCreditStatus,
  type Prisma
} from "@goxai/database";
import { ensureOrganizationWallet } from "../billing/billing.js";
import { getCreditAmount, getDatasetTaskEscrowEstimate } from "./taskFunding.js";
import {
  getTaskPaymentEscrowCredits,
  getTaskPaymentEscrowLedgerEntryId,
  type DatasetPaymentPolicyValue,
  type DatasetTaskWorkflowValue
} from "./taskPolicies.js";

export class InsufficientCreatorBalanceError extends Error {}

export function getAnnotationSubmissionCreditPoints(input: { regionCount: number; resultCount: number }) {
  const regionCount = Number.isFinite(input.regionCount) ? Math.max(0, Math.floor(input.regionCount)) : 0;
  const resultCount = Number.isFinite(input.resultCount) ? Math.max(0, Math.floor(input.resultCount)) : 0;

  return 10 + Math.min(regionCount, 25) + Math.min(resultCount, 10);
}

export function getAnnotationApprovalCreditPoints(score: number | null) {
  const scoreBonus = typeof score === "number" && Number.isFinite(score)
    ? Math.max(0, Math.min(5, Math.round(score)))
    : 0;

  return 15 + scoreBonus;
}

export function getReviewCreditPoints(input: { score: number | null; status: ReviewStatus }) {
  const decisionBonus = input.status === ReviewStatus.APPROVED || input.status === ReviewStatus.NEEDS_CHANGES ? 2 : 0;
  const scoreBonus = typeof input.score === "number" && Number.isFinite(input.score) ? 1 : 0;

  return 5 + decisionBonus + scoreBonus;
}

function getCreditsFromPoints(points: number) {
  return Math.max(0, Math.round(points));
}

type TaskCreditEventCreateInput = {
  annotationId?: string | null;
  amount?: string;
  approvedAt?: Date | null;
  availableAt?: Date | null;
  credits?: number;
  currency?: string;
  datasetId?: string | null;
  eventType: TaskCreditEventType;
  metadata?: Prisma.InputJsonObject;
  organizationId?: string | null;
  points: number;
  projectId?: string | null;
  referenceKey: string;
  reviewId?: string | null;
  status?: TaskCreditStatus;
  taskId?: string | null;
  userId?: string | null;
  voidedAt?: Date | null;
  withdrawnAt?: Date | null;
};

export async function upsertTaskCreditEvent(tx: Prisma.TransactionClient, input: TaskCreditEventCreateInput) {
  const credits = input.credits ?? getCreditsFromPoints(input.points);
  const status = input.status ?? TaskCreditStatus.UNDER_REVIEW;
  const approvedAt = input.approvedAt ?? (status === TaskCreditStatus.APPROVED || status === TaskCreditStatus.AVAILABLE ? new Date() : null);
  const amount = input.amount ?? getCreditAmount(credits);

  if (!input.userId || credits <= 0) {
    return null;
  }

  return tx.taskCreditEvent.upsert({
    where: {
      referenceKey: input.referenceKey
    },
    create: {
      annotationId: input.annotationId ?? null,
      amount,
      approvedAt,
      availableAt: input.availableAt ?? null,
      credits,
      currency: input.currency ?? "USD",
      datasetId: input.datasetId ?? null,
      eventType: input.eventType,
      metadata: input.metadata ?? {},
      organizationId: input.organizationId ?? null,
      points: input.points,
      projectId: input.projectId ?? null,
      referenceKey: input.referenceKey,
      reviewId: input.reviewId ?? null,
      status,
      taskId: input.taskId ?? null,
      userId: input.userId,
      voidedAt: input.voidedAt ?? null,
      withdrawnAt: input.withdrawnAt ?? null
    },
    update: {
      amount,
      approvedAt,
      availableAt: input.availableAt ?? null,
      credits,
      currency: input.currency ?? "USD",
      metadata: input.metadata ?? {},
      points: input.points,
      status,
      voidedAt: input.voidedAt ?? null,
      withdrawnAt: input.withdrawnAt ?? null
    }
  });
}

export async function resolveAnnotationUnderReviewCredit(
  tx: Prisma.TransactionClient,
  input: { annotationId: string; decision: "approve" | "reject"; reviewId: string }
) {
  await tx.taskCreditEvent.updateMany({
    where: {
      annotationId: input.annotationId,
      eventType: TaskCreditEventType.ANNOTATION_SUBMITTED,
      status: TaskCreditStatus.UNDER_REVIEW
    },
    data: {
      metadata: {
        resolution: input.decision,
        reviewId: input.reviewId
      },
      status: TaskCreditStatus.VOIDED,
      voidedAt: new Date()
    }
  });
}

export async function holdCreatorTaskEscrow(
  tx: Prisma.TransactionClient,
  input: {
    datasetId: string;
    description: string;
    organizationId: string;
    paymentPolicy: DatasetPaymentPolicyValue;
    taskCount: number;
    workflow: Pick<DatasetTaskWorkflowValue, "reviewerId">;
  }
) {
  const estimate = getDatasetTaskEscrowEstimate(input.taskCount, input.workflow, input.paymentPolicy);

  return holdCreatorCreditsEscrow(tx, {
    credits: estimate.credits,
    datasetId: input.datasetId,
    description: input.description,
    metadata: {
      annotationCredits: input.paymentPolicy.annotationCredits,
      datasetBudgetCredits: input.paymentPolicy.datasetBudgetCredits,
      datasetId: input.datasetId,
      freeTaskPostingFeeCredits: input.paymentPolicy.freeTaskPostingFeeCredits,
      platformFeeRate: input.paymentPolicy.platformFeeRate,
      reviewBudgetShare: input.paymentPolicy.reviewBudgetShare,
      reviewCredits: input.paymentPolicy.reviewCredits,
      taskBudgetBasis: input.paymentPolicy.taskBudgetBasis,
      taskCount: input.taskCount,
      totalCredits: estimate.credits
    },
    organizationId: input.organizationId,
    paymentPolicy: input.paymentPolicy
  });
}

export async function holdCreatorCreditsEscrow(
  tx: Prisma.TransactionClient,
  input: {
    credits: number;
    datasetId: string;
    description: string;
    metadata: Prisma.InputJsonObject;
    organizationId: string;
    paymentPolicy: Pick<DatasetPaymentPolicyValue, "currency">;
  }
) {
  const credits = Math.max(0, input.credits);
  const estimate = {
    amount: getCreditAmount(credits),
    credits,
    currency: input.paymentPolicy.currency
  };

  if (estimate.amount === "0.00") {
    return {
      estimate,
      ledgerEntryId: null
    };
  }

  const wallet = await ensureOrganizationWallet(tx, input.organizationId, input.paymentPolicy.currency);
  const walletUpdate = await tx.wallet.updateMany({
    where: {
      balance: {
        gte: estimate.amount
      },
      id: wallet.id
    },
    data: {
      balance: {
        decrement: estimate.amount
      }
    }
  });

  if (walletUpdate.count !== 1) {
    throw new InsufficientCreatorBalanceError(
      `Creator wallet needs at least ${estimate.amount} ${input.paymentPolicy.currency} to reserve these tasks.`
    );
  }

  const ledgerEntry = await tx.ledgerEntry.create({
    data: {
      amount: estimate.amount,
      currency: input.paymentPolicy.currency,
      description: input.description,
      metadata: input.metadata,
      referenceId: input.datasetId,
      type: LedgerEntryType.HOLD,
      walletId: wallet.id
    }
  });

  return {
    estimate,
    ledgerEntryId: ledgerEntry.id
  };
}

export async function settleTaskEscrowOnApproval(
  tx: Prisma.TransactionClient,
  input: {
    paymentPolicy: DatasetPaymentPolicyValue;
    reviewId: string;
    task: {
      id: string;
      metadata: Prisma.JsonValue | null;
      organizationId?: string | null;
      project: {
        organizationId: string;
      };
      reviewerId: string | null;
    };
  }
) {
  const escrowLedgerEntryId = getTaskPaymentEscrowLedgerEntryId(input.task.metadata);

  if (!escrowLedgerEntryId) {
    return null;
  }

  const existingSettlement = await tx.ledgerEntry.findFirst({
    where: {
      referenceId: input.task.id,
      type: {
        in: [LedgerEntryType.RELEASE, LedgerEntryType.REFUND]
      }
    },
    select: {
      id: true
    }
  });

  if (existingSettlement) {
    return null;
  }

  const hold = await tx.ledgerEntry.findUnique({
    where: {
      id: escrowLedgerEntryId
    },
    select: {
      currency: true,
      walletId: true
    }
  });

  if (!hold) {
    return null;
  }

  const escrowCredits = getTaskPaymentEscrowCredits(input.task.metadata, input.paymentPolicy);
  const platformFeeCredits = Math.min(escrowCredits, getTaskPaymentPlatformFeeCredits(input.task.metadata, input.paymentPolicy));
  const approvedCredits = Math.min(
    Math.max(0, escrowCredits - platformFeeCredits),
    input.paymentPolicy.annotationCredits + (input.task.reviewerId ? input.paymentPolicy.reviewCredits : 0)
  );
  const feeCredits = Math.min(platformFeeCredits, Math.max(0, escrowCredits - approvedCredits));
  const refundCredits = Math.max(0, escrowCredits - approvedCredits - feeCredits);
  const releaseAmount = getCreditAmount(approvedCredits);
  const feeAmount = getCreditAmount(feeCredits);
  const refundAmount = getCreditAmount(refundCredits);
  const entries: Array<{ id: string; type: LedgerEntryType }> = [];

  if (approvedCredits > 0) {
    const release = await tx.ledgerEntry.create({
      data: {
        amount: releaseAmount,
        currency: hold.currency,
        description: "Release approved task escrow to worker credits.",
        metadata: {
          approvedCredits,
          escrowLedgerEntryId,
          reviewId: input.reviewId,
          taskId: input.task.id
        },
        referenceId: input.task.id,
        type: LedgerEntryType.RELEASE,
        walletId: hold.walletId
      },
      select: {
        id: true,
        type: true
      }
    });
    entries.push(release);
  }

  if (feeCredits > 0) {
    const fee = await tx.ledgerEntry.create({
      data: {
        amount: feeAmount,
        currency: hold.currency,
        description: "Platform fee for approved task funding.",
        metadata: {
          escrowLedgerEntryId,
          feeCredits,
          platformFeeRate: input.paymentPolicy.platformFeeRate,
          reviewId: input.reviewId,
          taskId: input.task.id
        },
        referenceId: input.task.id,
        type: LedgerEntryType.FEE,
        walletId: hold.walletId
      },
      select: {
        id: true,
        type: true
      }
    });
    entries.push(fee);
  }

  if (refundCredits > 0) {
    await tx.wallet.update({
      where: {
        id: hold.walletId
      },
      data: {
        balance: {
          increment: refundAmount
        }
      }
    });

    const refund = await tx.ledgerEntry.create({
      data: {
        amount: refundAmount,
        currency: hold.currency,
        description: "Refund unused task escrow to creator wallet.",
        metadata: {
          escrowCredits,
          escrowLedgerEntryId,
          refundCredits,
          reviewId: input.reviewId,
          taskId: input.task.id
        },
        referenceId: input.task.id,
        type: LedgerEntryType.REFUND,
        walletId: hold.walletId
      },
      select: {
        id: true,
        type: true
      }
    });
    entries.push(refund);
  }

  return {
    approvedCredits,
    currency: hold.currency,
    escrowCredits,
    entries,
    feeCredits,
    refundCredits
  };
}

function getTaskPaymentPlatformFeeCredits(metadata: unknown, fallback: DatasetPaymentPolicyValue) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    const credits = typeof record.paymentPlatformFeeCredits === "number"
      ? record.paymentPlatformFeeCredits
      : typeof record.paymentPlatformFeeCredits === "string" && record.paymentPlatformFeeCredits.trim()
        ? Number(record.paymentPlatformFeeCredits)
        : NaN;

    if (Number.isInteger(credits) && credits >= 0) {
      return credits;
    }
  }

  const workerCredits = fallback.annotationCredits + fallback.reviewCredits;
  return workerCredits > 0 ? Math.ceil(workerCredits * fallback.platformFeeRate) : fallback.freeTaskPostingFeeCredits;
}
