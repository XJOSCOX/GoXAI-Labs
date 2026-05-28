import { AnnotationRegionType, TaskStatus, type Prisma } from "@goxai/database";

export function normalizeId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeNullableId(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : false;
}

function parseEnumValue<T extends Record<string, string>>(enumValues: T, value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const values = Object.values(enumValues);
  return values.includes(value) ? (value as T[keyof T]) : undefined;
}

export function parseTaskStatusQuery(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toUpperCase().replaceAll("-", "_");
  return parseEnumValue(TaskStatus, normalized);
}

const reviewReasonValues = new Set([
  "bad_boundary",
  "incomplete",
  "missing_label",
  "other",
  "wrong_class"
]);

const reviewSeverityValues = new Set(["low", "medium", "high", "critical"]);

export function parseReviewMetadata(body: unknown):
  | {
      ok: true;
      value: {
        metadata: Prisma.InputJsonObject;
        reason: string | null;
        score: number | null;
      };
    }
  | { ok: false; error: string } {
  const record = isPlainJsonObject(body) ? body : {};
  const score = parseReviewScore(record.score);
  const reason = parseReviewToken(record.reason, reviewReasonValues);
  const severity = parseReviewToken(record.severity, reviewSeverityValues);

  if (score === false) {
    return { ok: false, error: "Review score must be a whole number from 1 to 5." };
  }

  if (record.reason && !reason) {
    return { ok: false, error: "Choose a valid review reason." };
  }

  if (record.severity && !severity) {
    return { ok: false, error: "Choose a valid review severity." };
  }

  return {
    ok: true,
    value: {
      metadata: {
        ...(reason ? { reason } : {}),
        ...(severity ? { severity } : {})
      },
      reason,
      score
    }
  };
}

function parseReviewScore(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const score = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : false;
}

function parseReviewToken(value: unknown, allowedValues: Set<string>) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return allowedValues.has(normalized) ? normalized : null;
}

export function parseAnnotationBody(body: unknown):
  | {
      ok: true;
      value: {
        leadTimeSeconds?: number;
        regions: {
          confidence: number | null;
          geometryJson: Prisma.InputJsonObject;
          label: string | null;
          metadata: Prisma.InputJsonObject;
          type: AnnotationRegionType;
        }[];
        results: {
          from_name: string;
          to_name: string;
          type: string;
          value: Prisma.InputJsonObject;
        }[];
        resultJson: {
          results: {
            from_name: string;
            to_name: string;
            type: string;
            value: Prisma.InputJsonObject;
          }[];
          regions: {
            confidence: number | null;
            geometry: Prisma.InputJsonObject;
            label: string | null;
            metadata: Prisma.InputJsonObject;
            type: "BBOX" | "POLYGON";
          }[];
        };
      };
    }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Annotation payload is required." };
  }

  const payload = body as Record<string, unknown>;
  const rawRegions = Array.isArray(payload.regions) ? payload.regions : [];
  const rawResults = Array.isArray(payload.results) ? payload.results : [];

  if (rawRegions.length > 250) {
    return { ok: false, error: "Save up to 250 regions per annotation for now." };
  }

  if (rawResults.length > 250) {
    return { ok: false, error: "Save up to 250 non-region results per annotation for now." };
  }

  const regions = [];

  for (const rawRegion of rawRegions) {
    if (!rawRegion || typeof rawRegion !== "object") {
      return { ok: false, error: "Each annotation region must be an object." };
    }

    const region = rawRegion as Record<string, unknown>;
    const type = parseEnumValue(AnnotationRegionType, region.type) ?? AnnotationRegionType.BBOX;
    const geometry = region.geometry;

    if (!geometry || typeof geometry !== "object") {
      return { ok: false, error: "Each annotation region needs geometry." };
    }

    const label = typeof region.label === "string" && region.label.trim() ? region.label.trim().slice(0, 120) : null;
    const confidence = normalizeConfidence(region.confidence);
    const inputMetadata = isPlainJsonObject(region.metadata) ? sanitizeRegionMetadata(region.metadata) : {};
    const page = normalizePositiveInteger((geometry as Record<string, unknown>).page ?? region.page);
    const sourceName = normalizeShortText((geometry as Record<string, unknown>).sourceName ?? region.sourceName, 120);
    const ocrBlockId = normalizeShortText((geometry as Record<string, unknown>).ocrBlockId ?? region.ocrBlockId, 160);
    const text = normalizeShortText((geometry as Record<string, unknown>).text ?? region.text, 4000);

    if (type === AnnotationRegionType.BBOX) {
      const box = geometry as Record<string, unknown>;
      const x = normalizeUnitNumber(box.x);
      const y = normalizeUnitNumber(box.y);
      const width = normalizeUnitNumber(box.width);
      const height = normalizeUnitNumber(box.height);

      if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
        return { ok: false, error: "Bounding boxes must use normalized x, y, width, and height values." };
      }

      const geometryJson = {
        height,
        ...(ocrBlockId ? { ocrBlockId } : {}),
        ...(page ? { page } : {}),
        ...(sourceName ? { sourceName } : {}),
        ...(text ? { text } : {}),
        width,
        x,
        y
      };

      regions.push({
        confidence,
        geometryJson,
        label,
        metadata: {
          ...inputMetadata,
          ...(ocrBlockId ? { ocrBlockId } : {}),
          ...(page ? { page } : {}),
          ...(sourceName ? { sourceName } : {}),
          ...(text ? { text } : {}),
          tool: "bbox"
        },
        type
      });
      continue;
    }

    if (type !== AnnotationRegionType.POLYGON) {
      return { ok: false, error: "This annotation tool is not supported yet." };
    }

    const points = Array.isArray((geometry as Record<string, unknown>).points)
      ? ((geometry as Record<string, unknown>).points as unknown[])
      : [];

    if (points.length < 3 || points.length > 200) {
      return { ok: false, error: "Polygons must have between 3 and 200 points." };
    }

    const normalizedPoints = points.map((point) => {
      if (!point || typeof point !== "object") {
        return null;
      }

      const record = point as Record<string, unknown>;
      const x = normalizeUnitNumber(record.x);
      const y = normalizeUnitNumber(record.y);

      return x === null || y === null ? null : { x, y };
    });

    if (normalizedPoints.some((point) => point === null)) {
      return { ok: false, error: "Polygon points must use normalized x and y values." };
    }

    const geometryJson = {
      ...(ocrBlockId ? { ocrBlockId } : {}),
      ...(page ? { page } : {}),
      points: normalizedPoints as { x: number; y: number }[],
      ...(sourceName ? { sourceName } : {}),
      ...(text ? { text } : {})
    };

    regions.push({
      confidence,
      geometryJson,
      label,
      metadata: {
        ...inputMetadata,
        ...(ocrBlockId ? { ocrBlockId } : {}),
        ...(page ? { page } : {}),
        ...(sourceName ? { sourceName } : {}),
        ...(text ? { text } : {}),
        tool: "polygon"
      },
      type
    });
  }

  const leadTimeSeconds =
    typeof payload.leadTimeSeconds === "number" && Number.isFinite(payload.leadTimeSeconds) && payload.leadTimeSeconds >= 0
      ? payload.leadTimeSeconds
      : undefined;
  const results = [];

  for (const rawResult of rawResults) {
    if (!rawResult || typeof rawResult !== "object") {
      return { ok: false, error: "Each annotation result must be an object." };
    }

    const result = rawResult as Record<string, unknown>;
    const fromName = normalizeShortText(result.fromName ?? result.from_name, 120);
    const toName = normalizeShortText(result.toName ?? result.to_name, 120);
    const type = normalizeShortText(result.type, 80);
    const value = result.value;

    if (!fromName || !toName || !type || !isPlainJsonObject(value)) {
      return { ok: false, error: "Each annotation result needs fromName, toName, type, and a value object." };
    }

    results.push({
      from_name: fromName,
      to_name: toName,
      type,
      value: value as Prisma.InputJsonObject
    });
  }

  return {
    ok: true,
    value: {
      leadTimeSeconds,
      regions,
      results,
      resultJson: {
        results,
        regions: regions.map((region) => ({
          geometry: region.geometryJson,
          confidence: region.confidence,
          label: region.label,
          metadata: region.metadata,
          type: region.type === AnnotationRegionType.POLYGON ? "POLYGON" : "BBOX"
        }))
      }
    }
  };
}

function normalizeUnitNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, value));
}

function sanitizeRegionMetadata(value: Record<string, unknown>): Prisma.InputJsonObject {
  const metadata: Record<string, Prisma.InputJsonValue> = {};

  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) {
      continue;
    }

    if (isJsonSafeValue(entry, 0)) {
      metadata[key] = entry;
    }
  }

  return metadata as Prisma.InputJsonObject;
}

function isJsonSafeValue(value: unknown, depth: number): value is Prisma.InputJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (depth >= 4) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length <= 50 && value.every((item) => isJsonSafeValue(item, depth + 1));
  }

  if (!isPlainJsonObject(value)) {
    return false;
  }

  return Object.entries(value).length <= 50 && Object.entries(value).every(([key, entry]) => key.length <= 80 && isJsonSafeValue(entry, depth + 1));
}

export function normalizeShortText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizePositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export function normalizeNullableDate(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return false;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? false : date;
}
