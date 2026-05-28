import {
  FundingSourceStatus,
  getPrismaClient,
  LedgerEntryType,
  MembershipRole,
  PaymentIntentStatus,
  PayoutStatus,
  Prisma,
  TaskCreditStatus,
  WalletReceiptType,
  WalletOwnerType
} from "@goxai/database";
import express, { Router } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { requireAuthenticatedUser, type AuthenticatedRequest } from "../../shared/auth.js";
import { getRequestId } from "../../shared/logging.js";
import { getPlatformFeatures } from "../../shared/platformFeatures.js";
import {
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalCaptureSummary,
  getPayPalWebhookCaptureSummary,
  PayPalConfigurationError,
  PayPalRequestError,
  verifyPayPalWebhookSignature
} from "./paypal.js";
import {
  createPlaidLinkToken,
  createPlaidStripeBankAccountToken,
  PlaidConfigurationError,
  PlaidRequestError
} from "./plaid.js";
import {
  attachStripeBankAccountToken,
  createStripeCustomer,
  createStripeCheckoutSession,
  getStripeCheckoutSession,
  getStripeCheckoutSessionSummary,
  getStripeWebhookCheckoutSession,
  parseStripeWebhookEvent,
  StripeConfigurationError,
  StripeRequestError
} from "./stripe.js";

const router = Router();
const paypalWebhookRouter = Router();
const stripeWebhookRouter = Router();
const CREATOR_DATASET_REPORT_LIMIT = 8;
const CREATOR_LEDGER_LIMIT = 12;
const CREATOR_EXPORT_LIMIT = 10_000;
const CREATOR_LEDGER_PAGE_SIZE = 20;
const CREATOR_LEDGER_MAX_PAGE_SIZE = 100;
const WORKER_CREDIT_HOLD_DAYS = 7;
const WORKER_EVENT_LIMIT = 12;
const WORKER_PAYOUT_LIMIT = 8;

paypalWebhookRouter.post("/paypal-webhook", express.raw({ type: "application/json" }), async (request, response) => {
  const webhookEvent = parsePayPalWebhookBody(request.body);

  if (!webhookEvent) {
    response.status(400).json({ error: "Webhook body must be valid JSON." });
    return;
  }

  const headers = parsePayPalWebhookHeaders(request.headers);

  if (!headers) {
    response.status(400).json({ error: "PayPal webhook signature headers are required." });
    return;
  }

  try {
    const verified = await verifyPayPalWebhookSignature(headers, webhookEvent);

    if (!verified) {
      response.status(401).json({ error: "PayPal webhook signature verification failed." });
      return;
    }

    await handlePayPalWebhookEvent(webhookEvent, headers.transmissionId);
    response.status(200).json({ received: true });
  } catch (reason) {
    if (reason instanceof PayPalTopUpCompletionError) {
      response.status(202).json({ received: true, warning: reason.message });
      return;
    }

    if (reason instanceof PayPalConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof PayPalRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

stripeWebhookRouter.post("/stripe-webhook", express.raw({ type: "application/json" }), async (request, response) => {
  if (!Buffer.isBuffer(request.body)) {
    response.status(400).json({ error: "Webhook body must be raw JSON." });
    return;
  }

  try {
    const event = parseStripeWebhookEvent(request.body, request.header("stripe-signature"));

    await handleStripeWebhookEvent(event);
    response.status(200).json({ received: true });
  } catch (reason) {
    if (reason instanceof ProviderTopUpCompletionError) {
      response.status(202).json({ received: true, warning: reason.message });
      return;
    }

    if (reason instanceof StripeConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof StripeRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    if (reason instanceof SyntaxError) {
      response.status(400).json({ error: "Webhook body must be valid JSON." });
      return;
    }

    throw reason;
  }
});

router.use(requireAuthenticatedUser);

router.get("/creator-summary", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({
      wallet: emptyCreatorWalletSummary()
    });
    return;
  }

  const wallet = await summarizeCreatorWallet(prisma, organizationIds);

  response.status(200).json({
    wallet
  });
});

router.get("/creator-ledger-export", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const format = normalizeCreatorLedgerExportFormat(request.query.format);

  if (!format) {
    response.status(400).json({ error: "Export format must be json or csv." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const wallet =
    organizationIds.length === 0
      ? emptyCreatorWalletSummary()
      : await summarizeCreatorWallet(prisma, organizationIds, {
          datasetReportLimit: CREATOR_EXPORT_LIMIT,
          ledgerLimit: CREATOR_EXPORT_LIMIT
        });
  const file = buildCreatorLedgerExportFile({
    exportedAt: new Date(),
    format,
    wallet
  });

  response
    .status(200)
    .setHeader("Content-Type", file.mimeType)
    .setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`)
    .send(file.content);
});

router.get("/creator-ledger", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const filter = normalizeCreatorLedgerFilter(request.query.filter);

  if (!filter) {
    response.status(400).json({ error: "Ledger filter must be all, credit, escrow, paid, fee, or refund." });
    return;
  }

  const page = normalizePageNumber(request.query.page);
  const pageSize = normalizePageSize(request.query.pageSize, CREATOR_LEDGER_PAGE_SIZE, CREATOR_LEDGER_MAX_PAGE_SIZE);
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({
      entries: [],
      filterCounts: emptyCreatorLedgerFilterCounts(),
      page,
      pageSize,
      total: 0,
      totalPages: 1,
      wallet: emptyCreatorWalletSummary()
    });
    return;
  }

  const [wallet, ledgerPage] = await Promise.all([
    summarizeCreatorWallet(prisma, organizationIds),
    listCreatorLedgerPage(prisma, organizationIds, { filter, page, pageSize, search })
  ]);

  response.status(200).json({
    ...ledgerPage,
    wallet
  });
});

router.get("/creator-payment-intents", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({ paymentIntents: [] });
    return;
  }

  const paymentIntents = await prisma.paymentIntent.findMany({
    where: {
      organizationId: {
        in: organizationIds
      },
      purpose: "creator_wallet_top_up"
    },
    orderBy: {
      createdAt: "desc"
    },
    select: paymentIntentSelect,
    take: 8
  });

  response.status(200).json({
    paymentIntents: paymentIntents.map(serializePaymentIntent)
  });
});

router.get("/creator-funding-sources", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);

  if (organizationIds.length === 0) {
    response.status(200).json({ fundingSources: [] });
    return;
  }

  const fundingSources = await prisma.fundingSource.findMany({
    where: {
      organizationId: {
        in: organizationIds
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    select: fundingSourceSelect,
    take: 20
  });

  response.status(200).json({
    fundingSources: fundingSources.map(serializeFundingSource)
  });
});

router.get("/creator-funding-sources/:fundingSourceId", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const fundingSourceId = normalizeId(request.params.fundingSourceId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!fundingSourceId) {
    response.status(400).json({ error: "Funding source is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const fundingSource = await prisma.fundingSource.findFirst({
    where: {
      id: fundingSourceId,
      organizationId: {
        in: organizationIds
      }
    },
    select: fundingSourceSelect
  });

  if (!fundingSource) {
    response.status(404).json({ error: "Funding source was not found." });
    return;
  }

  const [paymentIntents, auditTrail] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: {
        fundingSourceId: fundingSource.id
      },
      orderBy: {
        createdAt: "desc"
      },
      select: paymentIntentSelect,
      take: 20
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          {
            entityType: "funding_source",
            entityId: fundingSource.id
          },
          {
            metadata: {
              path: ["fundingSourceId"],
              equals: fundingSource.id
            }
          }
        ]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 20
    })
  ]);

  response.status(200).json({
    auditTrail: auditTrail.map(serializeFundingSourceAuditEntry),
    fundingSource: serializeFundingSource(fundingSource),
    paymentIntents: paymentIntents.map(serializePaymentIntent)
  });
});

router.post("/creator-funding-sources/:fundingSourceId/disable", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;
  const fundingSourceId = normalizeId(request.params.fundingSourceId);

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  if (!fundingSourceId) {
    response.status(400).json({ error: "Funding source is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const fundingSource = await prisma.fundingSource.findFirst({
    where: {
      id: fundingSourceId,
      organizationId: {
        in: organizationIds
      }
    },
    select: fundingSourceSelect
  });

  if (!fundingSource) {
    response.status(404).json({ error: "Funding source was not found." });
    return;
  }

  const disabled = await prisma.fundingSource.update({
    where: {
      id: fundingSource.id
    },
    data: {
      disabledAt: new Date(),
      status: FundingSourceStatus.DISABLED
    },
    select: fundingSourceSelect
  });

  await prisma.auditLog.create({
    data: {
      action: "wallet.funding_source.disabled",
      entityId: disabled.id,
      entityType: "funding_source",
      metadata: {
        fundingSourceId: disabled.id,
        requestId: getRequestId(request)
      },
      organizationId: disabled.organizationId,
      userId: user.id
    }
  });

  response.status(200).json({
    fundingSource: serializeFundingSource(disabled)
  });
});

router.get("/worker-summary", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    await releaseWorkerCreditsAfterHold(tx, user.id, new Date());
  });

  response.status(200).json({
    wallet: await summarizeWorkerWallet(prisma, user.id)
  });
});

router.get("/receipts", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const receipts = await prisma.walletReceipt.findMany({
    where: buildWalletReceiptAccessWhere(user.id, organizationIds),
    orderBy: {
      issuedAt: "desc"
    },
    select: walletReceiptSelect,
    take: 100
  });

  response.status(200).json({
    receipts: receipts.map(serializeWalletReceipt)
  });
});

router.get("/receipts/:receiptId/download", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const receiptId = normalizeId(request.params.receiptId);

  if (!receiptId) {
    response.status(400).json({ error: "Receipt id is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const receipt = await prisma.walletReceipt.findFirst({
    where: {
      id: receiptId,
      ...buildWalletReceiptAccessWhere(user.id, organizationIds)
    },
    select: walletReceiptSelect
  });

  if (!receipt) {
    response.status(404).json({ error: "Receipt was not found." });
    return;
  }

  const file = buildWalletReceiptDownloadFile(receipt);

  response
    .status(200)
    .setHeader("Content-Type", file.mimeType)
    .setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`)
    .send(file.content);
});

router.post("/worker-withdrawal", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const prisma = getPrismaClient();

  const payoutIds = await prisma.$transaction(async (tx) => {
    await releaseWorkerCreditsAfterHold(tx, user.id, new Date());

    const availableEvents = await tx.taskCreditEvent.findMany({
      where: {
        amount: {
          gt: 0
        },
        status: TaskCreditStatus.AVAILABLE,
        userId: user.id
      },
      orderBy: {
        availableAt: "asc"
      },
      select: {
        amount: true,
        currency: true,
        id: true,
        metadata: true
      }
    });

    if (availableEvents.length === 0) {
      throw new WithdrawalRequestError("No available approved balance to withdraw yet.", 400);
    }

    const eventsByCurrency = new Map<string, typeof availableEvents>();

    for (const event of availableEvents) {
      const currencyEvents = eventsByCurrency.get(event.currency) ?? [];
      currencyEvents.push(event);
      eventsByCurrency.set(event.currency, currencyEvents);
    }

    const createdPayoutIds: string[] = [];

    for (const [currency, currencyEvents] of eventsByCurrency.entries()) {
      const wallet = await ensureUserWallet(tx, user.id, currency);
      const amount = roundMoney(currencyEvents.reduce((total, event) => total + decimalToNumber(event.amount), 0)).toFixed(2);
      const now = new Date();
      const taskCreditEventIds = currencyEvents.map((event) => event.id);

      const payout = await tx.payout.create({
        data: {
          amount,
          currency,
          metadata: {
            requestId: getRequestId(request),
            taskCreditEventIds
          },
          status: PayoutStatus.REQUESTED,
          userId: user.id,
          walletId: wallet.id
        }
      });

      const lockedEvents = await tx.taskCreditEvent.updateMany({
        where: {
          id: {
            in: taskCreditEventIds
          },
          status: TaskCreditStatus.AVAILABLE,
          userId: user.id
        },
        data: {
          status: TaskCreditStatus.WITHDRAWN,
          withdrawnAt: now
        }
      });
      const lockError = getWithdrawalLockError(currencyEvents.length, lockedEvents.count);

      if (lockError) {
        throw new WithdrawalRequestError(lockError, 409);
      }

      await tx.ledgerEntry.create({
        data: {
          amount,
          currency,
          description: "Worker withdrawal requested.",
          metadata: {
            payoutId: payout.id,
            requestId: getRequestId(request),
            taskCreditEventIds
          },
          referenceId: payout.id,
          type: LedgerEntryType.PAYOUT,
          walletId: wallet.id
        }
      });

      for (const event of currencyEvents) {
        await tx.taskCreditEvent.update({
          where: {
            id: event.id
          },
          data: {
            metadata: mergeJsonMetadata(event.metadata, {
              payoutId: payout.id,
              withdrawalRequestedAt: now.toISOString()
            })
          }
        });
      }

      await tx.auditLog.create({
        data: {
          action: "wallet.worker_withdrawal.requested",
          entityId: payout.id,
          entityType: "payout",
          metadata: {
            amount,
            currency,
            payoutId: payout.id,
            requestId: getRequestId(request),
            taskCreditEventIds
          },
          userId: user.id
        }
      });

      createdPayoutIds.push(payout.id);
    }

    return createdPayoutIds;
  }).catch((reason) => {
    if (reason instanceof WithdrawalRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return null;
    }

    throw reason;
  });

  if (!payoutIds) {
    return;
  }

  response.status(201).json({
    payoutIds,
    wallet: await summarizeWorkerWallet(prisma, user.id)
  });
});

router.post("/creator-top-up", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const amount = normalizeMoneyAmount(request.body?.amount);
  const currency = normalizeCurrency(request.body?.currency ?? "USD");
  const requestedOrganizationId = normalizeId(request.body?.organizationId);

  if (!amount) {
    response.status(400).json({ error: "Top-up amount must be greater than 0 and no more than 100,000." });
    return;
  }

  if (!currency) {
    response.status(400).json({ error: "Currency must be a 3-letter code like USD." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const organizationId = requestedOrganizationId ?? organizationIds[0] ?? null;

  if (!organizationId || !organizationIds.includes(organizationId)) {
    response.status(403).json({ error: "Choose an organization where you are an owner or admin." });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await ensureOrganizationWallet(tx, organizationId, currency);
    const now = new Date();

    const paymentIntent = await tx.paymentIntent.create({
      data: {
        amount,
        completedAt: now,
        currency,
        description: "Manual creator wallet top-up.",
        metadata: {
          requestId: getRequestId(request),
          source: "manual_creator_top_up"
        },
        organizationId,
        provider: "manual",
        purpose: "creator_wallet_top_up",
        status: PaymentIntentStatus.SUCCEEDED,
        walletId: wallet.id,
        createdById: user.id
      }
    });

    await tx.wallet.update({
      where: {
        id: wallet.id
      },
      data: {
        balance: {
          increment: amount
        }
      }
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        amount,
        currency,
        description: "Manual creator wallet top-up.",
        metadata: {
          paymentIntentId: paymentIntent.id,
          requestId: getRequestId(request),
          source: "manual_creator_top_up"
        },
        referenceId: paymentIntent.id,
        type: LedgerEntryType.CREDIT,
        walletId: wallet.id
      }
    });

    const receipt = await tx.walletReceipt.create({
      data: {
        amount,
        currency,
        description: "Creator wallet top-up receipt.",
        ledgerEntryId: ledgerEntry.id,
        metadata: {
          requestId: getRequestId(request),
          source: "manual_creator_top_up"
        },
        organizationId,
        paymentIntentId: paymentIntent.id,
        provider: "manual",
        receiptNumber: buildWalletReceiptNumber("TOP", now, paymentIntent.id),
        type: WalletReceiptType.TOP_UP,
        userId: user.id,
        walletId: wallet.id
      }
    });

    await tx.auditLog.create({
      data: {
        action: "wallet.creator_top_up.created",
        entityId: wallet.id,
        entityType: "wallet",
        metadata: {
          amount,
          currency,
          ledgerEntryId: ledgerEntry.id,
          paymentIntentId: paymentIntent.id,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          requestId: getRequestId(request)
        },
        organizationId,
        userId: user.id
      }
    });

    return {
      ledgerEntry,
      paymentIntent,
      receipt
    };
  });

  response.status(201).json({
    ledgerEntryId: result.ledgerEntry.id,
    paymentIntentId: result.paymentIntent.id,
    receiptId: result.receipt.id,
    receiptNumber: result.receipt.receiptNumber,
    wallet: await summarizeCreatorWallet(prisma, organizationIds)
  });
});

router.post("/creator-paypal-order", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const features = await getPlatformFeatures();

  if (!features.payments.paypalEnabled) {
    response.status(403).json({ error: "PayPal wallet top-ups are disabled by a platform admin." });
    return;
  }

  const amount = normalizeMoneyAmount(request.body?.amount);
  const currency = normalizeCurrency(request.body?.currency ?? "USD");
  const requestedOrganizationId = normalizeId(request.body?.organizationId);

  if (!amount) {
    response.status(400).json({ error: "Top-up amount must be greater than 0 and no more than 100,000." });
    return;
  }

  if (!currency) {
    response.status(400).json({ error: "Currency must be a 3-letter code like USD." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const organizationId = requestedOrganizationId ?? organizationIds[0] ?? null;

  if (!organizationId || !organizationIds.includes(organizationId)) {
    response.status(403).json({ error: "Choose an organization where you are an owner or admin." });
    return;
  }

  const wallet = await ensureOrganizationWallet(prisma, organizationId, currency);
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      amount,
      currency,
      description: "PayPal creator wallet top-up.",
      metadata: {
        requestId: getRequestId(request),
        source: "paypal_creator_top_up"
      },
      organizationId,
      provider: "paypal",
      purpose: "creator_wallet_top_up",
      status: PaymentIntentStatus.CREATED,
      walletId: wallet.id,
      createdById: user.id
    }
  });

  try {
    const paypal = await createPayPalOrder({
      amount,
      cancelUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, status: "cancel" }),
      currency,
      description: "GoXAi Lab creator wallet funds",
      paymentIntentId: paymentIntent.id,
      requestId: getRequestId(request) ?? paymentIntent.id,
      returnUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, status: "return" })
    });

    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        metadata: mergeJsonMetadata(paymentIntent.metadata, {
          approvalUrl: paypal.approvalUrl,
          paypalOrderStatus: paypal.order.status,
          requestId: getRequestId(request),
          source: "paypal_creator_top_up"
        }),
        providerRef: paypal.order.id,
        status: PaymentIntentStatus.PROCESSING
      }
    });

    response.status(201).json({
      approvalUrl: paypal.approvalUrl,
      orderId: paypal.order.id,
      paymentIntentId: paymentIntent.id
    });
  } catch (reason) {
    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        status: PaymentIntentStatus.FAILED
      }
    });

    if (reason instanceof PayPalConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof PayPalRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-paypal-capture", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const orderId = normalizeId(request.body?.orderId);
  const paymentIntentId = normalizeId(request.body?.paymentIntentId);

  if (!orderId || !paymentIntentId) {
    response.status(400).json({ error: "PayPal order and payment intent are required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: paymentIntentId,
      organizationId: {
        in: organizationIds
      },
      provider: "paypal",
      providerRef: orderId
    },
    include: {
      receipts: {
        orderBy: {
          issuedAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "PayPal top-up was not found." });
    return;
  }

  if (paymentIntent.status === PaymentIntentStatus.SUCCEEDED) {
    response.status(200).json({
      paymentIntentId: paymentIntent.id,
      receiptId: paymentIntent.receipts[0]?.id ?? null,
      receiptNumber: paymentIntent.receipts[0]?.receiptNumber ?? null,
      wallet: await summarizeCreatorWallet(prisma, organizationIds)
    });
    return;
  }

  try {
    const capture = await capturePayPalOrder(orderId, getRequestId(request) ?? paymentIntent.id);
    const summary = getPayPalCaptureSummary(capture);

    if (!summary) {
      response.status(409).json({ error: "PayPal capture did not match this wallet top-up." });
      return;
    }

    const result = await completePayPalCreatorTopUp({
      amount: summary.value,
      captureId: summary.captureId,
      captureStatus: summary.status,
      currency: summary.currency,
      orderId,
      paymentIntentId: paymentIntent.id,
      requestId: getRequestId(request),
      source: "paypal_return",
      userId: user.id
    });

    response.status(200).json({
      paymentIntentId: paymentIntent.id,
      receiptId: result.receipt?.id ?? null,
      receiptNumber: result.receipt?.receiptNumber ?? null,
      wallet: await summarizeCreatorWallet(prisma, organizationIds)
    });
  } catch (reason) {
    if (reason instanceof PayPalTopUpCompletionError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    if (reason instanceof PayPalConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof PayPalRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-paypal-cancel", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const paymentIntentId = normalizeId(request.body?.paymentIntentId);

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: paymentIntentId,
      organizationId: {
        in: organizationIds
      },
      provider: "paypal",
      status: {
        in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING]
      }
    },
    select: paymentIntentSelect
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "Open PayPal top-up was not found." });
    return;
  }

  const cancelled = await prisma.paymentIntent.update({
    where: {
      id: paymentIntent.id
    },
    data: {
      cancelledAt: new Date(),
      metadata: mergeJsonMetadata(paymentIntent.metadata, {
        cancelledByUserId: user.id,
        cancelledFromWalletReturn: true,
        requestId: getRequestId(request)
      }),
      status: PaymentIntentStatus.CANCELLED
    },
    select: paymentIntentSelect
  });

  response.status(200).json({
    paymentIntent: serializePaymentIntent(cancelled)
  });
});

router.post("/creator-stripe-checkout-session", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const features = await getPlatformFeatures();

  if (!features.payments.stripeEnabled) {
    response.status(403).json({ error: "Stripe wallet top-ups are disabled by a platform admin." });
    return;
  }

  const amount = normalizeMoneyAmount(request.body?.amount);
  const currency = normalizeCurrency(request.body?.currency ?? "USD");
  const requestedOrganizationId = normalizeId(request.body?.organizationId);
  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const organizationId = requestedOrganizationId ?? organizationIds[0] ?? null;

  if (!amount) {
    response.status(400).json({ error: "Top-up amount must be greater than 0 and no more than 100,000." });
    return;
  }

  if (!currency) {
    response.status(400).json({ error: "Currency must be a 3-letter code like USD." });
    return;
  }

  if (!organizationId || !organizationIds.includes(organizationId)) {
    response.status(403).json({ error: "Choose an organization where you are an owner or admin." });
    return;
  }

  const wallet = await ensureOrganizationWallet(prisma, organizationId, currency);
  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      amount,
      createdById: user.id,
      currency,
      description: "Creator wallet Stripe checkout top-up.",
      organizationId,
      provider: "stripe",
      purpose: "creator_wallet_top_up",
      status: PaymentIntentStatus.CREATED,
      walletId: wallet.id
    },
    select: paymentIntentSelect
  });

  try {
    const session = await createStripeCheckoutSession({
      amount,
      cancelUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, provider: "stripe", status: "cancel" }),
      currency,
      description: "GoXAi Lab creator wallet funds",
      paymentIntentId: paymentIntent.id,
      requestId: getRequestId(request) ?? paymentIntent.id,
      successUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, provider: "stripe", status: "return", stripeSessionId: "{CHECKOUT_SESSION_ID}" })
    });

    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        metadata: mergeJsonMetadata(paymentIntent.metadata, {
          checkoutUrl: session.url,
          requestId: getRequestId(request),
          source: "stripe_checkout_top_up",
          stripeCheckoutStatus: session.status
        }),
        providerRef: session.id,
        status: PaymentIntentStatus.PROCESSING
      }
    });

    response.status(201).json({
      checkoutUrl: session.url,
      paymentIntentId: paymentIntent.id,
      sessionId: session.id
    });
  } catch (reason) {
    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        status: PaymentIntentStatus.FAILED
      }
    });

    if (reason instanceof StripeConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof StripeRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-stripe-ach-checkout-session", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const features = await getPlatformFeatures();

  if (!features.payments.stripeEnabled) {
    response.status(403).json({ error: "Stripe wallet top-ups are disabled by a platform admin." });
    return;
  }

  const amount = normalizeMoneyAmount(request.body?.amount);
  const currency = normalizeCurrency(request.body?.currency ?? "USD");
  const fundingSourceId = normalizeId(request.body?.fundingSourceId);

  if (!amount) {
    response.status(400).json({ error: "Top-up amount must be greater than 0 and no more than 100,000." });
    return;
  }

  if (!currency) {
    response.status(400).json({ error: "Currency must be a 3-letter code like USD." });
    return;
  }

  if (!fundingSourceId) {
    response.status(400).json({ error: "Choose a linked bank account for ACH funding." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const fundingSource = await prisma.fundingSource.findFirst({
    where: {
      id: fundingSourceId,
      organizationId: {
        in: organizationIds
      },
      processor: "stripe",
      status: FundingSourceStatus.ACTIVE
    },
    select: {
      currency: true,
      id: true,
      metadata: true,
      organizationId: true,
      walletId: true
    }
  });

  if (!fundingSource) {
    response.status(404).json({ error: "Active Stripe bank funding source was not found." });
    return;
  }

  const stripeCustomerId = getJsonText(fundingSource.metadata, "stripeCustomerId");

  if (!stripeCustomerId) {
    response.status(409).json({ error: "This funding source is missing its Stripe customer link. Relink the bank account and try again." });
    return;
  }

  const sourceCurrency = normalizeCurrency(fundingSource.currency);

  if (sourceCurrency && sourceCurrency !== currency) {
    response.status(409).json({ error: `This funding source can only fund ${sourceCurrency} wallet top-ups.` });
    return;
  }

  const paymentIntent = await prisma.paymentIntent.create({
    data: {
      amount,
      createdById: user.id,
      currency,
      description: "Creator wallet Stripe ACH top-up.",
      fundingSourceId: fundingSource.id,
      metadata: {
        fundingSourceId: fundingSource.id,
        source: "stripe_ach_top_up"
      },
      organizationId: fundingSource.organizationId,
      provider: "stripe",
      purpose: "creator_wallet_top_up",
      status: PaymentIntentStatus.CREATED,
      walletId: fundingSource.walletId
    },
    select: paymentIntentSelect
  });

  try {
    const session = await createStripeCheckoutSession({
      amount,
      cancelUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, provider: "stripe", status: "cancel" }),
      currency,
      customerId: stripeCustomerId,
      description: "GoXAi Lab creator wallet ACH funds",
      fundingSourceId: fundingSource.id,
      paymentIntentId: paymentIntent.id,
      paymentMethodTypes: ["us_bank_account"],
      requestId: getRequestId(request) ?? paymentIntent.id,
      successUrl: buildWalletReturnUrl({ paymentIntentId: paymentIntent.id, provider: "stripe", status: "return", stripeSessionId: "{CHECKOUT_SESSION_ID}" })
    });

    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        metadata: mergeJsonMetadata(paymentIntent.metadata, {
          checkoutUrl: session.url,
          fundingSourceId: fundingSource.id,
          requestId: getRequestId(request),
          source: "stripe_ach_top_up",
          stripeCheckoutStatus: session.status
        }),
        providerRef: session.id,
        status: PaymentIntentStatus.PROCESSING
      }
    });

    response.status(201).json({
      checkoutUrl: session.url,
      paymentIntentId: paymentIntent.id,
      sessionId: session.id
    });
  } catch (reason) {
    await prisma.paymentIntent.update({
      where: {
        id: paymentIntent.id
      },
      data: {
        metadata: mergeJsonMetadata(paymentIntent.metadata, {
          failureReason: reason instanceof Error ? reason.message : "Unable to create Stripe ACH checkout.",
          fundingSourceId: fundingSource.id,
          requestId: getRequestId(request),
          source: "stripe_ach_top_up"
        }),
        status: PaymentIntentStatus.FAILED
      }
    });

    if (reason instanceof StripeConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof StripeRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-stripe-complete", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const paymentIntentId = normalizeId(request.body?.paymentIntentId);
  const sessionId = normalizeId(request.body?.sessionId);

  if (!paymentIntentId || !sessionId) {
    response.status(400).json({ error: "Stripe session and payment intent are required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: paymentIntentId,
      organizationId: {
        in: organizationIds
      },
      provider: "stripe",
      providerRef: sessionId
    },
    include: {
      receipts: {
        orderBy: {
          issuedAt: "desc"
        },
        take: 1
      }
    }
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "Stripe top-up was not found." });
    return;
  }

  if (paymentIntent.status === PaymentIntentStatus.SUCCEEDED) {
    response.status(200).json({
      paymentIntentId: paymentIntent.id,
      receiptId: paymentIntent.receipts[0]?.id ?? null,
      receiptNumber: paymentIntent.receipts[0]?.receiptNumber ?? null,
      wallet: await summarizeCreatorWallet(prisma, organizationIds)
    });
    return;
  }

  try {
    const session = await getStripeCheckoutSession(sessionId, getRequestId(request) ?? paymentIntent.id);
    const summary = getStripeCheckoutSessionSummary(session);

    if (!summary || summary.status !== "paid") {
      response.status(202).json({
        paymentIntentId: paymentIntent.id,
        receiptId: null,
        receiptNumber: null,
        wallet: await summarizeCreatorWallet(prisma, organizationIds)
      });
      return;
    }

    const result = await completeStripeCreatorTopUp({
      amount: summary.amount,
      currency: summary.currency,
      paymentIntentId: paymentIntent.id,
      providerPaymentIntentId: summary.providerPaymentIntentId,
      requestId: getRequestId(request),
      sessionId,
      source: "stripe_return",
      userId: user.id
    });

    response.status(200).json({
      paymentIntentId: paymentIntent.id,
      receiptId: result.receipt?.id ?? null,
      receiptNumber: result.receipt?.receiptNumber ?? null,
      wallet: await summarizeCreatorWallet(prisma, organizationIds)
    });
  } catch (reason) {
    if (reason instanceof ProviderTopUpCompletionError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    if (reason instanceof StripeConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof StripeRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-stripe-cancel", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const paymentIntentId = normalizeId(request.body?.paymentIntentId);

  if (!paymentIntentId) {
    response.status(400).json({ error: "Payment intent is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
  const paymentIntent = await prisma.paymentIntent.findFirst({
    where: {
      id: paymentIntentId,
      organizationId: {
        in: organizationIds
      },
      provider: "stripe",
      status: {
        in: [PaymentIntentStatus.CREATED, PaymentIntentStatus.PROCESSING]
      }
    },
    select: paymentIntentSelect
  });

  if (!paymentIntent) {
    response.status(404).json({ error: "Open Stripe top-up was not found." });
    return;
  }

  const cancelled = await prisma.paymentIntent.update({
    where: {
      id: paymentIntent.id
    },
    data: {
      cancelledAt: new Date(),
      metadata: mergeJsonMetadata(paymentIntent.metadata, {
        cancelledByUserId: user.id,
        cancelledFromWalletReturn: true,
        requestId: getRequestId(request)
      }),
      status: PaymentIntentStatus.CANCELLED
    },
    select: paymentIntentSelect
  });

  response.status(200).json({
    paymentIntent: serializePaymentIntent(cancelled)
  });
});

router.post("/creator-plaid-link-token", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const features = await getPlatformFeatures();

  if (!features.payments.plaidEnabled) {
    response.status(403).json({ error: "Plaid bank linking is disabled by a platform admin." });
    return;
  }

  try {
    const linkToken = await createPlaidLinkToken({
      clientUserId: user.id,
      userEmail: user.email
    });

    response.status(201).json(linkToken);
  } catch (reason) {
    if (reason instanceof PlaidConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof PlaidRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

router.post("/creator-plaid-stripe-bank-token", async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const features = await getPlatformFeatures();

  if (!features.payments.plaidEnabled || !features.payments.stripeEnabled) {
    response.status(403).json({ error: "Plaid bank linking and Stripe must be enabled before linking a bank." });
    return;
  }

  const accountId = normalizeId(request.body?.accountId);
  const accountMask = normalizeId(request.body?.accountMask);
  const accountName = normalizeId(request.body?.accountName);
  const accountSubtype = normalizeId(request.body?.accountSubtype);
  const accountType = normalizeId(request.body?.accountType);
  const institutionName = normalizeId(request.body?.institutionName);
  const organizationIdInput = normalizeId(request.body?.organizationId);
  const publicToken = normalizeId(request.body?.publicToken);

  if (!accountId || !publicToken) {
    response.status(400).json({ error: "Plaid public token and account are required." });
    return;
  }

  try {
    const result = await createPlaidStripeBankAccountToken({
      accountId,
      publicToken
    });
    const prisma = getPrismaClient();
    const organizationIds = await listCreatorOrganizationIds(prisma, user.id);
    const organizationId = organizationIdInput ?? organizationIds[0] ?? null;

    if (!organizationId || !organizationIds.includes(organizationId)) {
      response.status(403).json({ error: "Choose an organization where you are an owner or admin." });
      return;
    }

    const wallet = await ensureOrganizationWallet(prisma, organizationId);
    const stripeCustomer = await createStripeCustomer({
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
      requestId: getRequestId(request) ?? `${user.id}-plaid-customer`,
      userId: user.id
    });
    const stripeBankAccount = await attachStripeBankAccountToken({
      customerId: stripeCustomer.id,
      requestId: result.requestId ?? getRequestId(request) ?? `${user.id}-plaid-bank`,
      stripeBankAccountToken: result.stripeBankAccountToken
    });
    const fundingSource = await prisma.fundingSource.create({
      data: {
        accountMask: stripeBankAccount.last4 ?? accountMask,
        accountName: accountName ?? stripeBankAccount.bank_name,
        accountSubtype,
        accountType: accountType ?? "depository",
        currency: stripeBankAccount.currency?.toUpperCase() ?? "USD",
        institutionName: institutionName ?? stripeBankAccount.bank_name,
        metadata: {
          accountId,
          plaidRequestId: result.requestId,
          stripeBankAccountStatus: stripeBankAccount.status,
          stripeCustomerId: stripeCustomer.id,
          stripeFingerprint: stripeBankAccount.fingerprint
        },
        organizationId,
        processor: "stripe",
        processorRef: stripeBankAccount.id,
        provider: "plaid",
        providerRef: result.itemId,
        status: FundingSourceStatus.ACTIVE,
        userId: user.id,
        walletId: wallet.id
      },
      select: fundingSourceSelect
    });

    await prisma.auditLog.create({
      data: {
        action: "wallet.creator_bank_account.linked",
        entityId: fundingSource.id,
        entityType: "funding_source",
        metadata: {
          accountId,
          fundingSourceId: fundingSource.id,
          plaidRequestId: result.requestId,
          plaidItemId: result.itemId,
          stripeBankAccountId: stripeBankAccount.id,
          stripeCustomerId: stripeCustomer.id
        },
        organizationId,
        userId: user.id
      }
    });

    response.status(201).json({
      fundingSource: serializeFundingSource(fundingSource),
      linked: true,
      requestId: result.requestId
    });
  } catch (reason) {
    if (reason instanceof PlaidConfigurationError) {
      response.status(503).json({ error: reason.message });
      return;
    }

    if (reason instanceof PlaidRequestError) {
      response.status(reason.status).json({ error: reason.message });
      return;
    }

    throw reason;
  }
});

async function handlePayPalWebhookEvent(webhookEvent: unknown, transmissionId: string) {
  const event = isPlainJsonObject(webhookEvent) ? webhookEvent : {};
  const eventType = typeof event.event_type === "string" ? event.event_type : "";
  const eventId = typeof event.id === "string" ? event.id : null;
  const prisma = getPrismaClient();

  await prisma.auditLog.create({
    data: {
      action: "wallet.paypal_webhook.received",
      entityId: eventId,
      entityType: "paypal_webhook",
      metadata: {
        eventId,
        eventType,
        transmissionId
      }
    }
  });

  if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
    if (["PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.REVERSED"].includes(eventType)) {
      const summary = getPayPalWebhookCaptureSummary(webhookEvent);

      await markProviderTopUpFailed({
        metadata: {
          captureId: summary?.captureId ?? null,
          captureStatus: summary?.status ?? null,
          eventId,
          eventType,
          orderId: summary?.orderId ?? null
        },
        paymentIntentId: summary?.paymentIntentId ?? null,
        provider: "paypal",
        providerRef: summary?.orderId ?? null,
        reason: eventType,
        requestId: transmissionId,
        source: "paypal_webhook"
      });
    }

    return;
  }

  const summary = getPayPalWebhookCaptureSummary(webhookEvent);

  if (!summary || summary.status !== "COMPLETED") {
    return;
  }

  await completePayPalCreatorTopUp({
    amount: summary.value,
    captureId: summary.captureId,
    captureStatus: summary.status,
    currency: summary.currency,
    orderId: summary.orderId,
    paymentIntentId: summary.paymentIntentId,
    requestId: transmissionId,
    source: "paypal_webhook",
    userId: null
  });
}

async function handleStripeWebhookEvent(webhookEvent: unknown) {
  const event = isPlainJsonObject(webhookEvent) ? webhookEvent : {};
  const eventType = typeof event.type === "string" ? event.type : "";
  const eventId = typeof event.id === "string" ? event.id : null;
  const prisma = getPrismaClient();

  await prisma.auditLog.create({
    data: {
      action: "wallet.stripe_webhook.received",
      entityId: eventId,
      entityType: "stripe_webhook",
      metadata: {
        eventId,
        eventType
      }
    }
  });

  const checkoutSession = getStripeWebhookCheckoutSession(webhookEvent);

  if (!checkoutSession) {
    if (eventType === "payment_intent.payment_failed") {
      const eventData = isPlainJsonObject(event.data) ? event.data : null;
      const paymentIntent = isPlainJsonObject(eventData?.object) ? eventData.object : null;
      const metadata = isPlainJsonObject(paymentIntent?.metadata) ? paymentIntent.metadata : {};

      await markProviderTopUpFailed({
        metadata: {
          eventId,
          eventType,
          stripePaymentIntentId: typeof paymentIntent?.id === "string" ? paymentIntent.id : null
        },
        paymentIntentId: typeof metadata.paymentIntentId === "string" ? metadata.paymentIntentId : null,
        provider: "stripe",
        providerRef: typeof paymentIntent?.id === "string" ? paymentIntent.id : null,
        reason: eventType,
        requestId: eventId,
        source: "stripe_webhook"
      });
    }

    return;
  }

  const summary = getStripeCheckoutSessionSummary(checkoutSession);

  if (eventType === "checkout.session.async_payment_failed" || eventType === "checkout.session.expired") {
    await markProviderTopUpFailed({
      metadata: {
        eventId,
        eventType,
        stripePaymentIntentId: summary?.providerPaymentIntentId ?? null,
        stripeSessionId: summary?.sessionId ?? null
      },
      paymentIntentId: summary?.paymentIntentId ?? null,
      provider: "stripe",
      providerRef: summary?.sessionId ?? null,
      reason: eventType,
      requestId: eventId,
      source: "stripe_webhook"
    });
    return;
  }

  if (!summary || summary.status !== "paid") {
    return;
  }

  await completeStripeCreatorTopUp({
    amount: summary.amount,
    currency: summary.currency,
    paymentIntentId: summary.paymentIntentId,
    providerPaymentIntentId: summary.providerPaymentIntentId,
    requestId: eventId ?? summary.sessionId,
    sessionId: summary.sessionId,
    source: "stripe_webhook",
    userId: null
  });
}

async function markProviderTopUpFailed(input: {
  metadata?: Record<string, unknown>;
  paymentIntentId?: string | null;
  provider: string;
  providerRef?: string | null;
  reason: string;
  requestId?: string | null;
  source: "paypal_webhook" | "stripe_webhook";
}) {
  if (!input.paymentIntentId && !input.providerRef) {
    return null;
  }

  const prisma = getPrismaClient();
  const currentIntent = await prisma.paymentIntent.findFirst({
    where: {
      provider: input.provider,
      OR: [
        ...(input.paymentIntentId ? [{ id: input.paymentIntentId }] : []),
        ...(input.providerRef ? [{ providerRef: input.providerRef }] : [])
      ]
    },
    select: {
      createdById: true,
      id: true,
      metadata: true,
      organizationId: true,
      status: true,
      walletId: true
    }
  });

  if (!currentIntent || currentIntent.status === PaymentIntentStatus.SUCCEEDED || currentIntent.status === PaymentIntentStatus.CANCELLED) {
    return currentIntent;
  }

  const failed = await prisma.paymentIntent.update({
    where: {
      id: currentIntent.id
    },
    data: {
      metadata: mergeJsonMetadata(currentIntent.metadata, {
        ...(input.metadata ?? {}),
        failedAt: new Date().toISOString(),
        failureReason: input.reason,
        requestId: input.requestId,
        source: input.source
      }),
      status: PaymentIntentStatus.FAILED
    },
    select: {
      createdById: true,
      id: true,
      organizationId: true,
      walletId: true
    }
  });

  await prisma.auditLog.create({
    data: {
      action: `wallet.creator_top_up.${input.provider}_failed`,
      entityId: failed.walletId,
      entityType: "wallet",
      metadata: {
        ...(input.metadata ?? {}),
        failureReason: input.reason,
        paymentIntentId: failed.id,
        requestId: input.requestId,
        source: input.source
      },
      organizationId: failed.organizationId,
      userId: failed.createdById
    }
  });

  return failed;
}

async function completePayPalCreatorTopUp(input: {
  amount: string;
  captureId: string;
  captureStatus: string;
  currency: string;
  orderId: string | null;
  paymentIntentId: string | null;
  requestId?: string;
  source: "paypal_return" | "paypal_webhook";
  userId: string | null;
}) {
  const amount = normalizeMoneyAmount(input.amount);
  const currency = normalizeCurrency(input.currency);

  if (!amount || !currency) {
    throw new PayPalTopUpCompletionError("PayPal capture amount or currency is invalid.", 409);
  }

  const prisma = getPrismaClient();

  if (!input.paymentIntentId && !input.orderId) {
    throw new PayPalTopUpCompletionError("PayPal capture could not be matched to a wallet top-up.", 404);
  }

  return prisma.$transaction(async (tx) => {
    const currentIntent = await tx.paymentIntent.findFirst({
      where: {
        provider: "paypal",
        OR: [
          ...(input.paymentIntentId ? [{ id: input.paymentIntentId }] : []),
          ...(input.orderId ? [{ providerRef: input.orderId }] : [])
        ]
      },
      include: {
        receipts: {
          orderBy: {
            issuedAt: "desc"
          },
          take: 1
        }
      }
    });

    if (!currentIntent) {
      throw new PayPalTopUpCompletionError("PayPal top-up was not found.", 404);
    }

    const expectedAmount = normalizeMoneyAmount(currentIntent.amount.toString());
    const expectedCurrency = currentIntent.currency.toUpperCase();

    if (amount !== expectedAmount || currency !== expectedCurrency) {
      await tx.paymentIntent.update({
        where: {
          id: currentIntent.id
        },
        data: {
          metadata: mergeJsonMetadata(currentIntent.metadata, {
            captureAmount: amount,
            captureCurrency: currency,
            captureId: input.captureId,
            captureStatus: input.captureStatus,
            mismatchAt: new Date().toISOString(),
            orderId: input.orderId,
            requestId: input.requestId,
            source: input.source
          }),
          status: PaymentIntentStatus.FAILED
        }
      });
      throw new PayPalTopUpCompletionError("PayPal capture did not match this wallet top-up.", 409);
    }

    if (currentIntent.status === PaymentIntentStatus.SUCCEEDED) {
      return {
        paymentIntent: currentIntent,
        receipt: currentIntent.receipts[0] ?? null
      };
    }

    const now = new Date();
    const updatedIntent = await tx.paymentIntent.updateMany({
      where: {
        id: currentIntent.id,
        status: {
          not: PaymentIntentStatus.SUCCEEDED
        }
      },
      data: {
        completedAt: now,
        metadata: mergeJsonMetadata(currentIntent.metadata, {
          captureId: input.captureId,
          captureStatus: input.captureStatus,
          orderId: input.orderId,
          requestId: input.requestId,
          source: input.source
        }),
        status: PaymentIntentStatus.SUCCEEDED
      }
    });

    if (updatedIntent.count !== 1) {
      const completed = await tx.paymentIntent.findUnique({
        where: {
          id: currentIntent.id
        },
        include: {
          receipts: {
            orderBy: {
              issuedAt: "desc"
            },
            take: 1
          }
        }
      });

      return {
        paymentIntent: completed ?? currentIntent,
        receipt: completed?.receipts[0] ?? null
      };
    }

    await tx.wallet.update({
      where: {
        id: currentIntent.walletId
      },
      data: {
        balance: {
          increment: amount
        }
      }
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        amount,
        currency,
        description: "PayPal creator wallet top-up.",
        metadata: {
          captureId: input.captureId,
          orderId: input.orderId,
          paymentIntentId: currentIntent.id,
          requestId: input.requestId,
          source: input.source
        },
        referenceId: currentIntent.id,
        type: LedgerEntryType.CREDIT,
        walletId: currentIntent.walletId
      }
    });

    const receipt = await tx.walletReceipt.create({
      data: {
        amount,
        currency,
        description: "Creator wallet PayPal top-up receipt.",
        ledgerEntryId: ledgerEntry.id,
        metadata: {
          captureId: input.captureId,
          orderId: input.orderId,
          requestId: input.requestId,
          source: input.source
        },
        organizationId: currentIntent.organizationId,
        paymentIntentId: currentIntent.id,
        provider: "paypal",
        providerRef: input.captureId,
        receiptNumber: buildWalletReceiptNumber("PAYPAL", now, input.captureId),
        type: WalletReceiptType.TOP_UP,
        userId: input.userId ?? currentIntent.createdById,
        walletId: currentIntent.walletId
      }
    });

    await tx.auditLog.create({
      data: {
        action: "wallet.creator_top_up.paypal_captured",
        entityId: currentIntent.walletId,
        entityType: "wallet",
        metadata: {
          amount,
          captureId: input.captureId,
          currency,
          ledgerEntryId: ledgerEntry.id,
          orderId: input.orderId,
          paymentIntentId: currentIntent.id,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          requestId: input.requestId,
          source: input.source
        },
        organizationId: currentIntent.organizationId,
        userId: input.userId ?? currentIntent.createdById
      }
    });

    return {
      paymentIntent: {
        ...currentIntent,
        status: PaymentIntentStatus.SUCCEEDED
      },
      receipt
    };
  });
}

async function completeStripeCreatorTopUp(input: {
  amount: string;
  currency: string;
  paymentIntentId: string | null;
  providerPaymentIntentId: string | null;
  requestId?: string | null;
  sessionId: string;
  source: "stripe_return" | "stripe_webhook";
  userId: string | null;
}) {
  const amount = normalizeMoneyAmount(input.amount);
  const currency = normalizeCurrency(input.currency);

  if (!amount || !currency) {
    throw new ProviderTopUpCompletionError("Stripe checkout amount or currency is invalid.", 409);
  }

  const prisma = getPrismaClient();

  if (!input.paymentIntentId && !input.sessionId) {
    throw new ProviderTopUpCompletionError("Stripe checkout could not be matched to a wallet top-up.", 404);
  }

  return prisma.$transaction(async (tx) => {
    const currentIntent = await tx.paymentIntent.findFirst({
      where: {
        provider: "stripe",
        OR: [
          ...(input.paymentIntentId ? [{ id: input.paymentIntentId }] : []),
          { providerRef: input.sessionId }
        ]
      },
      include: {
        receipts: {
          orderBy: {
            issuedAt: "desc"
          },
          take: 1
        }
      }
    });

    if (!currentIntent) {
      throw new ProviderTopUpCompletionError("Stripe top-up was not found.", 404);
    }

    const expectedAmount = normalizeMoneyAmount(currentIntent.amount.toString());
    const expectedCurrency = currentIntent.currency.toUpperCase();

    if (amount !== expectedAmount || currency !== expectedCurrency) {
      await tx.paymentIntent.update({
        where: {
          id: currentIntent.id
        },
        data: {
          metadata: mergeJsonMetadata(currentIntent.metadata, {
            mismatchAt: new Date().toISOString(),
            requestId: input.requestId,
            source: input.source,
            stripeAmount: amount,
            stripeCurrency: currency,
            stripePaymentIntentId: input.providerPaymentIntentId,
            stripeSessionId: input.sessionId
          }),
          status: PaymentIntentStatus.FAILED
        }
      });
      throw new ProviderTopUpCompletionError("Stripe checkout did not match this wallet top-up.", 409);
    }

    if (currentIntent.status === PaymentIntentStatus.SUCCEEDED) {
      return {
        paymentIntent: currentIntent,
        receipt: currentIntent.receipts[0] ?? null
      };
    }

    const now = new Date();
    const updatedIntent = await tx.paymentIntent.updateMany({
      where: {
        id: currentIntent.id,
        status: {
          not: PaymentIntentStatus.SUCCEEDED
        }
      },
      data: {
        completedAt: now,
        metadata: mergeJsonMetadata(currentIntent.metadata, {
          requestId: input.requestId,
          source: input.source,
          stripePaymentIntentId: input.providerPaymentIntentId,
          stripeSessionId: input.sessionId
        }),
        status: PaymentIntentStatus.SUCCEEDED
      }
    });

    if (updatedIntent.count !== 1) {
      const completed = await tx.paymentIntent.findUnique({
        where: {
          id: currentIntent.id
        },
        include: {
          receipts: {
            orderBy: {
              issuedAt: "desc"
            },
            take: 1
          }
        }
      });

      return {
        paymentIntent: completed ?? currentIntent,
        receipt: completed?.receipts[0] ?? null
      };
    }

    await tx.wallet.update({
      where: {
        id: currentIntent.walletId
      },
      data: {
        balance: {
          increment: amount
        }
      }
    });

    const ledgerEntry = await tx.ledgerEntry.create({
      data: {
        amount,
        currency,
        description: "Stripe creator wallet top-up.",
        metadata: {
          paymentIntentId: currentIntent.id,
          requestId: input.requestId,
          source: input.source,
          stripePaymentIntentId: input.providerPaymentIntentId,
          stripeSessionId: input.sessionId
        },
        referenceId: currentIntent.id,
        type: LedgerEntryType.CREDIT,
        walletId: currentIntent.walletId
      }
    });

    const receiptProviderRef = input.providerPaymentIntentId ?? input.sessionId;
    const receipt = await tx.walletReceipt.create({
      data: {
        amount,
        currency,
        description: "Creator wallet Stripe top-up receipt.",
        ledgerEntryId: ledgerEntry.id,
        metadata: {
          requestId: input.requestId,
          source: input.source,
          stripePaymentIntentId: input.providerPaymentIntentId,
          stripeSessionId: input.sessionId
        },
        organizationId: currentIntent.organizationId,
        paymentIntentId: currentIntent.id,
        provider: "stripe",
        providerRef: receiptProviderRef,
        receiptNumber: buildWalletReceiptNumber("STRIPE", now, receiptProviderRef),
        type: WalletReceiptType.TOP_UP,
        userId: input.userId ?? currentIntent.createdById,
        walletId: currentIntent.walletId
      }
    });

    await tx.auditLog.create({
      data: {
        action: "wallet.creator_top_up.stripe_completed",
        entityId: currentIntent.walletId,
        entityType: "wallet",
        metadata: {
          amount,
          currency,
          ledgerEntryId: ledgerEntry.id,
          paymentIntentId: currentIntent.id,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          requestId: input.requestId,
          source: input.source,
          stripePaymentIntentId: input.providerPaymentIntentId,
          stripeSessionId: input.sessionId
        },
        organizationId: currentIntent.organizationId,
        userId: input.userId ?? currentIntent.createdById
      }
    });

    return {
      paymentIntent: {
        ...currentIntent,
        completedAt: now,
        status: PaymentIntentStatus.SUCCEEDED
      },
      receipt
    };
  });
}

async function listCreatorOrganizationIds(client: Prisma.TransactionClient, userId: string) {
  const memberships = await client.membership.findMany({
    where: {
      role: {
        in: [MembershipRole.OWNER, MembershipRole.ADMIN]
      },
      status: "ACTIVE",
      userId
    },
    select: {
      organizationId: true
    }
  });

  return [...new Set(memberships.map((membership) => membership.organizationId))];
}

async function summarizeCreatorWallet(
  client: Prisma.TransactionClient,
  organizationIds: string[],
  options: {
    datasetReportLimit?: number;
    ledgerLimit?: number;
  } = {}
) {
  const wallets = await Promise.all(organizationIds.map((organizationId) => ensureOrganizationWallet(client, organizationId)));
  const walletIds = wallets.map((wallet) => wallet.id);
  const [ledgerEntries, creditEvents] = await Promise.all([
    client.ledgerEntry.findMany({
      where: {
        walletId: {
          in: walletIds
        }
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        amount: true,
        createdAt: true,
        currency: true,
        description: true,
        id: true,
        metadata: true,
        referenceId: true,
        type: true
      }
    }),
    client.taskCreditEvent.findMany({
      where: {
        organizationId: {
          in: organizationIds
        }
      },
      select: {
        amount: true,
        status: true
      }
    })
  ]);
  const holdById = new Map(ledgerEntries.filter((entry) => entry.type === LedgerEntryType.HOLD).map((entry) => [entry.id, entry]));
  const datasetIds = [
    ...new Set(
      ledgerEntries
        .map((entry) => getCreatorLedgerDatasetId(entry, holdById))
        .filter((datasetId): datasetId is string => Boolean(datasetId))
    )
  ];
  const datasets =
    datasetIds.length > 0
      ? await client.dataset.findMany({
          where: {
            id: {
              in: datasetIds
            }
          },
          select: {
            id: true,
            name: true
          }
        })
      : [];
  const datasetNameById = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));

  const reservedBalance = ledgerEntries.reduce((total, entry) => {
    if (entry.type === LedgerEntryType.HOLD) {
      return total + decimalToNumber(entry.amount);
    }

    if (entry.type === LedgerEntryType.RELEASE || entry.type === LedgerEntryType.REFUND || entry.type === LedgerEntryType.FEE) {
      return total - decimalToNumber(entry.amount);
    }

    return total;
  }, 0);
  const refundedBalance = ledgerEntries
    .filter((entry) => entry.type === LedgerEntryType.REFUND)
    .reduce((total, entry) => total + decimalToNumber(entry.amount), 0);
  const paidToAnnotators = creditEvents
    .filter((event) =>
      event.status === TaskCreditStatus.APPROVED ||
      event.status === TaskCreditStatus.AVAILABLE ||
      event.status === TaskCreditStatus.WITHDRAWN
    )
    .reduce((total, event) => total + decimalToNumber(event.amount), 0);
  const underReviewBalance = creditEvents
    .filter((event) => event.status === TaskCreditStatus.UNDER_REVIEW)
    .reduce((total, event) => total + decimalToNumber(event.amount), 0);
  const availableBalance = wallets.reduce((total, wallet) => total + decimalToNumber(wallet.balance), 0);
  const datasetReportLimit = options.datasetReportLimit ?? CREATOR_DATASET_REPORT_LIMIT;
  const ledgerLimit = options.ledgerLimit ?? CREATOR_LEDGER_LIMIT;
  const datasetReports = buildCreatorDatasetReports(ledgerEntries, holdById, datasetNameById);

  return {
    availableBalance: roundMoney(availableBalance),
    currency: wallets[0]?.currency ?? "USD",
    datasetReports: datasetReports.slice(0, datasetReportLimit),
    ledgerEntries: ledgerEntries.slice(0, ledgerLimit).map((entry) => serializeCreatorLedgerEntry(entry, holdById, datasetNameById)),
    paidToAnnotators: roundMoney(paidToAnnotators),
    refundedBalance: roundMoney(refundedBalance),
    reservedBalance: roundMoney(Math.max(0, reservedBalance)),
    underReviewBalance: roundMoney(underReviewBalance),
    walletCount: wallets.length
  };
}

type CreatorWalletSummaryValue = {
  availableBalance: number;
  currency: string;
  datasetReports: ReturnType<typeof buildCreatorDatasetReports>;
  ledgerEntries: ReturnType<typeof serializeCreatorLedgerEntry>[];
  paidToAnnotators: number;
  refundedBalance: number;
  reservedBalance: number;
  underReviewBalance: number;
  walletCount: number;
};

export type CreatorLedgerFilter = "all" | "credit" | "escrow" | "fee" | "paid" | "refund";

export function buildCreatorLedgerExportFile(input: {
  exportedAt: Date;
  format: "csv" | "json";
  wallet: CreatorWalletSummaryValue;
}) {
  const dateStamp = input.exportedAt.toISOString().slice(0, 10);
  const summary = {
    availableBalance: input.wallet.availableBalance,
    paidToAnnotators: input.wallet.paidToAnnotators,
    refundedBalance: input.wallet.refundedBalance,
    reservedBalance: input.wallet.reservedBalance,
    underReviewBalance: input.wallet.underReviewBalance,
    walletCount: input.wallet.walletCount
  };

  if (input.format === "json") {
    return {
      content: Buffer.from(
        JSON.stringify(
          {
            currency: input.wallet.currency,
            datasetReports: input.wallet.datasetReports,
            exportedAt: input.exportedAt.toISOString(),
            ledgerEntries: input.wallet.ledgerEntries,
            summary
          },
          null,
          2
        )
      ),
      fileName: `creator-wallet-ledger-${dateStamp}.json`,
      mimeType: "application/json"
    };
  }

  const header = [
    "section",
    "id",
    "type",
    "dataset_id",
    "dataset_name",
    "task_id",
    "task_count",
    "amount",
    "currency",
    "held_balance",
    "reserved_balance",
    "paid_balance",
    "refunded_balance",
    "reconciliation_status",
    "reconciliation_delta",
    "created_at",
    "description",
    "reference_id"
  ];
  const rows = [
    header,
    ...input.wallet.datasetReports.map((report) => [
      "dataset",
      report.datasetId ?? "",
      "DATASET_TOTAL",
      report.datasetId ?? "",
      report.datasetName,
      "",
      report.taskCount,
      "",
      report.currency,
      report.heldBalance,
      report.reservedBalance,
      report.paidBalance,
      report.refundedBalance,
      report.reconciliationStatus,
      report.reconciliationDelta,
      report.lastActivityAt,
      "",
      ""
    ]),
    ...input.wallet.ledgerEntries.map((entry) => [
      "ledger",
      entry.id,
      entry.type,
      entry.datasetId ?? "",
      entry.datasetName ?? "",
      entry.taskId ?? "",
      entry.taskCount,
      entry.amount,
      entry.currency,
      "",
      "",
      "",
      "",
      "",
      "",
      entry.createdAt,
      entry.description ?? "",
      entry.referenceId ?? ""
    ])
  ];

  return {
    content: Buffer.from(rows.map((row) => row.map((value) => escapeCsvValue(value)).join(",")).join("\n")),
    fileName: `creator-wallet-ledger-${dateStamp}.csv`,
    mimeType: "text/csv"
  };
}

async function summarizeWorkerWallet(client: Prisma.TransactionClient, userId: string) {
  await ensureUserWallet(client, userId);

  const [creditEvents, recentEvents, payouts] = await Promise.all([
    client.taskCreditEvent.findMany({
      where: {
        userId
      },
      select: {
        amount: true,
        currency: true,
        availableAt: true,
        status: true
      }
    }),
    client.taskCreditEvent.findMany({
      where: {
        userId
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
            name: true
          }
        },
        eventType: true,
        id: true,
        project: {
          select: {
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
      },
      take: WORKER_EVENT_LIMIT
    }),
    client.payout.findMany({
      where: {
        userId
      },
      orderBy: {
        createdAt: "desc"
      },
      select: {
        amount: true,
        createdAt: true,
        currency: true,
        id: true,
        status: true,
        updatedAt: true
      },
      take: WORKER_PAYOUT_LIMIT
    })
  ]);

  const currency = creditEvents[0]?.currency ?? payouts[0]?.currency ?? "USD";
  const now = new Date();
  const nextAvailableAt = creditEvents
    .filter((event) => event.status === TaskCreditStatus.APPROVED && event.availableAt && event.availableAt > now)
    .map((event) => event.availableAt as Date)
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
  const pendingPayouts = payouts.filter((payout) => payout.status === PayoutStatus.REQUESTED || payout.status === PayoutStatus.PROCESSING);

  return {
    approvedBalance: sumCreditEvents(creditEvents, TaskCreditStatus.APPROVED),
    approvedCreditCount: countCreditEvents(creditEvents, TaskCreditStatus.APPROVED),
    availableBalance: sumCreditEvents(creditEvents, TaskCreditStatus.AVAILABLE),
    availableCreditCount: countCreditEvents(creditEvents, TaskCreditStatus.AVAILABLE),
    currency,
    holdDays: WORKER_CREDIT_HOLD_DAYS,
    nextAvailableAt: nextAvailableAt?.toISOString() ?? null,
    paidWithdrawalBalance: roundMoney(
      payouts
        .filter((payout) => payout.status === PayoutStatus.PAID)
        .reduce((total, payout) => total + decimalToNumber(payout.amount), 0)
    ),
    pendingWithdrawalBalance: roundMoney(
      pendingPayouts.reduce((total, payout) => total + decimalToNumber(payout.amount), 0)
    ),
    pendingWithdrawalCount: pendingPayouts.length,
    payouts: payouts.map((payout) => ({
      amount: decimalToNumber(payout.amount),
      createdAt: payout.createdAt.toISOString(),
      currency: payout.currency,
      id: payout.id,
      status: payout.status,
      updatedAt: payout.updatedAt.toISOString()
    })),
    recentEvents: recentEvents.map((event) => ({
      amount: decimalToNumber(event.amount),
      approvedAt: event.approvedAt?.toISOString() ?? null,
      assetName: event.task?.asset?.fileName ?? null,
      availableAt: event.availableAt?.toISOString() ?? null,
      createdAt: event.createdAt.toISOString(),
      credits: event.credits,
      currency: event.currency,
      datasetName: event.dataset?.name ?? null,
      eventType: event.eventType,
      id: event.id,
      projectName: event.project?.name ?? null,
      status: event.status,
      taskId: event.task?.id ?? null,
      withdrawnAt: event.withdrawnAt?.toISOString() ?? null
    })),
    totalEarnedBalance: roundMoney(
      creditEvents
        .filter(
          (event) =>
            event.status === TaskCreditStatus.APPROVED ||
            event.status === TaskCreditStatus.AVAILABLE ||
            event.status === TaskCreditStatus.WITHDRAWN
        )
        .reduce((total, event) => total + decimalToNumber(event.amount), 0)
    ),
    underReviewBalance: sumCreditEvents(creditEvents, TaskCreditStatus.UNDER_REVIEW),
    underReviewCreditCount: countCreditEvents(creditEvents, TaskCreditStatus.UNDER_REVIEW),
    withdrawnBalance: sumCreditEvents(creditEvents, TaskCreditStatus.WITHDRAWN)
  };
}

async function listCreatorLedgerPage(
  client: Prisma.TransactionClient,
  organizationIds: string[],
  input: {
    filter: CreatorLedgerFilter;
    page: number;
    pageSize: number;
    search: string;
  }
) {
  const wallets = await Promise.all(organizationIds.map((organizationId) => ensureOrganizationWallet(client, organizationId)));
  const walletIds = wallets.map((wallet) => wallet.id);

  if (walletIds.length === 0) {
    return {
      entries: [],
      filterCounts: emptyCreatorLedgerFilterCounts(),
      page: input.page,
      pageSize: input.pageSize,
      total: 0,
      totalPages: 1
    };
  }

  const ledgerEntries = await client.ledgerEntry.findMany({
    where: {
      walletId: {
        in: walletIds
      }
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      amount: true,
      createdAt: true,
      currency: true,
      description: true,
      id: true,
      metadata: true,
      referenceId: true,
      type: true
    },
    take: CREATOR_EXPORT_LIMIT
  });
  const holdById = new Map(ledgerEntries.filter((entry) => entry.type === LedgerEntryType.HOLD).map((entry) => [entry.id, entry]));
  const datasetIds = [
    ...new Set(
      ledgerEntries
        .map((entry) => getCreatorLedgerDatasetId(entry, holdById))
        .filter((datasetId): datasetId is string => Boolean(datasetId))
    )
  ];
  const datasets =
    datasetIds.length > 0
      ? await client.dataset.findMany({
          where: {
            id: {
              in: datasetIds
            }
          },
          select: {
            id: true,
            name: true
          }
        })
      : [];
  const datasetNameById = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));
  const entries = ledgerEntries.map((entry) => serializeCreatorLedgerEntry(entry, holdById, datasetNameById));
  const searchedEntries = filterCreatorLedgerEntriesBySearch(entries, input.search);
  const filterCounts = buildCreatorLedgerFilterCounts(searchedEntries);
  const filteredEntries = searchedEntries.filter((entry) => creatorLedgerFilterMatches(entry.type, input.filter));
  const total = filteredEntries.length;
  const totalPages = Math.max(1, Math.ceil(total / input.pageSize));
  const page = Math.min(input.page, totalPages);
  const start = (page - 1) * input.pageSize;

  return {
    entries: filteredEntries.slice(start, start + input.pageSize),
    filterCounts,
    page,
    pageSize: input.pageSize,
    total,
    totalPages
  };
}

async function releaseWorkerCreditsAfterHold(client: Prisma.TransactionClient, userId: string, now: Date) {
  const availableCutoff = new Date(now.getTime() - WORKER_CREDIT_HOLD_DAYS * 24 * 60 * 60 * 1000);
  const approvedEvents = await client.taskCreditEvent.findMany({
    where: {
      approvedAt: {
        lte: availableCutoff
      },
      status: TaskCreditStatus.APPROVED,
      userId
    },
    select: {
      id: true
    }
  });

  for (const event of approvedEvents) {
    await client.taskCreditEvent.update({
      where: {
        id: event.id
      },
      data: {
        availableAt: now,
        status: TaskCreditStatus.AVAILABLE
      }
    });
  }
}

export async function ensureUserWallet(client: Prisma.TransactionClient, userId: string, currency = "USD") {
  const existing = await client.wallet.findFirst({
    where: {
      ownerType: WalletOwnerType.USER,
      userId
    }
  });

  if (existing) {
    return existing;
  }

  return client.wallet.create({
    data: {
      balance: "0.00",
      currency,
      ownerType: WalletOwnerType.USER,
      userId
    }
  });
}

function sumCreditEvents(
  events: Array<{ amount: Prisma.Decimal | number | string; status: TaskCreditStatus }>,
  status: TaskCreditStatus
) {
  return roundMoney(
    events
      .filter((event) => event.status === status)
      .reduce((total, event) => total + decimalToNumber(event.amount), 0)
  );
}

function countCreditEvents(events: Array<{ status: TaskCreditStatus }>, status: TaskCreditStatus) {
  return events.filter((event) => event.status === status).length;
}

export async function ensureOrganizationWallet(client: Prisma.TransactionClient, organizationId: string, currency = "USD") {
  const existing = await client.wallet.findFirst({
    where: {
      organizationId,
      ownerType: WalletOwnerType.ORGANIZATION
    }
  });

  if (existing) {
    return existing;
  }

  return client.wallet.create({
    data: {
      balance: "0.00",
      currency,
      organizationId,
      ownerType: WalletOwnerType.ORGANIZATION
    }
  });
}

function emptyCreatorWalletSummary() {
  return {
    availableBalance: 0,
    currency: "USD",
    datasetReports: [],
    ledgerEntries: [],
    paidToAnnotators: 0,
    refundedBalance: 0,
    reservedBalance: 0,
    underReviewBalance: 0,
    walletCount: 0
  };
}

type CreatorLedgerEntrySource = {
  amount: Prisma.Decimal;
  createdAt: Date;
  currency: string;
  description: string | null;
  id: string;
  metadata: Prisma.JsonValue | null;
  referenceId: string | null;
  type: LedgerEntryType;
};

export function buildCreatorDatasetReports(
  ledgerEntries: CreatorLedgerEntrySource[],
  holdById: Map<string, CreatorLedgerEntrySource>,
  datasetNameById: Map<string, string>
) {
  const reports = new Map<
    string,
    {
      currency: string;
      datasetId: string | null;
      datasetName: string;
      feeBalance: number;
      heldBalance: number;
      lastActivityAt: string;
      paidBalance: number;
      refundedBalance: number;
      reservedBalance: number;
      taskCount: number;
    }
  >();

  for (const entry of ledgerEntries) {
    if (entry.type !== LedgerEntryType.HOLD && entry.type !== LedgerEntryType.RELEASE && entry.type !== LedgerEntryType.REFUND && entry.type !== LedgerEntryType.FEE) {
      continue;
    }

    const datasetId = getCreatorLedgerDatasetId(entry, holdById);
    const key = datasetId ?? "unassigned";
    const report =
      reports.get(key) ??
      {
        currency: entry.currency,
        datasetId,
        datasetName: datasetId ? datasetNameById.get(datasetId) ?? "Unknown dataset" : "Unassigned escrow",
        feeBalance: 0,
        heldBalance: 0,
        lastActivityAt: entry.createdAt.toISOString(),
        paidBalance: 0,
        refundedBalance: 0,
        reservedBalance: 0,
        taskCount: 0
      };
    const amount = decimalToNumber(entry.amount);

    if (entry.type === LedgerEntryType.HOLD) {
      report.heldBalance += amount;
      report.taskCount += getJsonNumber(entry.metadata, "taskCount");
    } else if (entry.type === LedgerEntryType.RELEASE) {
      report.paidBalance += amount;
    } else if (entry.type === LedgerEntryType.REFUND) {
      report.refundedBalance += amount;
    } else if (entry.type === LedgerEntryType.FEE) {
      report.feeBalance += amount;
    }

    if (entry.createdAt.getTime() > new Date(report.lastActivityAt).getTime()) {
      report.lastActivityAt = entry.createdAt.toISOString();
    }

    report.reservedBalance = Math.max(0, report.heldBalance - report.paidBalance - report.refundedBalance - report.feeBalance);
    reports.set(key, report);
  }

  return [...reports.values()]
    .map((report) => {
      const visibleReport = {
        currency: report.currency,
        datasetId: report.datasetId,
        datasetName: report.datasetName,
        heldBalance: roundMoney(report.heldBalance),
        lastActivityAt: report.lastActivityAt,
        paidBalance: roundMoney(report.paidBalance),
        refundedBalance: roundMoney(report.refundedBalance),
        reservedBalance: roundMoney(report.reservedBalance),
        taskCount: report.taskCount
      };

      return {
        ...visibleReport,
        reconciliationDelta: getFundingReconciliationDelta(report),
        reconciliationStatus: getFundingReconciliationStatus(report)
      };
    })
    .sort((first, second) => new Date(second.lastActivityAt).getTime() - new Date(first.lastActivityAt).getTime());
}

export function getFundingReconciliationDelta(input: {
  feeBalance?: number;
  heldBalance: number;
  paidBalance: number;
  refundedBalance: number;
  reservedBalance: number;
}) {
  return roundMoney(input.heldBalance - input.paidBalance - input.refundedBalance - (input.feeBalance ?? 0) - input.reservedBalance);
}

export function getFundingReconciliationStatus(input: {
  feeBalance?: number;
  heldBalance: number;
  paidBalance: number;
  refundedBalance: number;
  reservedBalance: number;
}) {
  return Math.abs(getFundingReconciliationDelta(input)) <= 0.01 ? "balanced" : "warning";
}

export function serializeCreatorLedgerEntry(
  entry: CreatorLedgerEntrySource,
  holdById: Map<string, CreatorLedgerEntrySource>,
  datasetNameById: Map<string, string>
) {
  const datasetId = getCreatorLedgerDatasetId(entry, holdById);
  const taskId = getJsonText(entry.metadata, "taskId");

  return {
    amount: decimalToNumber(entry.amount),
    createdAt: entry.createdAt.toISOString(),
    currency: entry.currency,
    datasetId,
    datasetName: datasetId ? datasetNameById.get(datasetId) ?? "Unknown dataset" : null,
    description: entry.description,
    id: entry.id,
    referenceId: entry.referenceId,
    taskCount: getJsonNumber(entry.metadata, "taskCount"),
    taskId,
    type: entry.type
  };
}

export function buildCreatorLedgerFilterCounts(entries: ReturnType<typeof serializeCreatorLedgerEntry>[]) {
  return entries.reduce<Record<CreatorLedgerFilter, number>>(
    (counts, entry) => {
      for (const filter of creatorLedgerFilterValues) {
        if (creatorLedgerFilterMatches(entry.type, filter)) {
          counts[filter] += 1;
        }
      }

      return counts;
    },
    emptyCreatorLedgerFilterCounts()
  );
}

export function filterCreatorLedgerEntriesBySearch(
  entries: ReturnType<typeof serializeCreatorLedgerEntry>[],
  search: string
) {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return entries;
  }

  return entries.filter((entry) =>
    [
      entry.datasetName,
      entry.description,
      entry.id,
      entry.referenceId,
      entry.taskId,
      entry.type
    ].some((value) => value?.toLowerCase().includes(normalizedSearch))
  );
}

function creatorLedgerFilterMatches(type: string, filter: CreatorLedgerFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "credit") {
    return type === LedgerEntryType.CREDIT;
  }

  if (filter === "escrow") {
    return type === LedgerEntryType.HOLD;
  }

  if (filter === "paid") {
    return type === LedgerEntryType.RELEASE || type === LedgerEntryType.PAYOUT;
  }

  if (filter === "fee") {
    return type === LedgerEntryType.FEE;
  }

  return type === LedgerEntryType.REFUND;
}

function getCreatorLedgerDatasetId(entry: CreatorLedgerEntrySource, holdById: Map<string, CreatorLedgerEntrySource>) {
  if (entry.type === LedgerEntryType.HOLD) {
    return getJsonText(entry.metadata, "datasetId") ?? entry.referenceId;
  }

  const escrowLedgerEntryId = getJsonText(entry.metadata, "escrowLedgerEntryId");
  const hold = escrowLedgerEntryId ? holdById.get(escrowLedgerEntryId) : null;

  return hold ? getJsonText(hold.metadata, "datasetId") ?? hold.referenceId : null;
}

function decimalToNumber(value: Prisma.Decimal | number | string) {
  return typeof value === "number" ? value : Number(value.toString());
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeMoneyAmount(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (!Number.isFinite(numberValue) || numberValue <= 0 || numberValue > 100_000) {
    return null;
  }

  return numberValue.toFixed(2);
}

function normalizeCurrency(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const currency = value.trim().toUpperCase();

  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function buildWalletReturnUrl(input: { paymentIntentId: string; provider?: "paypal" | "stripe"; status: "cancel" | "return"; stripeSessionId?: string }) {
  const webOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
  const params = new URLSearchParams({
    paymentIntentId: input.paymentIntentId,
    [input.provider ?? "paypal"]: input.status
  });

  if (input.stripeSessionId) {
    params.set("stripeSessionId", input.stripeSessionId);
  }

  return `${webOrigin}/wallet?${params.toString()}`;
}

const creatorLedgerFilterValues: CreatorLedgerFilter[] = ["all", "credit", "escrow", "paid", "fee", "refund"];

function normalizeCreatorLedgerFilter(value: unknown): CreatorLedgerFilter | null {
  if (typeof value !== "string" || value.trim() === "") {
    return "all";
  }

  const normalized = value.trim().toLowerCase();

  return creatorLedgerFilterValues.includes(normalized as CreatorLedgerFilter) ? (normalized as CreatorLedgerFilter) : null;
}

function normalizeCreatorLedgerExportFormat(value: unknown) {
  if (typeof value !== "string") {
    return "json";
  }

  const format = value.trim().toLowerCase();

  return format === "csv" || format === "json" ? format : null;
}

function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePageNumber(value: unknown) {
  const page = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 1;

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(value: unknown, fallback: number, max: number) {
  const pageSize = typeof value === "string" ? Number(value) : typeof value === "number" ? value : fallback;

  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    return fallback;
  }

  return Math.min(pageSize, max);
}

function parsePayPalWebhookBody(body: unknown) {
  try {
    if (Buffer.isBuffer(body)) {
      return JSON.parse(body.toString("utf8")) as unknown;
    }

    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

function parsePayPalWebhookHeaders(headers: IncomingHttpHeaders) {
  const authAlgo = getHeaderValue(headers["paypal-auth-algo"]);
  const certUrl = getHeaderValue(headers["paypal-cert-url"]);
  const transmissionId = getHeaderValue(headers["paypal-transmission-id"]);
  const transmissionSig = getHeaderValue(headers["paypal-transmission-sig"]);
  const transmissionTime = getHeaderValue(headers["paypal-transmission-time"]);

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return null;
  }

  return {
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime
  };
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mergeJsonMetadata(current: Prisma.JsonValue | null, next: Record<string, unknown>) {
  const base = isPlainJsonObject(current) ? current : {};

  return {
    ...base,
    ...next
  } as Prisma.InputJsonObject;
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getJsonText(metadata: Prisma.JsonValue | null, key: string) {
  if (!isPlainJsonObject(metadata)) {
    return null;
  }

  const value = metadata[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getJsonNumber(metadata: Prisma.JsonValue | null, key: string) {
  if (!isPlainJsonObject(metadata)) {
    return 0;
  }

  const value = metadata[key];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyCreatorLedgerFilterCounts() {
  return {
    all: 0,
    credit: 0,
    escrow: 0,
    fee: 0,
    paid: 0,
    refund: 0
  };
}

const walletReceiptSelect = {
  amount: true,
  createdAt: true,
  currency: true,
  description: true,
  id: true,
  issuedAt: true,
  metadata: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true
    }
  },
  provider: true,
  providerRef: true,
  receiptNumber: true,
  type: true,
  user: {
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true
    }
  }
} satisfies Prisma.WalletReceiptSelect;

type WalletReceiptRecord = Prisma.WalletReceiptGetPayload<{ select: typeof walletReceiptSelect }>;

const paymentIntentSelect = {
  amount: true,
  cancelledAt: true,
  completedAt: true,
  createdAt: true,
  currency: true,
  description: true,
  id: true,
  metadata: true,
  provider: true,
  providerRef: true,
  status: true,
  updatedAt: true
} satisfies Prisma.PaymentIntentSelect;

type PaymentIntentRecord = Prisma.PaymentIntentGetPayload<{ select: typeof paymentIntentSelect }>;

const fundingSourceSelect = {
  accountMask: true,
  accountName: true,
  accountSubtype: true,
  accountType: true,
  createdAt: true,
  currency: true,
  disabledAt: true,
  id: true,
  institutionName: true,
  organizationId: true,
  processor: true,
  provider: true,
  status: true,
  updatedAt: true
} satisfies Prisma.FundingSourceSelect;

type FundingSourceRecord = Prisma.FundingSourceGetPayload<{ select: typeof fundingSourceSelect }>;

type FundingSourceAuditEntry = {
  action: string;
  createdAt: Date;
  entityId: string | null;
  entityType: string | null;
  id: string;
  metadata: Prisma.JsonValue | null;
  userId: string | null;
};

function buildWalletReceiptAccessWhere(userId: string, organizationIds: string[]): Prisma.WalletReceiptWhereInput {
  return {
    OR: [
      {
        userId
      },
      ...(organizationIds.length > 0
        ? [
            {
              organizationId: {
                in: organizationIds
              }
            }
          ]
        : [])
    ]
  };
}

function serializeWalletReceipt(receipt: WalletReceiptRecord) {
  return {
    amount: decimalToNumber(receipt.amount),
    createdAt: receipt.createdAt.toISOString(),
    currency: receipt.currency,
    description: receipt.description,
    id: receipt.id,
    issuedAt: receipt.issuedAt.toISOString(),
    organization: receipt.organization,
    provider: receipt.provider,
    providerRef: receipt.providerRef,
    receiptNumber: receipt.receiptNumber,
    type: receipt.type,
    user: receipt.user
      ? {
          email: receipt.user.email,
          id: receipt.user.id,
          name: [receipt.user.firstName, receipt.user.lastName].filter(Boolean).join(" ") || receipt.user.email
        }
      : null
  };
}

function serializePaymentIntent(paymentIntent: PaymentIntentRecord) {
  return {
    amount: decimalToNumber(paymentIntent.amount),
    cancelledAt: paymentIntent.cancelledAt?.toISOString() ?? null,
    completedAt: paymentIntent.completedAt?.toISOString() ?? null,
    createdAt: paymentIntent.createdAt.toISOString(),
    currency: paymentIntent.currency,
    description: paymentIntent.description,
    id: paymentIntent.id,
    provider: paymentIntent.provider,
    providerRef: paymentIntent.providerRef,
    status: paymentIntent.status,
    updatedAt: paymentIntent.updatedAt.toISOString()
  };
}

function serializeFundingSource(fundingSource: FundingSourceRecord) {
  return {
    accountMask: fundingSource.accountMask,
    accountName: fundingSource.accountName,
    accountSubtype: fundingSource.accountSubtype,
    accountType: fundingSource.accountType,
    createdAt: fundingSource.createdAt.toISOString(),
    currency: fundingSource.currency,
    disabledAt: fundingSource.disabledAt?.toISOString() ?? null,
    id: fundingSource.id,
    institutionName: fundingSource.institutionName,
    organizationId: fundingSource.organizationId,
    processor: fundingSource.processor,
    provider: fundingSource.provider,
    status: fundingSource.status,
    updatedAt: fundingSource.updatedAt.toISOString()
  };
}

function serializeFundingSourceAuditEntry(entry: FundingSourceAuditEntry) {
  return {
    action: entry.action,
    createdAt: entry.createdAt.toISOString(),
    entityId: entry.entityId,
    entityType: entry.entityType,
    id: entry.id,
    metadata: entry.metadata,
    userId: entry.userId
  };
}

export function buildWalletReceiptDownloadFile(receipt: WalletReceiptRecord) {
  const serialized = serializeWalletReceipt(receipt);
  const dateStamp = receipt.issuedAt.toISOString().slice(0, 10);

  return {
    content: Buffer.from(JSON.stringify(serialized, null, 2)),
    fileName: `${receipt.receiptNumber.toLowerCase()}-${dateStamp}.json`,
    mimeType: "application/json"
  };
}

function escapeCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

export function buildWalletReceiptNumber(prefix: string, issuedAt: Date, id: string) {
  const normalizedPrefix = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "RCT";
  const dateStamp = issuedAt.toISOString().slice(0, 10).replaceAll("-", "");
  const normalizedId = id.trim().replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase() || "00000000";

  return `${normalizedPrefix}-${dateStamp}-${normalizedId}`;
}

export function getWithdrawalLockError(selectedCount: number, lockedCount: number) {
  if (selectedCount === lockedCount) {
    return null;
  }

  return "Some credits were already moved into another withdrawal. Refresh and try again.";
}

class WithdrawalRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class PayPalTopUpCompletionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class ProviderTopUpCompletionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export { router as billingRouter, paypalWebhookRouter, stripeWebhookRouter };
