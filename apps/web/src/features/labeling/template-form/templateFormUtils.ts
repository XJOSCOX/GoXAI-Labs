import type { AnnotationTemplateSummary, BuiltInAnnotationTemplateGroup } from "../../../api";
import { annotationLabelColors, parseLabelInputsFromText, type LabelingSettings, type TemplatePreset } from "../../../components/labeling/LabelingConfigBuilder";
import { formatEnum } from "../../../utils/format";

export const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
export const labelPositions: Array<LabelingSettings["labelPosition"]> = ["top", "right", "bottom", "left"];
export const templateToolDefinitions = [
  { id: "BBOX", label: "Bounding box", tagNames: ["RectangleLabels", "OcrLabels"], type: "label" },
  { id: "RECTANGLE", label: "Rectangle", tagNames: ["Rectangle"], type: "direct" },
  { id: "POLYGON", label: "Polygon", tagNames: ["PolygonLabels"], type: "label" },
  { id: "BRUSH", label: "Brush", tagNames: ["BrushLabels"], type: "label" },
  { id: "BITMASK", label: "Bitmask", tagNames: ["BitmaskLabels"], type: "label" },
  { id: "ELLIPSE", label: "Ellipse", tagNames: ["EllipseLabels"], type: "label" },
  { id: "KEYPOINT", label: "Keypoint", tagNames: ["KeyPointLabels"], type: "label" },
  { id: "VECTOR", label: "Vector", tagNames: ["VectorLabels"], type: "label" },
  { id: "VIDEO_RECTANGLE", label: "Video rectangle", tagNames: ["VideoRectangle"], type: "direct" },
  { id: "VIDEO_LABELS", label: "Video labels", tagNames: ["Labels"], type: "label" },
  { id: "VIDEO_VECTOR", label: "Video vector", tagNames: ["VideoVectorLabels", "VideoVector"], type: "label" },
  { id: "AUDIO_REGION", label: "Audio region", tagNames: ["Labels"], type: "label" },
  { id: "TIME_SERIES_LABELS", label: "Time series labels", tagNames: ["TimeSeriesLabels"], type: "label" },
  { id: "TIMELINE_LABELS", label: "Timeline labels", tagNames: ["TimelineLabels"], type: "label" },
  { id: "TEXT_SPAN", label: "Text span", tagNames: ["Labels"], type: "label" },
  { id: "HYPERTEXT_LABELS", label: "HyperText labels", tagNames: ["HyperTextLabels"], type: "label" },
  { id: "PARAGRAPH_LABELS", label: "Paragraph labels", tagNames: ["ParagraphLabels"], type: "label" },
  { id: "CLASSIFICATION", label: "Choices", tagNames: ["Choices"], type: "choice" },
  { id: "TEXT_AREA", label: "Text area", tagNames: ["TextArea"], type: "field" },
  { id: "CHAT", label: "Chat", tagNames: ["Chat"], type: "field" },
  { id: "NUMBER", label: "Number", tagNames: ["Number"], type: "field" },
  { id: "RATING", label: "Rating", tagNames: ["Rating"], type: "field" },
  { id: "DATE_TIME", label: "Date/time", tagNames: ["DateTime"], type: "field" },
  { id: "TAXONOMY", label: "Taxonomy", tagNames: ["Taxonomy"], type: "choice" },
  { id: "RANKER", label: "Ranker", tagNames: ["Ranker"], type: "choice" },
  { id: "PAIRWISE", label: "Pairwise", tagNames: ["Pairwise"], type: "field" },
  { id: "RELATION", label: "Relation", tagNames: ["Relations", "Relation"], type: "relation" },
  { id: "MAGIC_WAND", label: "Magic wand", tagNames: ["MagicWand"], type: "field" },
  { id: "SHORTCUT", label: "Shortcut", tagNames: ["Shortcut"], type: "field" }
] as const;
export const templateTools = templateToolDefinitions.map((tool) => tool.id);

export type ParsedTemplateConfig = {
  dataKey: string;
  header: string;
  labels: Array<{ color: string; name: string }>;
  parseError: string | null;
  settings: LabelingSettings;
  tools: string[];
};

export function parseTemplateConfigCode(configCode: string): ParsedTemplateConfig {
  const fallback: ParsedTemplateConfig = {
    dataKey: "$image",
    header: "Select label and annotate the asset",
    labels: [],
    parseError: null,
    settings: {
      imageZoom: true,
      labelPosition: "top",
      regionBorderWidth: 1,
      rotateControls: false,
      zoomControls: true
    },
    tools: []
  };

  if (!configCode.trim()) {
    return {
      ...fallback,
      parseError: "Template code is empty."
    };
  }

  if (typeof DOMParser === "undefined") {
    return fallback;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(configCode, "application/xml");
  const parserError = document.getElementsByTagName("parsererror")[0];

  if (parserError) {
    return {
      ...fallback,
      parseError: "Template code has invalid XML."
    };
  }

  const imageNode = getFirstObjectNode(document);
  const firstToolNode = getFirstToolNode(document);
  const labels = Array.from(document.getElementsByTagName("Label"))
    .map((labelNode, index) => ({
      color: labelNode.getAttribute("background") || labelNode.getAttribute("valueColor") || annotationLabelColors[index % annotationLabelColors.length],
      name: labelNode.getAttribute("value")?.trim() ?? ""
    }))
    .filter((label) => label.name.length > 0);
  const choices = Array.from(document.getElementsByTagName("Choice"))
    .map((choiceNode, index) => ({
      color: choiceNode.getAttribute("background") || choiceNode.getAttribute("valueColor") || annotationLabelColors[(labels.length + index) % annotationLabelColors.length],
      name: choiceNode.getAttribute("value")?.trim() ?? ""
    }))
    .filter((choice) => choice.name.length > 0);
  const tools = getTemplateToolsFromDocument(document);
  const strokeWidth = Number(firstToolNode?.getAttribute("strokeWidth"));
  const labelPosition = parseLabelPosition(
    firstToolNode?.getAttribute("labelPosition") ??
    firstToolNode?.getAttribute("labelsPosition") ??
    firstToolNode?.getAttribute("displayLabels") ??
    fallback.settings.labelPosition
  );

  return {
    dataKey: imageNode?.getAttribute("value")?.trim() || fallback.dataKey,
    header: document.getElementsByTagName("Header")[0]?.getAttribute("value")?.trim() || fallback.header,
    labels: [...labels, ...choices],
    parseError: null,
    settings: {
      imageZoom: imageNode?.getAttribute("zoom") !== "false",
      labelPosition,
      regionBorderWidth: Number.isFinite(strokeWidth) ? Math.max(1, Math.min(8, strokeWidth)) : 1,
      rotateControls: imageNode?.getAttribute("rotateControl") === "true",
      zoomControls: imageNode?.getAttribute("zoomControl") !== "false"
    },
    tools
  };
}

function parseLabelPosition(value: string): LabelingSettings["labelPosition"] {
  return value === "right" || value === "bottom" || value === "left" ? value : "top";
}

function getFirstObjectNode(document: Document) {
  const objectTags = ["Image", "Video", "Audio", "Text", "HyperText", "Paragraphs", "TimeSeries", "Table", "Pdf", "PDF", "List", "Chat"];

  for (const tag of objectTags) {
    const node = document.getElementsByTagName(tag)[0];

    if (node) {
      return node;
    }
  }

  return null;
}

export function getTemplateToolsFromDocument(document: Document) {
  const tools = new Set<string>();

  templateToolDefinitions
    .filter((definition) => !["AUDIO_REGION", "TEXT_SPAN", "VIDEO_LABELS"].includes(definition.id))
    .filter((definition) => definition.tagNames.some((tagName) => document.getElementsByTagName(tagName).length > 0))
    .forEach((definition) => tools.add(definition.id));

  Array.from(document.getElementsByTagName("Labels")).forEach((node) => {
    const targetName = node.getAttribute("toName");
    const targetNode = targetName ? document.querySelector(`[name="${CSS.escape(targetName)}"]`) : null;
    const targetTag = targetNode?.tagName.toLowerCase();

    if (targetTag === "audio") {
      tools.add("AUDIO_REGION");
    } else if (targetTag === "video") {
      tools.add("VIDEO_LABELS");
    } else {
      tools.add("TEXT_SPAN");
    }
  });

  return Array.from(tools);
}

function getFirstToolNode(document: Document) {
  const toolTags = templateToolDefinitions.flatMap((definition) => definition.tagNames);

  for (const tag of toolTags) {
    const node = document.getElementsByTagName(tag)[0];

    if (node) {
      return node;
    }
  }

  return null;
}

export function getPreviewColor(labels: Array<{ color: string }>, index: number) {
  return labels[index]?.color || annotationLabelColors[index % annotationLabelColors.length];
}

export function colorWithAlpha(color: string, alpha: number) {
  const hex = color.trim();

  if (!hex.startsWith("#") || (hex.length !== 4 && hex.length !== 7)) {
    return color;
  }

  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function addLabelsToTemplateCode(configCode: string, labelNames: string[]) {
  const parsed = parseTemplateConfigCode(configCode);
  const existingLabels = new Set(parsed.labels.map((label) => label.name.toLowerCase()));
  const nextLabels = labelNames.filter((name) => !existingLabels.has(name.toLowerCase()));

  if (nextLabels.length === 0) {
    return configCode;
  }

  let colorIndex = parsed.labels.length;
  const toolContainerPattern = /(<(RectangleLabels|PolygonLabels|BrushLabels|BitmaskLabels|EllipseLabels|KeyPointLabels|VectorLabels|VideoVectorLabels|TimeSeriesLabels|TimelineLabels|Labels|HyperTextLabels|ParagraphLabels|Choices|Taxonomy|Ranker)\b[^>]*>)([\s\S]*?)(<\/\2>)/g;

  return configCode.replace(toolContainerPattern, (match, openTag: string, tagName: string, content: string, closeTag: string) => {
    const existingInContainer = new Set(
      Array.from(content.matchAll(/\bvalue="([^"]+)"/g)).map((result) => decodeTemplateMarkup(result[1]).toLowerCase())
    );
    const labelMarkup = nextLabels
      .filter((name) => !existingInContainer.has(name.toLowerCase()))
      .map((name) => {
        const color = annotationLabelColors[colorIndex % annotationLabelColors.length];
        colorIndex += 1;

        if (tagName === "Choices" || tagName === "Taxonomy" || tagName === "Ranker") {
          return `    <Choice value="${escapeTemplateMarkup(name)}" valueColor="${color}" />`;
        }

        return `    <Label value="${escapeTemplateMarkup(name)}" background="${color}" />`;
      });

    if (labelMarkup.length === 0) {
      return match;
    }

    const nextContent = `${content.trimEnd()}\n${labelMarkup.join("\n")}\n  `;

    return `${openTag}${nextContent}${closeTag}`;
  });
}

export function setMediaAttributeInCode(configCode: string, attribute: string, value: string) {
  return configCode.replace(/<(Image|Video|Audio|Text|HyperText|Paragraphs|TimeSeries|Table|Pdf|PDF|List|Chat)\b([^>]*?)(\s*\/?)>/, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, attribute, value).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/" || tagName !== "Text";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

export function setToolStrokeWidthInCode(configCode: string, value: number) {
  const width = Number.isFinite(value) ? String(Math.max(1, Math.min(8, value))) : "1";

  return configCode.replace(/<(RectangleLabels|Rectangle|PolygonLabels|Polygon|EllipseLabels|Ellipse|KeyPointLabels|KeyPoint|VectorLabels|Vector|VideoRectangle|VideoVectorLabels|VideoVector|TimeSeriesLabels|TimelineLabels)\b([^>]*?)(\s*\/?)>/g, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, "strokeWidth", width).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

export function setToolLabelPositionInCode(configCode: string, value: LabelingSettings["labelPosition"]) {
  const position = parseLabelPosition(value);

  return configCode.replace(/<(RectangleLabels|PolygonLabels|BrushLabels|BitmaskLabels|EllipseLabels|KeyPointLabels|VectorLabels|VideoVectorLabels|TimeSeriesLabels|TimelineLabels|Labels|HyperTextLabels|ParagraphLabels|Choices|Taxonomy|Ranker)\b([^>]*?)(\s*\/?)>/g, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, "labelPosition", position).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

export function toggleToolInCode(configCode: string, tool: string, enabled: boolean) {
  const tagName = getToolTagName(tool);

  if (!tagName) {
    return configCode;
  }

  const toolPattern = new RegExp(`\\n?\\s*<${tagName}\\b(?:[\\s\\S]*?<\\/${tagName}>|[^>]*\\/>)`, "g");

  if (!enabled) {
    return configCode.replace(toolPattern, "");
  }

  if (new RegExp(`<${tagName}\\b`).test(configCode)) {
    return configCode;
  }

  const parsed = parseTemplateConfigCode(configCode);
  const labelMarkup = buildLabelMarkupFromParsed(parsed.labels, tool);
  const toolMarkup = buildToolMarkup(tool, labelMarkup, parsed.settings);

  if (/<\/View>\s*$/.test(configCode)) {
    return configCode.replace(/\s*<\/View>\s*$/, `\n\n${toolMarkup}\n</View>`);
  }

  return `${configCode.trimEnd()}\n\n${toolMarkup}`;
}

function getToolTagName(tool: string) {
  return getToolDefinition(tool)?.tagNames[0] ?? null;
}

export function getToolLabel(tool: string) {
  return getToolDefinition(tool)?.label ?? formatEnum(tool);
}

function getToolDefinition(tool: string) {
  return templateToolDefinitions.find((definition) => definition.id === tool);
}


function buildLabelMarkupFromParsed(labels: ParsedTemplateConfig["labels"], tool: string) {
  const sourceLabels = labels.length > 0
    ? labels
    : [{ color: annotationLabelColors[0], name: "Label" }];

  return sourceLabels
    .map((label) => {
      if (["CLASSIFICATION", "TAXONOMY", "RANKER"].includes(tool)) {
        return `    <Choice value="${escapeTemplateMarkup(label.name)}" valueColor="${label.color}" />`;
      }

      return `    <Label value="${escapeTemplateMarkup(label.name)}" background="${label.color}" />`;
    })
    .join("\n");
}

function setXmlAttribute(attributes: string, attribute: string, value: string) {
  const attributePattern = new RegExp(`\\s${attribute}="[^"]*"`);

  if (attributePattern.test(attributes)) {
    return attributes.replace(attributePattern, ` ${attribute}="${escapeTemplateMarkup(value)}"`);
  }

  return `${attributes} ${attribute}="${escapeTemplateMarkup(value)}"`;
}

function decodeTemplateMarkup(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function getTemplateConfigString(template: AnnotationTemplateSummary | null, key: string) {
  const value = template?.configJson?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function templateLabelsToText(template: AnnotationTemplateSummary | null) {
  const labels = template?.configJson.labels;

  if (!Array.isArray(labels)) {
    return "";
  }

  return labels
    .map((label) => {
      if (typeof label === "string") {
        return label;
      }

      if (label && typeof label === "object" && "name" in label && typeof label.name === "string") {
        return label.name;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function getTemplateTools(template: AnnotationTemplateSummary | null, sourcePreset: TemplatePreset | null) {
  const tools = template?.configJson.tools;

  if (!template || !Array.isArray(tools)) {
    return sourcePreset?.tools ?? ["BBOX"];
  }

  const parsedTools = tools.map((tool) => {
    if (typeof tool === "string") {
      return tool;
    }

    if (tool && typeof tool === "object" && "tool" in tool && typeof tool.tool === "string") {
      return tool.tool;
    }

    return "";
  }).filter(Boolean);

  return parsedTools.length > 0 ? parsedTools : ["BBOX"];
}

export function getTemplateSettings(template: AnnotationTemplateSummary | null, sourcePreset: TemplatePreset | null): LabelingSettings {
  const rawSettings = template?.configJson.settings;
  const presetSettings = sourcePreset?.settings ?? {};

  return {
    imageZoom: getBooleanSetting(rawSettings, "imageZoom", presetSettings.imageZoom ?? true),
    labelPosition: getLabelPositionSetting(rawSettings, "labelPosition", presetSettings.labelPosition ?? "top"),
    regionBorderWidth: getNumberSetting(rawSettings, "regionBorderWidth", presetSettings.regionBorderWidth ?? 1),
    rotateControls: getBooleanSetting(rawSettings, "rotateControls", presetSettings.rotateControls ?? false),
    zoomControls: getBooleanSetting(rawSettings, "zoomControls", presetSettings.zoomControls ?? true)
  };
}

function getBooleanSetting(settings: unknown, key: string, fallback: boolean) {
  return settings && typeof settings === "object" && key in settings && typeof (settings as Record<string, unknown>)[key] === "boolean"
    ? ((settings as Record<string, unknown>)[key] as boolean)
    : fallback;
}

function getNumberSetting(settings: unknown, key: string, fallback: number) {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[key] : null;

  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getLabelPositionSetting(settings: unknown, key: string, fallback: LabelingSettings["labelPosition"]) {
  const value = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[key] : null;

  return typeof value === "string" ? parseLabelPosition(value) : fallback;
}

export function getCustomCategoryId(categoryKey?: string) {
  return categoryKey?.startsWith("custom:") ? categoryKey.replace("custom:", "") : null;
}

export function getBuiltInCategoryName(categoryKey: string | undefined, builtInCategories: BuiltInAnnotationTemplateGroup[]) {
  if (!categoryKey?.startsWith("builtin:")) {
    return null;
  }

  const categoryIdOrName = categoryKey.replace("builtin:", "");
  return builtInCategories.find((category) => category.id === categoryIdOrName)?.name ?? categoryIdOrName;
}

export function normalizePresetDataType(dataType?: string) {
  if (!dataType) {
    return null;
  }

  const normalized = dataType.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_+|_+$/g, "");

  if (normalized.includes("VIDEO")) {
    return "VIDEO";
  }

  if (normalized.includes("AUDIO")) {
    return "AUDIO";
  }

  if (normalized.includes("PDF")) {
    return "PDF";
  }

  if (normalized.includes("TEXT")) {
    return "TEXT";
  }

  if (normalized.includes("TIME")) {
    return "TIME_SERIES";
  }

  if (normalized.includes("MULTIMODAL")) {
    return "MULTIMODAL";
  }

  return "IMAGE";
}

export function buildTemplateMarkup(
  header: string,
  dataKey: string,
  labelsText: string,
  tools: string[],
  settings: Partial<LabelingSettings>
) {
  const labels = parseLabelInputsFromText(labelsText);
  const labelMarkup = labels.length > 0
    ? labels.map((label) => `    <Label value="${escapeTemplateMarkup(label.name)}" background="${label.color}" />`).join("\n")
    : `    <Label value="Label" background="#7dd3fc" />`;
  const tagMarkup = tools.length > 0
    ? tools.map((tool) => buildToolMarkup(tool, labelMarkup, settings)).join("\n\n")
    : buildToolMarkup("BBOX", labelMarkup, settings);

  return `<View>
  <Header value="${escapeTemplateMarkup(header)}" />
  <Image name="image" value="${escapeTemplateMarkup(dataKey)}" zoom="${settings.imageZoom !== false ? "true" : "false"}" zoomControl="${settings.zoomControls !== false ? "true" : "false"}" rotateControl="${settings.rotateControls === true ? "true" : "false"}" />

${tagMarkup}
</View>`;
}

function buildToolMarkup(tool: string, labelMarkup: string, settings: Partial<LabelingSettings>) {
  const strokeWidth = settings.regionBorderWidth ?? 1;
  const labelPosition = parseLabelPosition(settings.labelPosition ?? "top");
  const labelPositionAttribute = ` labelPosition="${labelPosition}"`;

  if (tool === "RECTANGLE") {
    return `  <Rectangle name="box" toName="image" strokeWidth="${strokeWidth}" />`;
  }

  if (tool === "POLYGON") {
    return `  <PolygonLabels name="label" toName="image" strokeWidth="${strokeWidth}" pointSize="small" opacity="0.9"${labelPositionAttribute}>
${labelMarkup}
  </PolygonLabels>`;
  }

  if (tool === "ELLIPSE") {
    return `  <EllipseLabels name="label" toName="image" strokeWidth="${strokeWidth}"${labelPositionAttribute}>
${labelMarkup}
  </EllipseLabels>`;
  }

  if (tool === "BRUSH") {
    return `  <BrushLabels name="label" toName="image" opacity="0.65"${labelPositionAttribute}>
${labelMarkup}
  </BrushLabels>`;
  }

  if (tool === "BITMASK") {
    return `  <BitmaskLabels name="label" toName="image" opacity="0.65"${labelPositionAttribute}>
${labelMarkup}
  </BitmaskLabels>`;
  }

  if (tool === "TEXT_SPAN") {
    return `  <Labels name="label" toName="text"${labelPositionAttribute}>
${labelMarkup}
  </Labels>`;
  }

  if (tool === "HYPERTEXT_LABELS") {
    return `  <HyperTextLabels name="label" toName="html"${labelPositionAttribute}>
${labelMarkup}
  </HyperTextLabels>`;
  }

  if (tool === "PARAGRAPH_LABELS") {
    return `  <ParagraphLabels name="label" toName="paragraphs"${labelPositionAttribute}>
${labelMarkup}
  </ParagraphLabels>`;
  }

  if (tool === "KEYPOINT") {
    return `  <KeyPointLabels name="label" toName="image" strokeWidth="${strokeWidth}"${labelPositionAttribute}>
${labelMarkup}
  </KeyPointLabels>`;
  }

  if (tool === "VECTOR") {
    return `  <VectorLabels name="label" toName="image" strokeWidth="${strokeWidth}"${labelPositionAttribute}>
${labelMarkup}
  </VectorLabels>`;
  }

  if (tool === "VIDEO_RECTANGLE") {
    return `  <VideoRectangle name="box" toName="video" strokeWidth="${strokeWidth}" />`;
  }

  if (tool === "VIDEO_LABELS") {
    return `  <Labels name="label" toName="video"${labelPositionAttribute}>
${labelMarkup}
  </Labels>`;
  }

  if (tool === "VIDEO_VECTOR") {
    return `  <VideoVectorLabels name="label" toName="video" strokeWidth="${strokeWidth}"${labelPositionAttribute}>
${labelMarkup}
  </VideoVectorLabels>`;
  }

  if (tool === "AUDIO_REGION") {
    return `  <Labels name="label" toName="audio"${labelPositionAttribute}>
${labelMarkup}
  </Labels>`;
  }

  if (tool === "TIME_SERIES_LABELS") {
    return `  <TimeSeriesLabels name="label" toName="timeseries"${labelPositionAttribute}>
${labelMarkup}
  </TimeSeriesLabels>`;
  }

  if (tool === "TIMELINE_LABELS") {
    return `  <TimelineLabels name="label" toName="video"${labelPositionAttribute}>
${labelMarkup}
  </TimelineLabels>`;
  }

  if (tool === "CLASSIFICATION") {
    return `  <Choices name="label" toName="image" choice="single"${labelPositionAttribute}>
${labelMarkup}
  </Choices>`;
  }

  if (tool === "TEXT_AREA") {
    return `  <TextArea name="transcription" toName="image" editable="true" />`;
  }

  if (tool === "NUMBER") {
    return `  <Number name="number" toName="image" />`;
  }

  if (tool === "RATING") {
    return `  <Rating name="rating" toName="image" maxRating="5" />`;
  }

  if (tool === "DATE_TIME") {
    return `  <DateTime name="datetime" toName="image" />`;
  }

  if (tool === "TAXONOMY") {
    return `  <Taxonomy name="taxonomy" toName="image"${labelPositionAttribute}>
${labelMarkup}
  </Taxonomy>`;
  }

  if (tool === "RANKER") {
    return `  <Ranker name="ranker" toName="image"${labelPositionAttribute}>
${labelMarkup}
  </Ranker>`;
  }

  if (tool === "PAIRWISE") {
    return `  <Pairwise name="comparison" toName="image" />`;
  }

  if (tool === "RELATION") {
    return `  <Relations>
    <Relation value="related" />
  </Relations>`;
  }

  if (tool === "MAGIC_WAND") {
    return `  <MagicWand name="magic" toName="image" />`;
  }

  if (tool === "SHORTCUT") {
    return `  <Shortcut value="ctrl+enter" alias="Submit" />`;
  }

  return `  <RectangleLabels name="label" toName="image" strokeWidth="${strokeWidth}"${labelPositionAttribute}>
${labelMarkup}
  </RectangleLabels>`;
}

function escapeTemplateMarkup(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
