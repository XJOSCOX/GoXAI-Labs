import type { AnnotationSummary, ReviewSummary } from "../../../api";
import { formatEnum } from "../../../utils/format";
import { formatTaskCredits } from "../payment/payment";

export interface TaskHistoryItem {
  body: string;
  id: string;
  meta: string;
  timestamp: string;
  title: string;
}

export interface AnnotationVersionDiff {
  currentStatus: string;
  currentVersion: number;
  previousVersion: number;
  regionDelta: number;
  responseDelta: number;
}

export function buildTaskHistoryItems(annotationHistory: AnnotationSummary[], reviews: ReviewSummary[]): TaskHistoryItem[] {
  const annotationItems = annotationHistory.map((item) => ({
    body: `${formatEnum(item.status)} by ${item.user.name}`,
    id: `annotation-${item.id}`,
    meta: item.submittedAt ? "Submitted annotation" : "Draft saved",
    timestamp: item.updatedAt,
    title: `Annotation v${item.version}`
  }));
  const reviewItems = reviews.map((review) => {
    const settlement = getReviewPaymentSettlement(review);

    return {
      body: settlement
        ? `${review.feedback?.trim() || `Reviewed by ${review.reviewer.name}`} - Worker ${formatTaskCredits(settlement.approvedCredits, settlement.currency)}, platform ${formatTaskCredits(settlement.feeCredits, settlement.currency)}, refund ${formatTaskCredits(settlement.refundCredits, settlement.currency)}`
        : review.feedback?.trim() || `Reviewed by ${review.reviewer.name}`,
      id: `review-${review.id}`,
      meta: `Annotation v${review.annotation.version}`,
      timestamp: review.createdAt,
      title: formatEnum(review.status)
    };
  });

  return [...annotationItems, ...reviewItems].sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime()
  );
}

function getReviewPaymentSettlement(review: ReviewSummary) {
  const metadata = isRecord(review.metadata) ? review.metadata : {};
  const settlement = isRecord(metadata.paymentSettlement) ? metadata.paymentSettlement : null;

  if (!settlement) {
    return null;
  }

  const approvedCredits = getNumber(settlement.approvedCredits);
  const feeCredits = getNumber(settlement.feeCredits);
  const refundCredits = getNumber(settlement.refundCredits);
  const currency = typeof settlement.currency === "string" ? settlement.currency : "USD";

  return approvedCredits === null || feeCredits === null || refundCredits === null
    ? null
    : { approvedCredits, currency, feeCredits, refundCredits };
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatReviewMetadata(review: ReviewSummary) {
  const metadata = isRecord(review.metadata) ? review.metadata : {};
  const details = [
    review.score ? `Score ${review.score}/5` : null,
    typeof metadata.reason === "string" ? formatEnum(metadata.reason) : null,
    typeof metadata.severity === "string" ? formatEnum(metadata.severity) : null
  ].filter(Boolean);

  return details.length > 0 ? details.join(" - ") : "Review feedback";
}

export function buildAnnotationVersionDiff(annotationHistory: AnnotationSummary[]): AnnotationVersionDiff | null {
  if (annotationHistory.length < 2) {
    return null;
  }

  const [current, previous] = [...annotationHistory].sort((left, right) => right.version - left.version);

  if (!current || !previous) {
    return null;
  }

  return {
    currentStatus: current.status,
    currentVersion: current.version,
    previousVersion: previous.version,
    regionDelta: current.regions.length - previous.regions.length,
    responseDelta: countAnnotationResponses(current) - countAnnotationResponses(previous)
  };
}

function countAnnotationResponses(annotation: AnnotationSummary) {
  const results = Array.isArray(annotation.resultJson.results) ? annotation.resultJson.results : [];
  return results.length;
}

export function formatSignedCount(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
