import { Download, Search, WalletCards, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  type CreatorLedgerFilter,
  type CreatorWalletExportFormat,
  type WalletReceiptSummary
} from "../../api";
import { CreatorLedgerDetailModal } from "./CreatorLedgerDetailModal";
import {
  type CreatorWalletLedger,
  type WalletQueryUpdate,
  formatCreatorLedgerType,
  formatDate,
  formatMoney,
  shortId,
  walletLedgerFilters
} from "./walletUtils";

type CreatorLedgerPanelProps = {
  downloadingReceiptId: string | null;
  exporting: CreatorWalletExportFormat | null;
  filter: CreatorLedgerFilter;
  ledger: CreatorWalletLedger | null;
  loading: boolean;
  onExport: (format: CreatorWalletExportFormat) => void;
  onQueryChange: (next: WalletQueryUpdate) => void;
  onReceiptDownload: (receipt: WalletReceiptSummary) => void;
  receipts: WalletReceiptSummary[];
  search: string;
};

export function CreatorLedgerPanel({
  downloadingReceiptId,
  exporting,
  filter,
  ledger,
  loading,
  onExport,
  onQueryChange,
  onReceiptDownload,
  receipts,
  search
}: CreatorLedgerPanelProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const selectedEntry = useMemo(
    () => ledger?.entries.find((entry) => entry.id === selectedEntryId) ?? null,
    [ledger?.entries, selectedEntryId]
  );
  const selectedReceipt = selectedEntry ? findReceiptForEntry(selectedEntry, receipts) : null;

  return (
    <section className="panel wallet-ledger-panel">
      <div className="section-actions">
        <div>
          <p className="eyebrow">Creator wallet</p>
          <h2>Transaction ledger</h2>
        </div>
        <div className="wallet-export-actions">
          <button className="secondary-button compact-button" disabled={exporting !== null} onClick={() => onExport("json")} type="button">
            <Download size={15} />
            {exporting === "json" ? "Exporting" : "JSON"}
          </button>
          <button className="secondary-button compact-button" disabled={exporting !== null} onClick={() => onExport("csv")} type="button">
            <Download size={15} />
            {exporting === "csv" ? "Exporting" : "CSV"}
          </button>
        </div>
      </div>

      <div className="wallet-ledger-toolbar">
        <label className="search-field compact-search-field">
          <Search size={15} />
          <input
            aria-label="Search creator ledger"
            onChange={(event) => onQueryChange({ search: event.currentTarget.value })}
            placeholder="Search dataset, task, reference, description"
            value={search}
          />
        </label>
        {search ? (
          <button className="secondary-button compact-button" onClick={() => onQueryChange({ search: "" })} type="button">
            <X size={15} />
            Clear
          </button>
        ) : null}
      </div>

      <div className="wallet-ledger-filter large" aria-label="Filter creator wallet ledger">
        {walletLedgerFilters.map((option) => (
          <button
            className={option.value === filter ? "active" : ""}
            disabled={(ledger?.filterCounts[option.value] ?? 0) === 0 && option.value !== "all"}
            key={option.value}
            onClick={() => onQueryChange({ filter: option.value })}
            type="button"
          >
            {option.label}
            <span>{ledger?.filterCounts[option.value] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="wallet-ledger-table">
        <div className="wallet-ledger-row wallet-ledger-head">
          <span>Type</span>
          <span>Context</span>
          <span>Date</span>
          <span>Amount</span>
          <span>Action</span>
        </div>
        {loading ? (
          <div className="empty-state">
            <WalletCards size={28} />
            <strong>Loading ledger</strong>
            <span>Checking creator wallet transactions.</span>
          </div>
        ) : ledger && ledger.entries.length > 0 ? (
          ledger.entries.map((entry) => (
            <article
              className="wallet-ledger-row interactive"
              key={entry.id}
              onClick={() => setSelectedEntryId(entry.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedEntryId(entry.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span>
                <strong>{formatCreatorLedgerType(entry.type)}</strong>
                <small>{shortId(entry.id)}</small>
              </span>
              <span>
                {entry.datasetId ? (
                  <Link onClick={(event) => event.stopPropagation()} to={`/datasets/${entry.datasetId}`}>{entry.datasetName ?? "Open dataset"}</Link>
                ) : (
                  <strong>{entry.datasetName ?? "Creator wallet"}</strong>
                )}
                <small>{entry.taskId ? `Task ${shortId(entry.taskId)}` : entry.description ?? "No task reference"}</small>
              </span>
              <time>{formatDate(entry.createdAt)}</time>
              <em>{formatMoney(entry.amount, entry.currency)}</em>
              <button
                className="ghost-button compact-button wallet-row-detail-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedEntryId(entry.id);
                }}
                type="button"
              >
                Details
              </button>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <WalletCards size={28} />
            <strong>No wallet activity found</strong>
            <span>Try another filter or search term.</span>
          </div>
        )}
      </div>

      {ledger && ledger.totalPages > 1 ? (
        <div className="pagination-bar">
          <span>
            Showing {ledger.entries.length} of {ledger.total} - page {ledger.page} of {ledger.totalPages}
          </span>
          <div>
            <button
              className="secondary-button compact-button"
              disabled={ledger.page === 1}
              onClick={() => onQueryChange({ page: Math.max(1, ledger.page - 1) })}
              type="button"
            >
              Previous
            </button>
            <button
              className="secondary-button compact-button"
              disabled={ledger.page >= ledger.totalPages}
              onClick={() => onQueryChange({ page: Math.min(ledger.totalPages, ledger.page + 1) })}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {selectedEntry ? (
        <CreatorLedgerDetailModal
          downloadingReceiptId={downloadingReceiptId}
          entry={selectedEntry}
          onClose={() => setSelectedEntryId(null)}
          onReceiptDownload={onReceiptDownload}
          receipt={selectedReceipt}
        />
      ) : null}
    </section>
  );
}

function findReceiptForEntry(entry: CreatorWalletLedger["entries"][number], receipts: WalletReceiptSummary[]) {
  const directMatch = receipts.find((receipt) => (
    receipt.providerRef && (receipt.providerRef === entry.referenceId || receipt.providerRef === entry.id)
  ));

  if (directMatch) {
    return directMatch;
  }

  if (entry.type !== "CREDIT" && entry.type !== "FEE" && entry.type !== "PAYOUT") {
    return null;
  }

  const entryTime = new Date(entry.createdAt).getTime();
  const entryAmount = Math.abs(entry.amount);

  return receipts.find((receipt) => {
    const receiptTime = new Date(receipt.issuedAt).getTime();

    return receipt.currency === entry.currency
      && Math.abs(receipt.amount - entryAmount) < 0.01
      && Math.abs(receiptTime - entryTime) <= 5 * 60 * 1000;
  }) ?? null;
}
