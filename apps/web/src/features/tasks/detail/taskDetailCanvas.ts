import type { AnnotationShape, BoxHandle, Point } from "../annotation/geometry";

export interface ZoomAnchor {
  stageX: number;
  stageY: number;
  x: number;
  y: number;
}

export type RegionEdit =
  | {
      id: string;
      kind: "move";
      originalShape: AnnotationShape;
      startPoint: Point;
    }
  | {
      handle: BoxHandle;
      id: string;
      kind: "resize-box";
      originalShape: AnnotationShape;
      startPoint: Point;
    }
  | {
      id: string;
      kind: "move-point";
      originalShape: AnnotationShape;
      pointIndex: number;
    };

export interface ActiveRegionEdit {
  id: string;
  kind: RegionEdit["kind"];
}

export interface PanDrag {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface ShapeHistoryEntry {
  action: string;
  selectedShapeId: string | null;
  shapes: AnnotationShape[];
  timestamp: number;
}

export interface PredictionPreviewState {
  focusedRegionIndex: number | null;
  jobId: string;
  selectedRegionIndexes: number[];
}

export type SaveStatus = "dirty" | "error" | "idle" | "saved" | "saving";

export const zoomStep = 0.25;
export const minZoom = 1;
export const maxZoom = 3;
export const autoSaveDelayMs = 650;
export const autoSaveRetryDelayMs = 3000;
export const maxUndoSteps = 60;

export function clampZoom(value: number) {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

export function getPredictionPreviewShapeId(jobId: string, regionIndex: number) {
  return `prediction-preview-${jobId}-${regionIndex}`;
}

export function getShapeBounds(shape: AnnotationShape) {
  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);

    return {
      height: Math.max(...ys) - y,
      width: Math.max(...xs) - x,
      x,
      y
    };
  }

  return {
    height: shape.height ?? 0,
    width: shape.width ?? 0,
    x: shape.x ?? 0,
    y: shape.y ?? 0
  };
}
