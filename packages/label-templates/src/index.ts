import { parse as parseYaml } from "yaml";

export type LabelingSettings = {
  imageZoom: boolean;
  labelPosition: "top" | "right" | "bottom" | "left";
  regionBorderWidth: number;
  rotateControls: boolean;
  zoomControls: boolean;
};

export type TemplateCategoryPreset = {
  description: string;
  id: string;
  name: string;
  order: number;
};

export type TemplatePreset = {
  category: string;
  categoryId?: string;
  configCode?: string;
  configPath?: string;
  dataType: string;
  description: string;
  details?: string;
  id: string;
  image?: string;
  labels: string[];
  name: string;
  order?: number;
  settings?: Partial<LabelingSettings>;
  source?: "builtin" | "custom";
  sourceRepo?: string;
  sourceTemplateId?: string;
  subtype: string;
  tools: string[];
  type?: string;
};

type TemplateRecipe = {
  config: string;
  dataType?: string;
  details?: string;
  group: string;
  image?: string;
  order?: number;
  sourceRepo?: string;
  title: string;
  type?: string;
};

export const annotationLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

const categoryModules = import.meta.glob<TemplateCategoryPreset[]>("../templates/categories.json", {
  eager: true,
  import: "default"
});

const groupModules = import.meta.glob<string>("../templates/groups.txt", {
  eager: true,
  import: "default",
  query: "?raw"
});

const recipeModules = import.meta.glob<string>("../templates/*/*/config.yml", {
  eager: true,
  import: "default",
  query: "?raw"
});

const groupNames = parseGroupList(Object.values(groupModules)[0] ?? "");
const categoriesFromJson = applyGroupOrdering(Object.values(categoryModules)[0] ?? [], groupNames);
const categoryDefaults = new Map(categoriesFromJson.map((category) => [category.id, category]));

const loadedRecipes = Object.entries(recipeModules)
  .map(([modulePath, rawRecipe]) => normalizeRecipe(modulePath, rawRecipe))
  .sort((a, b) => a.categoryOrder - b.categoryOrder || a.order - b.order || a.title.localeCompare(b.title));

export const builtInTemplateCategories: TemplateCategoryPreset[] = Array.from(
  loadedRecipes.reduce((categories, recipe) => {
    if (!categories.has(recipe.categoryId)) {
      const fallback = categoryDefaults.get(recipe.categoryId);
      categories.set(recipe.categoryId, {
        description: fallback?.description ?? `${recipe.group} templates and starter labeling configurations.`,
        id: recipe.categoryId,
        name: recipe.group,
        order: recipe.categoryOrder
      });
    }

    return categories;
  }, new Map<string, TemplateCategoryPreset>()).values()
).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

export const builtInTemplatePresets: TemplatePreset[] = loadedRecipes.map((recipe) => {
  const summary = summarizeConfig(recipe.config);

  return {
    category: recipe.group,
    categoryId: recipe.categoryId,
    configCode: recipe.config,
    configPath: recipe.configPath,
    dataType: recipe.dataType ?? summary.dataType,
    description: detailsToDescription(recipe.details) ?? `${recipe.title} labeling template.`,
    details: recipe.details,
    id: recipe.id,
    image: recipe.image,
    labels: summary.labels,
    name: recipe.title,
    order: recipe.order,
    settings: summary.settings,
    source: "builtin",
    sourceRepo: recipe.sourceRepo,
    subtype: recipe.title,
    tools: summary.tools,
    type: recipe.type
  };
});

export function getBuiltInTemplatePreset(templateId: string) {
  return builtInTemplatePresets.find((template) => template.id === templateId) ?? null;
}

function normalizeRecipe(modulePath: string, rawRecipe: string) {
  const recipe = parseRecipeYaml(rawRecipe, modulePath);
  const normalizedPath = modulePathToTemplatePath(modulePath);
  const categoryId = categoryIdFromPath(modulePath);
  const fallback = categoryDefaults.get(categoryId);
  const templateId = `${categoryId}/${templateIdFromPath(modulePath)}`;

  return {
    ...recipe,
    categoryId,
    categoryOrder: fallback?.order ?? 100,
    configPath: normalizedPath,
    group: recipe.group || fallback?.name || titleFromSlug(categoryId),
    id: templateId,
    order: recipe.order ?? templateOrderFromPath(modulePath)
  };
}

function parseRecipeYaml(rawRecipe: string, sourcePath: string): TemplateRecipe {
  const result = parseYamlObject(rawRecipe, sourcePath);

  return {
    config: readString(result.config) ?? "<View></View>",
    dataType: readString(result.dataType),
    details: readString(result.details),
    group: readString(result.group) ?? "Custom Templates",
    image: readString(result.image),
    order: readNumber(result.order),
    sourceRepo: readString(result.source_repo),
    title: readString(result.title) ?? "Untitled template",
    type: readString(result.type)
  };
}

function parseYamlObject(rawRecipe: string, sourcePath: string) {
  try {
    const parsed = parseYaml(rawRecipe) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a YAML mapping at the document root.");
    }

    return parsed as Record<string, unknown>;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "Unknown YAML parse error.";
    throw new Error(`Unable to parse template recipe ${sourcePath}: ${message}`);
  }
}

function readString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  return undefined;
}

function parseGroupList(rawGroups: string) {
  return rawGroups
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((group) => group.trim())
    .filter(Boolean);
}

function applyGroupOrdering(categories: TemplateCategoryPreset[], groups: string[]) {
  const orderByName = new Map(groups.map((group, index) => [normalizeGroupName(group), (index + 1) * 10]));

  return categories.map((category) => ({
    ...category,
    order: orderByName.get(normalizeGroupName(category.name)) ?? category.order
  }));
}

function normalizeGroupName(group: string) {
  return group.trim().toLowerCase();
}

function summarizeConfig(config: string) {
  const labels = Array.from(config.matchAll(/<(?:Label|Choice)\b[^>]*\bvalue="([^"]+)"/g)).map((match) => decodeXml(match[1]));
  const tools = Array.from(new Set(getToolMatches(config)));

  return {
    dataType: inferDataType(config),
    labels,
    settings: inferSettings(config),
    tools
  };
}

function getToolMatches(config: string) {
  const definitions: Array<[string, RegExp]> = [
    ["BBOX", /<RectangleLabels\b|<Rectangle\b/],
    ["POLYGON", /<PolygonLabels\b|<Polygon\b/],
    ["BRUSH", /<BrushLabels\b|<BitmaskLabels\b/],
    ["ELLIPSE", /<EllipseLabels\b|<Ellipse\b/],
    ["KEYPOINT", /<KeyPointLabels\b|<KeyPoint\b/],
    ["VECTOR", /<VectorLabels\b|<Vector\b/],
    ["TEXT_SPAN", /<(?:Labels|HyperTextLabels|ParagraphLabels|OcrLabels)\b[^>]*toName="(?:text|html|paragraphs|ocr|pdf)"/],
    ["AUDIO_REGION", /<Labels\b[^>]*toName="audio"/],
    ["VIDEO_REGION", /<Labels\b[^>]*toName="video"|<VideoRectangle\b|<VideoVector/],
    ["TIMESERIES_RANGE", /<TimeSeriesLabels\b|<TimelineLabels\b/],
    ["CLASSIFICATION", /<Choices\b/],
    ["TAXONOMY", /<Taxonomy\b/],
    ["RANKER", /<Ranker\b/],
    ["RATING", /<Rating\b/],
    ["TEXT_AREA", /<TextArea\b/],
    ["NUMBER", /<Number\b/],
    ["DATE_TIME", /<DateTime\b/],
    ["PAIRWISE", /<Pairwise\b/],
    ["RELATION", /<Relations\b|<Relation\b/],
    ["CHAT", /<Chat\b/]
  ];

  return definitions.filter(([, pattern]) => pattern.test(config)).map(([tool]) => tool);
}

function inferDataType(config: string) {
  const objectTags = Array.from(config.matchAll(/<(Image|Video|Audio|Text|HyperText|Paragraphs|TimeSeries|Table|Pdf|PDF|List|Chat)\b([^>]*)/g)).map((match) => ({
    attributes: match[2] ?? "",
    tag: match[1]
  }));
  const dynamicTags = objectTags.filter((object) => getDataBindingAttribute(object.attributes)?.startsWith("$"));
  const sourceTags = dynamicTags.length > 0 ? dynamicTags : objectTags;
  const sourceTypes = Array.from(new Set(sourceTags.map((source) => objectTagToDataType(source.tag))));

  if (sourceTypes.length === 0) return "IMAGE";
  if (sourceTypes.length > 1) return "MULTIMODAL";
  return sourceTypes[0];
}

function objectTagToDataType(tagName: string) {
  if (tagName === "Video") return "VIDEO";
  if (tagName === "Audio") return "AUDIO";
  if (tagName === "Pdf" || tagName === "PDF") return "PDF";
  if (tagName === "TimeSeries") return "TIME_SERIES";
  if (tagName === "Image") return "IMAGE";
  return "TEXT";
}

function inferSettings(config: string): Partial<LabelingSettings> {
  const firstObject = /<(Image|Video|Audio)\b([^>]*)/.exec(config)?.[2] ?? "";
  const firstTool = /<(RectangleLabels|PolygonLabels|BrushLabels|BitmaskLabels|EllipseLabels|KeyPointLabels|VectorLabels|Labels|Choices)\b([^>]*)/.exec(config)?.[2] ?? "";
  const strokeWidth = Number(getAttribute(firstTool, "strokeWidth"));
  const labelPosition = getAttribute(firstTool, "labelPosition");

  return {
    imageZoom: getAttribute(firstObject, "zoom") !== "false",
    labelPosition: labelPosition === "right" || labelPosition === "bottom" || labelPosition === "left" ? labelPosition : "top",
    regionBorderWidth: Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 1,
    rotateControls: getAttribute(firstObject, "rotateControl") === "true",
    zoomControls: getAttribute(firstObject, "zoomControl") !== "false"
  };
}

function getAttribute(attributes: string, name: string) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attributes);
  return match?.[1] ?? null;
}

function getDataBindingAttribute(attributes: string) {
  return getAttribute(attributes, "value") ?? getAttribute(attributes, "valueList");
}

function detailsToDescription(details?: string) {
  if (!details) {
    return null;
  }

  return details
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function categoryIdFromPath(modulePath: string) {
  return modulePath.replace(/\\/g, "/").split("/").at(-3) ?? "custom-templates";
}

function templateIdFromPath(modulePath: string) {
  return modulePath.replace(/\\/g, "/").split("/").at(-2) ?? "untitled";
}

function modulePathToTemplatePath(modulePath: string) {
  return modulePath.replace(/\\/g, "/").replace(/^\.\.\//, "");
}

function templateOrderFromPath(modulePath: string) {
  const templateSlug = templateIdFromPath(modulePath);

  return templateSlug.charCodeAt(0) || 100;
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
