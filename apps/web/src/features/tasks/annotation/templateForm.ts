import type { AnnotationSummary, SaveAnnotationInput, TaskSummary } from "../../../api";

export interface TemplateSource {
  binding: string | null;
  name: string;
  type: "AUDIO" | "IMAGE" | "PDF" | "TEXT" | "TIME_SERIES" | "VIDEO" | "UNKNOWN";
}

export interface TextAreaControl {
  maxSubmissions: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  toName: string;
}

export interface ChoiceControl {
  choice: "multiple" | "single";
  choices: {
    color: string | null;
    value: string;
  }[];
  name: string;
  required: boolean;
  toName: string;
}

export interface NumberControl {
  max: number | null;
  min: number | null;
  name: string;
  required: boolean;
  toName: string;
}

export interface RatingControl {
  maxRating: number;
  name: string;
  required: boolean;
  toName: string;
}

export interface DateTimeControl {
  name: string;
  required: boolean;
  toName: string;
}

export interface TemporalLabelControl {
  labels: {
    color: string | null;
    value: string;
  }[];
  name: string;
  required: boolean;
  toName: string;
  type: "labels" | "timeserieslabels";
}

export interface TemporalRegionResponse {
  end: string;
  id: string;
  label: string;
  page?: number;
  start: string;
}

export type TemplateFormControl = ChoiceControl | DateTimeControl | NumberControl | RatingControl | TemporalLabelControl | TextAreaControl;

export function getConfigString(config: unknown, key: string) {
  if (!config || typeof config !== "object") {
    return null;
  }

  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function parseTemplateSources(configCode: string): TemplateSource[] {
  const sources: TemplateSource[] = [];
  const objectTagPattern = /<(Image|Text|HyperText|Paragraphs|Audio|Video|TimeSeries|Table|List|Chat|Pdf|PDF)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = objectTagPattern.exec(configCode))) {
    const tagName = match[1];
    const attributes = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");

    if (!name) {
      continue;
    }

    sources.push({
      binding: normalizeBinding(getXmlAttribute(attributes, "value") ?? getXmlAttribute(attributes, "valueList")),
      name,
      type: getSourceType(tagName)
    });
  }

  return dedupeSources(sources);
}

export function parseChoiceControls(configCode: string): ChoiceControl[] {
  const controls: ChoiceControl[] = [];
  const choicesPattern = /<Choices\b([^>]*)>([\s\S]*?)<\/Choices>/gi;
  let match: RegExpExecArray | null;

  while ((match = choicesPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    const choices = parseChoiceValues(body);

    if (choices.length === 0) {
      continue;
    }

    controls.push({
      choice: getXmlAttribute(attributes, "choice") === "multiple" ? "multiple" : "single",
      choices,
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function parseChoiceValues(body: string): ChoiceControl["choices"] {
  const choices: ChoiceControl["choices"] = [];
  const choicePattern = /<Choice\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = choicePattern.exec(body))) {
    const attributes = match[1] ?? "";
    const value = getXmlAttribute(attributes, "value");

    if (!value) {
      continue;
    }

    choices.push({
      color: getXmlAttribute(attributes, "background") ?? getXmlAttribute(attributes, "valueColor"),
      value
    });
  }

  return choices;
}

export function parseTextAreaControls(configCode: string): TextAreaControl[] {
  const controls: TextAreaControl[] = [];
  const textAreaPattern = /<TextArea\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = textAreaPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      maxSubmissions: parsePositiveInteger(getXmlAttribute(attributes, "maxSubmissions")),
      name,
      placeholder: getXmlAttribute(attributes, "placeholder"),
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

export function parseNumberControls(configCode: string): NumberControl[] {
  const controls: NumberControl[] = [];
  const numberPattern = /<Number\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = numberPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      max: parseFiniteNumber(getXmlAttribute(attributes, "max")),
      min: parseFiniteNumber(getXmlAttribute(attributes, "min")),
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

export function parseRatingControls(configCode: string): RatingControl[] {
  const controls: RatingControl[] = [];
  const ratingPattern = /<Rating\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = ratingPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      maxRating: Math.max(2, Math.min(10, parsePositiveInteger(getXmlAttribute(attributes, "maxRating")) ?? 5)),
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

export function parseDateTimeControls(configCode: string): DateTimeControl[] {
  const controls: DateTimeControl[] = [];
  const datePattern = /<DateTime\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = datePattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

export function parseTemporalLabelControls(configCode: string): TemporalLabelControl[] {
  const controls: TemporalLabelControl[] = [];
  const labelsPattern = /<(Labels|TimeSeriesLabels)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = labelsPattern.exec(configCode))) {
    const tagName = match[1];
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    const labels = parseLabelValues(body);

    if (labels.length === 0) {
      continue;
    }

    controls.push({
      labels,
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName,
      type: tagName === "TimeSeriesLabels" ? "timeserieslabels" : "labels"
    });
  }

  return controls;
}

export function parseRegionDrawingTools(configCode: string): Array<"BBOX" | "POLYGON"> {
  const tools: Array<"BBOX" | "POLYGON"> = [];

  if (/<(?:RectangleLabels|Rectangle|OcrLabels)\b/i.test(configCode)) {
    tools.push("BBOX");
  }

  if (/<(?:PolygonLabels|Polygon)\b/i.test(configCode)) {
    tools.push("POLYGON");
  }

  return tools;
}

export function dedupeDrawingTools(tools: Array<"BBOX" | "POLYGON">): Array<"BBOX" | "POLYGON"> {
  const seen = new Set<string>();
  const deduped: Array<"BBOX" | "POLYGON"> = [];

  tools.forEach((tool) => {
    if (seen.has(tool)) {
      return;
    }

    seen.add(tool);
    deduped.push(tool);
  });

  return deduped;
}

function parseLabelValues(body: string): TemporalLabelControl["labels"] {
  const labels: TemporalLabelControl["labels"] = [];
  const labelPattern = /<Label\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = labelPattern.exec(body))) {
    const attributes = match[1] ?? "";
    const value = getXmlAttribute(attributes, "value");

    if (!value) {
      continue;
    }

    labels.push({
      color: getXmlAttribute(attributes, "background") ?? getXmlAttribute(attributes, "valueColor"),
      value
    });
  }

  return labels;
}

function getXmlAttribute(attributes: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function normalizeBinding(value: string | null) {
  if (!value?.startsWith("$")) {
    return null;
  }

  return value.slice(1);
}

function getSourceType(tagName: string): TemplateSource["type"] {
  const normalized = tagName.toUpperCase();

  if (normalized === "IMAGE") return "IMAGE";
  if (normalized === "AUDIO") return "AUDIO";
  if (normalized === "VIDEO") return "VIDEO";
  if (normalized === "PDF") return "PDF";
  if (normalized === "TIMESERIES") return "TIME_SERIES";
  if (["TEXT", "HYPERTEXT", "PARAGRAPHS", "TABLE", "LIST", "CHAT"].includes(normalized)) return "TEXT";

  return "UNKNOWN";
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseFiniteNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function dedupeSources(sources: TemplateSource[]) {
  const seen = new Set<string>();
  const deduped: TemplateSource[] = [];

  sources.forEach((source) => {
    if (seen.has(source.name)) {
      return;
    }

    seen.add(source.name);
    deduped.push(source);
  });

  return deduped;
}

export function annotationToTextResponses(annotation: AnnotationSummary | null): Record<string, string> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, string> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    const result = getResultRecord(rawResult);
    const fromName = getResultFromName(result);
    const value = result?.value;

    if (!fromName || !isRecord(value)) {
      return;
    }

    const textValue = value.text;

    if (Array.isArray(textValue) && typeof textValue[0] === "string") {
      responses[fromName] = textValue[0];
    } else if (typeof textValue === "string") {
      responses[fromName] = textValue;
    }
  });

  return responses;
}

export function annotationToChoiceResponses(annotation: AnnotationSummary | null): Record<string, string[]> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, string[]> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    const result = getResultRecord(rawResult);
    const fromName = getResultFromName(result);
    const value = result?.value;

    if (!fromName || !isRecord(value)) {
      return;
    }

    if (Array.isArray(value.choices)) {
      responses[fromName] = value.choices.filter((choice): choice is string => typeof choice === "string");
    }
  });

  return responses;
}

export function annotationToScalarResponses(annotation: AnnotationSummary | null, valueKey: "datetime" | "number"): Record<string, string> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, string> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    const result = getResultRecord(rawResult);
    const fromName = getResultFromName(result);
    const value = result?.value;

    if (!fromName || !isRecord(value)) {
      return;
    }

    const rawValue = value[valueKey];

    if (typeof rawValue === "string") {
      responses[fromName] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      responses[fromName] = String(rawValue);
    }
  });

  return responses;
}

export function annotationToRatingResponses(annotation: AnnotationSummary | null): Record<string, number> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, number> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    const result = getResultRecord(rawResult);
    const fromName = getResultFromName(result);
    const value = result?.value;

    if (!fromName || !isRecord(value)) {
      return;
    }

    if (typeof value.rating === "number" && Number.isFinite(value.rating)) {
      responses[fromName] = value.rating;
    }
  });

  return responses;
}

export function annotationToTemporalResponses(annotation: AnnotationSummary | null): Record<string, TemporalRegionResponse[]> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, TemporalRegionResponse[]> = {};

  annotation.resultJson.results.forEach((rawResult, index) => {
    const result = getResultRecord(rawResult);
    const fromName = getResultFromName(result);
    const value = result?.value;

    if (!fromName || !isRecord(value)) {
      return;
    }

    const rawLabelList = Array.isArray(value.labels) ? value.labels : Array.isArray(value.timeserieslabels) ? value.timeserieslabels : null;
    const rawLabel = rawLabelList?.find((item): item is string => typeof item === "string");
    const start = value.start;
    const end = value.end;

    if (!rawLabel || (typeof start !== "string" && typeof start !== "number") || (typeof end !== "string" && typeof end !== "number")) {
      return;
    }

    responses[fromName] = [
      ...(responses[fromName] ?? []),
      {
        end: String(end),
        id: typeof result?.id === "string" ? result.id : `${fromName}-${index}`,
        label: rawLabel,
        start: String(start)
      }
    ];
  });

  return responses;
}

function getResultRecord(value: unknown) {
  return isRecord(value) ? value : null;
}

function getResultFromName(result: Record<string, unknown> | null) {
  if (!result) {
    return null;
  }

  return typeof result.from_name === "string" ? result.from_name : typeof result.fromName === "string" ? result.fromName : null;
}

export function formResponsesToResults({
  choiceControls,
  choiceResponses,
  dateTimeControls,
  dateTimeResponses,
  numberControls,
  numberResponses,
  ratingControls,
  ratingResponses,
  temporalControls,
  temporalResponses,
  textControls,
  textResponses
}: {
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  dateTimeControls: DateTimeControl[];
  dateTimeResponses: Record<string, string>;
  numberControls: NumberControl[];
  numberResponses: Record<string, string>;
  ratingControls: RatingControl[];
  ratingResponses: Record<string, number>;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textControls: TextAreaControl[];
  textResponses: Record<string, string>;
}): SaveAnnotationInput["results"] {
  const textResults = textControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "textarea",
      value: {
        text: [(textResponses[control.name] ?? "").trim()]
      }
    }))
    .filter((result) => result.value.text[0].length > 0);

  const choiceResults = choiceControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "choices",
      value: {
        choices: choiceResponses[control.name] ?? []
      }
    }))
    .filter((result) => result.value.choices.length > 0);

  const numberResults = numberControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "number",
      value: {
        number: Number(numberResponses[control.name])
      }
    }))
    .filter((result) => Number.isFinite(result.value.number));

  const ratingResults = ratingControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "rating",
      value: {
        rating: ratingResponses[control.name]
      }
    }))
    .filter((result) => typeof result.value.rating === "number" && Number.isFinite(result.value.rating));

  const dateTimeResults = dateTimeControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "datetime",
      value: {
        datetime: (dateTimeResponses[control.name] ?? "").trim()
      }
    }))
    .filter((result) => result.value.datetime.length > 0);

  const temporalResults = temporalControls.flatMap((control) =>
    (temporalResponses[control.name] ?? []).map((region) => ({
      fromName: control.name,
      toName: control.toName,
      type: control.type,
      value:
        control.type === "timeserieslabels"
          ? {
              end: region.end,
              instant: region.start === region.end,
              ...(region.page ? { page: region.page } : {}),
              start: region.start,
              timeserieslabels: [region.label]
            }
          : {
              end: Number(region.end),
              labels: [region.label],
              ...(region.page ? { page: region.page } : {}),
              start: Number(region.start)
            }
    }))
  ).filter((result) => {
    if (result.type === "timeserieslabels") {
      return typeof result.value.start === "string" && result.value.start.length > 0 && typeof result.value.end === "string" && result.value.end.length > 0;
    }

    return (
      Number.isFinite(result.value.start) &&
      Number.isFinite(result.value.end) &&
      result.value.end >= result.value.start &&
      (!("page" in result.value) || Number.isFinite(result.value.page))
    );
  });

  return [...choiceResults, ...textResults, ...numberResults, ...ratingResults, ...dateTimeResults, ...temporalResults];
}

export function toggleChoiceValue(current: string[], value: string, mode: ChoiceControl["choice"]) {
  if (mode === "single") {
    return current.includes(value) ? [] : [value];
  }

  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

export function hasControlResponse(
  control: TemplateFormControl,
  textResponses: Record<string, string>,
  choiceResponses: Record<string, string[]>,
  numberResponses: Record<string, string>,
  ratingResponses: Record<string, number>,
  dateTimeResponses: Record<string, string>,
  temporalResponses: Record<string, TemporalRegionResponse[]>
) {
  if ("choices" in control) {
    return (choiceResponses[control.name]?.length ?? 0) > 0;
  }

  if ("labels" in control) {
    return (temporalResponses[control.name]?.length ?? 0) > 0;
  }

  if ("maxRating" in control) {
    return Boolean(ratingResponses[control.name]);
  }

  if ("min" in control) {
    return Boolean(numberResponses[control.name]?.trim());
  }

  if (!("placeholder" in control)) {
    return Boolean(dateTimeResponses[control.name]?.trim());
  }

  return Boolean(textResponses[control.name]?.trim());
}

export function getTemplateSourceValue(
  task: TaskSummary,
  source: TemplateSource,
  textAssetContent: string | null
) {
  const binding = source.binding;
  const taskMetadata = isRecord(task.metadata) ? task.metadata : {};
  const assetMetadata = isRecord(task.asset?.metadata) ? task.asset.metadata : {};
  const taskData = isRecord(taskMetadata.data) ? taskMetadata.data : {};
  const assetData = isRecord(assetMetadata.data) ? assetMetadata.data : {};

  if (binding) {
    const value = taskData[binding] ?? assetData[binding] ?? taskMetadata[binding] ?? assetMetadata[binding];

    if (typeof value === "string") {
      return value;
    }

    if (value != null) {
      return JSON.stringify(value, null, 2);
    }
  }

  if (source.type === "TEXT") {
    return textAssetContent ?? getStringValue(assetMetadata.text) ?? getStringValue(taskMetadata.text) ?? task.asset?.fileName ?? "";
  }

  return "";
}

export function isTextLikeAsset(mimeType?: string | null) {
  if (!mimeType) {
    return false;
  }

  return mimeType.startsWith("text/") || ["application/json", "application/ld+json", "application/xml"].includes(mimeType);
}

export function formatControlName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
