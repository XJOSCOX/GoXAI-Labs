import { PayoutStatus } from "@goxai/database";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPayoutStatusTransition, parsePayoutReviewBody } from "./admin.js";

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
