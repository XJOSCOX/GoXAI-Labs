import {
  ApplicationStatus,
  CreatorStatus,
  FundingSourceStatus,
  getPrismaClient,
  GlobalRole,
  LedgerEntryType,
  MembershipRole,
  MembershipStatus,
  PaymentIntentStatus,
  PayoutStatus,
  Prisma,
  TaskCreditStatus,
  TaskStatus,
  UserStatus,
  VerificationStatus,
  WalletReceiptType
} from "@goxai/database";
import { Router, type NextFunction, type Response } from "express";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { buildWalletReceiptNumber, ensureOrganizationWallet } from "../billing/billing.js";
import { getRequestId } from "../../shared/logging.js";
import { getPlatformFeatures, updatePlatformFeatures } from "../../shared/platformFeatures.js";
import { getPlatformTaskEconomics, updatePlatformTaskEconomics } from "../../shared/platformEconomics.js";

const router = Router();
const STALE_PAYMENT_INTENT_HOURS = 24;

router.use(requireAuthenticatedUser);
router.use(requireSuperAdmin);

router.get("/overview", async (_request: AuthenticatedRequest, response) => {
  const prisma = getPrismaClient();
  const webhookSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    users,
    verificationApplications,
    creatorApplications,
    payouts,
    counts,
    peopleMemberships,
    superAdmins,
    platformFeatures,
    taskEconomics,
    paymentIntents,
    fundingSources,
    webhookEvents,
    paypalWebhookCount24h,
    stripeWebhookCount24h,
    platformRevenue,
    paymentAuditTrail
  ] = await Promise.all([
    prisma.user.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 80,
      select: userSelect
    }),
    prisma.verificationApplication.findMany({
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    prisma.creatorApplication.findMany({
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 80
    }),
    prisma.payout.findMany({
      include: {
        _count: {
          select: {
            receipts: true
          }
        },
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.PENDING } }),
      prisma.user.count({ where: { verificationStatus: VerificationStatus.VERIFIED } }),
      prisma.user.count({ where: { creatorStatus: CreatorStatus.PENDING } }),
      prisma.user.count({ where: { creatorStatus: CreatorStatus.APPROVED } }),
      prisma.organization.count(),
      prisma.project.count(),
      prisma.dataset.count(),
      prisma.payout.count({ where: { status: PayoutStatus.REQUESTED } }),
      prisma.payout.count({ where: { status: PayoutStatus.PROCESSING } }),
      prisma.payout.count({ where: { status: PayoutStatus.PAID } }),
      prisma.payout.count({ where: { status: PayoutStatus.FAILED } })
    ]),
    prisma.membership.findMany({
      distinct: ["role", "userId"],
      where: {
        status: MembershipStatus.ACTIVE,
        role: {
          in: [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.REVIEWER, MembershipRole.ANNOTATOR]
        }
      },
      select: {
        role: true,
        userId: true
      }
    }),
    prisma.user.findMany({
      where: {
        globalRole: GlobalRole.SUPER_ADMIN
      },
      select: {
        id: true
      }
    }),
    getPlatformFeatures(),
    getPlatformTaskEconomics(),
    prisma.paymentIntent.findMany({
      include: adminPaymentIntentInclude,
      orderBy: {
        createdAt: "desc"
      },
      take: 60
    }),
    prisma.fundingSource.findMany({
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    prisma.providerWebhookEvent.findMany({
      orderBy: {
        receivedAt: "desc"
      },
      take: 40
    }),
    prisma.providerWebhookEvent.count({
      where: {
        provider: "paypal",
        receivedAt: {
          gte: webhookSince
        }
      }
    }),
    prisma.providerWebhookEvent.count({
      where: {
        provider: "stripe",
        receivedAt: {
          gte: webhookSince
        }
      }
    }),
    buildAdminPlatformRevenueReport(),
    buildAdminPaymentAuditTrail()
  ]);
  const adminUserIds = new Set(superAdmins.map((user) => user.id));
  const annotatorUserIds = new Set<string>();
  const reviewerUserIds = new Set<string>();
  const paymentReconciliationSummaries = await buildAdminPaymentIntentReconciliationSummaries(paymentIntents);

  for (const membership of peopleMemberships) {
    if (membership.role === MembershipRole.OWNER || membership.role === MembershipRole.ADMIN) {
      adminUserIds.add(membership.userId);
    }

    if (membership.role === MembershipRole.ANNOTATOR) {
      annotatorUserIds.add(membership.userId);
    }

    if (membership.role === MembershipRole.REVIEWER) {
      reviewerUserIds.add(membership.userId);
    }
  }

  response.status(200).json({
    counts: {
      users: counts[0],
      pendingVerification: counts[1],
      verifiedUsers: counts[2],
      pendingCreators: counts[3],
      approvedCreators: counts[4],
      organizations: counts[5],
      projects: counts[6],
      datasets: counts[7],
      requestedPayouts: counts[8],
      processingPayouts: counts[9],
      paidPayouts: counts[10],
      failedPayouts: counts[11]
    },
    people: {
      totalUsers: counts[0],
      admins: adminUserIds.size,
      creators: counts[4],
      annotators: annotatorUserIds.size,
      reviewers: reviewerUserIds.size,
      pendingVerification: counts[1]
    },
    settings: {
      economics: taskEconomics,
      features: platformFeatures,
      paymentProviders: buildPaymentProviderSettings(platformFeatures)
    },
    payments: {
      auditTrail: paymentAuditTrail,
      fundingSources: fundingSources.map(serializeAdminFundingSource),
      paymentIntents: paymentIntents.map((payment) => serializeAdminPaymentIntent(payment, paymentReconciliationSummaries.get(payment.id))),
      platformRevenue,
      webhookHealth: buildWebhookHealth(
        webhookEvents,
        {
          paypal: paypalWebhookCount24h,
          stripe: stripeWebhookCount24h
        },
        new Date()
      )
    },
    users: users.map(serializeAdminUser),
    payouts: payouts.map(serializeAdminPayout),
    verificationApplications: verificationApplications.map((application) => serializeAdminApplication(application, "verification")),
    creatorApplications: creatorApplications.map((application) => serializeAdminApplication(application, "creator"))
  });
});

router.patch("/settings/economics", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const platformFeeRate = parsePercentSetting(request.body?.platformFeeRate);
  const freeTaskPostingFeeCredits = parseCreditSetting(request.body?.freeTaskPostingFeeCredits);

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (platformFeeRate === null) {
    response.status(400).json({ error: "Platform fee must be a number from 0 to 100." });
    return;
  }

  if (freeTaskPostingFeeCredits === null) {
    response.status(400).json({ error: "Free task posting fee must be whole credits from 0 to 1,000,000." });
    return;
  }

  const economics = await updatePlatformTaskEconomics({
    freeTaskPostingFeeCredits,
    platformFeeRate,
    updatedById: admin.id
  });
  let existingTaskUpdate: Awaited<ReturnType<typeof applyEconomicsToExistingOpenTasks>> | null = null;

  try {
    existingTaskUpdate = request.body?.applyToExistingTasks === true
      ? await applyEconomicsToExistingOpenTasks(economics, admin.id, getRequestId(request) ?? "unknown")
      : null;
  } catch (error) {
    if (error instanceof ExistingOpenTaskEconomicsError) {
      response.status(402).json({ error: error.message, economics });
      return;
    }

    throw error;
  }

  response.status(200).json({
    economics,
    existingTaskUpdate,
    mode: existingTaskUpdate ? "existing_open_tasks" : "future_only"
  });
});

router.patch("/settings/features", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const aiEnabled = parseBooleanSetting(request.body?.aiEnabled);
  const paypalEnabled = parseOptionalBooleanSetting(request.body?.payments?.paypalEnabled);
  const plaidEnabled = parseOptionalBooleanSetting(request.body?.payments?.plaidEnabled);
  const stripeEnabled = parseOptionalBooleanSetting(request.body?.payments?.stripeEnabled);

  if (aiEnabled === null) {
    response.status(400).json({ error: "AI enabled must be true or false." });
    return;
  }

  if (paypalEnabled === null || plaidEnabled === null || stripeEnabled === null) {
    response.status(400).json({ error: "Payment provider settings must be true or false." });
    return;
  }

  const features = await updatePlatformFeatures({
    aiEnabled,
    payments: {
      ...(paypalEnabled === undefined ? {} : { paypalEnabled }),
      ...(plaidEnabled === undefined ? {} : { plaidEnabled }),
      ...(stripeEnabled === undefined ? {} : { stripeEnabled })
    },
    updatedById: admin.id
  });

  response.status(200).json({ features });
});

router.post("/funding-sources/:fundingSourceId/disable", async (request: AuthenticatedRequest, response) => {
  await updateAdminFundingSourceStatus(request, response, FundingSourceStatus.DISABLED);
});

router.post("/funding-sources/:fundingSourceId/enable", async (request: AuthenticatedRequest, response) => {
  await updateAdminFundingSourceStatus(request, response, FundingSourceStatus.ACTIVE);
});

router.patch("/users/:userId", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const userId = normalizeId(request.params.userId);

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!userId) {
    response.status(400).json({ error: "User is required." });
    return;
  }

  const parsed = parseUserUpdate(request.body);

  if (!parsed.ok) {
    response.status(400).json({ error: parsed.error });
    return;
  }

  const prisma = getPrismaClient();
  const updated = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      ...parsed.value,
      ...(parsed.value.verificationStatus === VerificationStatus.VERIFIED
        ? { isVerified: true, verifiedAt: new Date(), verifiedById: admin.id }
        : {}),
      ...(parsed.value.verificationStatus && parsed.value.verificationStatus !== VerificationStatus.VERIFIED
        ? { isVerified: false, verifiedAt: null, verifiedById: null }
        : {})
    },
    select: userSelect
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "admin.user.updated",
      entityType: "user",
      entityId: updated.id,
      metadata: {
        requestId: getRequestId(request),
        update: parsed.value
      }
    }
  });

  response.status(200).json({
    user: serializeAdminUser(updated)
  });
});

router.post("/payment-intents/:paymentIntentId/cancel", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const paymentIntentId = normalizeId(request.params.paymentIntentId);
  const adminNotes = normalizeLimitedText(request.body?.adminNotes, 1_000) ?? null;

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.paymentIntent.findUnique({
    where: {
      id: paymentIntentId
    },
    include: adminPaymentIntentInclude
  });

  if (!existing) {
    response.status(404).json({ error: "Payment intent was not found." });
    return;
  }

  const state = getAdminPaymentIntentState(existing, new Date());

  if (!state.canCancel) {
    response.status(409).json({ error: `Payment intents with status ${existing.status} cannot be cancelled.` });
    return;
  }

  const cancelledAt = new Date();
  const cancelled = await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentIntent.update({
      where: {
        id: existing.id
      },
      data: {
        cancelledAt,
        metadata: mergeJsonObject(existing.metadata, {
          adminCancelledAt: cancelledAt.toISOString(),
          adminCancelledById: admin.id,
          adminNotes,
          previousStatus: existing.status,
          requestId: getRequestId(request)
        }),
        status: PaymentIntentStatus.CANCELLED
      },
      include: adminPaymentIntentInclude
    });

    await tx.auditLog.create({
      data: {
        action: "admin.payment_intent.cancelled",
        entityId: updated.id,
        entityType: "payment_intent",
        metadata: {
          adminNotes,
          amount: updated.amount.toString(),
          currency: updated.currency,
          previousStatus: existing.status,
          provider: updated.provider,
          providerRef: updated.providerRef,
          requestId: getRequestId(request)
        },
        organizationId: updated.organizationId,
        userId: admin.id
      }
    });

    return updated;
  });

  response.status(200).json({
    paymentIntent: serializeAdminPaymentIntent(cancelled)
  });
});

router.post("/payment-intents/:paymentIntentId/refund", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const paymentIntentId = normalizeId(request.params.paymentIntentId);
  const parsedRefund = parsePaymentRefundBody(request.body);

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  if (!parsedRefund.ok) {
    response.status(400).json({ error: parsedRefund.error });
    return;
  }

  const prisma = getPrismaClient();

  try {
    await prisma.$transaction(async (tx) => {
      const paymentIntent = await tx.paymentIntent.findUnique({
        where: {
          id: paymentIntentId
        },
        include: {
          ...adminPaymentIntentInclude,
          wallet: {
            select: {
              balance: true,
              id: true
            }
          }
        }
      });

      if (!paymentIntent) {
        throw new PaymentRefundError("Payment intent was not found.", 404);
      }

      if (paymentIntent.status !== PaymentIntentStatus.SUCCEEDED) {
        throw new PaymentRefundError("Only settled payment intents can be refunded.", 409);
      }

      const previousRefunds = await tx.ledgerEntry.findMany({
        where: {
          metadata: {
            path: ["paymentIntentId"],
            equals: paymentIntent.id
          },
          type: LedgerEntryType.REFUND,
          walletId: paymentIntent.walletId
        },
        select: {
          amount: true
        }
      });
      const refundPlan = getPaymentRefundPlan({
        alreadyRefundedCents: previousRefunds.reduce((total, entry) => total + moneyToCents(entry.amount), 0),
        originalAmount: paymentIntent.amount,
        requestedAmountCents: parsedRefund.value.amountCents,
        walletBalance: paymentIntent.wallet.balance
      });

      if (!refundPlan.ok) {
        throw new PaymentRefundError(refundPlan.error, 409);
      }

      const originalCents = refundPlan.originalCents;
      const refundedCents = refundPlan.alreadyRefundedCents;
      const refundCents = refundPlan.refundCents;
      const refundAmount = centsToMoney(refundCents);
      const refundedAt = new Date();
      const walletUpdate = await tx.wallet.updateMany({
        where: {
          balance: {
            gte: refundAmount
          },
          id: paymentIntent.walletId
        },
        data: {
          balance: {
            decrement: refundAmount
          }
        }
      });

      if (walletUpdate.count !== 1) {
        throw new PaymentRefundError("The creator wallet changed before the refund could be recorded.", 409);
      }

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          amount: refundAmount,
          currency: paymentIntent.currency,
          description: "Refund creator wallet top-up.",
          metadata: {
            adminNotes: parsedRefund.value.adminNotes ?? null,
            originalPaymentProvider: paymentIntent.provider,
            paymentIntentId: paymentIntent.id,
            providerRef: parsedRefund.value.providerRef,
            refundKind: "top_up",
            requestId: getRequestId(request)
          },
          referenceId: paymentIntent.id,
          type: LedgerEntryType.REFUND,
          walletId: paymentIntent.walletId
        }
      });

      const receipt = await tx.walletReceipt.create({
        data: {
          amount: refundAmount,
          currency: paymentIntent.currency,
          description: "Creator wallet top-up refund receipt.",
          ledgerEntryId: ledgerEntry.id,
          metadata: {
            adminNotes: parsedRefund.value.adminNotes ?? null,
            originalPaymentProvider: paymentIntent.provider,
            paymentIntentId: paymentIntent.id,
            providerRef: parsedRefund.value.providerRef,
            refundKind: "top_up",
            requestId: getRequestId(request)
          },
          organizationId: paymentIntent.organizationId,
          paymentIntentId: paymentIntent.id,
          provider: paymentIntent.provider,
          providerRef: parsedRefund.value.providerRef,
          receiptNumber: buildWalletReceiptNumber("REF", refundedAt, ledgerEntry.id),
          type: WalletReceiptType.REFUND,
          userId: paymentIntent.createdById,
          walletId: paymentIntent.walletId
        }
      });

      const nextRefundedCents = refundedCents + refundCents;
      await tx.paymentIntent.update({
        where: {
          id: paymentIntent.id
        },
        data: {
          metadata: mergeJsonObject(paymentIntent.metadata, {
            adminRefundedAmount: centsToMoney(nextRefundedCents),
            adminRefundedAt: refundedAt.toISOString(),
            adminRefundedById: admin.id,
            adminRefundedLedgerEntryId: ledgerEntry.id,
            adminRefundedReceiptId: receipt.id,
            adminRefundedRemainingAmount: centsToMoney(Math.max(0, originalCents - nextRefundedCents)),
            adminRefundProviderRef: parsedRefund.value.providerRef,
            adminRefundRequestId: getRequestId(request)
          })
        }
      });

      await tx.auditLog.create({
        data: {
          action: "admin.payment_intent.refund_recorded",
          entityId: paymentIntent.id,
          entityType: "payment_intent",
          metadata: {
            adminNotes: parsedRefund.value.adminNotes ?? null,
            amount: refundAmount,
            currency: paymentIntent.currency,
            ledgerEntryId: ledgerEntry.id,
            provider: paymentIntent.provider,
            providerRef: parsedRefund.value.providerRef,
            receiptId: receipt.id,
            requestId: getRequestId(request)
          },
          organizationId: paymentIntent.organizationId,
          userId: admin.id
        }
      });
    });
  } catch (reason) {
    if (reason instanceof PaymentRefundError) {
      response.status(reason.statusCode).json({ error: reason.message });
      return;
    }

    throw reason;
  }

  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: {
      id: paymentIntentId
    },
    include: adminPaymentIntentInclude
  });

  response.status(200).json({
    paymentIntent: paymentIntent ? serializeAdminPaymentIntent(paymentIntent) : null
  });
});

router.get("/payment-intents/:paymentIntentId", async (request: AuthenticatedRequest, response) => {
  const paymentIntentId = normalizeId(request.params.paymentIntentId);

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  const prisma = getPrismaClient();
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: {
      id: paymentIntentId
    },
    include: adminPaymentIntentInclude
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "Payment intent was not found." });
    return;
  }

  const receipts = await prisma.walletReceipt.findMany({
    where: {
      paymentIntentId: paymentIntent.id
    },
    include: {
      ledgerEntry: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      },
      user: {
        select: userSelect
      }
    },
    orderBy: {
      issuedAt: "desc"
    }
  });
  const receiptLedgerEntryIds = receipts.map((receipt) => receipt.ledgerEntryId).filter((id): id is string => Boolean(id));
  const ledgerWhere: Prisma.LedgerEntryWhereInput[] = [
    {
      referenceId: paymentIntent.id
    },
    {
      metadata: {
        path: ["paymentIntentId"],
        equals: paymentIntent.id
      }
    }
  ];

  if (receiptLedgerEntryIds.length > 0) {
    ledgerWhere.push({
      id: {
        in: receiptLedgerEntryIds
      }
    });
  }

  const webhookWhere: Prisma.ProviderWebhookEventWhereInput[] = [
    {
      metadata: {
        path: ["paymentIntentId"],
        equals: paymentIntent.id
      }
    }
  ];

  if (paymentIntent.providerRef) {
    webhookWhere.push(
      {
        eventId: paymentIntent.providerRef
      },
      {
        metadata: {
          path: ["providerRef"],
          equals: paymentIntent.providerRef
        }
      }
    );
  }

  const [ledgerEntries, auditTrail, webhookEvents] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        OR: ledgerWhere
      },
      include: {
        wallet: {
          select: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            },
            user: {
              select: userSelect
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 30
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          {
            entityId: paymentIntent.id,
            entityType: "payment_intent"
          },
          {
            metadata: {
              path: ["paymentIntentId"],
              equals: paymentIntent.id
            }
          }
        ]
      },
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    }),
    prisma.providerWebhookEvent.findMany({
      where: {
        OR: webhookWhere,
        provider: paymentIntent.provider
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 20
    })
  ]);

  response.status(200).json({
    paymentIntent: serializeAdminPaymentIntentDetail(paymentIntent, receipts, ledgerEntries, auditTrail, webhookEvents)
  });
});

router.get("/payment-intents/:paymentIntentId/receipts", async (request: AuthenticatedRequest, response) => {
  const paymentIntentId = normalizeId(request.params.paymentIntentId);

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  const prisma = getPrismaClient();
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: {
      id: paymentIntentId
    },
    include: adminPaymentIntentInclude
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "Payment intent was not found." });
    return;
  }

  const receipts = await prisma.walletReceipt.findMany({
    where: {
      paymentIntentId
    },
    include: {
      ledgerEntry: {
        select: {
          id: true,
          referenceId: true,
          type: true
        }
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      },
      user: {
        select: userSelect
      }
    },
    orderBy: {
      issuedAt: "asc"
    }
  });

  if (receipts.length === 0) {
    response.status(404).json({ error: "No receipts were found for this payment intent." });
    return;
  }

  const fileName = `payment-${paymentIntent.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-receipts.json`;
  const payload = {
    exportedAt: new Date(),
    paymentIntent: serializeAdminPaymentIntent(paymentIntent),
    receipts: receipts.map((receipt) => ({
      amount: Number(receipt.amount.toString()),
      createdAt: receipt.createdAt,
      currency: receipt.currency,
      description: receipt.description,
      id: receipt.id,
      issuedAt: receipt.issuedAt,
      ledgerEntry: receipt.ledgerEntry,
      metadata: receipt.metadata,
      organization: receipt.organization,
      paymentIntentId: receipt.paymentIntentId,
      provider: receipt.provider,
      providerRef: receipt.providerRef,
      receiptNumber: receipt.receiptNumber,
      type: receipt.type,
      user: receipt.user ? serializeAdminUser(receipt.user) : null
    })),
    totals: summarizeReceiptTotals(receipts)
  };

  response
    .status(200)
    .setHeader("Content-Type", "application/json")
    .setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
    .send(JSON.stringify(payload, null, 2));
});

router.get("/payouts/:payoutId", async (request: AuthenticatedRequest, response) => {
  const payoutId = normalizeId(request.params.payoutId);

  if (!payoutId) {
    response.status(400).json({ error: "Payout is required." });
    return;
  }

  const prisma = getPrismaClient();
  const payout = await prisma.payout.findUnique({
    where: {
      id: payoutId
    },
    include: {
      _count: {
        select: {
          receipts: true
        }
      },
      user: {
        select: userSelect
      }
    }
  });

  if (!payout) {
    response.status(404).json({ error: "Payout was not found." });
    return;
  }

  const taskCreditEventIds = getPayoutTaskCreditEventIds(payout.metadata);
  const [creditEvents, auditTrail] = await Promise.all([
    taskCreditEventIds.length > 0
      ? prisma.taskCreditEvent.findMany({
          where: {
            id: {
              in: taskCreditEventIds
            }
          },
          orderBy: {
            createdAt: "desc"
          },
          select: {
            amount: true,
            approvedAt: true,
            availableAt: true,
            createdAt: true,
            credits: true,
            currency: true,
            dataset: {
              select: {
                id: true,
                name: true
              }
            },
            eventType: true,
            id: true,
            points: true,
            project: {
              select: {
                id: true,
                name: true
              }
            },
            status: true,
            task: {
              select: {
                asset: {
                  select: {
                    fileName: true
                  }
                },
                id: true
              }
            },
            withdrawnAt: true
          }
        })
      : [],
    prisma.auditLog.findMany({
      where: {
        entityId: payout.id,
        entityType: "payout"
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        action: true,
        createdAt: true,
        id: true,
        metadata: true
      },
      take: 20
    })
  ]);

  response.status(200).json({
    payout: serializeAdminPayoutDetail(payout, creditEvents, auditTrail)
  });
});

router.get("/payouts/:payoutId/receipt", async (request: AuthenticatedRequest, response) => {
  const payoutId = normalizeId(request.params.payoutId);

  if (!payoutId) {
    response.status(400).json({ error: "Payout is required." });
    return;
  }

  const prisma = getPrismaClient();
  const receipt = await prisma.walletReceipt.findFirst({
    where: {
      payoutId
    },
    orderBy: {
      issuedAt: "desc"
    },
    select: {
      amount: true,
      createdAt: true,
      currency: true,
      description: true,
      id: true,
      issuedAt: true,
      metadata: true,
      provider: true,
      providerRef: true,
      receiptNumber: true,
      type: true,
      user: {
        select: userSelect
      }
    }
  });

  if (!receipt) {
    response.status(404).json({ error: "Payout receipt was not found." });
    return;
  }

  const fileName = `${receipt.receiptNumber.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  const payload = {
    amount: Number(receipt.amount.toString()),
    createdAt: receipt.createdAt,
    currency: receipt.currency,
    description: receipt.description,
    id: receipt.id,
    issuedAt: receipt.issuedAt,
    metadata: receipt.metadata,
    provider: receipt.provider,
    providerRef: receipt.providerRef,
    receiptNumber: receipt.receiptNumber,
    type: receipt.type,
    user: receipt.user ? serializeAdminUser(receipt.user) : null
  };

  response
    .status(200)
    .setHeader("Content-Type", "application/json")
    .setHeader("Content-Disposition", `attachment; filename="${fileName}"`)
    .send(JSON.stringify(payload, null, 2));
});

router.post("/payouts/:payoutId/:decision", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const payoutId = normalizeId(request.params.payoutId);
  const decision = request.params.decision;

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!payoutId) {
    response.status(400).json({ error: "Payout is required." });
    return;
  }

  if (decision !== "processing" && decision !== "paid" && decision !== "cancel" && decision !== "fail") {
    response.status(400).json({ error: "Decision must be processing, paid, cancel, or fail." });
    return;
  }

  const parsedReview = parsePayoutReviewBody(decision, request.body);

  if (!parsedReview.ok) {
    response.status(400).json({ error: parsedReview.error });
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.payout.findUnique({
    where: {
      id: payoutId
    },
    include: {
      user: {
        select: userSelect
      }
    }
  });

  if (!existing) {
    response.status(404).json({ error: "Payout was not found." });
    return;
  }

  const transition = getPayoutStatusTransition(existing.status, decision);

  if (!transition.ok) {
    response.status(409).json({ error: transition.error });
    return;
  }

  const saved = await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.update({
      where: {
        id: existing.id
      },
      data: {
        metadata: mergePayoutMetadata(existing.metadata, {
          ...(parsedReview.value.adminNotes ? { adminNotes: parsedReview.value.adminNotes } : {}),
          ...(parsedReview.value.provider ? { provider: parsedReview.value.provider } : {}),
          ...(parsedReview.value.providerRef ? { providerRef: parsedReview.value.providerRef } : {}),
          reviewedAt: new Date().toISOString(),
          reviewedById: admin.id,
          previousStatus: existing.status
        }),
        ...(transition.status === PayoutStatus.PAID
          ? {
              provider: parsedReview.value.provider ?? "manual",
              providerRef: parsedReview.value.providerRef
            }
          : {}),
        status: transition.status
      },
      include: {
        user: {
          select: userSelect
        }
      }
    });

    if (transition.status === PayoutStatus.CANCELLED || transition.status === PayoutStatus.FAILED) {
      const taskCreditEventIds = getPayoutTaskCreditEventIds(existing.metadata);

      if (taskCreditEventIds.length > 0) {
        await tx.taskCreditEvent.updateMany({
          where: {
            id: {
              in: taskCreditEventIds
            },
            status: TaskCreditStatus.WITHDRAWN,
            userId: existing.userId
          },
          data: {
            status: TaskCreditStatus.AVAILABLE,
            withdrawnAt: null
          }
        });
      }
    }

    if (transition.status === PayoutStatus.PAID) {
      const paidAt = new Date();
      const payoutLedgerEntry = await tx.ledgerEntry.findFirst({
        where: {
          referenceId: payout.id,
          walletId: payout.walletId
        },
        select: {
          id: true
        }
      });

      await tx.walletReceipt.create({
        data: {
          amount: payout.amount,
          currency: payout.currency,
          description: "Worker payout statement.",
          ledgerEntryId: payoutLedgerEntry?.id ?? null,
          metadata: {
            adminNotes: parsedReview.value.adminNotes ?? null,
            provider: parsedReview.value.provider ?? "manual",
            providerRef: parsedReview.value.providerRef ?? null,
            requestId: getRequestId(request)
          },
          payoutId: payout.id,
          provider: parsedReview.value.provider ?? "manual",
          providerRef: parsedReview.value.providerRef,
          receiptNumber: buildWalletReceiptNumber("POUT", paidAt, payout.id),
          type: WalletReceiptType.PAYOUT,
          userId: payout.userId,
          walletId: payout.walletId
        }
      });
    }

    await tx.auditLog.create({
      data: {
        action: `payout.${decision === "cancel" ? "cancelled" : decision === "fail" ? "failed" : decision}`,
        entityId: payout.id,
        entityType: "payout",
        metadata: {
          amount: payout.amount.toString(),
          currency: payout.currency,
          provider: parsedReview.value.provider ?? null,
          providerRef: parsedReview.value.providerRef ?? null,
          adminNotes: parsedReview.value.adminNotes ?? null,
          nextStatus: transition.status,
          previousStatus: existing.status,
          requestId: getRequestId(request)
        },
        userId: admin.id
      }
    });

    return payout;
  });

  response.status(200).json({
    payout: serializeAdminPayout(saved)
  });
});

router.post("/applications/:type/:applicationId/:decision", async (request: AuthenticatedRequest, response) => {
  const admin = request.currentUser;
  const type = request.params.type;
  const applicationId = normalizeId(request.params.applicationId);
  const decision = request.params.decision;
  const reviewerNotes = normalizeText(request.body?.reviewerNotes) ?? null;

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (type !== "verification" && type !== "creator") {
    response.status(400).json({ error: "Application type must be verification or creator." });
    return;
  }

  if (!applicationId) {
    response.status(400).json({ error: "Application is required." });
    return;
  }

  if (decision !== "approve" && decision !== "reject") {
    response.status(400).json({ error: "Decision must be approve or reject." });
    return;
  }

  const prisma = getPrismaClient();
  const reviewedAt = new Date();
  const nextStatus = decision === "approve" ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED;

  if (type === "verification") {
    const application = await prisma.verificationApplication.findUnique({
      where: {
        id: applicationId
      }
    });

    if (!application) {
      response.status(404).json({ error: "Verification application was not found." });
      return;
    }

    const saved = await prisma.$transaction(async (tx) => {
      const reviewed = await tx.verificationApplication.update({
        where: {
          id: application.id
        },
        data: {
          status: nextStatus,
          reviewerId: admin.id,
          reviewerNotes,
          reviewedAt
        },
        include: {
          user: {
            select: userSelect
          }
        }
      });

      await tx.user.update({
        where: {
          id: application.userId
        },
        data:
          decision === "approve"
            ? {
                isVerified: true,
                verificationStatus: VerificationStatus.VERIFIED,
                verifiedAt: reviewedAt,
                verifiedById: admin.id
              }
            : {
                isVerified: false,
                verificationStatus: VerificationStatus.REJECTED,
                verifiedAt: null,
                verifiedById: null
              }
      });

      await tx.auditLog.create({
        data: {
          userId: admin.id,
          action: `verification_application.${decision === "approve" ? "approved" : "rejected"}`,
          entityType: "verification_application",
          entityId: application.id,
          metadata: {
            requestId: getRequestId(request),
            applicantId: application.userId
          }
        }
      });

      return reviewed;
    });

    response.status(200).json({
      application: serializeAdminApplication(saved, "verification")
    });
    return;
  }

  const application = await prisma.creatorApplication.findUnique({
    where: {
      id: applicationId
    }
  });

  if (!application) {
    response.status(404).json({ error: "Creator application was not found." });
    return;
  }

  const saved = await prisma.$transaction(async (tx) => {
    const reviewed = await tx.creatorApplication.update({
      where: {
        id: application.id
      },
      data: {
        status: nextStatus,
        reviewerId: admin.id,
        reviewerNotes,
        reviewedAt
      },
      include: {
        user: {
          select: userSelect
        }
      }
    });

    await tx.user.update({
      where: {
        id: application.userId
      },
      data: {
        creatorStatus: decision === "approve" ? CreatorStatus.APPROVED : CreatorStatus.REJECTED
      }
    });

    await tx.auditLog.create({
      data: {
        userId: admin.id,
        action: `creator_application.${decision === "approve" ? "approved" : "rejected"}`,
        entityType: "creator_application",
        entityId: application.id,
        metadata: {
          requestId: getRequestId(request),
          applicantId: application.userId
        }
      }
    });

    return reviewed;
  });

  response.status(200).json({
    application: serializeAdminApplication(saved, "creator")
  });
});

function requireSuperAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (user.globalRole !== GlobalRole.SUPER_ADMIN) {
    response.status(403).json({ error: "Super admin access is required." });
    return;
  }

  next();
}

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  jobTitle: true,
  isVerified: true,
  verificationStatus: true,
  creatorStatus: true,
  globalRole: true,
  status: true,
  createdAt: true,
  updatedAt: true
} as const;

const adminPaymentIntentInclude = {
  createdBy: {
    select: userSelect
  },
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  _count: {
    select: {
      receipts: true
    }
  }
} satisfies Prisma.PaymentIntentInclude;

type AdminPaymentIntentRecord = Prisma.PaymentIntentGetPayload<{ include: typeof adminPaymentIntentInclude }>;

type AdminPaymentReconciliationSummary = {
  issueCount: number;
  netLedgerAmount: number;
  netReceiptAmount: number;
  severity: "blocked" | "none" | "warning";
  status: "balanced" | "warning";
};

function parseBooleanSetting(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function parseOptionalBooleanSetting(value: unknown) {
  return value === undefined ? undefined : parseBooleanSetting(value);
}

function parsePercentSetting(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const normalized = numberValue > 1 ? numberValue / 100 : numberValue;

  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1 ? normalized : null;
}

function parseCreditSetting(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 1_000_000 ? numberValue : null;
}

class ExistingOpenTaskEconomicsError extends Error {}

async function buildAdminPlatformRevenueReport() {
  const prisma = getPrismaClient();
  const openTaskStatuses = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED, TaskStatus.SUBMITTED, TaskStatus.REVIEWING];
  const [feeEntries, recentFeeEntries, pendingTasks] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: {
        type: LedgerEntryType.FEE
      },
      include: {
        wallet: {
          select: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 2000
    }),
    prisma.ledgerEntry.findMany({
      where: {
        type: LedgerEntryType.FEE
      },
      include: {
        wallet: {
          select: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20
    }),
    prisma.task.findMany({
      where: {
        status: {
          in: openTaskStatuses
        }
      },
      select: {
        id: true,
        metadata: true,
        dataset: {
          select: {
            id: true,
            name: true
          }
        },
        project: {
          select: {
            id: true,
            name: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            }
          }
        }
      }
    })
  ]);
  const feeTaskIds = Array.from(new Set([...feeEntries, ...recentFeeEntries].map(getFeeEntryTaskId).filter((id): id is string => Boolean(id))));
  const feeTasks = feeTaskIds.length > 0
    ? await prisma.task.findMany({
        where: {
          id: {
            in: feeTaskIds
          }
        },
        select: {
          id: true,
          dataset: {
            select: {
              id: true,
              name: true
            }
          },
          project: {
            select: {
              id: true,
              name: true,
              organization: {
                select: {
                  id: true,
                  name: true,
                  slug: true
                }
              }
            }
          }
        }
      })
    : [];
  const taskById = new Map(feeTasks.map((task) => [task.id, task]));
  const totalsByCurrency = new Map<string, { collectedAmount: number; currency: string; pendingAmount: number; totalAmount: number }>();
  const datasetBuckets = new Map<string, RevenueBucket>();
  const projectBuckets = new Map<string, RevenueBucket>();
  const creatorBuckets = new Map<string, RevenueBucket>();

  for (const entry of feeEntries) {
    const amount = Number(entry.amount.toString());
    const currency = getCurrency(entry.currency);
    const task = taskById.get(getFeeEntryTaskId(entry) ?? "");
    const organization = entry.wallet.organization ?? task?.project.organization ?? null;

    addRevenueTotal(totalsByCurrency, currency, "collectedAmount", amount);
    addRevenueBucket(datasetBuckets, {
      amount,
      currency,
      id: task?.dataset?.id ?? getJsonText(entry.metadata, "datasetId") ?? "unassigned",
      kind: "collectedAmount",
      name: task?.dataset?.name ?? getJsonText(entry.metadata, "datasetName") ?? "No dataset",
      slug: null
    });
    addRevenueBucket(projectBuckets, {
      amount,
      currency,
      id: task?.project.id ?? getJsonText(entry.metadata, "projectId") ?? "unassigned",
      kind: "collectedAmount",
      name: task?.project.name ?? getJsonText(entry.metadata, "projectName") ?? "No project",
      slug: null
    });
    addRevenueBucket(creatorBuckets, {
      amount,
      currency,
      id: organization?.id ?? "unknown",
      kind: "collectedAmount",
      name: organization?.name ?? "Unknown creator",
      slug: organization?.slug ?? null
    });
  }

  for (const task of pendingTasks) {
    const metadata = isPlainObject(task.metadata) ? task.metadata : {};
    const pendingCredits = getWholeNumber(metadata.paymentPlatformFeeCredits);

    if (pendingCredits <= 0) {
      continue;
    }

    const amount = Number(getCreditAmount(pendingCredits));
    const currency = getCurrency(metadata.paymentCurrency);
    const organization = task.project.organization;

    addRevenueTotal(totalsByCurrency, currency, "pendingAmount", amount);
    addRevenueBucket(datasetBuckets, {
      amount,
      currency,
      id: task.dataset?.id ?? "unassigned",
      kind: "pendingAmount",
      name: task.dataset?.name ?? "No dataset",
      slug: null
    });
    addRevenueBucket(projectBuckets, {
      amount,
      currency,
      id: task.project.id,
      kind: "pendingAmount",
      name: task.project.name,
      slug: null
    });
    addRevenueBucket(creatorBuckets, {
      amount,
      currency,
      id: organization.id,
      kind: "pendingAmount",
      name: organization.name,
      slug: organization.slug
    });
  }

  return {
    byCreator: Array.from(creatorBuckets.values()).sort(sortRevenueBucket).slice(0, 12),
    byDataset: Array.from(datasetBuckets.values()).sort(sortRevenueBucket).slice(0, 12),
    byProject: Array.from(projectBuckets.values()).sort(sortRevenueBucket).slice(0, 12),
    recentFees: recentFeeEntries.map((entry) => {
      const task = taskById.get(getFeeEntryTaskId(entry) ?? "");
      const organization = entry.wallet.organization ?? task?.project.organization ?? null;

      return {
        amount: Number(entry.amount.toString()),
        createdAt: entry.createdAt,
        currency: getCurrency(entry.currency),
        creator: organization,
        dataset: task?.dataset ?? null,
        description: entry.description,
        id: entry.id,
        project: task?.project ? { id: task.project.id, name: task.project.name } : null,
        referenceId: entry.referenceId,
        reviewId: getJsonText(entry.metadata, "reviewId"),
        taskId: task?.id ?? getFeeEntryTaskId(entry)
      };
    }),
    totals: Array.from(totalsByCurrency.values())
      .map((total) => ({
        ...total,
        collectedAmount: roundMoney(total.collectedAmount),
        pendingAmount: roundMoney(total.pendingAmount),
        totalAmount: roundMoney(total.collectedAmount + total.pendingAmount)
      }))
      .sort((left, right) => left.currency.localeCompare(right.currency))
  };
}

type RevenueBucket = {
  collectedAmount: number;
  currency: string;
  id: string;
  name: string;
  pendingAmount: number;
  slug: string | null;
  taskCount: number;
  totalAmount: number;
};

async function buildAdminPaymentAuditTrail() {
  const prisma = getPrismaClient();
  const [paymentIntents, receipts, ledgerEntries, webhookEvents, auditLogs] = await Promise.all([
    prisma.paymentIntent.findMany({
      include: {
        createdBy: {
          select: userSelect
        },
        organization: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        }
      },
      orderBy: {
        updatedAt: "desc"
      },
      take: 30
    }),
    prisma.walletReceipt.findMany({
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true
          }
        },
        user: {
          select: userSelect
        }
      },
      orderBy: {
        issuedAt: "desc"
      },
      take: 30
    }),
    prisma.ledgerEntry.findMany({
      include: {
        wallet: {
          select: {
            organization: {
              select: {
                id: true,
                name: true,
                slug: true
              }
            },
            user: {
              select: userSelect
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 30
    }),
    prisma.providerWebhookEvent.findMany({
      orderBy: {
        updatedAt: "desc"
      },
      take: 30
    }),
    prisma.auditLog.findMany({
      include: {
        user: {
          select: userSelect
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 40
    })
  ]);

  return [
    ...paymentIntents.map((payment) => ({
      actor: payment.createdBy ? getAdminUserDisplayName(payment.createdBy) : null,
      amount: Number(payment.amount.toString()),
      createdAt: payment.updatedAt,
      currency: payment.currency,
      description: payment.description ?? `${formatPaymentProviderName(payment.provider)} checkout ${payment.status.toLowerCase()}.`,
      id: `payment:${payment.id}`,
      kind: "payment_intent",
      organization: payment.organization?.name ?? null,
      provider: payment.provider,
      reference: payment.providerRef ?? payment.clientRequestId ?? payment.id,
      sourceId: payment.id,
      status: payment.status,
      title: "Payment intent"
    })),
    ...receipts.map((receipt) => ({
      actor: receipt.user ? getAdminUserDisplayName(receipt.user) : null,
      amount: Number(receipt.amount.toString()),
      createdAt: receipt.issuedAt,
      currency: receipt.currency,
      description: receipt.description ?? `${receipt.type} receipt issued.`,
      id: `receipt:${receipt.id}`,
      kind: "receipt",
      organization: receipt.organization?.name ?? null,
      provider: receipt.provider,
      reference: receipt.receiptNumber,
      sourceId: receipt.id,
      status: receipt.type,
      title: "Wallet receipt"
    })),
    ...ledgerEntries.map((entry) => ({
      actor: entry.wallet.user ? getAdminUserDisplayName(entry.wallet.user) : null,
      amount: Number(entry.amount.toString()),
      createdAt: entry.createdAt,
      currency: entry.currency,
      description: entry.description ?? `${entry.type} ledger entry.`,
      id: `ledger:${entry.id}`,
      kind: "ledger_entry",
      organization: entry.wallet.organization?.name ?? null,
      provider: null,
      reference: entry.referenceId ?? getJsonText(entry.metadata, "paymentIntentId") ?? entry.id,
      sourceId: entry.id,
      status: entry.type,
      title: "Wallet ledger"
    })),
    ...webhookEvents.map((event) => ({
      actor: null,
      amount: null,
      createdAt: event.updatedAt,
      currency: null,
      description: event.duplicateCount > 0
        ? `${event.eventType ?? "Webhook event"} with ${event.duplicateCount} duplicate deliver${event.duplicateCount === 1 ? "y" : "ies"}.`
        : `${event.eventType ?? "Webhook event"} received.`,
      id: `webhook:${event.id}`,
      kind: "webhook",
      organization: null,
      provider: event.provider,
      reference: event.eventId,
      sourceId: event.id,
      status: event.duplicateCount > 0 ? "RETRIED" : "RECEIVED",
      title: "Provider webhook"
    })),
    ...auditLogs.map((entry) => ({
      actor: entry.user ? getAdminUserDisplayName(entry.user) : null,
      amount: null,
      createdAt: entry.createdAt,
      currency: null,
      description: getAuditTrailDescription(entry),
      id: `audit:${entry.id}`,
      kind: "audit_log",
      organization: null,
      provider: getJsonText(entry.metadata, "provider"),
      reference: entry.entityId ?? getJsonText(entry.metadata, "requestId") ?? entry.id,
      sourceId: entry.id,
      status: entry.entityType ?? "audit",
      title: entry.action
    }))
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 50);
}

function addRevenueTotal(
  totals: Map<string, { collectedAmount: number; currency: string; pendingAmount: number; totalAmount: number }>,
  currency: string,
  kind: "collectedAmount" | "pendingAmount",
  amount: number
) {
  const current = totals.get(currency) ?? {
    collectedAmount: 0,
    currency,
    pendingAmount: 0,
    totalAmount: 0
  };
  current[kind] += amount;
  current.totalAmount = current.collectedAmount + current.pendingAmount;
  totals.set(currency, current);
}

function addRevenueBucket(
  buckets: Map<string, RevenueBucket>,
  input: {
    amount: number;
    currency: string;
    id: string;
    kind: "collectedAmount" | "pendingAmount";
    name: string;
    slug: string | null;
  }
) {
  const key = `${input.currency}:${input.id}`;
  const current = buckets.get(key) ?? {
    collectedAmount: 0,
    currency: input.currency,
    id: input.id,
    name: input.name,
    pendingAmount: 0,
    slug: input.slug,
    taskCount: 0,
    totalAmount: 0
  };
  current[input.kind] += input.amount;
  current.taskCount += 1;
  current.totalAmount = current.collectedAmount + current.pendingAmount;
  buckets.set(key, current);
}

function sortRevenueBucket(left: RevenueBucket, right: RevenueBucket) {
  return right.totalAmount - left.totalAmount || left.name.localeCompare(right.name);
}

function getFeeEntryTaskId(entry: { metadata: Prisma.JsonValue | null; referenceId: string | null }) {
  return getJsonText(entry.metadata, "taskId") ?? entry.referenceId;
}

async function applyEconomicsToExistingOpenTasks(
  economics: Awaited<ReturnType<typeof getPlatformTaskEconomics>>,
  adminId: string,
  requestId: string
) {
  const prisma = getPrismaClient();
  const tasks = await prisma.task.findMany({
    where: {
      status: {
        in: [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.REJECTED, TaskStatus.SUBMITTED, TaskStatus.REVIEWING]
      }
    },
    select: {
      id: true,
      datasetId: true,
      metadata: true,
      project: {
        select: {
          id: true,
          organizationId: true
        }
      }
    }
  });
  const updates = tasks.map((task) => getExistingTaskEconomicsUpdate(task, economics)).filter((update): update is ExistingTaskEconomicsUpdate => update !== null);

  if (updates.length === 0) {
    return {
      heldCredits: 0,
      skippedCount: tasks.length,
      updatedCount: 0
    };
  }

  const creditsByWallet = new Map<string, { currency: string; credits: number; organizationId: string }>();
  const creditsByHold = new Map<string, number>();

  for (const update of updates) {
    const walletKey = `${update.organizationId}:${update.currency}`;
    const walletBucket = creditsByWallet.get(walletKey) ?? {
      credits: 0,
      currency: update.currency,
      organizationId: update.organizationId
    };
    walletBucket.credits += update.topUpCredits;
    creditsByWallet.set(walletKey, walletBucket);
    creditsByHold.set(update.escrowLedgerEntryId, (creditsByHold.get(update.escrowLedgerEntryId) ?? 0) + update.topUpCredits);
  }

  await prisma.$transaction(async (tx) => {
    for (const bucket of creditsByWallet.values()) {
      const wallet = await ensureOrganizationWallet(tx, bucket.organizationId, bucket.currency);
      const walletUpdate = await tx.wallet.updateMany({
        where: {
          balance: {
            gte: getCreditAmount(bucket.credits)
          },
          id: wallet.id
        },
        data: {
          balance: {
            decrement: getCreditAmount(bucket.credits)
          }
        }
      });

      if (walletUpdate.count !== 1) {
        throw new ExistingOpenTaskEconomicsError(
          `Creator wallet needs ${getCreditAmount(bucket.credits)} ${bucket.currency} to apply the new platform fee to existing open tasks. Add funds or use future tasks only.`
        );
      }
    }

    for (const [ledgerEntryId, credits] of creditsByHold.entries()) {
      await tx.ledgerEntry.updateMany({
        where: {
          id: ledgerEntryId,
          type: LedgerEntryType.HOLD
        },
        data: {
          amount: {
            increment: getCreditAmount(credits)
          }
        }
      });
    }

    await Promise.all(
      updates.map((update) =>
        tx.task.update({
          where: {
            id: update.taskId
          },
          data: {
            metadata: update.metadata
          }
        })
      )
    );

    await tx.auditLog.create({
      data: {
        userId: adminId,
        action: "admin.task_economics.applied_to_existing_tasks",
        entityType: "platform_setting",
        entityId: "platform.task_economics",
        metadata: {
          freeTaskPostingFeeCredits: economics.freeTaskPostingFeeCredits,
          heldCredits: updates.reduce((total, update) => total + update.topUpCredits, 0),
          platformFeeRate: economics.platformFeeRate,
          requestId,
          updatedCount: updates.length
        }
      }
    });
  });

  return {
    heldCredits: updates.reduce((total, update) => total + update.topUpCredits, 0),
    skippedCount: tasks.length - updates.length,
    updatedCount: updates.length
  };
}

type ExistingTaskEconomicsUpdate = {
  currency: string;
  escrowLedgerEntryId: string;
  metadata: Prisma.InputJsonObject;
  organizationId: string;
  taskId: string;
  topUpCredits: number;
};

function getExistingTaskEconomicsUpdate(
  task: {
    id: string;
    metadata: Prisma.JsonValue | null;
    project: {
      organizationId: string;
    };
  },
  economics: Awaited<ReturnType<typeof getPlatformTaskEconomics>>
): ExistingTaskEconomicsUpdate | null {
  const metadata = isPlainObject(task.metadata) ? task.metadata : {};
  const escrowLedgerEntryId = getString(metadata.paymentEscrowLedgerEntryId);
  const currentEscrowCredits = getWholeNumber(metadata.paymentEscrowCredits);
  const currentPlatformFeeCredits = getWholeNumber(metadata.paymentPlatformFeeCredits);
  const workerCredits = getWholeNumber(metadata.paymentWorkerCredits) || getWholeNumber(metadata.paymentAnnotationCredits) + getWholeNumber(metadata.paymentReviewCredits);
  const nextPlatformFeeCredits = workerCredits > 0
    ? Math.ceil(workerCredits * economics.platformFeeRate)
    : economics.freeTaskPostingFeeCredits;
  const topUpCredits = Math.max(0, nextPlatformFeeCredits - currentPlatformFeeCredits);

  if (!escrowLedgerEntryId || topUpCredits <= 0) {
    return null;
  }

  return {
    currency: getCurrency(metadata.paymentCurrency),
    escrowLedgerEntryId,
    metadata: {
      ...metadata,
      paymentEscrowCredits: currentEscrowCredits + topUpCredits,
      paymentFreeTaskPostingFeeCredits: economics.freeTaskPostingFeeCredits,
      paymentPlatformFeeCredits: nextPlatformFeeCredits,
      paymentPlatformFeeRate: economics.platformFeeRate,
      paymentWorkerCredits: workerCredits
    },
    organizationId: task.project.organizationId,
    taskId: task.id,
    topUpCredits
  };
}

function getCreditAmount(credits: number) {
  return ((Math.max(0, credits) / 100)).toFixed(2);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function decimalToNumber(value: Prisma.Decimal | number | string) {
  return typeof value === "number" ? value : Number(value.toString());
}

function moneyToCents(value: Prisma.Decimal | number | string) {
  return Math.round(decimalToNumber(value) * 100);
}

function centsToMoney(cents: number) {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function normalizeMoneyCents(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isFinite(numberValue) || numberValue <= 0 || numberValue > 100_000) {
    return null;
  }

  return Math.round(numberValue * 100);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getWholeNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;

  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : 0;
}

function getCurrency(value: unknown) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "USD";

  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function getAdminUserDisplayName(user: Parameters<typeof serializeAdminUser>[0]) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

function formatPaymentProviderName(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "paypal") {
    return "PayPal";
  }

  if (normalized === "stripe") {
    return "Stripe";
  }

  if (normalized === "plaid") {
    return "Plaid";
  }

  return provider || "Manual";
}

function getAuditTrailDescription(entry: { action: string; entityType: string | null; metadata: Prisma.JsonValue | null }) {
  const previousStatus = getJsonText(entry.metadata, "previousStatus");
  const nextStatus = getJsonText(entry.metadata, "nextStatus") ?? getJsonText(entry.metadata, "status");
  const requestId = getJsonText(entry.metadata, "requestId");
  const reason = getJsonText(entry.metadata, "reason");
  const error = getJsonText(entry.metadata, "error");

  if (entry.action.endsWith("_webhook.rejected")) {
    return error ?? `Provider webhook rejected${reason ? `: ${reason}` : ""}.`;
  }

  if (previousStatus && nextStatus) {
    return `${entry.entityType ?? "Record"} moved from ${previousStatus} to ${nextStatus}.`;
  }

  if (requestId) {
    return `${entry.entityType ?? "Record"} audit event for request ${requestId}.`;
  }

  return `${entry.entityType ?? "Record"} audit event.`;
}

function buildPaymentProviderSettings(features: Awaited<ReturnType<typeof getPlatformFeatures>>) {
  return {
    paypal: {
      configured: Boolean(process.env.PAYPAL_CLIENT_ID?.trim() && process.env.PAYPAL_CLIENT_SECRET?.trim()),
      enabled: features.payments.paypalEnabled,
      environment: process.env.PAYPAL_ENVIRONMENT?.trim() || "sandbox",
      missing: [
        ...(!process.env.PAYPAL_CLIENT_ID?.trim() ? ["PAYPAL_CLIENT_ID"] : []),
        ...(!process.env.PAYPAL_CLIENT_SECRET?.trim() ? ["PAYPAL_CLIENT_SECRET"] : []),
        ...(!process.env.PAYPAL_WEBHOOK_ID?.trim() ? ["PAYPAL_WEBHOOK_ID"] : [])
      ]
    },
    plaid: {
      configured: Boolean(process.env.PLAID_CLIENT_ID?.trim() && process.env.PLAID_SECRET?.trim()),
      enabled: features.payments.plaidEnabled,
      environment: process.env.PLAID_ENV?.trim() || "sandbox",
      missing: [
        ...(!process.env.PLAID_CLIENT_ID?.trim() ? ["PLAID_CLIENT_ID"] : []),
        ...(!process.env.PLAID_SECRET?.trim() ? ["PLAID_SECRET"] : [])
      ]
    },
    stripe: {
      configured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
      enabled: features.payments.stripeEnabled,
      environment: process.env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") ? "live" : "test",
      missing: [
        ...(!process.env.STRIPE_SECRET_KEY?.trim() ? ["STRIPE_SECRET_KEY"] : []),
        ...(!process.env.STRIPE_WEBHOOK_SECRET?.trim() ? ["STRIPE_WEBHOOK_SECRET"] : [])
      ]
    }
  };
}

function parseUserUpdate(body: unknown):
  | {
      ok: true;
      value: {
        verificationStatus?: VerificationStatus;
        creatorStatus?: CreatorStatus;
        globalRole?: GlobalRole;
        status?: UserStatus;
      };
    }
  | { ok: false; error: string } {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const verificationStatus = parseEnumValue(VerificationStatus, value.verificationStatus);
  const creatorStatus = parseEnumValue(CreatorStatus, value.creatorStatus);
  const globalRole = parseEnumValue(GlobalRole, value.globalRole);
  const status = parseEnumValue(UserStatus, value.status);

  if (value.verificationStatus !== undefined && !verificationStatus) {
    return { ok: false, error: "Choose a valid verification status." };
  }

  if (value.creatorStatus !== undefined && !creatorStatus) {
    return { ok: false, error: "Choose a valid creator status." };
  }

  if (value.globalRole !== undefined && !globalRole) {
    return { ok: false, error: "Choose a valid global role." };
  }

  if (value.status !== undefined && !status) {
    return { ok: false, error: "Choose a valid user status." };
  }

  return {
    ok: true,
    value: {
      ...(verificationStatus ? { verificationStatus } : {}),
      ...(creatorStatus ? { creatorStatus } : {}),
      ...(globalRole ? { globalRole } : {}),
      ...(status ? { status } : {})
    }
  };
}

function serializeAdminApplication(
  application: {
    id: string;
    userId: string;
    status: ApplicationStatus;
    reason: string;
    intendedUse: string | null;
    reviewerNotes: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user?: Parameters<typeof serializeAdminUser>[0];
  },
  type: "verification" | "creator"
) {
  return {
    id: application.id,
    type,
    userId: application.userId,
    user: application.user ? serializeAdminUser(application.user) : null,
    status: application.status,
    reason: application.reason,
    intendedUse: application.intendedUse,
    reviewerNotes: application.reviewerNotes,
    reviewedAt: application.reviewedAt,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

function serializeAdminPayout(payout: {
  id: string;
  userId: string;
  walletId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: PayoutStatus;
  provider: string | null;
  providerRef: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { receipts: number };
  user?: Parameters<typeof serializeAdminUser>[0];
}) {
  return {
    id: payout.id,
    userId: payout.userId,
    user: payout.user ? serializeAdminUser(payout.user) : null,
    walletId: payout.walletId,
    amount: Number(payout.amount.toString()),
    currency: payout.currency,
    status: payout.status,
    provider: payout.provider,
    providerRef: payout.providerRef,
    adminNotes: getPayoutMetadataText(payout.metadata, "adminNotes"),
    receiptCount: payout._count?.receipts ?? 0,
    reviewedAt: getPayoutMetadataText(payout.metadata, "reviewedAt"),
    taskCreditEventCount: getPayoutTaskCreditEventIds(payout.metadata).length,
    createdAt: payout.createdAt,
    updatedAt: payout.updatedAt
  };
}

function serializeAdminPayoutDetail(
  payout: Parameters<typeof serializeAdminPayout>[0],
  creditEvents: Array<{
    amount: Prisma.Decimal;
    approvedAt: Date | null;
    availableAt: Date | null;
    createdAt: Date;
    credits: number;
    currency: string;
    dataset: { id: string; name: string } | null;
    eventType: string;
    id: string;
    points: number;
    project: { id: string; name: string } | null;
    status: string;
    task: { id: string; asset: { fileName: string } | null } | null;
    withdrawnAt: Date | null;
  }>,
  auditTrail: Array<{
    action: string;
    createdAt: Date;
    id: string;
    metadata: Prisma.JsonValue | null;
  }>
) {
  return {
    ...serializeAdminPayout(payout),
    auditTrail: auditTrail.map((entry) => ({
      action: entry.action,
      createdAt: entry.createdAt,
      id: entry.id,
      metadata: entry.metadata
    })),
    creditEvents: creditEvents.map((event) => ({
      amount: Number(event.amount.toString()),
      approvedAt: event.approvedAt,
      assetName: event.task?.asset?.fileName ?? null,
      availableAt: event.availableAt,
      createdAt: event.createdAt,
      credits: event.credits,
      currency: event.currency,
      datasetId: event.dataset?.id ?? null,
      datasetName: event.dataset?.name ?? null,
      eventType: event.eventType,
      id: event.id,
      points: event.points,
      projectId: event.project?.id ?? null,
      projectName: event.project?.name ?? null,
      status: event.status,
      taskId: event.task?.id ?? null,
      withdrawnAt: event.withdrawnAt
    }))
  };
}

async function buildAdminPaymentIntentReconciliationSummaries(payments: AdminPaymentIntentRecord[]): Promise<Map<string, AdminPaymentReconciliationSummary>> {
  const paymentIds = payments.map((payment) => payment.id);

  if (paymentIds.length === 0) {
    return new Map<string, AdminPaymentReconciliationSummary>();
  }

  const prisma = getPrismaClient();
  const paymentIdSet = new Set(paymentIds);
  const receipts = await prisma.walletReceipt.findMany({
    where: {
      paymentIntentId: {
        in: paymentIds
      }
    },
    select: {
      amount: true,
      currency: true,
      id: true,
      ledgerEntryId: true,
      paymentIntentId: true,
      type: true
    }
  });
  const receiptLedgerEntryIds = receipts.map((receipt) => receipt.ledgerEntryId).filter((id): id is string => Boolean(id));
  const ledgerWhere: Prisma.LedgerEntryWhereInput[] = [
    {
      referenceId: {
        in: paymentIds
      }
    },
    ...paymentIds.map((id) => ({
      metadata: {
        path: ["paymentIntentId"],
        equals: id
      }
    }))
  ];

  if (receiptLedgerEntryIds.length > 0) {
    ledgerWhere.push({
      id: {
        in: receiptLedgerEntryIds
      }
    });
  }

  const ledgerEntries = await prisma.ledgerEntry.findMany({
    where: {
      OR: ledgerWhere
    },
    select: {
      amount: true,
      currency: true,
      id: true,
      metadata: true,
      referenceId: true,
      type: true
    }
  });
  const receiptsByPayment = new Map<string, typeof receipts>();
  const receiptPaymentByLedgerEntry = new Map<string, string>();
  const ledgerEntriesByPayment = new Map<string, Map<string, typeof ledgerEntries[number]>>();

  for (const receipt of receipts) {
    if (!receipt.paymentIntentId) {
      continue;
    }

    const paymentReceipts = receiptsByPayment.get(receipt.paymentIntentId) ?? [];
    paymentReceipts.push(receipt);
    receiptsByPayment.set(receipt.paymentIntentId, paymentReceipts);

    if (receipt.ledgerEntryId) {
      receiptPaymentByLedgerEntry.set(receipt.ledgerEntryId, receipt.paymentIntentId);
    }
  }

  for (const entry of ledgerEntries) {
    const linkedPaymentIds = new Set<string>();
    const metadataPaymentId = getJsonText(entry.metadata, "paymentIntentId");
    const receiptPaymentId = receiptPaymentByLedgerEntry.get(entry.id);

    if (entry.referenceId && paymentIdSet.has(entry.referenceId)) {
      linkedPaymentIds.add(entry.referenceId);
    }

    if (metadataPaymentId && paymentIdSet.has(metadataPaymentId)) {
      linkedPaymentIds.add(metadataPaymentId);
    }

    if (receiptPaymentId) {
      linkedPaymentIds.add(receiptPaymentId);
    }

    for (const paymentId of linkedPaymentIds) {
      const paymentLedgerEntries = ledgerEntriesByPayment.get(paymentId) ?? new Map<string, typeof entry>();
      paymentLedgerEntries.set(entry.id, entry);
      ledgerEntriesByPayment.set(paymentId, paymentLedgerEntries);
    }
  }

  return new Map(paymentIds.map((paymentId) => {
    const payment = payments.find((candidate) => candidate.id === paymentId);

    if (!payment) {
      return [paymentId, {
        issueCount: 0,
        netLedgerAmount: 0,
        netReceiptAmount: 0,
        severity: "none" as const,
        status: "balanced" as const
      }];
    }

    const reconciliation = buildAdminPaymentReconciliation(
      payment,
      receiptsByPayment.get(paymentId) ?? [],
      [...(ledgerEntriesByPayment.get(paymentId)?.values() ?? [])]
    );
    const severity = reconciliation.issues.some((issue) => issue.severity === "blocked")
      ? "blocked"
      : reconciliation.issues.length > 0
        ? "warning"
        : "none";

    return [paymentId, {
      issueCount: reconciliation.issueCount,
      netLedgerAmount: reconciliation.netLedgerAmount,
      netReceiptAmount: reconciliation.netReceiptAmount,
      severity,
      status: reconciliation.status as AdminPaymentReconciliationSummary["status"]
    } satisfies AdminPaymentReconciliationSummary];
  }));
}

function serializeAdminPaymentIntent(payment: {
  id: string;
  walletId: string;
  createdById: string | null;
  organizationId: string | null;
  clientRequestId: string | null;
  amount: Prisma.Decimal;
  currency: string;
  status: PaymentIntentStatus;
  provider: string;
  providerRef: string | null;
  purpose: string;
  description: string | null;
  metadata: Prisma.JsonValue | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: Parameters<typeof serializeAdminUser>[0] | null;
  organization?: { id: string; name: string; slug: string } | null;
  _count: { receipts: number };
}, reconciliationSummary?: AdminPaymentReconciliationSummary) {
  const state = getAdminPaymentIntentState(payment, new Date());

  return {
    amount: Number(payment.amount.toString()),
    canCancel: state.canCancel,
    cancelledAt: payment.cancelledAt,
    clientRequestId: payment.clientRequestId,
    completedAt: payment.completedAt,
    createdAt: payment.createdAt,
    createdBy: payment.createdBy ? serializeAdminUser(payment.createdBy) : null,
    createdById: payment.createdById,
    currency: payment.currency,
    description: payment.description,
    id: payment.id,
    organization: payment.organization ?? null,
    organizationId: payment.organizationId,
    provider: payment.provider,
    providerRef: payment.providerRef,
    purpose: payment.purpose,
    reconciliationSummary: reconciliationSummary ?? {
      issueCount: 0,
      netLedgerAmount: 0,
      netReceiptAmount: 0,
      severity: "none",
      status: "balanced"
    },
    receiptCount: payment._count.receipts,
    staleAgeMinutes: state.staleAgeMinutes,
    staleReason: state.staleReason,
    status: payment.status,
    statusGroup: state.statusGroup,
    updatedAt: payment.updatedAt,
    walletId: payment.walletId
  };
}

function serializeAdminPaymentIntentDetail(
  payment: Parameters<typeof serializeAdminPaymentIntent>[0],
  receipts: Array<{
    amount: Prisma.Decimal;
    createdAt: Date;
    currency: string;
    description: string | null;
    id: string;
    issuedAt: Date;
    ledgerEntryId: string | null;
    paymentIntentId: string | null;
    provider: string;
    providerRef: string | null;
    receiptNumber: string;
    type: WalletReceiptType;
    organization?: { id: string; name: string; slug: string } | null;
    user?: Parameters<typeof serializeAdminUser>[0] | null;
  }>,
  ledgerEntries: Array<{
    amount: Prisma.Decimal;
    createdAt: Date;
    currency: string;
    description: string | null;
    id: string;
    metadata: Prisma.JsonValue | null;
    referenceId: string | null;
    type: LedgerEntryType;
    walletId: string;
    wallet: {
      organization?: { id: string; name: string; slug: string } | null;
      user?: Parameters<typeof serializeAdminUser>[0] | null;
    };
  }>,
  auditTrail: Array<{
    action: string;
    createdAt: Date;
    entityId: string | null;
    entityType: string | null;
    id: string;
    metadata: Prisma.JsonValue | null;
    user?: Parameters<typeof serializeAdminUser>[0] | null;
  }>,
  webhookEvents: Array<{
    action: string | null;
    duplicateCount: number;
    eventId: string;
    eventType: string | null;
    id: string;
    lastDuplicateAt: Date | null;
    metadata: Prisma.JsonValue | null;
    provider: string;
    receivedAt: Date;
    updatedAt: Date;
  }>
) {
  const reconciliation = buildAdminPaymentReconciliation(payment, receipts, ledgerEntries);

  return {
    ...serializeAdminPaymentIntent(payment),
    auditTrail: auditTrail.map((entry) => ({
      action: entry.action,
      actor: entry.user ? serializeAdminUser(entry.user) : null,
      createdAt: entry.createdAt,
      description: getAuditTrailDescription(entry),
      entityId: entry.entityId,
      entityType: entry.entityType,
      id: entry.id,
      metadata: entry.metadata
    })),
    ledgerEntries: ledgerEntries.map((entry) => ({
      amount: Number(entry.amount.toString()),
      createdAt: entry.createdAt,
      currency: entry.currency,
      description: entry.description,
      id: entry.id,
      organization: entry.wallet.organization ?? null,
      referenceId: entry.referenceId,
      type: entry.type,
      user: entry.wallet.user ? serializeAdminUser(entry.wallet.user) : null,
      walletId: entry.walletId
    })),
    receipts: receipts.map((receipt) => ({
      amount: Number(receipt.amount.toString()),
      createdAt: receipt.createdAt,
      currency: receipt.currency,
      description: receipt.description,
      id: receipt.id,
      issuedAt: receipt.issuedAt,
      ledgerEntryId: receipt.ledgerEntryId,
      organization: receipt.organization ?? null,
      paymentIntentId: receipt.paymentIntentId,
      provider: receipt.provider,
      providerRef: receipt.providerRef,
      receiptNumber: receipt.receiptNumber,
      type: receipt.type,
      user: receipt.user ? serializeAdminUser(receipt.user) : null
    })),
    reconciliation,
    refundReadiness: getPaymentRefundReadiness(payment, reconciliation, ledgerEntries),
    webhookEvents: webhookEvents.map((event) => ({
      action: event.action,
      duplicateCount: event.duplicateCount,
      eventId: event.eventId,
      eventType: event.eventType,
      id: event.id,
      lastDuplicateAt: event.lastDuplicateAt,
      metadata: event.metadata,
      provider: event.provider,
      receivedAt: event.receivedAt,
      updatedAt: event.updatedAt
    }))
  };
}

export function buildAdminPaymentReconciliation(
  payment: Pick<Parameters<typeof serializeAdminPaymentIntent>[0], "amount" | "currency" | "status">,
  receipts: Array<{
    amount: Prisma.Decimal | number | string;
    currency: string;
    type: WalletReceiptType;
  }>,
  ledgerEntries: Array<{
    amount: Prisma.Decimal | number | string;
    currency: string;
    type: LedgerEntryType;
  }>
) {
  const paymentAmount = roundMoney(decimalToNumber(payment.amount));
  const topUpLedgerAmount = sumMoney(ledgerEntries.filter((entry) => entry.type === LedgerEntryType.CREDIT));
  const refundLedgerAmount = sumMoney(ledgerEntries.filter((entry) => entry.type === LedgerEntryType.REFUND));
  const topUpReceiptAmount = sumMoney(receipts.filter((receipt) => receipt.type === WalletReceiptType.TOP_UP));
  const refundReceiptAmount = sumMoney(receipts.filter((receipt) => receipt.type === WalletReceiptType.REFUND));
  const netLedgerAmount = roundMoney(topUpLedgerAmount - refundLedgerAmount);
  const netReceiptAmount = roundMoney(topUpReceiptAmount - refundReceiptAmount);
  const issues: Array<{ code: string; message: string; severity: "blocked" | "warning" }> = [];
  const currencies = new Set([
    payment.currency,
    ...ledgerEntries.map((entry) => entry.currency),
    ...receipts.map((receipt) => receipt.currency)
  ]);

  if (currencies.size > 1) {
    issues.push({
      code: "currency_mismatch",
      message: "Payment, ledger, and receipt rows do not all use the same currency.",
      severity: "blocked"
    });
  }

  if (payment.status === PaymentIntentStatus.SUCCEEDED) {
    if (!moneyMatches(topUpLedgerAmount, paymentAmount)) {
      issues.push({
        code: "credit_ledger_mismatch",
        message: "Settled payment amount does not match the wallet credit ledger total.",
        severity: "blocked"
      });
    }

    if (!moneyMatches(topUpReceiptAmount, paymentAmount)) {
      issues.push({
        code: "top_up_receipt_mismatch",
        message: "Settled payment amount does not match issued top-up receipts.",
        severity: "warning"
      });
    }
  } else if (topUpLedgerAmount > 0 || topUpReceiptAmount > 0) {
    issues.push({
      code: "unsettled_local_credit",
      message: "This payment is not settled but local wallet credit or receipts exist.",
      severity: "blocked"
    });
  }

  if (refundLedgerAmount > paymentAmount) {
    issues.push({
      code: "refund_over_payment",
      message: "Recorded refunds exceed the original payment amount.",
      severity: "blocked"
    });
  }

  if (!moneyMatches(refundLedgerAmount, refundReceiptAmount)) {
    issues.push({
      code: "refund_receipt_mismatch",
      message: "Refund ledger entries and refund receipts do not match.",
      severity: "warning"
    });
  }

  return {
    expectedTopUpAmount: payment.status === PaymentIntentStatus.SUCCEEDED ? paymentAmount : 0,
    issueCount: issues.length,
    issues,
    netLedgerAmount,
    netReceiptAmount,
    paymentAmount,
    refundLedgerAmount,
    refundReceiptAmount,
    status: issues.length > 0 ? "warning" : "balanced",
    topUpLedgerAmount,
    topUpReceiptAmount
  };
}

function sumMoney(items: Array<{ amount: Prisma.Decimal | number | string }>) {
  return roundMoney(items.reduce((total, item) => total + decimalToNumber(item.amount), 0));
}

function moneyMatches(left: number, right: number) {
  return Math.abs(roundMoney(left) - roundMoney(right)) <= 0.01;
}

function summarizeReceiptTotals(
  receipts: Array<{
    amount: Prisma.Decimal;
    currency: string;
    type: WalletReceiptType;
  }>
) {
  const byCurrency = new Map<string, { count: number; currency: string; refundAmount: number; topUpAmount: number; totalAmount: number }>();

  for (const receipt of receipts) {
    const amount = decimalToNumber(receipt.amount);
    const current = byCurrency.get(receipt.currency) ?? {
      count: 0,
      currency: receipt.currency,
      refundAmount: 0,
      topUpAmount: 0,
      totalAmount: 0
    };

    current.count += 1;
    current.totalAmount += amount;

    if (receipt.type === WalletReceiptType.REFUND) {
      current.refundAmount += amount;
    } else if (receipt.type === WalletReceiptType.TOP_UP) {
      current.topUpAmount += amount;
    }

    byCurrency.set(receipt.currency, current);
  }

  return {
    byCurrency: [...byCurrency.values()].map((total) => ({
      ...total,
      refundAmount: roundMoney(total.refundAmount),
      topUpAmount: roundMoney(total.topUpAmount),
      totalAmount: roundMoney(total.totalAmount)
    })),
    count: receipts.length
  };
}

function getPaymentRefundReadiness(
  payment: Pick<Parameters<typeof serializeAdminPaymentIntent>[0], "amount" | "providerRef" | "status">,
  reconciliation: ReturnType<typeof buildAdminPaymentReconciliation>,
  ledgerEntries: Array<{
    amount: Prisma.Decimal;
    type: LedgerEntryType;
  }>
) {
  const refundedAmount = roundMoney(
    ledgerEntries
      .filter((entry) => entry.type === LedgerEntryType.REFUND)
      .reduce((total, entry) => total + decimalToNumber(entry.amount), 0)
  );
  const originalAmount = decimalToNumber(payment.amount);
  const refundableAmount = roundMoney(Math.max(0, originalAmount - refundedAmount));

  if (payment.status !== PaymentIntentStatus.SUCCEEDED) {
    return {
      refundableAmount,
      refundedAmount,
      reason: "Only settled top-ups can be refunded or reversed safely.",
      status: "not_refundable"
    };
  }

  if (refundableAmount <= 0) {
    return {
      refundableAmount,
      refundedAmount,
      reason: "The full top-up amount has already been marked as refunded.",
      status: "fully_refunded"
    };
  }

  if (!payment.providerRef) {
    return {
      refundableAmount,
      refundedAmount,
      reason: "The provider reference is missing, so an external refund cannot be matched yet.",
      status: "needs_provider_reference"
    };
  }

  if (reconciliation.status === "warning") {
    return {
      refundableAmount,
      refundedAmount,
      reason: "The top-up has payment, ledger, or receipt mismatches that should be reviewed first.",
      status: "needs_reconciliation"
    };
  }

  return {
    refundableAmount,
    refundedAmount,
    reason: "Provider reference, receipt, and wallet ledger entry are present.",
    status: "ready"
  };
}

function serializeAdminFundingSource(source: {
  accountMask: string | null;
  accountName: string | null;
  accountSubtype: string | null;
  accountType: string | null;
  createdAt: Date;
  currency: string;
  disabledAt: Date | null;
  id: string;
  institutionName: string | null;
  organization?: { id: string; name: string; slug: string } | null;
  organizationId: string | null;
  processor: string | null;
  processorRef: string | null;
  provider: string;
  providerRef: string | null;
  status: string;
  updatedAt: Date;
  user?: Parameters<typeof serializeAdminUser>[0] | null;
  userId: string | null;
  walletId: string;
}) {
  return {
    accountMask: source.accountMask,
    accountName: source.accountName,
    accountSubtype: source.accountSubtype,
    accountType: source.accountType,
    createdAt: source.createdAt,
    currency: source.currency,
    disabledAt: source.disabledAt,
    id: source.id,
    institutionName: source.institutionName,
    organization: source.organization ?? null,
    organizationId: source.organizationId,
    processor: source.processor,
    processorRef: source.processorRef,
    provider: source.provider,
    providerRef: source.providerRef,
    status: source.status,
    updatedAt: source.updatedAt,
    user: source.user ? serializeAdminUser(source.user) : null,
    userId: source.userId,
    walletId: source.walletId
  };
}

async function updateAdminFundingSourceStatus(
  request: AuthenticatedRequest,
  response: Response,
  status: FundingSourceStatus
) {
  const admin = request.currentUser;
  const fundingSourceId = normalizeId(request.params.fundingSourceId);

  if (!admin) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!fundingSourceId) {
    response.status(400).json({ error: "Funding source is required." });
    return;
  }

  const prisma = getPrismaClient();
  const fundingSource = await prisma.fundingSource.findUnique({
    where: {
      id: fundingSourceId
    },
    select: {
      id: true,
      organizationId: true,
      status: true
    }
  });

  if (!fundingSource) {
    response.status(404).json({ error: "Funding source was not found." });
    return;
  }

  const updated = await prisma.fundingSource.update({
    where: {
      id: fundingSource.id
    },
    data: {
      disabledAt: status === FundingSourceStatus.DISABLED ? new Date() : null,
      status
    },
    include: {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      },
      user: {
        select: userSelect
      }
    }
  });

  await prisma.auditLog.create({
    data: {
      action: status === FundingSourceStatus.ACTIVE ? "admin.funding_source.enabled" : "admin.funding_source.disabled",
      entityId: updated.id,
      entityType: "funding_source",
      metadata: {
        fundingSourceId: updated.id,
        previousStatus: fundingSource.status,
        requestId: getRequestId(request),
        status
      },
      organizationId: updated.organizationId,
      userId: admin.id
    }
  });

  response.status(200).json({
    fundingSource: serializeAdminFundingSource(updated)
  });
}

export function buildWebhookHealth(
  events: Array<{
    action: string | null;
    duplicateCount: number;
    eventId: string;
    eventType: string | null;
    id: string;
    lastDuplicateAt: Date | null;
    metadata: Prisma.JsonValue | null;
    provider: string;
    receivedAt: Date;
    updatedAt: Date;
  }>,
  counts24h: Record<"paypal" | "stripe", number>,
  now = new Date()
) {
  return (["paypal", "stripe"] as const).map((provider) => {
    const providerEvents = events.filter((entry) => entry.provider === provider);
    const latest = providerEvents[0] ?? null;
    const duplicateCount = providerEvents.reduce((total, event) => total + event.duplicateCount, 0);
    const lastEventAgeMinutes = latest ? Math.max(0, Math.floor((now.getTime() - latest.receivedAt.getTime()) / 60_000)) : null;
    const status = duplicateCount > 0 ? "retrying" : latest ? "receiving" : "quiet";

    return {
      count24h: counts24h[provider],
      duplicateCount,
      lastEventAgeMinutes,
      lastDuplicateAt: latest?.lastDuplicateAt ?? null,
      lastEventId: latest?.eventId ?? null,
      lastEventType: latest?.eventType ?? null,
      lastReceivedAt: latest?.receivedAt ?? null,
      lastTransmissionId: latest ? getJsonText(latest.metadata, "transmissionId") : null,
      provider,
      status,
      statusLabel: status === "retrying" ? "Retries seen" : status === "receiving" ? "Receiving" : "No events",
      recentEvents: providerEvents.slice(0, 6).map((event) => ({
        action: event.action,
        duplicateCount: event.duplicateCount,
        eventId: event.eventId,
        eventType: event.eventType,
        id: event.id,
        idempotencyKey: getJsonText(event.metadata, "idempotencyKey"),
        lastDuplicateAt: event.lastDuplicateAt,
        paymentIntentId: getJsonText(event.metadata, "paymentIntentId"),
        providerRef: getJsonText(event.metadata, "providerRef"),
        receivedAt: event.receivedAt,
        transmissionId: getJsonText(event.metadata, "transmissionId"),
        updatedAt: event.updatedAt
      }))
    };
  });
}

function serializeAdminUser(user: {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  isVerified: boolean;
  verificationStatus: VerificationStatus;
  creatorStatus: CreatorStatus;
  globalRole: GlobalRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
    jobTitle: user.jobTitle,
    isVerified: user.isVerified,
    verificationStatus: user.verificationStatus,
    creatorStatus: user.creatorStatus,
    globalRole: user.globalRole,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  return typeof value === "string" && Object.values(enumValues).includes(value) ? (value as T[keyof T]) : undefined;
}

export type PayoutDecision = "processing" | "paid" | "cancel" | "fail";

export interface PayoutReviewDetails {
  adminNotes?: string;
  provider?: string;
  providerRef?: string;
}

class PaymentRefundError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export interface PaymentRefundDetails {
  adminNotes?: string;
  amountCents?: number;
  providerRef: string;
}

export function getPaymentRefundPlan(input: {
  alreadyRefundedCents: number;
  originalAmount: Prisma.Decimal | number | string;
  requestedAmountCents?: number;
  walletBalance: Prisma.Decimal | number | string;
}): {
  ok: true;
  alreadyRefundedCents: number;
  originalCents: number;
  refundCents: number;
  remainingCents: number;
} | { ok: false; error: string } {
  const originalCents = moneyToCents(input.originalAmount);
  const alreadyRefundedCents = input.alreadyRefundedCents;
  const remainingCents = Math.max(0, originalCents - alreadyRefundedCents);
  const refundCents = input.requestedAmountCents ?? remainingCents;
  const walletCents = moneyToCents(input.walletBalance);

  if (remainingCents <= 0) {
    return { ok: false, error: "This payment intent is already fully refunded." };
  }

  if (refundCents > remainingCents) {
    return { ok: false, error: "Refund amount cannot exceed the remaining refundable balance." };
  }

  if (refundCents > walletCents) {
    return { ok: false, error: "The creator wallet does not have enough available balance for this refund." };
  }

  return {
    ok: true,
    alreadyRefundedCents,
    originalCents,
    refundCents,
    remainingCents
  };
}

export function parsePaymentRefundBody(body: unknown): { ok: true; value: PaymentRefundDetails } | { ok: false; error: string } {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const adminNotes = normalizeLimitedText(value.adminNotes, 1_000);
  const providerRef = normalizeLimitedText(value.providerRef, 160);
  const amountCents = value.amount === undefined || value.amount === null || value.amount === ""
    ? undefined
    : normalizeMoneyCents(value.amount);

  if (!providerRef) {
    return { ok: false, error: "Refund reference is required before recording a refund." };
  }

  if (amountCents === null) {
    return { ok: false, error: "Refund amount must be greater than 0 and no more than 100,000." };
  }

  return {
    ok: true,
    value: {
      ...(adminNotes ? { adminNotes } : {}),
      ...(amountCents ? { amountCents } : {}),
      providerRef
    }
  };
}

export function parsePayoutReviewBody(
  decision: PayoutDecision,
  body: unknown
): { ok: true; value: PayoutReviewDetails } | { ok: false; error: string } {
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const adminNotes = normalizeLimitedText(value.adminNotes, 1_000);
  const provider = normalizeLimitedText(value.provider, 80);
  const providerRef = normalizeLimitedText(value.providerRef, 160);

  if (decision === "paid" && !providerRef) {
    return { ok: false, error: "Payment reference is required before marking a payout paid." };
  }

  return {
    ok: true,
    value: {
      ...(adminNotes ? { adminNotes } : {}),
      ...(provider ? { provider } : {}),
      ...(providerRef ? { providerRef } : {})
    }
  };
}

export function getPayoutStatusTransition(
  currentStatus: PayoutStatus,
  decision: PayoutDecision
): { ok: true; status: PayoutStatus } | { ok: false; error: string } {
  const transitionMap: Record<PayoutStatus, Partial<Record<PayoutDecision, PayoutStatus>>> = {
    [PayoutStatus.REQUESTED]: {
      cancel: PayoutStatus.CANCELLED,
      processing: PayoutStatus.PROCESSING
    },
    [PayoutStatus.PROCESSING]: {
      fail: PayoutStatus.FAILED,
      paid: PayoutStatus.PAID
    },
    [PayoutStatus.PAID]: {},
    [PayoutStatus.FAILED]: {},
    [PayoutStatus.CANCELLED]: {}
  };
  const nextStatus = transitionMap[currentStatus][decision];

  if (!nextStatus) {
    return {
      ok: false,
      error: `Payouts with status ${currentStatus} cannot be moved with ${decision}.`
    };
  }

  return {
    ok: true,
    status: nextStatus
  };
}

function mergePayoutMetadata(current: Prisma.JsonValue | null, next: Record<string, unknown>) {
  const base = isPlainJsonObject(current) ? current : {};

  return {
    ...base,
    ...next
  } as Prisma.InputJsonObject;
}

function mergeJsonObject(current: Prisma.JsonValue | null, next: Record<string, unknown>) {
  const base = isPlainJsonObject(current) ? current : {};

  return {
    ...base,
    ...next
  } as Prisma.InputJsonObject;
}

export function getAdminPaymentIntentState(
  payment: {
    cancelledAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    status: PaymentIntentStatus;
    updatedAt: Date;
  },
  now = new Date()
) {
  const isOpen = payment.status === PaymentIntentStatus.CREATED || payment.status === PaymentIntentStatus.PROCESSING;
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - payment.updatedAt.getTime()) / 60_000));
  const staleAgeMinutes = STALE_PAYMENT_INTENT_HOURS * 60;
  const isStale = isOpen && ageMinutes >= staleAgeMinutes;

  return {
    canCancel: isOpen,
    isOpen,
    staleAgeMinutes: isStale ? ageMinutes : 0,
    staleReason: isStale ? `Open for ${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m without completion.` : null,
    statusGroup: payment.status === PaymentIntentStatus.SUCCEEDED
      ? "settled"
      : payment.status === PaymentIntentStatus.CANCELLED || payment.status === PaymentIntentStatus.FAILED
        ? "closed"
        : isStale
          ? "stale"
          : "open"
  };
}

function getPayoutTaskCreditEventIds(metadata: Prisma.JsonValue | null) {
  if (!isPlainJsonObject(metadata) || !Array.isArray(metadata.taskCreditEventIds)) {
    return [];
  }

  return metadata.taskCreditEventIds.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function getPayoutMetadataText(metadata: Prisma.JsonValue | null, key: string) {
  return getJsonText(metadata, key);
}

function getJsonText(metadata: Prisma.JsonValue | null, key: string) {
  if (!isPlainJsonObject(metadata)) {
    return null;
  }

  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLimitedText(value: unknown, maxLength: number) {
  const normalized = normalizeText(value);

  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export { router as adminRouter };
