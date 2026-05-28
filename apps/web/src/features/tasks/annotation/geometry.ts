import type { AIJobSummary, AIPredictionRegionSummary, AnnotationSummary, SaveAnnotationInput } from "../../../api";

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationShape {
  confidence?: number | null;
  height?: number;
  id: string;
  label: string;
  metadata?: Record<string, unknown> | null;
  ocrBlockId?: string;
  page?: number;
  points?: Point[];
  sourceName?: string;
  text?: string;
  type: "BBOX" | "POLYGON";
  width?: number;
  x?: number;
  y?: number;
}

export interface LabelOption {
  color: string;
  name: string;
  shortcutKey?: string | null;
}

export type BoxHandle = "nw" | "ne" | "se" | "sw";

export const defaultLabel = "Object";
export const labelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

const editHandleHitRadius = 0.018;
const polygonCloseHitRadius = 0.02;

export function annotationToShapes(annotation: AnnotationSummary | null): AnnotationShape[] {
  if (!annotation) {
    return [];
  }

  const shapes: AnnotationShape[] = [];

  annotation.regions.forEach((region, index) => {
    const geometry = region.geometryJson;

    if (region.type === "POLYGON" && isPolygonGeometry(geometry)) {
      shapes.push({
        id: region.id || `region-${index}`,
        label: region.label ?? defaultLabel,
        confidence: region.confidence,
        metadata: region.metadata,
        ocrBlockId: geometry.ocrBlockId,
        page: geometry.page,
        points: geometry.points,
        sourceName: geometry.sourceName,
        text: geometry.text,
        type: "POLYGON"
      });
      return;
    }

    if (!isBoxGeometry(geometry)) {
      return;
    }

    shapes.push({
      height: geometry.height,
      id: region.id || `region-${index}`,
      label: region.label ?? defaultLabel,
      confidence: region.confidence,
      metadata: region.metadata,
      ocrBlockId: geometry.ocrBlockId,
      page: geometry.page,
      sourceName: geometry.sourceName,
      text: geometry.text,
      type: "BBOX",
      width: geometry.width,
      x: geometry.x,
      y: geometry.y
    });
  });

  return shapes;
}

export function aiJobPredictionToShapes(job: AIJobSummary): AnnotationShape[] {
  const regions = job.outputJson?.predictions?.regions ?? [];
  const shapes: AnnotationShape[] = [];

  regions.forEach((region, index) => {
    const geometry = region.geometry;
    const id = `prediction-${job.id}-${index}`;

    if (region.type === "POLYGON" && isPolygonGeometry(geometry)) {
      shapes.push({
        confidence: region.confidence,
        id,
        label: region.label ?? defaultLabel,
        metadata: getPredictionShapeMetadata(job, region, index),
        ocrBlockId: geometry.ocrBlockId,
        page: geometry.page,
        points: geometry.points,
        sourceName: geometry.sourceName,
        text: geometry.text,
        type: "POLYGON"
      });
      return;
    }

    if (region.type === "BBOX" && isBoxGeometry(geometry)) {
      shapes.push({
        confidence: region.confidence,
        height: geometry.height,
        id,
        label: region.label ?? defaultLabel,
        metadata: getPredictionShapeMetadata(job, region, index),
        ocrBlockId: geometry.ocrBlockId,
        page: geometry.page,
        sourceName: geometry.sourceName,
        text: geometry.text,
        type: "BBOX" as const,
        width: geometry.width,
        x: geometry.x,
        y: geometry.y
      });
    }
  });

  return shapes;
}

function getPredictionShapeMetadata(job: AIJobSummary, region: AIPredictionRegionSummary, index: number) {
  return {
    ...(region.metadata ?? {}),
    aiJobId: job.id,
    aiJobType: job.type,
    aiModelProviderId: job.modelProviderId,
    aiModelProviderName: job.modelProvider?.name ?? null,
    aiPredictionIndex: index,
    originalGeometry: region.geometry,
    originalLabel: region.label,
    source: "ai_prediction"
  };
}

export function cloneShapes(shapes: AnnotationShape[]): AnnotationShape[] {
  return shapes.map((shape) => ({
    ...shape,
    points: shape.points?.map((point) => ({ ...point }))
  }));
}

export function areShapesEqual(first: AnnotationShape[], second: AnnotationShape[]) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function isBoxGeometry(value: unknown): value is { height: number; ocrBlockId?: string; page?: number; sourceName?: string; text?: string; width: number; x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const geometry = value as Record<string, unknown>;
  return ["height", "width", "x", "y"].every((key) => typeof geometry[key] === "number");
}

function isPolygonGeometry(value: unknown): value is { ocrBlockId?: string; page?: number; points: Point[]; sourceName?: string; text?: string } {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).points)) {
    return false;
  }

  return ((value as { points: unknown[] }).points).every((point) => {
    if (!point || typeof point !== "object") {
      return false;
    }

    const record = point as Record<string, unknown>;
    return typeof record.x === "number" && typeof record.y === "number";
  });
}

export function createBoxFromPoints(start: { x: number; y: number }, end: { x: number; y: number }, label: string): AnnotationShape {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return {
    height,
    id: "draft",
    label,
    type: "BBOX",
    width,
    x,
    y
  };
}

export function shouldClosePolygon(points: Point[], point: Point) {
  if (points.length < 3) {
    return false;
  }

  return getPointDistance(points[0], point) <= polygonCloseHitRadius;
}

export function findEditHandleAtPoint(shape: AnnotationShape, point: Point) {
  if (shape.type === "POLYGON" && shape.points) {
    const pointIndex = shape.points.findIndex((shapePoint) => getPointDistance(shapePoint, point) <= editHandleHitRadius);

    return pointIndex >= 0 ? { kind: "move-point" as const, pointIndex } : null;
  }

  const handle = getBoxHandlePoints(shape).find((candidate) => getPointDistance(candidate.point, point) <= editHandleHitRadius);

  return handle ? { handle: handle.handle, kind: "resize-box" as const } : null;
}

export function getBoxHandlePoints(shape: AnnotationShape): Array<{ handle: BoxHandle; point: Point }> {
  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;

  return [
    { handle: "nw", point: { x, y } },
    { handle: "ne", point: { x: x + width, y } },
    { handle: "se", point: { x: x + width, y: y + height } },
    { handle: "sw", point: { x, y: y + height } }
  ];
}

export function resizeBoxShape(shape: AnnotationShape, handle: BoxHandle, point: Point): AnnotationShape {
  const left = shape.x ?? 0;
  const top = shape.y ?? 0;
  const right = left + (shape.width ?? 0);
  const bottom = top + (shape.height ?? 0);
  const minSize = 0.01;

  const nextLeft = handle === "nw" || handle === "sw" ? Math.min(point.x, right - minSize) : left;
  const nextRight = handle === "ne" || handle === "se" ? Math.max(point.x, left + minSize) : right;
  const nextTop = handle === "nw" || handle === "ne" ? Math.min(point.y, bottom - minSize) : top;
  const nextBottom = handle === "sw" || handle === "se" ? Math.max(point.y, top + minSize) : bottom;
  const clampedLeft = clamp(nextLeft);
  const clampedRight = clamp(nextRight);
  const clampedTop = clamp(nextTop);
  const clampedBottom = clamp(nextBottom);

  return {
    ...shape,
    height: Math.max(minSize, clampedBottom - clampedTop),
    width: Math.max(minSize, clampedRight - clampedLeft),
    x: Math.min(clampedLeft, clampedRight - minSize),
    y: Math.min(clampedTop, clampedBottom - minSize)
  };
}

export function movePolygonPoint(shape: AnnotationShape, pointIndex: number, point: Point): AnnotationShape {
  if (shape.type !== "POLYGON" || !shape.points) {
    return shape;
  }

  return {
    ...shape,
    points: shape.points.map((shapePoint, index) => (index === pointIndex ? { x: clamp(point.x), y: clamp(point.y) } : shapePoint))
  };
}

export function shapesToAnnotationPayload(shapes: AnnotationShape[]): SaveAnnotationInput {
  return {
    regions: shapes.map((shape) => {
      const geometry = getShapeGeometry(shape);
      const metadata = getShapeMetadataForSave(shape, geometry);

      return {
        geometry,
        label: shape.label,
        ...(typeof shape.confidence === "number" ? { confidence: shape.confidence } : {}),
        ...(metadata ? { metadata } : {}),
        type: shape.type
      };
    })
  };
}

function getShapeGeometry(shape: AnnotationShape) {
  return shape.type === "POLYGON"
    ? {
        ...(shape.ocrBlockId ? { ocrBlockId: shape.ocrBlockId } : {}),
        ...(shape.page ? { page: shape.page } : {}),
        points: shape.points ?? [],
        ...(shape.sourceName ? { sourceName: shape.sourceName } : {}),
        ...(shape.text ? { text: shape.text } : {})
      }
    : {
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

function getShapeMetadataForSave(shape: AnnotationShape, geometry: ReturnType<typeof getShapeGeometry>) {
  if (!shape.metadata) {
    return null;
  }

  if (shape.metadata.source !== "ai_prediction" && typeof shape.metadata.aiJobId !== "string") {
    return shape.metadata;
  }

  const originalLabel = typeof shape.metadata.originalLabel === "string" || shape.metadata.originalLabel === null
    ? shape.metadata.originalLabel
    : undefined;
  const aiEdited =
    (shape.metadata.originalGeometry !== undefined && !jsonValuesEqual(shape.metadata.originalGeometry, geometry)) ||
    (originalLabel !== undefined && originalLabel !== shape.label);

  return {
    ...shape.metadata,
    aiEdited
  };
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(normalizeJsonForComparison(left)) === JSON.stringify(normalizeJsonForComparison(right));
}

function normalizeJsonForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonForComparison);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => [key, normalizeJsonForComparison(entry)])
  );
}

export function serializeAnnotationPayload(payload: SaveAnnotationInput) {
  return JSON.stringify(payload);
}

export function findShapeAtPoint(shapes: AnnotationShape[], point: Point) {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];

    if (shapeContainsPoint(shape, point)) {
      return shape;
    }
  }

  return null;
}

export function getPointDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function shapeContainsPoint(shape: AnnotationShape, point: Point) {
  if (shape.type === "POLYGON" && shape.points && shape.points.length >= 3) {
    return pointInPolygon(point, shape.points);
  }

  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;

  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || Number.EPSILON) + current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function translateShape(shape: AnnotationShape, deltaX: number, deltaY: number): AnnotationShape {
  const bounds = getShapeBounds(shape);
  const clampedDeltaX = clampDelta(deltaX, bounds.minX, bounds.maxX);
  const clampedDeltaY = clampDelta(deltaY, bounds.minY, bounds.maxY);

  if (shape.type === "POLYGON" && shape.points) {
    return {
      ...shape,
      points: shape.points.map((point) => ({
        x: point.x + clampedDeltaX,
        y: point.y + clampedDeltaY
      }))
    };
  }

  return {
    ...shape,
    x: (shape.x ?? 0) + clampedDeltaX,
    y: (shape.y ?? 0) + clampedDeltaY
  };
}

function getShapeBounds(shape: AnnotationShape) {
  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    const xValues = shape.points.map((point) => point.x);
    const yValues = shape.points.map((point) => point.y);

    return {
      maxX: Math.max(...xValues),
      maxY: Math.max(...yValues),
      minX: Math.min(...xValues),
      minY: Math.min(...yValues)
    };
  }

  const x = shape.x ?? 0;
  const y = shape.y ?? 0;

  return {
    maxX: x + (shape.width ?? 0),
    maxY: y + (shape.height ?? 0),
    minX: x,
    minY: y
  };
}

function clampDelta(delta: number, min: number, max: number) {
  return Math.max(-min, Math.min(1 - max, delta));
}

export function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function clampScroll(value: number, max: number) {
  return Math.max(0, Math.min(Math.max(0, max), value));
}

export function getLabelOptions(
  datasetLabels: { color: string; name: string; shortcutKey: string | null }[] | undefined,
  config: Record<string, unknown> | null | undefined
): LabelOption[] {
  if (datasetLabels && datasetLabels.length > 0) {
    return datasetLabels.map((label, index) => ({
      color: label.color || labelColors[index % labelColors.length],
      name: label.name,
      shortcutKey: label.shortcutKey
    }));
  }

  if (!config || !Array.isArray(config.labels)) {
    return [];
  }

  const labels: LabelOption[] = [];

  config.labels.forEach((label, index) => {
    if (typeof label === "string") {
      labels.push({
        color: labelColors[index % labelColors.length],
        name: label,
        shortcutKey: getShortcutKey(index)
      });
      return;
    }

    if (!label || typeof label !== "object") {
      return;
    }

    const record = label as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const color = typeof record.color === "string" && record.color.trim().length > 0 ? record.color.trim() : labelColors[index % labelColors.length];

    if (name) {
      labels.push({
        color,
        name,
        shortcutKey: getShortcutKey(index)
      });
    }
  });

  return labels;
}

export function getLabelColor(labelName: string, options: LabelOption[]) {
  return options.find((option) => option.name === labelName)?.color ?? labelColors[0];
}

export function getToolOptions(datasetTools: { enabled: boolean; tool: string }[] | undefined): string[] {
  const enabledTools = (datasetTools ?? []).filter((tool) => tool.enabled).map((tool) => tool.tool);

  return enabledTools.length > 0 ? enabledTools : ["BBOX"];
}

export function getRegionBorderWidth(config: Record<string, unknown> | null | undefined) {
  const settings = config?.settings;

  if (!settings || typeof settings !== "object") {
    return 2;
  }

  const width = (settings as Record<string, unknown>).regionBorderWidth;

  return typeof width === "number" && Number.isFinite(width) ? Math.max(1, Math.min(8, width)) : 2;
}

export function pointsToSvg(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getShortcutKey(index: number) {
  return index >= 0 && index < 9 ? String(index + 1) : undefined;
}
