import type { AIJobSummary, SaveAnnotationInput } from "../../../api";
import {
  aiJobPredictionToShapes,
  cloneShapes,
  shapesToAnnotationPayload,
  type AnnotationShape
} from "../annotation/geometry";
import { getPredictionPreviewShapeId, type PredictionPreviewState } from "./taskDetailCanvas";

export function parsePredictionImportText(text: string): { ok: true; predictions: unknown } | { message: string; ok: false } {
  try {
    return { ok: true, predictions: JSON.parse(text) };
  } catch {
    return { message: "Prediction JSON is not valid.", ok: false };
  }
}

export function buildPredictionPreviewShapes(job: AIJobSummary, preview: PredictionPreviewState) {
  const selectedIndexes = new Set(preview.selectedRegionIndexes);

  return aiJobPredictionToShapes(job)
    .map((shape, index) => ({
      ...shape,
      id: getPredictionPreviewShapeId(job.id, index)
    }))
    .filter((_, index) => selectedIndexes.has(index));
}

export function buildPredictionShapes(job: AIJobSummary, selectedRegionIndexes: number[] | undefined, timestamp = Date.now()) {
  const selectedRegionIndexSet = selectedRegionIndexes ? new Set(selectedRegionIndexes) : null;

  return aiJobPredictionToShapes(job)
    .filter((_, index) => !selectedRegionIndexSet || selectedRegionIndexSet.has(index))
    .map((shape, index) => ({
      ...shape,
      id: `prediction-${timestamp}-${index}`
    }));
}

export function buildPredictionSavePayload(
  currentShapes: AnnotationShape[],
  predictionShapes: AnnotationShape[],
  currentResults: SaveAnnotationInput["results"]
) {
  const nextShapes = [...cloneShapes(currentShapes), ...predictionShapes];

  return {
    nextPayload: {
      ...shapesToAnnotationPayload(nextShapes),
      results: currentResults
    },
    nextShapes
  };
}

export function formatPrelabelCount(count: number) {
  return `${count} prelabel${count === 1 ? "" : "s"}`;
}
