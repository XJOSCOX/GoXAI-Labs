import { X } from "lucide-react";
import { Link } from "react-router-dom";

import { type WorkerCreditEventSummary } from "../../api";
import { formatDate, formatEnumText, formatMoney, shortId } from "./walletUtils";

type WorkerCreditDetailModalProps = {
  event: WorkerCreditEventSummary;
  onClose: () => void;
};

export function WorkerCreditDetailModal({ event, onClose }: WorkerCreditDetailModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label="Worker credit detail"
        aria-modal="true"
        className="modal-panel wallet-ledger-modal wallet-transaction-modal"
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Earning detail</p>
            <h2>{event.assetName ?? event.datasetName ?? "Task credit"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close earning detail">
            <X size={18} />
          </button>
        </div>

        <div className="wallet-ledger-total">
          <span>Credit amount</span>
          <strong>{formatMoney(event.amount, event.currency)}</strong>
          <small>{event.credits} credits - {formatEnumText(event.status)}</small>
        </div>

        <div className="wallet-transaction-grid">
          <DetailItem
            label="Task"
            value={event.taskId ? shortId(event.taskId) : "No task reference"}
            linkTo={event.taskId ? `/tasks/${event.taskId}` : undefined}
            monoValue={event.taskId}
          />
          <DetailItem label="Project" value={event.projectName ?? "Project"} />
          <DetailItem label="Dataset" value={event.datasetName ?? "Dataset"} />
          <DetailItem label="Event" value={formatEnumText(event.eventType)} />
          <DetailItem label="Review" value={event.reviewId ? shortId(event.reviewId) : "No review reference"} monoValue={event.reviewId} />
          <DetailItem label="Annotation" value={event.annotationId ? shortId(event.annotationId) : "No annotation reference"} monoValue={event.annotationId} />
          <DetailItem label="Reference key" value={shortId(event.referenceKey)} monoValue={event.referenceKey} />
          <DetailItem label="Created" value={formatDate(event.createdAt)} />
          <DetailItem label="Approved" value={event.approvedAt ? formatDate(event.approvedAt) : "Waiting"} />
          <DetailItem label="Available" value={event.availableAt ? formatDate(event.availableAt) : "Waiting"} />
          <DetailItem label="Withdrawn" value={event.withdrawnAt ? formatDate(event.withdrawnAt) : "Not withdrawn"} />
        </div>

        <div className="wallet-ledger-description">
          <span>What happened</span>
          <p>{getCreditStory(event)}</p>
        </div>
      </section>
    </div>
  );
}

function DetailItem({ label, linkTo, monoValue, value }: { label: string; linkTo?: string; monoValue?: string | null; value: string }) {
  return (
    <div className="wallet-transaction-detail-item">
      <span>{label}</span>
      {linkTo ? <Link to={linkTo}>{value}</Link> : <strong>{value}</strong>}
      {monoValue && monoValue !== value ? <code>{monoValue}</code> : null}
    </div>
  );
}

function getCreditStory(event: WorkerCreditEventSummary) {
  if (event.eventType === "ANNOTATION_APPROVED") {
    return event.reviewId
      ? "This annotation credit was approved by review and can be traced back to the task approval."
      : "This annotation credit was approved after task review.";
  }

  if (event.eventType === "REVIEW_COMPLETED") {
    return "This review credit was created when the reviewer completed the task approval.";
  }

  if (event.status === "AVAILABLE") {
    return "This approved credit has finished its hold period and can be included in a withdrawal request.";
  }

  if (event.status === "APPROVED") {
    return event.availableAt
      ? `This credit is approved and becomes available on ${formatDate(event.availableAt)}.`
      : "This credit is approved and waiting for its availability window.";
  }

  if (event.status === "WITHDRAWN") {
    return "This credit has already been moved into a worker payout request.";
  }

  return "This credit is still tied to task review or payout processing.";
}
