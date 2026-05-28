import { Download, X } from "lucide-react";
import { Link } from "react-router-dom";

import { type CreatorWalletLedgerEntry, type WalletReceiptSummary } from "../../api";
import { formatCreatorLedgerType, formatDate, formatEnumText, formatMoney, shortId } from "./walletUtils";

type CreatorLedgerDetailModalProps = {
  downloadingReceiptId: string | null;
  entry: CreatorWalletLedgerEntry;
  onClose: () => void;
  onReceiptDownload: (receipt: WalletReceiptSummary) => void;
  receipt: WalletReceiptSummary | null;
};

export function CreatorLedgerDetailModal({
  downloadingReceiptId,
  entry,
  onClose,
  onReceiptDownload,
  receipt
}: CreatorLedgerDetailModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Wallet transaction detail"
        aria-modal="true"
        className="modal-panel wallet-ledger-modal wallet-transaction-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Transaction detail</p>
            <h2>{formatCreatorLedgerType(entry.type)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close transaction detail">
            <X size={18} />
          </button>
        </div>

        <div className="wallet-ledger-total">
          <span>Amount</span>
          <strong>{formatMoney(entry.amount, entry.currency)}</strong>
          <small>{entry.currency} - {formatDate(entry.createdAt)}</small>
        </div>

        <div className="wallet-transaction-grid">
          <DetailItem label="Type" value={formatCreatorLedgerType(entry.type)} />
          <DetailItem label="Ledger ID" value={shortId(entry.id)} monoValue={entry.id} />
          <DetailItem label="Reference" value={entry.referenceId ? shortId(entry.referenceId) : "No external reference"} monoValue={entry.referenceId} />
          <DetailItem label="Task count" value={entry.taskCount > 0 ? String(entry.taskCount) : "Not grouped"} />
          <DetailItem
            label="Dataset"
            value={entry.datasetName ?? "Creator wallet"}
            linkTo={entry.datasetId ? `/datasets/${entry.datasetId}` : undefined}
          />
          <DetailItem label="Task" value={entry.taskId ? shortId(entry.taskId) : "No task reference"} monoValue={entry.taskId} />
        </div>

        <div className="wallet-ledger-description">
          <span>What happened</span>
          <p>{getLedgerStory(entry)}</p>
        </div>

        {receipt ? (
          <div className="wallet-receipt-detail">
            <span>
              <strong>{receipt.receiptNumber}</strong>
              <small>
                {formatEnumText(receipt.type)} - {receipt.provider} - issued {formatDate(receipt.issuedAt)}
              </small>
            </span>
            <button
              className="secondary-button compact-button"
              disabled={downloadingReceiptId === receipt.id}
              onClick={() => onReceiptDownload(receipt)}
              type="button"
            >
              <Download size={15} />
              {downloadingReceiptId === receipt.id ? "Downloading" : "Download receipt"}
            </button>
          </div>
        ) : (
          <div className="wallet-ledger-description">
            <span>Receipt</span>
            <p>No receipt is attached to this ledger row yet.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function DetailItem({
  label,
  linkTo,
  monoValue,
  value
}: {
  label: string;
  linkTo?: string;
  monoValue?: string | null;
  value: string;
}) {
  return (
    <div className="wallet-transaction-detail-item">
      <span>{label}</span>
      {linkTo ? <Link to={linkTo}>{value}</Link> : <strong>{value}</strong>}
      {monoValue && monoValue !== value ? <code>{monoValue}</code> : null}
    </div>
  );
}

function getLedgerStory(entry: CreatorWalletLedgerEntry) {
  if (entry.type === "CREDIT") {
    return "Funds were added to the creator wallet after the payment provider confirmed the top-up.";
  }

  if (entry.type === "HOLD") {
    return entry.taskCount > 0
      ? `Creator funds were reserved in escrow for ${entry.taskCount} task${entry.taskCount === 1 ? "" : "s"}.`
      : "Creator funds were reserved in escrow for task work.";
  }

  if (entry.type === "RELEASE" || entry.type === "PAYOUT") {
    return "Escrow was released to approved worker earnings or payout activity.";
  }

  if (entry.type === "FEE") {
    return "The platform fee portion was collected from approved task funding.";
  }

  if (entry.type === "REFUND") {
    return "Unused task escrow was returned to the creator wallet.";
  }

  return entry.description ?? "Wallet ledger activity.";
}
