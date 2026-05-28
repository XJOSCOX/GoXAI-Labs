import { LedgerEntryType, Prisma, WalletReceiptType } from "@goxai/database";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCreatorDatasetReports,
  buildCreatorLedgerExportFile,
  buildCreatorLedgerFilterCounts,
  buildProviderWebhookRejectionAudit,
  buildWalletReceiptDownloadFile,
  buildWalletReceiptNumber,
  filterCreatorLedgerEntriesBySearch,
  getFundingReconciliationDelta,
  getFundingReconciliationStatus,
  normalizePaymentClientRequestId,
  getPayPalWebhookIdempotencyKey,
  getStripeWebhookIdempotencyKey,
  getWithdrawalLockError,
  serializeCreatorLedgerEntry
} from "./billing.js";
import { getPayPalApiBaseUrl, getPayPalApprovalUrl, getPayPalCaptureSummary, getPayPalWebhookCaptureSummary } from "./paypal.js";
import { getPlaidApiBaseUrl } from "./plaid.js";
import { getStripeApiBaseUrl, getStripeCheckoutSessionSummary, verifyStripeWebhookSignature } from "./stripe.js";

const now = new Date("2026-05-26T12:00:00.000Z");

describe("creator wallet reporting", () => {
  it("rolls creator holds, releases, and refunds up by dataset", () => {
    const hold = ledgerEntry({
      amount: "10.00",
      id: "hold-1",
      metadata: {
        datasetId: "dataset-1",
        taskCount: 5
      },
      referenceId: "dataset-1",
      type: LedgerEntryType.HOLD
    });
    const release = ledgerEntry({
      amount: "7.00",
      id: "release-1",
      metadata: {
        escrowLedgerEntryId: hold.id,
        taskId: "task-1"
      },
      referenceId: "task-1",
      type: LedgerEntryType.RELEASE
    });
    const refund = ledgerEntry({
      amount: "2.00",
      id: "refund-1",
      metadata: {
        escrowLedgerEntryId: hold.id,
        taskId: "task-2"
      },
      referenceId: "task-2",
      type: LedgerEntryType.REFUND
    });

    assert.deepEqual(buildCreatorDatasetReports([refund, release, hold], new Map([[hold.id, hold]]), new Map([["dataset-1", "Training V1"]])), [
      {
        currency: "USD",
        datasetId: "dataset-1",
        datasetName: "Training V1",
        heldBalance: 10,
        lastActivityAt: now.toISOString(),
        paidBalance: 7,
        reconciliationDelta: 0,
        reconciliationStatus: "balanced",
        refundedBalance: 2,
        reservedBalance: 1,
        taskCount: 5
      }
    ]);
  });

  it("keeps top-up refunds out of dataset escrow reporting", () => {
    const hold = ledgerEntry({
      amount: "10.00",
      id: "hold-1",
      metadata: {
        datasetId: "dataset-1",
        taskCount: 5
      },
      referenceId: "dataset-1",
      type: LedgerEntryType.HOLD
    });
    const topUpRefund = ledgerEntry({
      amount: "4.00",
      id: "refund-top-up-1",
      metadata: {
        paymentIntentId: "payment-1",
        refundKind: "top_up"
      },
      referenceId: "payment-1",
      type: LedgerEntryType.REFUND
    });

    assert.deepEqual(buildCreatorDatasetReports([topUpRefund, hold], new Map([[hold.id, hold]]), new Map([["dataset-1", "Training V1"]])), [
      {
        currency: "USD",
        datasetId: "dataset-1",
        datasetName: "Training V1",
        heldBalance: 10,
        lastActivityAt: now.toISOString(),
        paidBalance: 0,
        reconciliationDelta: 0,
        reconciliationStatus: "balanced",
        refundedBalance: 0,
        reservedBalance: 10,
        taskCount: 5
      }
    ]);
  });

  it("attaches dataset and task context to recent creator ledger rows", () => {
    const hold = ledgerEntry({
      amount: "10.00",
      id: "hold-1",
      metadata: {
        datasetId: "dataset-1",
        taskCount: 5
      },
      referenceId: "dataset-1",
      type: LedgerEntryType.HOLD
    });
    const release = ledgerEntry({
      amount: "7.00",
      id: "release-1",
      metadata: {
        escrowLedgerEntryId: hold.id,
        taskId: "task-1"
      },
      referenceId: "task-1",
      type: LedgerEntryType.RELEASE
    });

    assert.deepEqual(serializeCreatorLedgerEntry(release, new Map([[hold.id, hold]]), new Map([["dataset-1", "Training V1"]])), {
      approvedCredits: 0,
      amount: 7,
      createdAt: now.toISOString(),
      currency: "USD",
      datasetId: "dataset-1",
      datasetName: "Training V1",
      description: "Test entry",
      escrowCredits: 0,
      escrowLedgerEntryId: "hold-1",
      feeCredits: 0,
      id: "release-1",
      isTopUpRefund: false,
      originalPaymentProvider: null,
      paymentIntentId: null,
      platformFeeRate: 0,
      providerRef: null,
      referenceId: "task-1",
      refundCredits: 0,
      refundKind: null,
      reviewId: null,
      taskCount: 0,
      taskId: "task-1",
      type: LedgerEntryType.RELEASE
    });
  });

  it("exposes top-up refund trace fields on creator ledger rows", () => {
    const refund = ledgerEntry({
      amount: "4.00",
      id: "refund-top-up-1",
      metadata: {
        originalPaymentProvider: "PAYPAL",
        paymentIntentId: "payment-1",
        providerRef: "refund-provider-1",
        refundKind: "top_up"
      },
      referenceId: "payment-1",
      type: LedgerEntryType.REFUND
    });

    assert.deepEqual(serializeCreatorLedgerEntry(refund, new Map(), new Map()), {
      approvedCredits: 0,
      amount: 4,
      createdAt: now.toISOString(),
      currency: "USD",
      datasetId: null,
      datasetName: null,
      description: "Test entry",
      escrowCredits: 0,
      escrowLedgerEntryId: null,
      feeCredits: 0,
      id: "refund-top-up-1",
      isTopUpRefund: true,
      originalPaymentProvider: "PAYPAL",
      paymentIntentId: "payment-1",
      platformFeeRate: 0,
      providerRef: "refund-provider-1",
      referenceId: "payment-1",
      refundCredits: 0,
      refundKind: "top_up",
      reviewId: null,
      taskCount: 0,
      taskId: null,
      type: LedgerEntryType.REFUND
    });
  });

  it("exports creator wallet reports as JSON", () => {
    const file = buildCreatorLedgerExportFile({
      exportedAt: now,
      format: "json",
      wallet: creatorWalletFixture()
    });
    const payload = JSON.parse(file.content.toString()) as {
      datasetReports: unknown[];
      exportedAt: string;
      ledgerEntries: unknown[];
      summary: {
        reservedBalance: number;
      };
    };

    assert.equal(file.fileName, "creator-wallet-ledger-2026-05-26.json");
    assert.equal(file.mimeType, "application/json");
    assert.equal(payload.exportedAt, now.toISOString());
    assert.equal(payload.datasetReports.length, 1);
    assert.equal(payload.ledgerEntries.length, 1);
    assert.equal(payload.summary.reservedBalance, 3);
  });

  it("exports creator wallet reports as CSV with dataset and ledger rows", () => {
    const file = buildCreatorLedgerExportFile({
      exportedAt: now,
      format: "csv",
      wallet: creatorWalletFixture({
        datasetName: "Training, \"Vision\""
      })
    });
    const csv = file.content.toString();

    assert.equal(file.fileName, "creator-wallet-ledger-2026-05-26.csv");
    assert.equal(file.mimeType, "text/csv");
    assert.match(csv, /^section,id,type,refund_kind,payment_intent_id,provider_ref,original_payment_provider,dataset_id,dataset_name/);
    assert.match(csv, /dataset,dataset-1,DATASET_TOTAL,,,,,dataset-1,"Training, ""Vision"""/);
    assert.match(csv, /ledger,release-1,RELEASE,,,,,dataset-1,"Training, ""Vision""",task-1/);
  });

  it("counts creator ledger filters for wallet drill-downs", () => {
    const entries = creatorWalletFixture().ledgerEntries;

    assert.deepEqual(buildCreatorLedgerFilterCounts(entries), {
      all: 1,
      credit: 0,
      escrow: 0,
      fee: 0,
      paid: 1,
      refund: 0
    });
  });

  it("searches creator ledger entries by dataset, description, task, and reference", () => {
    const entries = creatorWalletFixture({ datasetName: "Invoice review" }).ledgerEntries;

    assert.equal(filterCreatorLedgerEntriesBySearch(entries, "invoice").length, 1);
    assert.equal(filterCreatorLedgerEntriesBySearch(entries, "worker credit").length, 1);
    assert.equal(filterCreatorLedgerEntriesBySearch(entries, "task-1").length, 1);
    assert.equal(filterCreatorLedgerEntriesBySearch(entries, "missing").length, 0);
  });

  it("flags unbalanced dataset funding reconciliation", () => {
    assert.equal(
      getFundingReconciliationDelta({
        heldBalance: 10,
        paidBalance: 7,
        refundedBalance: 1,
        reservedBalance: 1
      }),
      1
    );
    assert.equal(
      getFundingReconciliationStatus({
        heldBalance: 10,
        paidBalance: 7,
        refundedBalance: 1,
        reservedBalance: 1
      }),
      "warning"
    );
    assert.equal(
      getFundingReconciliationStatus({
        heldBalance: 10,
        paidBalance: 7,
        refundedBalance: 2,
        reservedBalance: 1
      }),
      "balanced"
    );
  });

  it("rejects withdrawal locks when another request already moved credits", () => {
    assert.equal(getWithdrawalLockError(2, 2), null);
    assert.equal(
      getWithdrawalLockError(2, 1),
      "Some credits were already moved into another withdrawal. Refresh and try again."
    );
  });

  it("builds stable provider-neutral receipt numbers", () => {
    assert.equal(buildWalletReceiptNumber("top", now, "pay_int_123456789"), "TOP-20260526-23456789");
    assert.equal(buildWalletReceiptNumber("manual top up", now, "abc"), "MANUALTO-20260526-ABC");
  });

  it("exports wallet receipts as provider-neutral JSON documents", () => {
    const file = buildWalletReceiptDownloadFile({
      amount: new Prisma.Decimal("20.00"),
      createdAt: now,
      currency: "USD",
      description: "Worker payout statement.",
      id: "receipt-1",
      issuedAt: now,
      metadata: null,
      organization: null,
      provider: "sandbox",
      providerRef: "sandbox-payout-20",
      receiptNumber: "POUT-20260526-DEMO",
      type: WalletReceiptType.PAYOUT,
      user: {
        email: "worker.demo@goxailab.local",
        firstName: "Worker",
        id: "user-1",
        lastName: "Demo"
      }
    });
    const payload = JSON.parse(file.content.toString()) as { amount: number; provider: string; receiptNumber: string; type: string };

    assert.equal(file.fileName, "pout-20260526-demo-2026-05-26.json");
    assert.equal(file.mimeType, "application/json");
    assert.equal(payload.amount, 20);
    assert.equal(payload.provider, "sandbox");
    assert.equal(payload.receiptNumber, "POUT-20260526-DEMO");
    assert.equal(payload.type, "PAYOUT");
  });

  it("normalizes PayPal checkout helpers", () => {
    assert.equal(getPayPalApiBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
    assert.equal(getPayPalApiBaseUrl("live"), "https://api-m.paypal.com");
    assert.equal(getPayPalApiBaseUrl("sandbox", "https://example.test/"), "https://example.test");
    assert.equal(
      getPayPalApprovalUrl({
        links: [
          { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER", rel: "self" },
          { href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER", rel: "approve" }
        ]
      }),
      "https://www.sandbox.paypal.com/checkoutnow?token=ORDER"
    );
    assert.deepEqual(
      getPayPalCaptureSummary({
        id: "ORDER",
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  amount: {
                    currency_code: "USD",
                    value: "15.00"
                  },
                  id: "CAPTURE",
                  status: "COMPLETED"
                }
              ]
            }
          }
        ]
      }),
      {
        captureId: "CAPTURE",
        currency: "USD",
        status: "COMPLETED",
        value: "15.00"
      }
    );
    assert.deepEqual(
      getPayPalWebhookCaptureSummary({
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          amount: {
            currency_code: "USD",
            value: "15.00"
          },
          custom_id: "pay-int-1",
          id: "CAPTURE",
          status: "COMPLETED",
          supplementary_data: {
            related_ids: {
              order_id: "ORDER"
            }
          }
        }
      }),
      {
        captureId: "CAPTURE",
        currency: "USD",
        orderId: "ORDER",
        paymentIntentId: "pay-int-1",
        status: "COMPLETED",
        value: "15.00"
      }
    );
  });

  it("normalizes Stripe and Plaid payment helpers", () => {
    assert.equal(getStripeApiBaseUrl(), "https://api.stripe.com");
    assert.equal(getStripeApiBaseUrl("https://stripe.test/"), "https://stripe.test");
    assert.equal(getPlaidApiBaseUrl("sandbox"), "https://sandbox.plaid.com");
    assert.equal(getPlaidApiBaseUrl("development"), "https://development.plaid.com");
    assert.equal(getPlaidApiBaseUrl("production"), "https://production.plaid.com");
    assert.deepEqual(
      getStripeCheckoutSessionSummary({
        amount_total: 1500,
        currency: "usd",
        id: "cs_test",
        metadata: {
          paymentIntentId: "pay-int-1"
        },
        payment_intent: "pi_test",
        payment_status: "paid"
      }),
      {
        amount: "15.00",
        currency: "USD",
        paymentIntentId: "pay-int-1",
        providerPaymentIntentId: "pi_test",
        sessionId: "cs_test",
        status: "paid"
      }
    );
  });

  it("verifies Stripe webhook signatures against the raw payload", () => {
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const payload = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }));
    const timestamp = 1_800_000_000;
    const secret = "whsec_test";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload.toString("utf8")}`).digest("hex");

    process.env.STRIPE_WEBHOOK_SECRET = secret;

    try {
      assert.doesNotThrow(() => verifyStripeWebhookSignature(payload, `t=${timestamp},v1=${signature}`, timestamp));
      assert.throws(() => verifyStripeWebhookSignature(payload, `t=${timestamp},v1=bad`, timestamp));
    } finally {
      if (previousSecret === undefined) {
        delete process.env.STRIPE_WEBHOOK_SECRET;
      } else {
        process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
      }
    }
  });

  it("builds stable provider webhook idempotency keys", () => {
    assert.equal(getPayPalWebhookIdempotencyKey({ eventId: " WH-123 ", transmissionId: "TRANS-123" }), "WH-123");
    assert.equal(getPayPalWebhookIdempotencyKey({ eventId: "", transmissionId: " TRANS-123 " }), "TRANS-123");
    assert.equal(getPayPalWebhookIdempotencyKey({ eventId: null, transmissionId: null }), null);
    assert.equal(getStripeWebhookIdempotencyKey({ eventId: " evt_123 " }), "evt_123");
    assert.equal(getStripeWebhookIdempotencyKey({ eventId: " " }), null);
  });

  it("builds webhook rejection audit metadata without raw payloads", () => {
    assert.deepEqual(buildProviderWebhookRejectionAudit({
      error: "PayPal webhook signature verification failed.",
      event: {
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        id: "WH-123"
      },
      provider: "paypal",
      reason: "signature_verification_failed",
      requestId: "request-1",
      statusCode: 401,
      transmissionId: "TRANS-123"
    }), {
      action: "wallet.paypal_webhook.rejected",
      entityId: "WH-123",
      entityType: "paypal_webhook",
      metadata: {
        error: "PayPal webhook signature verification failed.",
        eventId: "WH-123",
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        idempotencyKey: "WH-123",
        provider: "paypal",
        reason: "signature_verification_failed",
        requestId: "request-1",
        signatureHeaderPresent: null,
        statusCode: 401,
        transmissionId: "TRANS-123"
      }
    });
  });

  it("falls back to provider rejection ids when webhook payloads are unusable", () => {
    assert.deepEqual(buildProviderWebhookRejectionAudit({
      error: "Webhook body must be raw JSON.",
      provider: "stripe",
      reason: "invalid_raw_body",
      signatureHeaderPresent: false,
      statusCode: 400
    }), {
      action: "wallet.stripe_webhook.rejected",
      entityId: "stripe-webhook-rejected",
      entityType: "stripe_webhook",
      metadata: {
        error: "Webhook body must be raw JSON.",
        eventId: null,
        eventType: null,
        idempotencyKey: null,
        provider: "stripe",
        reason: "invalid_raw_body",
        requestId: null,
        signatureHeaderPresent: false,
        statusCode: 400,
        transmissionId: null
      }
    });
  });

  it("normalizes payment client request idempotency keys", () => {
    assert.equal(normalizePaymentClientRequestId(" wallet:abc-123 "), "wallet:abc-123");
    assert.equal(normalizePaymentClientRequestId("short"), null);
    assert.equal(normalizePaymentClientRequestId("bad key"), null);
    assert.equal(normalizePaymentClientRequestId("x".repeat(129)), null);
    assert.equal(normalizePaymentClientRequestId(null), null);
  });
});

function ledgerEntry(input: {
  amount: string;
  id: string;
  metadata: Prisma.JsonObject;
  referenceId: string;
  type: LedgerEntryType;
}) {
  return {
    amount: new Prisma.Decimal(input.amount),
    createdAt: now,
    currency: "USD",
    description: "Test entry",
    id: input.id,
    metadata: input.metadata,
    referenceId: input.referenceId,
    type: input.type
  };
}

function creatorWalletFixture(input: { datasetName?: string } = {}) {
  return {
    availableBalance: 20,
    currency: "USD",
    datasetReports: [
      {
        currency: "USD",
        datasetId: "dataset-1",
        datasetName: input.datasetName ?? "Training V1",
        heldBalance: 10,
        lastActivityAt: now.toISOString(),
        paidBalance: 7,
        reconciliationDelta: 0,
        reconciliationStatus: "balanced" as const,
        refundedBalance: 0,
        reservedBalance: 3,
        taskCount: 5
      }
    ],
    ledgerEntries: [
      {
        approvedCredits: 0,
        amount: 7,
        createdAt: now.toISOString(),
        currency: "USD",
        datasetId: "dataset-1",
        datasetName: input.datasetName ?? "Training V1",
        description: "Worker credit released",
        escrowCredits: 0,
        escrowLedgerEntryId: "hold-1",
        feeCredits: 0,
        id: "release-1",
        isTopUpRefund: false,
        originalPaymentProvider: null,
        paymentIntentId: null,
        platformFeeRate: 0,
        providerRef: null,
        referenceId: "task-1",
        refundCredits: 0,
        refundKind: null,
        reviewId: null,
        taskCount: 0,
        taskId: "task-1",
        type: LedgerEntryType.RELEASE
      }
    ],
    paidToAnnotators: 7,
    refundedBalance: 0,
    reservedBalance: 3,
    underReviewBalance: 0,
    walletCount: 1
  };
}
