import {
  type AssetSummary,
  type DatasetSummary,
  type ExportFormat,
  type QualityStatsResult
} from "../../../api";
import { formatEnum } from "../../../utils/format";
import { buildUploadObjectKey, createReadableCode, getFileKey, toSafeObjectKeyPart } from "../../../utils/upload";

const maxUploadFolderAssets = 250;
const structuredImportExtensions = new Set(["csv", "json", "jsonl", "ndjson"]);

export function getDatasetExportFormats(dataset: DatasetSummary): { label: string; value: ExportFormat }[] {
  const formats: { label: string; value: ExportFormat }[] = [
    { label: "JSON", value: "JSON" },
    { label: "JSON_MIN", value: "JSON_MIN" },
    { label: "CSV", value: "CSV" },
    { label: "TSV", value: "TSV" }
  ];
  const enabledTools = new Set(dataset.tools.filter((tool) => tool.enabled).map((tool) => tool.tool.toUpperCase()));
  const configCode = typeof dataset.labelingConfig?.configCode === "string" ? dataset.labelingConfig.configCode : "";
  const hasImageSource = dataset.project.dataType.toUpperCase() === "IMAGE" || /<Image\b/i.test(configCode);
  const hasImageRegions = hasImageSource && (enabledTools.has("BBOX") || enabledTools.has("POLYGON"));
  const hasTextSource = dataset.project.dataType.toUpperCase() === "TEXT" || /<(Text|HyperText|Paragraphs|List|Chat)\b/i.test(configCode);
  const hasAudioSource = dataset.project.dataType.toUpperCase() === "AUDIO" || /<Audio\b/i.test(configCode);
  const hasTextAnswers = /<TextArea\b/i.test(configCode) || enabledTools.has("TEXT_AREA");

  if (hasImageRegions) {
    formats.push(
      { label: "COCO", value: "COCO" },
      { label: "YOLO", value: "YOLO" },
      { label: "Pascal VOC", value: "PASCAL_VOC" }
    );
  }

  if (hasTextSource && enabledTools.has("TEXT_SPAN")) {
    formats.push({ label: "CoNLL 2003", value: "CONLL_2003" });
  }

  if (hasAudioSource || hasTextAnswers) {
    formats.push({ label: "ASR JSONL", value: "ASR_JSONL" });
  }

  return formats;
}

export function isSourceFileExportFormat(format: ExportFormat) {
  return format === "COCO" || format === "YOLO" || format === "PASCAL_VOC";
}

export function formatDatasetVersionReason(reason: string) {
  const labels: Record<string, string> = {
    asset_registered: "Asset added",
    assets_deleted: "Assets deleted",
    dataset_created: "Dataset created",
    dataset_details_updated: "Details updated",
    rollback: "Rollback",
    tasks_generated: "Tasks generated",
    template_config_updated: "Template updated"
  };

  return labels[reason] ?? formatEnum(reason);
}

export function createUploadJobs({
  assets,
  dataset,
  files,
  rename,
  renamePrefix
}: {
  assets: AssetSummary[];
  dataset: DatasetSummary;
  files: File[];
  rename: boolean;
  renamePrefix: string;
}) {
  const folderCounts = getDatasetUploadFolderCounts(dataset, assets);
  const selectedAutoBase = getDatasetUploadFolderBase(dataset, folderCounts);
  const counts = new Map(folderCounts);

  return files.map((file) => {
    const folder = getNextDatasetUploadFolder(selectedAutoBase, counts);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);

    return {
      file,
      key: getFileKey(file),
      objectKey: buildUploadObjectKey(file, {
        folder,
        prefix: renamePrefix,
        rename
      })
    };
  });
}

export function getAssetFolderPrefix(objectKey: string) {
  const slashIndex = objectKey.lastIndexOf("/");

  return slashIndex > -1 ? objectKey.slice(0, slashIndex + 1) : "";
}

export function getDatasetBindings(config: DatasetSummary["labelingConfig"]) {
  const configCode = typeof config?.configCode === "string" ? config.configCode : "";
  return Array.from(new Set(Array.from(configCode.matchAll(/\b(?:value|valueList)="\$([^"]+)"/g)).map((match) => match[1]).filter(Boolean)));
}

export function getDatasetTextSources(config: DatasetSummary["labelingConfig"]) {
  const configCode = typeof config?.configCode === "string" ? config.configCode : "";
  const sources: { binding: string; name: string }[] = [];
  const textTagPattern = /<(Text|HyperText|Paragraphs|List|Chat)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = textTagPattern.exec(configCode))) {
    const attributes = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const value = getXmlAttribute(attributes, "value") ?? getXmlAttribute(attributes, "valueList");

    if (!name || !value?.startsWith("$")) {
      continue;
    }

    sources.push({
      binding: value.slice(1),
      name
    });
  }

  return sources;
}

export function isStructuredImportFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return structuredImportExtensions.has(extension) || ["application/json", "application/x-ndjson", "text/csv"].includes(file.type);
}

export async function parseStructuredImportFile(file: File) {
  const text = await file.text();
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv" || file.type === "text/csv") {
    return parseCsvRows(text);
  }

  if (extension === "jsonl" || extension === "ndjson") {
    return parseJsonLines(text);
  }

  return parseJsonRows(text);
}

export function getStructuredRowTitle(row: Record<string, unknown>, bindings: string[], rowNumber: number) {
  const titleValue = row.title ?? row.name ?? row.id ?? bindings.map((binding) => row[binding]).find((value) => typeof value === "string" && value.trim());

  return typeof titleValue === "string" && titleValue.trim()
    ? titleValue.trim().slice(0, 80)
    : `Row ${rowNumber}`;
}

export function hasDatasetTemplateConfig(dataset: DatasetSummary) {
  return dataset.labels.length > 0 && dataset.tools.some((tool) => tool.enabled) && isRecord(dataset.labelingConfig);
}

export function hasDatasetControllerConfig(dataset: DatasetSummary) {
  return isRecord(dataset.metadata) && isRecord(dataset.metadata.taskWorkflowDefaults);
}

export function getDatasetAssignmentLabel(dataset: DatasetSummary) {
  if (!isRecord(dataset.metadata) || !isRecord(dataset.metadata.taskWorkflowDefaults)) {
    return "Unassigned";
  }

  const mode = dataset.metadata.taskWorkflowDefaults.assignmentMode;

  if (mode === "round_robin") {
    return "Round-robin";
  }

  if (mode === "single") {
    return "One annotator";
  }

  return "Unassigned";
}

export function getDatasetQualityPolicy(dataset: DatasetSummary) {
  const policy = isRecord(dataset.metadata) && isRecord(dataset.metadata.qualityPolicy) ? dataset.metadata.qualityPolicy : {};

  return {
    minAgreementRate: getPercentPolicyValue(policy.minAgreementRate, 0.8),
    minQualityScore: getNumberPolicyValue(policy.minQualityScore, 75),
    samplingTargetRate: getPercentPolicyValue(policy.samplingTargetRate, 0.2)
  };
}

export function getDatasetExportQualityWarnings(
  quality: QualityStatsResult | null,
  policy: { minAgreementRate: number; minQualityScore: number; samplingTargetRate: number }
) {
  if (!quality) {
    return [];
  }

  const warnings = [];

  if (quality.summary.datasetQualityScore < policy.minQualityScore) {
    warnings.push(`Quality score ${quality.summary.datasetQualityScore}/100 is below ${policy.minQualityScore}/100.`);
  }

  if (quality.sampling.sampleRate < policy.samplingTargetRate) {
    warnings.push(`Sampling coverage ${formatPercent(quality.sampling.sampleRate)} is below ${formatPercent(policy.samplingTargetRate)}.`);
  }

  if (quality.consensus.agreementRate !== null && quality.consensus.agreementRate < policy.minAgreementRate) {
    warnings.push(`Agreement ${formatPercent(quality.consensus.agreementRate)} is below ${formatPercent(policy.minAgreementRate)}.`);
  }

  return warnings;
}

export function getCompletionPercent(approved: number, total: number) {
  if (total <= 0) {
    return 0;
  }

  return Math.round((approved / total) * 100);
}

export function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getDatasetUploadFolderCounts(dataset: DatasetSummary, assets: AssetSummary[]) {
  const base = getDatasetUploadPrefix(dataset);
  const counts = new Map<string, number>();

  assets.forEach((asset) => {
    const folder = getAssignedUploadFolder(asset.objectKey);

    if (!folder || !folder.startsWith(base)) {
      return;
    }

    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  });

  return counts;
}

function getDatasetUploadFolderBase(dataset: DatasetSummary, folderCounts: Map<string, number>) {
  const prefix = getDatasetUploadPrefix(dataset);
  const existingBase = Array.from(folderCounts.keys())
    .map((folder) => folder.match(new RegExp(`^(${escapeRegExp(prefix)}-[a-z0-9]{6})(?:-\\d+)?$`))?.[1])
    .find((folder): folder is string => Boolean(folder));

  return existingBase ?? `${prefix}-${createReadableCode(6)}`;
}

function getNextDatasetUploadFolder(base: string, folderCounts: Map<string, number>) {
  let index = 0;

  while (true) {
    const folder = index === 0 ? base : `${base}-${index}`;

    if ((folderCounts.get(folder) ?? 0) < maxUploadFolderAssets) {
      return folder;
    }

    index += 1;
  }
}

function getDatasetUploadPrefix(dataset: DatasetSummary) {
  return `dataset/import/${toSafeObjectKeyPart(dataset.name) || "dataset"}`;
}

function getAssignedUploadFolder(objectKey: string) {
  const parts = objectKey.split("/").filter(Boolean);

  return parts[0] === "dataset" && parts[1] === "import" && parts[2]
    ? parts.slice(0, 3).join("/")
    : "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getXmlAttribute(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match?.[1] ?? match?.[2] ?? null;
}

function parseJsonRows(text: string): Record<string, unknown>[] {
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.data)
      ? parsed.data
      : isRecord(parsed)
        ? [parsed]
        : [];

  return rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new Error(`JSON row ${index + 1} must be an object.`);
    }

    return row;
  });
}

function parseJsonLines(text: string): Record<string, unknown>[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as unknown;

      if (!isRecord(parsed)) {
        throw new Error(`JSONL line ${index + 1} must be an object.`);
      }

      return parsed;
    });
}

function parseCsvRows(text: string): Record<string, unknown>[] {
  const rows = parseCsvTable(text);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) => header.trim());

  if (headers.some((header) => !header)) {
    throw new Error("CSV headers cannot be empty.");
  }

  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });

    return record;
  });
}

function parseCsvTable(text: string) {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function getPercentPolicyValue(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;
  const normalized = numeric > 1 ? numeric / 100 : numeric;

  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1 ? normalized : fallback;
}

function getNumberPolicyValue(value: unknown, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : fallback;

  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
