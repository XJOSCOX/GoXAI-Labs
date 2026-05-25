import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

type TemplateCategory = {
  description: string;
  id: string;
  name: string;
  order: number;
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

const apiDirectory = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(apiDirectory, "../../../packages/label-templates/templates");

export async function readBuiltInTemplates() {
  const [categories, groupNames] = await Promise.all([readCategories(), readGroups()]);
  const orderedCategories = applyGroupOrdering(categories, groupNames);
  const categoryByName = new Map(orderedCategories.map((category) => [normalizeGroupName(category.name), category]));
  const categoryById = new Map(orderedCategories.map((category) => [category.id, category]));
  const recipes = await readRecipes(templateRoot, templateRoot, categoryById, categoryByName);

  recipes.sort((a, b) => a.categoryOrder - b.categoryOrder || a.order - b.order || a.title.localeCompare(b.title));

  const groups = Array.from(
    recipes.reduce((map, recipe) => {
      if (!map.has(recipe.categoryId)) {
        const fallback = categoryById.get(recipe.categoryId);
        map.set(recipe.categoryId, {
          description: fallback?.description ?? `${recipe.group} templates and starter labeling configurations.`,
          id: recipe.categoryId,
          name: recipe.group,
          order: recipe.categoryOrder
        });
      }

      return map;
    }, new Map<string, TemplateCategory>()).values()
  ).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

  return {
    groups,
    templates: recipes.map((recipe) => {
      const summary = summarizeConfig(recipe.config);

      return {
        category: recipe.group,
        categoryId: recipe.categoryId,
        configCode: recipe.config,
        configJson: {
          category: recipe.group,
          configCode: recipe.config,
          configPath: recipe.configPath,
          labels: summary.labels.map((name, index) => ({
            color: labelColors[index % labelColors.length],
            name,
            shortcutKey: index < 9 ? String(index + 1) : undefined
          })),
          settings: summary.settings,
          source: "builtin",
          sourceRepo: recipe.sourceRepo,
          sourceTemplateId: recipe.id,
          subtype: recipe.title,
          tools: summary.tools.map((tool) => ({ enabled: true, tool })),
          version: 1
        },
        configPath: recipe.configPath,
        dataType: recipe.dataType ?? summary.dataType,
        description: detailsToDescription(recipe.details) ?? `${recipe.title} labeling template.`,
        details: recipe.details ?? null,
        id: recipe.id,
        image: recipe.image ?? null,
        labels: summary.labels,
        name: recipe.title,
        order: recipe.order,
        source: "builtin",
        sourceRepo: recipe.sourceRepo ?? null,
        subtype: recipe.title,
        tools: summary.tools,
        type: recipe.type ?? "community"
      };
    })
  };
}

async function readCategories() {
  const raw = await readFile(path.join(templateRoot, "categories.json"), "utf8");
  return JSON.parse(raw) as TemplateCategory[];
}

async function readGroups() {
  try {
    const raw = await readFile(path.join(templateRoot, "groups.txt"), "utf8");
    return parseGroupList(raw);
  } catch {
    return [];
  }
}

async function readRecipes(
  directory: string,
  root: string,
  categoryById: Map<string, TemplateCategory>,
  categoryByName: Map<string, TemplateCategory>
): Promise<Array<TemplateRecipe & { categoryId: string; categoryOrder: number; configPath: string; id: string; order: number }>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const recipes = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return readRecipes(fullPath, root, categoryById, categoryByName);
      }

      if (!entry.isFile() || entry.name !== "config.yml") {
        return [];
      }

      const rawRecipe = await readFile(fullPath, "utf8");
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      const [categoryId = "custom-templates", templateSlug = "untitled"] = relativePath.split("/");
      const fallback = categoryById.get(categoryId);
      const recipe = parseRecipeYaml(rawRecipe, relativePath);
      const groupFallback = categoryByName.get(normalizeGroupName(recipe.group));
      const category = fallback ?? groupFallback;

      return [
        {
          ...recipe,
          categoryId,
          categoryOrder: category?.order ?? 100,
          configPath: `templates/${relativePath}`,
          group: recipe.group || category?.name || titleFromSlug(categoryId),
          id: `${categoryId}/${templateSlug}`,
          order: recipe.order ?? (templateSlug.charCodeAt(0) || 100)
        }
      ];
    })
  );

  return recipes.flat();
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

function applyGroupOrdering(categories: TemplateCategory[], groups: string[]) {
  const orderByName = new Map(groups.map((group, index) => [normalizeGroupName(group), (index + 1) * 10]));

  return categories.map((category) => ({
    ...category,
    order: orderByName.get(normalizeGroupName(category.name)) ?? category.order
  }));
}

function normalizeGroupName(group: string) {
  return group.trim().toLowerCase();
}

const labelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

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

function inferSettings(config: string) {
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
