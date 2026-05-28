import { Download, ReceiptText } from "lucide-react";

import { type WalletReceiptSummary } from "../../api";
import { formatDate, formatEnumText, formatMoney } from "./walletUtils";

type WalletReceiptsPanelProps = {
  downloadingReceiptId: string | null;
  loading: boolean;
  onDownload: (receipt: WalletReceiptSummary) => void;
  receipts: WalletReceiptSummary[];
  title?: string;
};

export function WalletReceiptsPanel({
  downloadingReceiptId,
  loading,
  onDownload,
  receipts,
  title = "Receipts"
}: WalletReceiptsPanelProps) {
  const visibleReceipts = receipts.slice(0, 6);
  const hiddenCount = Math.max(receipts.length - visibleReceipts.length, 0);

  return (
    <section className="panel wallet-payments-panel wallet-receipts-panel">
      <div className="wallet-panel-head">
        <span>
          <p className="eyebrow">Records</p>
          <h2>{title}</h2>
        </span>
        <strong>{receipts.length}</strong>
      </div>
      <div className="wallet-receipt-list">
        {loading ? (
          <p className="muted-copy">Loading receipts.</p>
        ) : visibleReceipts.length > 0 ? (
          visibleReceipts.map((receipt) => (
            <article className="wallet-receipt-row" key={receipt.id}>
              <span className="wallet-receipt-icon">
                <ReceiptText size={16} />
              </span>
              <span className="wallet-receipt-copy">
                <strong>{receipt.receiptNumber}</strong>
                <small>
                  {formatEnumText(receipt.type)} - {formatPaymentProvider(receipt.provider)} - {formatDate(receipt.issuedAt)}
                </small>
              </span>
              <em>{formatMoney(receipt.amount, receipt.currency)}</em>
              <button
                className="ghost-button compact-button wallet-receipt-download"
                disabled={downloadingReceiptId === receipt.id}
                onClick={() => onDownload(receipt)}
                type="button"
              >
                <Download size={14} />
                {downloadingReceiptId === receipt.id ? "Downloading" : "PDF"}
              </button>
            </article>
          ))
        ) : (
          <p className="muted-copy">Receipts will appear after completed top-ups, payouts, or platform fee entries.</p>
        )}
        {hiddenCount > 0 ? <small className="wallet-panel-footnote">{hiddenCount} more receipt{hiddenCount === 1 ? "" : "s"} in history</small> : null}
      </div>
    </section>
  );
}

function formatPaymentProvider(provider: string) {
  if (provider === "paypal") {
    return "PayPal";
  }

  if (provider === "stripe") {
    return "Stripe";
  }

  if (provider === "manual") {
    return "Manual";
  }

  return formatEnumText(provider);
}
