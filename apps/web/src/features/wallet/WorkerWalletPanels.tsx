import { CircleDollarSign, Send } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { type WalletReceiptSummary, type WorkerWalletSummary } from "../../api";
import { WalletReceiptsPanel } from "./WalletReceiptsPanel";
import { WorkerCreditDetailModal } from "./WorkerCreditDetailModal";
import { formatDate, formatEnumText, formatMoney, shortId } from "./walletUtils";

type WorkerWalletPanelsProps = {
  downloadingReceiptId: string | null;
  loading: boolean;
  onReceiptDownload: (receipt: WalletReceiptSummary) => void;
  onWithdrawal: () => void;
  receipts: WalletReceiptSummary[];
  receiptsLoading: boolean;
  wallet: WorkerWalletSummary;
  walletSwitcher: ReactNode;
  withdrawing: boolean;
};

export function WorkerWalletPanels({
  downloadingReceiptId,
  loading,
  onReceiptDownload,
  onWithdrawal,
  receipts,
  receiptsLoading,
  wallet,
  walletSwitcher,
  withdrawing
}: WorkerWalletPanelsProps) {
  const canWithdraw = wallet.availableBalance > 0 && wallet.availableCreditCount > 0;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const selectedEvent = useMemo(
    () => wallet.recentEvents.find((event) => event.id === selectedEventId) ?? null,
    [selectedEventId, wallet.recentEvents]
  );

  return (
    <section className="wallet-layout worker-wallet-layout">
      <aside className="wallet-side-column">
        {walletSwitcher}
        <article className="wallet-balance-card">
          <div className="wallet-balance-head">
            <span className="wallet-balance-icon">
              <CircleDollarSign size={18} />
            </span>
            <span>Available balance</span>
          </div>
          <div className="wallet-balance-total">
            <strong>{formatMoney(wallet.availableBalance, wallet.currency)}</strong>
            <small>{wallet.availableCreditCount} approved credit{wallet.availableCreditCount === 1 ? "" : "s"} ready</small>
          </div>
          <button
            className="primary-button compact-button"
            disabled={withdrawing || loading || !canWithdraw}
            onClick={onWithdrawal}
            type="button"
          >
            <Send size={15} />
            {withdrawing ? "Requesting" : "Request withdrawal"}
          </button>
          <small className="wallet-payment-note">
            Withdrawal requests move all available credits into a pending payout for admin processing.
          </small>
        </article>
        <dl className="wallet-metric-strip">
          <div>
            <dt>Under review</dt>
            <dd>{formatMoney(wallet.underReviewBalance, wallet.currency)}</dd>
          </div>
          <div>
            <dt>Approved</dt>
            <dd>{formatMoney(wallet.approvedBalance, wallet.currency)}</dd>
          </div>
          <div>
            <dt>Total earned</dt>
            <dd>{formatMoney(wallet.totalEarnedBalance, wallet.currency)}</dd>
          </div>
          <div>
            <dt>Paid out</dt>
            <dd>{formatMoney(wallet.paidWithdrawalBalance, wallet.currency)}</dd>
          </div>
        </dl>
      </aside>

      <section className="panel wallet-ledger-panel">
        <div>
          <p className="eyebrow">Worker earnings</p>
          <h2>Credited tasks</h2>
          <p className="muted-copy">Credits are only paid when approved. Approved credits become available after {wallet.holdDays} days.</p>
        </div>
        <div className="wallet-ledger-table">
          <div className="wallet-ledger-row wallet-ledger-head worker">
            <span>Task</span>
            <span>Trace</span>
            <span>Status</span>
            <span>Amount</span>
            <span>Action</span>
          </div>
          {loading ? (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>Loading earnings</strong>
              <span>Checking approved work and payout state.</span>
            </div>
          ) : wallet.recentEvents.length > 0 ? (
            wallet.recentEvents.map((event) => (
              <article
                className="wallet-ledger-row worker interactive"
                key={event.id}
                onClick={() => setSelectedEventId(event.id)}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                    keyEvent.preventDefault();
                    setSelectedEventId(event.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span>
                  <strong>{event.assetName ?? event.datasetName ?? "Task credit"}</strong>
                  <small>{event.taskId ? `Task ${shortId(event.taskId)}` : shortId(event.id)}</small>
                </span>
                <span>
                  <strong>{event.projectName ?? "Project"}</strong>
                  <small>{event.datasetName ?? "Dataset"} - {formatEnumText(event.eventType)} - {event.credits} credits</small>
                </span>
                <span>
                  <strong>{formatEnumText(event.status)}</strong>
                  <small>{formatDate(event.approvedAt ?? event.availableAt ?? event.createdAt)}</small>
                </span>
                <em>{formatMoney(event.amount, event.currency)}</em>
                <button
                  className="ghost-button compact-button wallet-row-detail-button"
                  onClick={(mouseEvent) => {
                    mouseEvent.stopPropagation();
                    setSelectedEventId(event.id);
                  }}
                  type="button"
                >
                  Details
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <CircleDollarSign size={28} />
              <strong>No earnings yet</strong>
              <span>Approved annotation and review work will appear here.</span>
            </div>
          )}
        </div>
      </section>

      <aside className="wallet-support-grid worker-wallet-support">
        <section className="panel wallet-payments-panel">
          <div className="wallet-panel-head">
            <span>
              <p className="eyebrow">Payouts</p>
              <h2>Payout readiness</h2>
            </span>
            <strong>{wallet.pendingWithdrawalCount}</strong>
          </div>
          <div className="wallet-readiness-list">
            <ReadinessRow
              label="Ready now"
              value={formatMoney(wallet.availableBalance, wallet.currency)}
              detail={`${wallet.availableCreditCount} credit${wallet.availableCreditCount === 1 ? "" : "s"} can be requested`}
            />
            <ReadinessRow
              label="Cooling down"
              value={formatMoney(wallet.approvedBalance, wallet.currency)}
              detail={wallet.nextAvailableAt ? `Next release ${formatDate(wallet.nextAvailableAt)}` : `${wallet.approvedCreditCount} approved credit${wallet.approvedCreditCount === 1 ? "" : "s"}`}
            />
            <ReadinessRow
              label="Pending payout"
              value={formatMoney(wallet.pendingWithdrawalBalance, wallet.currency)}
              detail={`${wallet.pendingWithdrawalCount} active request${wallet.pendingWithdrawalCount === 1 ? "" : "s"}`}
            />
            <ReadinessRow
              label="Under review"
              value={formatMoney(wallet.underReviewBalance, wallet.currency)}
              detail={`${wallet.underReviewCreditCount} credit${wallet.underReviewCreditCount === 1 ? "" : "s"} waiting for approval`}
            />
          </div>
        </section>

        <section className="panel wallet-escrow-panel">
          <div className="wallet-panel-head">
            <span>
              <p className="eyebrow">History</p>
              <h2>Withdrawal history</h2>
            </span>
            <strong>{wallet.payouts.length}</strong>
          </div>
          <div className="wallet-report-list">
            {wallet.payouts.length > 0 ? wallet.payouts.map((payout) => (
              <div className="wallet-report-row" key={payout.id}>
                <span>
                  <strong>{formatEnumText(payout.status)}</strong>
                  <small>Requested {formatDate(payout.createdAt)}</small>
                  <small>Updated {formatDate(payout.updatedAt)}</small>
                </span>
                <em>{formatMoney(payout.amount, payout.currency)}</em>
              </div>
            )) : (
              <p className="muted-copy">No withdrawal requests yet.</p>
            )}
          </div>
        </section>

        <WalletReceiptsPanel
          downloadingReceiptId={downloadingReceiptId}
          loading={receiptsLoading}
          onDownload={onReceiptDownload}
          receipts={receipts}
        />
      </aside>

      {selectedEvent ? (
        <WorkerCreditDetailModal event={selectedEvent} onClose={() => setSelectedEventId(null)} />
      ) : null}
    </section>
  );
}

function ReadinessRow({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="wallet-readiness-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <em>{value}</em>
    </div>
  );
}
