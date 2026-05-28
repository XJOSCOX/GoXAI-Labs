import { Building2, CreditCard, Landmark, WalletCards } from "lucide-react";
import { type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { type CreatorWalletFundingSourceSummary, type CreatorWalletPaymentIntentSummary, type WalletReceiptSummary } from "../../api";
import { WalletReceiptsPanel } from "./WalletReceiptsPanel";
import { type CreatorWalletSnapshot, formatMoney } from "./walletUtils";

export type CreatorTopUpProvider = "paypal" | "stripe" | "ach";

type CreatorWalletSummaryPanelProps = {
  fundingSources: CreatorWalletFundingSourceSummary[];
  linkingBank: boolean;
  onBankLink: () => void;
  onDisableFundingSource: (sourceId: string) => void;
  onFundingSourceChange: (sourceId: string) => void;
  onProviderChange: (provider: CreatorTopUpProvider) => void;
  onTopUp: (event: FormEvent<HTMLFormElement>) => void;
  onTopUpAmountChange: (value: string) => void;
  provider: CreatorTopUpProvider;
  providerAvailability: {
    paypalEnabled: boolean;
    plaidEnabled: boolean;
    stripeEnabled: boolean;
  };
  sessionAvailable: boolean;
  selectedFundingSourceId: string;
  topUpAmount: string;
  toppingUp: boolean;
  wallet?: CreatorWalletSnapshot;
  walletSwitcher: ReactNode;
};

export function CreatorWalletSummaryPanel({
  fundingSources,
  linkingBank,
  onBankLink,
  onDisableFundingSource,
  onFundingSourceChange,
  onProviderChange,
  onTopUp,
  onTopUpAmountChange,
  provider,
  providerAvailability,
  sessionAvailable,
  selectedFundingSourceId,
  topUpAmount,
  toppingUp,
  wallet,
  walletSwitcher
}: CreatorWalletSummaryPanelProps) {
  const currency = wallet?.currency ?? "USD";
  const activeFundingSources = fundingSources.filter((source) => source.status === "ACTIVE" && source.processor === "stripe");
  const achEnabled = providerAvailability.stripeEnabled && activeFundingSources.length > 0;
  const submitDisabled = toppingUp || !sessionAvailable || (provider === "ach" && !selectedFundingSourceId);

  return (
    <aside className="wallet-side-column">
      {walletSwitcher}
      <article className="wallet-balance-card">
        <div className="wallet-balance-head">
          <span className="wallet-balance-icon">
            <WalletCards size={18} />
          </span>
          <span>Creator balance</span>
        </div>
        <div className="wallet-balance-total">
          <strong>{formatMoney(wallet?.availableBalance ?? 0, currency)}</strong>
          <small className="wallet-reserved-amount">{formatMoney(wallet?.reservedBalance ?? 0, currency)} reserved</small>
        </div>
        <form className="wallet-top-up-form" onSubmit={onTopUp}>
          <div className="wallet-provider-toggle" role="group" aria-label="Payment provider">
            <button
              className={provider === "paypal" ? "active" : ""}
              disabled={!providerAvailability.paypalEnabled}
              onClick={() => onProviderChange("paypal")}
              type="button"
            >
              PayPal
            </button>
            <button
              className={provider === "stripe" ? "active" : ""}
              disabled={!providerAvailability.stripeEnabled}
              onClick={() => onProviderChange("stripe")}
              type="button"
            >
              Stripe
            </button>
            <button
              className={provider === "ach" ? "active" : ""}
              disabled={!achEnabled}
              onClick={() => onProviderChange("ach")}
              type="button"
            >
              ACH
            </button>
          </div>
          {provider === "ach" ? (
            <label>
              Bank account
              <select onChange={(event) => onFundingSourceChange(event.currentTarget.value)} value={selectedFundingSourceId}>
                <option value="">Choose linked bank</option>
                {activeFundingSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {formatFundingSourceName(source)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Add funds
            <input
              min="0.01"
              onChange={(event) => onTopUpAmountChange(event.currentTarget.value)}
              placeholder="0.00"
              step="0.01"
              type="number"
              value={topUpAmount}
            />
          </label>
          <button className="primary-button compact-button" disabled={submitDisabled} type="submit">
            {provider === "ach" ? <Landmark size={15} /> : <CreditCard size={15} />}
            {toppingUp ? `Opening ${formatPaymentProvider(provider)}` : `Pay with ${formatPaymentProvider(provider)}`}
          </button>
        </form>
        <button className="secondary-button compact-button wallet-bank-link-button" disabled={linkingBank || !sessionAvailable || !providerAvailability.plaidEnabled} onClick={onBankLink} type="button">
          <Building2 size={15} />
          {linkingBank ? "Opening bank link" : "Link bank with Plaid"}
        </button>
        <small className="wallet-payment-note">
          Funds are credited after the payment provider confirms the payment in {currency}. Plaid links a bank account for ACH readiness; it does not move funds by itself.
        </small>
      </article>
      <dl className="wallet-metric-strip">
        <div>
          <dt>Under review</dt>
          <dd>{formatMoney(wallet?.underReviewBalance ?? 0, currency)}</dd>
        </div>
        <div>
          <dt>Paid to workers</dt>
          <dd>{formatMoney(wallet?.paidToAnnotators ?? 0, currency)}</dd>
        </div>
        <div>
          <dt>Refunded</dt>
          <dd>{formatMoney(wallet?.refundedBalance ?? 0, currency)}</dd>
        </div>
        <div>
          <dt>Wallets</dt>
          <dd>{wallet?.walletCount ?? 0}</dd>
        </div>
      </dl>

      <section className="panel wallet-payments-panel">
        <div className="wallet-panel-head">
          <span>
            <p className="eyebrow">Funding</p>
            <h2>Linked bank accounts</h2>
          </span>
          <strong>{fundingSources.length}</strong>
        </div>
        <div className="wallet-payment-list compact">
          {providerAvailability.plaidEnabled ? fundingSources.length > 0 ? (
            fundingSources.map((source) => (
              <div className="wallet-payment-row" key={source.id}>
                <span>
                  <strong>{source.institutionName ?? source.accountName ?? "Linked bank"}</strong>
                  <small>
                    {source.accountMask ? `Ending ${source.accountMask}` : "Bank account"} - {formatPaymentProvider(source.processor ?? source.provider)}
                  </small>
                </span>
                <span className="wallet-payment-actions">
                  <span className={`status-pill compact ${source.status === "ACTIVE" ? "ready" : ""}`}>{formatPaymentStatus(source.status)}</span>
                  {source.status === "ACTIVE" ? (
                    <button className="ghost-button compact-button" onClick={() => onDisableFundingSource(source.id)} type="button">
                      Disable
                    </button>
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <p className="muted-copy">No bank accounts linked yet.</p>
          ) : (
            <p className="muted-copy">Plaid bank linking is disabled.</p>
          )}
        </div>
      </section>
    </aside>
  );
}

type CreatorWalletSupportPanelsProps = {
  downloadingReceiptId: string | null;
  onReceiptDownload: (receipt: WalletReceiptSummary) => void;
  paymentIntents: CreatorWalletPaymentIntentSummary[];
  paymentsLoading: boolean;
  receipts: WalletReceiptSummary[];
  receiptsLoading: boolean;
  wallet?: CreatorWalletSnapshot;
};

export function CreatorWalletSupportPanels({
  downloadingReceiptId,
  onReceiptDownload,
  paymentIntents,
  paymentsLoading,
  receipts,
  receiptsLoading,
  wallet
}: CreatorWalletSupportPanelsProps) {
  const recentTopUps = paymentIntents.slice(0, 4);
  const hiddenTopUps = Math.max(paymentIntents.length - recentTopUps.length, 0);

  return (
    <section className="wallet-support-grid">
      <section className="panel wallet-escrow-panel">
        <div className="wallet-panel-head">
          <span>
            <p className="eyebrow">Escrow</p>
            <h2>Dataset funding</h2>
          </span>
          <strong>{wallet?.datasetReports.length ?? 0}</strong>
        </div>
        <div className="wallet-report-list">
          {wallet?.datasetReports.length ? wallet.datasetReports.map((report) => (
            <div className="wallet-report-row" key={report.datasetId ?? report.datasetName}>
              <span>
                {report.datasetId ? <Link to={`/datasets/${report.datasetId}`}>{report.datasetName}</Link> : <strong>{report.datasetName}</strong>}
                <small>
                  {report.taskCount} tasks - held {formatMoney(report.heldBalance, report.currency)} - refunded{" "}
                  {formatMoney(report.refundedBalance, report.currency)}
                </small>
                <small className={`wallet-reconciliation ${report.reconciliationStatus}`}>
                  Reconciliation: {report.reconciliationStatus === "balanced" ? "Balanced" : `Review ${formatMoney(report.reconciliationDelta, report.currency)}`}
                </small>
              </span>
            </div>
          )) : (
            <p className="muted-copy">No dataset escrow activity yet.</p>
          )}
        </div>
      </section>

      <section className="panel wallet-payments-panel wallet-topups-panel">
        <div className="wallet-panel-head">
          <span>
            <p className="eyebrow">Payments</p>
            <h2>Recent top-ups</h2>
          </span>
          <strong>{paymentIntents.length}</strong>
        </div>
        <div className="wallet-payment-list">
          {paymentsLoading ? (
            <p className="muted-copy">Checking recent top-up activity.</p>
          ) : recentTopUps.length > 0 ? (
            recentTopUps.map((payment) => (
              <div className="wallet-payment-row" key={payment.id}>
                <span>
                  <strong>{formatMoney(payment.amount, payment.currency)}</strong>
                  <small>{formatPaymentProvider(payment.provider)} - {formatPaymentDate(payment.createdAt)}</small>
                </span>
                <span className={`status-pill compact ${getPaymentStatusClass(payment.status)}`}>{formatPaymentStatus(payment.status)}</span>
              </div>
            ))
          ) : (
            <p className="muted-copy">No top-ups yet.</p>
          )}
          {hiddenTopUps > 0 ? <small className="wallet-panel-footnote">{hiddenTopUps} more in the ledger</small> : null}
        </div>
      </section>

      <WalletReceiptsPanel
        downloadingReceiptId={downloadingReceiptId}
        loading={receiptsLoading}
        onDownload={onReceiptDownload}
        receipts={receipts}
      />
    </section>
  );
}

function formatPaymentProvider(provider: string) {
  return provider === "paypal" ? "PayPal" : provider === "ach" ? "ACH" : provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatFundingSourceName(source: CreatorWalletFundingSourceSummary) {
  const bank = source.institutionName ?? source.accountName ?? "Linked bank";
  const mask = source.accountMask ? ` ending ${source.accountMask}` : "";

  return `${bank}${mask}`;
}

function formatPaymentStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPaymentStatusClass(status: string) {
  if (status === "SUCCEEDED") {
    return "ready";
  }

  if (status === "FAILED" || status === "CANCELLED") {
    return "warning";
  }

  return "";
}

function formatPaymentDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
