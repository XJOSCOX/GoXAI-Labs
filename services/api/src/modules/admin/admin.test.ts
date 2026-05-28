import { LedgerEntryType, PaymentIntentStatus, PayoutStatus, Prisma, WalletReceiptType } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdminPaymentReconciliation,
  buildWebhookHealth,
  getAdminPaymentIntentState,
  getPaymentRefundPlan,
  getPayoutStatusTransition,
  parsePaymentRefundBody,
  parsePayoutReviewBody
} from "./admin.js";

describe("getPayoutStatusTransition", () => {
  it("allows requested payouts to start processing or return credits", () => {
    assert.deepEqual(getPayoutStatusTransition(PayoutStatus.REQUESTED, "processing"), {
      ok: true,
      status: PayoutStatus.PROCESSING
    });
    assert.deepEqual(getPayoutStatusTransition(PayoutStatus.REQUESTED, "cancel"), {
      ok: true,
      status: PayoutStatus.CANCELLED
    });
  });

  it("only lets processing payouts finish as paid or failed", () => {
    assert.deepEqual(getPayoutStatusTransition(PayoutStatus.PROCESSING, "paid"), {
      ok: true,
      status: PayoutStatus.PAID
    });
    assert.deepEqual(getPayoutStatusTransition(PayoutStatus.PROCESSING, "fail"), {
      ok: true,
      status: PayoutStatus.FAILED
    });
    assert.equal(getPayoutStatusTransition(PayoutStatus.PROCESSING, "cancel").ok, false);
  });

  it("keeps final payout states immutable", () => {
    for (const status of [PayoutStatus.PAID, PayoutStatus.FAILED, PayoutStatus.CANCELLED]) {
      assert.equal(getPayoutStatusTransition(status, "processing").ok, false);
      assert.equal(getPayoutStatusTransition(status, "paid").ok, false);
      assert.equal(getPayoutStatusTransition(status, "cancel").ok, false);
      assert.equal(getPayoutStatusTransition(status, "fail").ok, false);
    }
  });

  it("blocks direct requested to paid or failed transitions", () => {
    assert.equal(getPayoutStatusTransition(PayoutStatus.REQUESTED, "paid").ok, false);
    assert.equal(getPayoutStatusTransition(PayoutStatus.REQUESTED, "fail").ok, false);
  });
});

describe("parsePayoutReviewBody", () => {
  it("requires a payment reference before a payout can be marked paid", () => {
    assert.deepEqual(parsePayoutReviewBody("paid", { provider: "bank" }), {
      ok: false,
      error: "Payment reference is required before marking a payout paid."
    });
  });

  it("keeps payment details and trims admin notes", () => {
    assert.deepEqual(parsePayoutReviewBody("paid", { adminNotes: " Confirmed transfer ", provider: "ACH", providerRef: " TX-1001 " }), {
      ok: true,
      value: {
        adminNotes: "Confirmed transfer",
        provider: "ACH",
        providerRef: "TX-1001"
      }
    });
  });

  it("allows cancel and failure notes without payment details", () => {
    assert.deepEqual(parsePayoutReviewBody("fail", { adminNotes: "Bank rejected the payout." }), {
      ok: true,
      value: {
        adminNotes: "Bank rejected the payout."
      }
    });
  });
});

describe("parsePaymentRefundBody", () => {
  it("requires a refund reference before recording a refund", () => {
    assert.deepEqual(parsePaymentRefundBody({ amount: 10 }), {
      ok: false,
      error: "Refund reference is required before recording a refund."
    });
  });

  it("keeps refund amount, reference, and notes", () => {
    assert.deepEqual(parsePaymentRefundBody({ adminNotes: " Customer requested refund ", amount: "12.34", providerRef: " RF-1001 " }), {
      ok: true,
      value: {
        adminNotes: "Customer requested refund",
        amountCents: 1234,
        providerRef: "RF-1001"
      }
    });
  });

  it("allows amount to be omitted for a full remaining refund", () => {
    assert.deepEqual(parsePaymentRefundBody({ providerRef: "RF-1002" }), {
      ok: true,
      value: {
        providerRef: "RF-1002"
      }
    });
  });
});

describe("getPaymentRefundPlan", () => {
  it("defaults to the remaining refundable amount", () => {
    assert.deepEqual(getPaymentRefundPlan({
      alreadyRefundedCents: 2500,
      originalAmount: "100.00",
      walletBalance: "90.00"
    }), {
      alreadyRefundedCents: 2500,
      ok: true,
      originalCents: 10000,
      refundCents: 7500,
      remainingCents: 7500
    });
  });

  it("allows partial refunds inside the remaining amount", () => {
    assert.deepEqual(getPaymentRefundPlan({
      alreadyRefundedCents: 2500,
      originalAmount: "100.00",
      requestedAmountCents: 4000,
      walletBalance: "90.00"
    }), {
      alreadyRefundedCents: 2500,
      ok: true,
      originalCents: 10000,
      refundCents: 4000,
      remainingCents: 7500
    });
  });

  it("blocks fully refunded payment intents", () => {
    assert.deepEqual(getPaymentRefundPlan({
      alreadyRefundedCents: 10000,
      originalAmount: "100.00",
      walletBalance: "100.00"
    }), {
      ok: false,
      error: "This payment intent is already fully refunded."
    });
  });

  it("blocks refunds above the remaining provider amount", () => {
    assert.deepEqual(getPaymentRefundPlan({
      alreadyRefundedCents: 2500,
      originalAmount: "100.00",
      requestedAmountCents: 7501,
      walletBalance: "100.00"
    }), {
      ok: false,
      error: "Refund amount cannot exceed the remaining refundable balance."
    });
  });

  it("blocks refunds when the creator wallet balance is too low", () => {
    assert.deepEqual(getPaymentRefundPlan({
      alreadyRefundedCents: 0,
      originalAmount: "100.00",
      requestedAmountCents: 9000,
      walletBalance: "89.99"
    }), {
      ok: false,
      error: "The creator wallet does not have enough available balance for this refund."
    });
  });
});

describe("buildAdminPaymentReconciliation", () => {
  it("balances settled payments against top-up ledger and receipt rows", () => {
    assert.deepEqual(buildAdminPaymentReconciliation(
      paymentForReconciliation({ amount: "100.00", status: PaymentIntentStatus.SUCCEEDED }),
      [
        receiptForReconciliation({ amount: "100.00", type: WalletReceiptType.TOP_UP })
      ],
      [
        ledgerForReconciliation({ amount: "100.00", type: LedgerEntryType.CREDIT })
      ]
    ), {
      expectedTopUpAmount: 100,
      issueCount: 0,
      issues: [],
      netLedgerAmount: 100,
      netReceiptAmount: 100,
      paymentAmount: 100,
      refundLedgerAmount: 0,
      refundReceiptAmount: 0,
      status: "balanced",
      topUpLedgerAmount: 100,
      topUpReceiptAmount: 100
    });
  });

  it("flags local money rows on unsettled payments", () => {
    const reconciliation = buildAdminPaymentReconciliation(
      paymentForReconciliation({ amount: "100.00", status: PaymentIntentStatus.CANCELLED }),
      [
        receiptForReconciliation({ amount: "100.00", type: WalletReceiptType.TOP_UP })
      ],
      [
        ledgerForReconciliation({ amount: "100.00", type: LedgerEntryType.CREDIT })
      ]
    );

    assert.equal(reconciliation.status, "warning");
    assert.equal(reconciliation.issueCount, 1);
    assert.deepEqual(reconciliation.issues[0], {
      code: "unsettled_local_credit",
      message: "This payment is not settled but local wallet credit or receipts exist.",
      severity: "blocked"
    });
  });

  it("flags mismatched credit, receipt, refund, and currency rows", () => {
    const reconciliation = buildAdminPaymentReconciliation(
      paymentForReconciliation({ amount: "100.00", currency: "USD", status: PaymentIntentStatus.SUCCEEDED }),
      [
        receiptForReconciliation({ amount: "99.00", currency: "USD", type: WalletReceiptType.TOP_UP }),
        receiptForReconciliation({ amount: "5.00", currency: "USD", type: WalletReceiptType.REFUND })
      ],
      [
        ledgerForReconciliation({ amount: "98.00", currency: "USD", type: LedgerEntryType.CREDIT }),
        ledgerForReconciliation({ amount: "6.00", currency: "CAD", type: LedgerEntryType.REFUND })
      ]
    );

    assert.equal(reconciliation.status, "warning");
    assert.deepEqual(reconciliation.issues.map((issue) => issue.code), [
      "currency_mismatch",
      "credit_ledger_mismatch",
      "top_up_receipt_mismatch",
      "refund_receipt_mismatch"
    ]);
  });
});

describe("getAdminPaymentIntentState", () => {
  const now = new Date("2026-05-28T12:00:00.000Z");
  const basePayment = {
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date("2026-05-28T10:00:00.000Z"),
    updatedAt: new Date("2026-05-28T10:00:00.000Z")
  };

  it("lets admins cancel open payment intents", () => {
    assert.deepEqual(getAdminPaymentIntentState({ ...basePayment, status: PaymentIntentStatus.PROCESSING }, now), {
      canCancel: true,
      isOpen: true,
      staleAgeMinutes: 0,
      staleReason: null,
      statusGroup: "open"
    });
  });

  it("flags old open payment intents as stale", () => {
    const state = getAdminPaymentIntentState(
      {
        ...basePayment,
        status: PaymentIntentStatus.PROCESSING,
        updatedAt: new Date("2026-05-27T10:00:00.000Z")
      },
      now
    );

    assert.equal(state.canCancel, true);
    assert.equal(state.isOpen, true);
    assert.equal(state.staleAgeMinutes, 1560);
    assert.equal(state.statusGroup, "stale");
    assert.match(state.staleReason ?? "", /Open for 26h/);
  });

  it("keeps settled and closed payment intents immutable", () => {
    assert.equal(getAdminPaymentIntentState({ ...basePayment, status: PaymentIntentStatus.SUCCEEDED }, now).canCancel, false);
    assert.equal(getAdminPaymentIntentState({ ...basePayment, status: PaymentIntentStatus.SUCCEEDED }, now).statusGroup, "settled");
    assert.equal(getAdminPaymentIntentState({ ...basePayment, status: PaymentIntentStatus.CANCELLED }, now).canCancel, false);
    assert.equal(getAdminPaymentIntentState({ ...basePayment, status: PaymentIntentStatus.CANCELLED }, now).statusGroup, "closed");
  });
});

describe("buildWebhookHealth", () => {
  it("summarizes provider webhook retries and trace metadata", () => {
    const health = buildWebhookHealth(
      [
        webhookEvent({
          duplicateCount: 2,
          eventId: "WH-1",
          eventType: "PAYMENT.CAPTURE.COMPLETED",
          metadata: {
            idempotencyKey: "WH-1",
            paymentIntentId: "payment-1",
            providerRef: "paypal-order-1",
            transmissionId: "transmission-1"
          },
          provider: "paypal",
          receivedAt: new Date("2026-05-28T11:55:00.000Z")
        }),
        webhookEvent({
          eventId: "evt_1",
          eventType: "checkout.session.completed",
          metadata: {
            idempotencyKey: "evt_1"
          },
          provider: "stripe",
          receivedAt: new Date("2026-05-28T11:30:00.000Z")
        })
      ],
      {
        paypal: 1,
        stripe: 1
      },
      new Date("2026-05-28T12:00:00.000Z")
    );

    assert.equal(health[0].provider, "paypal");
    assert.equal(health[0].status, "retrying");
    assert.equal(health[0].duplicateCount, 2);
    assert.equal(health[0].lastEventAgeMinutes, 5);
    assert.deepEqual(health[0].recentEvents[0], {
      action: "wallet.paypal_webhook.received",
      duplicateCount: 2,
      eventId: "WH-1",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
      id: "webhook-WH-1",
      idempotencyKey: "WH-1",
      lastDuplicateAt: null,
      paymentIntentId: "payment-1",
      providerRef: "paypal-order-1",
      receivedAt: new Date("2026-05-28T11:55:00.000Z"),
      transmissionId: "transmission-1",
      updatedAt: new Date("2026-05-28T11:55:00.000Z")
    });
    assert.equal(health[1].provider, "stripe");
    assert.equal(health[1].status, "receiving");
  });

  it("marks providers quiet when no webhook events were received", () => {
    const health = buildWebhookHealth([], { paypal: 0, stripe: 0 }, new Date("2026-05-28T12:00:00.000Z"));

    assert.equal(health[0].status, "quiet");
    assert.equal(health[0].statusLabel, "No events");
    assert.equal(health[0].lastEventAgeMinutes, null);
    assert.equal(health[0].recentEvents.length, 0);
  });
});

function webhookEvent(input: {
  duplicateCount?: number;
  eventId: string;
  eventType: string;
  metadata?: Prisma.JsonObject;
  provider: "paypal" | "stripe";
  receivedAt: Date;
}) {
  return {
    action: `wallet.${input.provider}_webhook.received`,
    duplicateCount: input.duplicateCount ?? 0,
    eventId: input.eventId,
    eventType: input.eventType,
    id: `webhook-${input.eventId}`,
    lastDuplicateAt: null,
    metadata: input.metadata ?? null,
    provider: input.provider,
    receivedAt: input.receivedAt,
    updatedAt: input.receivedAt
  };
}

function paymentForReconciliation(input: {
  amount: string;
  currency?: string;
  status: PaymentIntentStatus;
}) {
  return {
    amount: new Prisma.Decimal(input.amount),
    currency: input.currency ?? "USD",
    status: input.status
  };
}

function receiptForReconciliation(input: {
  amount: string;
  currency?: string;
  type: WalletReceiptType;
}) {
  return {
    amount: new Prisma.Decimal(input.amount),
    currency: input.currency ?? "USD",
    type: input.type
  };
}

function ledgerForReconciliation(input: {
  amount: string;
  currency?: string;
  type: LedgerEntryType;
}) {
  return {
    amount: new Prisma.Decimal(input.amount),
    currency: input.currency ?? "USD",
    type: input.type
  };
}
