import type { AIJobSummary } from "../../../api";
import type { ReviewGuidanceItem } from "../review/reviewGuidance";
import type { AnnotationShape } from "../annotation/geometry";

const lowConfidenceThreshold = 0.75;

export type AIRegionReviewStatus = "accepted" | "edited" | "low_confidence";

export type TaskAIRegionReviewItem = {
  confidence: number | null;
  currentGeometry: string;
  currentLabel: string;
  geometryChanged: boolean;
  id: string;
  originalGeometry: string;
  originalLabel: string;
  status: AIRegionReviewStatus;
};

export type TaskAIAssistanceSummary = {
  acceptedRegions: number;
  averageConfidence: number | null;
  editedRegions: number;
  hasAIAssist: boolean;
  lowConfidenceRegions: number;
  mockOnly: boolean;
  predictedRegions: number;
  providerName: string | null;
  regions: TaskAIRegionReviewItem[];
  removedRegions: number;
};

export function buildTaskAIAssistanceSummary(jobs: AIJobSummary[], shapes: AnnotationShape[]): TaskAIAssistanceSummary {
  const completedJobs = jobs.filter((job) => job.status === "COMPLETED");
  const predictionKeys = new Set<string>();

  for (const job of completedJobs) {
    const regions = job.outputJson?.predictions?.regions ?? [];
    regions.forEach((_, index) => {
      predictionKeys.add(`${job.id}:${index}`);
    });
  }

  const aiShapes = shapes.filter(isAIShape);
  const mockShapeCount = aiShapes.filter(isMockShape).length;
  const mockJobCount = completedJobs.filter(isMockJob).length;
  const confidenceValues = aiShapes
    .map((shape) => shape.confidence)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const reviewRegions = aiShapes.map(buildAIRegionReviewItem);
  const acceptedRegions = aiShapes.length;
  const predictedRegions = Math.max(predictionKeys.size, acceptedRegions);
  const editedRegions = reviewRegions.filter((region) => region.status === "edited").length;
  const lowConfidenceRegions = reviewRegions.filter((region) => region.confidence !== null && region.confidence < lowConfidenceThreshold).length;

  return {
    acceptedRegions,
    averageConfidence: confidenceValues.length > 0
      ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
      : null,
    editedRegions,
    hasAIAssist: predictedRegions > 0 || acceptedRegions > 0,
    lowConfidenceRegions,
    mockOnly: predictedRegions > 0 && mockShapeCount === aiShapes.length && mockJobCount === completedJobs.length,
    predictedRegions,
    providerName: completedJobs[0]?.modelProvider?.name ?? null,
    regions: reviewRegions,
    removedRegions: Math.max(0, predictedRegions - acceptedRegions)
  };
}

export function buildAIReviewGuidance(summary: TaskAIAssistanceSummary): ReviewGuidanceItem[] {
  if (!summary.hasAIAssist) {
    return [];
  }

  const items: ReviewGuidanceItem[] = [];

  if (summary.lowConfidenceRegions > 0) {
    items.push({
      detail: `${summary.lowConfidenceRegions} prelabel${summary.lowConfidenceRegions === 1 ? "" : "s"} below ${formatPercent(lowConfidenceThreshold)} confidence.`,
      title: "Low-confidence prelabels",
      tone: "warning"
    });
  }

  if (summary.editedRegions > 0) {
    items.push({
      detail: `${summary.editedRegions} prelabel${summary.editedRegions === 1 ? " was" : "s were"} changed by the worker.`,
      title: "Worker edited prelabel",
      tone: "info"
    });
  }

  if (summary.removedRegions > 0) {
    items.push({
      detail: `${summary.removedRegions} predicted region${summary.removedRegions === 1 ? "" : "s"} were not kept in the annotation.`,
      title: "Prelabels removed",
      tone: "info"
    });
  }

  return items;
}

export function getAIRegionStatus(shape: AnnotationShape): AIRegionReviewStatus | null {
  if (!isAIShape(shape)) {
    return null;
  }

  if (isEditedAIShape(shape)) {
    return "edited";
  }

  if (typeof shape.confidence === "number" && shape.confidence < lowConfidenceThreshold) {
    return "low_confidence";
  }

  return "accepted";
}

export function isAIShape(shape: AnnotationShape) {
  return shape.metadata?.source === "ai_prediction" || typeof shape.metadata?.aiJobId === "string";
}

function isMockShape(shape: AnnotationShape) {
  return shape.metadata?.mock === true;
}

function isMockJob(job: AIJobSummary) {
  return job.inputJson?.mock === true || job.outputJson?.predictions?.regions?.some((region) => region.metadata?.mock === true) === true;
}

export function formatAIConfidence(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : "N/A";
}

function buildAIRegionReviewItem(shape: AnnotationShape): TaskAIRegionReviewItem {
  const metadata = getRecord(shape.metadata);
  const originalGeometry = metadata ? metadata.originalGeometry : null;
  const originalLabel = getOriginalLabel(metadata);
  const geometryChanged = originalGeometry !== null && !jsonValuesEqual(originalGeometry, shapeToGeometry(shape));
  const labelChanged = originalLabel !== null && originalLabel !== shape.label;
  const status = geometryChanged || labelChanged
    ? "edited"
    : typeof shape.confidence === "number" && shape.confidence < lowConfidenceThreshold
      ? "low_confidence"
      : "accepted";

  return {
    confidence: typeof shape.confidence === "number" ? shape.confidence : null,
    currentGeometry: summarizeShapeGeometry(shape),
    currentLabel: shape.label,
    geometryChanged,
    id: shape.id,
    originalGeometry: summarizeGeometry(originalGeometry),
    originalLabel: originalLabel ?? "Unlabeled",
    status
  };
}

function isEditedAIShape(shape: AnnotationShape) {
  const metadata = getRecord(shape.metadata);
  const originalGeometry = metadata ? metadata.originalGeometry : null;
  const originalLabel = getOriginalLabel(metadata);

  return (originalGeometry !== null && !jsonValuesEqual(originalGeometry, shapeToGeometry(shape))) ||
    (originalLabel !== null && originalLabel !== shape.label);
}

function shapeToGeometry(shape: AnnotationShape) {
  if (shape.type === "POLYGON") {
    return {
      ...(shape.ocrBlockId ? { ocrBlockId: shape.ocrBlockId } : {}),
      ...(shape.page ? { page: shape.page } : {}),
      points: shape.points ?? [],
      ...(shape.sourceName ? { sourceName: shape.sourceName } : {}),
      ...(shape.text ? { text: shape.text } : {})
    };
  }

  return {
    height: shape.height ?? 0,
    ...(shape.ocrBlockId ? { ocrBlockId: shape.ocrBlockId } : {}),
    ...(shape.page ? { page: shape.page } : {}),
    ...(shape.sourceName ? { sourceName: shape.sourceName } : {}),
    ...(shape.text ? { text: shape.text } : {}),
    width: shape.width ?? 0,
    x: shape.x ?? 0,
    y: shape.y ?? 0
  };
}

function summarizeShapeGeometry(shape: AnnotationShape) {
  return summarizeGeometry(shapeToGeometry(shape));
}

function summarizeGeometry(value: unknown) {
  const geometry = getRecord(value);

  if (!geometry) {
    return "N/A";
  }

  if (Array.isArray(geometry.points)) {
    return `${geometry.points.length} points`;
  }

  const x = getNumber(geometry.x);
  const y = getNumber(geometry.y);
  const width = getNumber(geometry.width);
  const height = getNumber(geometry.height);

  if (x === null || y === null || width === null || height === null) {
    return "Custom geometry";
  }

  return `x${toPercent(x)} y${toPercent(y)} w${toPercent(width)} h${toPercent(height)}`;
}

function getOriginalLabel(metadata: Record<string, unknown> | null) {
  if (!metadata || !("originalLabel" in metadata)) {
    return null;
  }

  return typeof metadata.originalLabel === "string" && metadata.originalLabel.trim()
    ? metadata.originalLabel
    : "Unlabeled";
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
