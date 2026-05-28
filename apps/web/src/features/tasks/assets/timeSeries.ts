import { clamp } from "../annotation/geometry";

export function buildTimeSeriesPreview(sourceText: string) {
  const rows = parseDelimitedRows(sourceText);

  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1).filter((row: string[]) => row.some((cell: string) => cell.trim().length > 0));
  const valueColumnIndex = headers.findIndex((_header: string, index: number) => index > 0 && dataRows.some((row: string[]) => Number.isFinite(Number(row[index]))));

  if (valueColumnIndex < 0) {
    return null;
  }

  const labelColumnIndex = headers.findIndex((header: string) => /time|date|timestamp/i.test(header));
  const normalizedLabelIndex = labelColumnIndex >= 0 ? labelColumnIndex : 0;
  const points = dataRows
    .map((row, index) => ({
      index,
      label: row[normalizedLabelIndex] ?? String(index + 1),
      value: Number(row[valueColumnIndex])
    }))
    .filter((point) => Number.isFinite(point.value));

  if (points.length < 2) {
    return null;
  }

  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const valueRange = maxValue - minValue || 1;
  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 38 - ((point.value - minValue) / valueRange) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    polyline,
    rows: points.map((point) => ({
      label: point.label,
      value: Number.isInteger(point.value) ? String(point.value) : point.value.toFixed(3)
    })),
    valueColumn: headers[valueColumnIndex] ?? "Value"
  };
}

export function getTimeSeriesRowIndex(percent: number, rowCount: number) {
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), Math.round(clamp(percent) * Math.max(0, rowCount - 1))));
}

function parseDelimitedRows(sourceText: string): string[][] {
  const trimmed = sourceText.trim();

  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const parsedRecord = isRecord(parsed) ? parsed : {};
      const objects = Array.isArray(parsed) ? parsed : Array.isArray(parsedRecord.data) ? parsedRecord.data : [];

      if (objects.every((item) => isRecord(item))) {
        const records = objects as Array<Record<string, unknown>>;
        const headers = Array.from(new Set<string>(records.flatMap((item) => Object.keys(item))));
        return [
          headers,
          ...records.map((item) => headers.map((header) => {
            const value = item[header];
            return value == null ? "" : String(value);
          }))
        ];
      }
    } catch {
      return [];
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = trimmed.includes("\t") ? "\t" : ",";
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"" && nextCharacter === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
