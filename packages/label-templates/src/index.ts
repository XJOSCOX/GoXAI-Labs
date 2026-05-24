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
  id: string;
  labels: string[];
  manifestPath?: string;
  name: string;
  settings?: Partial<LabelingSettings>;
  source?: "builtin" | "custom";
  sourceTemplateId?: string;
  subtype: string;
  tools: string[];
};

type TemplateManifest = {
  category: string;
  categoryDescription?: string;
  categoryId?: string;
  categoryOrder?: number;
  configPath?: string;
  dataType: string;
  description: string;
  id: string;
  labels?: string[];
  name: string;
  settings?: Partial<LabelingSettings>;
  source?: "builtin";
  subtype: string;
  templateOrder?: number;
  tools?: string[];
};

type LoadedManifest = TemplateManifest & {
  categoryId: string;
  categoryOrder: number;
  configPath: string;
  labels: string[];
  manifestPath: string;
  templateOrder: number;
  tools: string[];
};

export const annotationLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

const categoryModules = import.meta.glob<TemplateCategoryPreset[]>("../templates/categories.json", {
  eager: true,
  import: "default"
});

const manifestModules = import.meta.glob<Record<string, unknown>>("../templates/*/*/manifest.json", {
  eager: true,
  import: "default"
});

const configModules = import.meta.glob<string>("../templates/*/*/template.xml", {
  eager: true,
  import: "default",
  query: "?raw"
});

const configByPath = new Map(
  Object.entries(configModules).map(([modulePath, configCode]) => [modulePathToTemplatePath(modulePath), configCode])
);

const categoryDefaults = new Map(
  (Object.values(categoryModules)[0] ?? []).map((category) => [category.id, category])
);

const loadedManifests = Object.entries(manifestModules)
  .map(([modulePath, manifest]) => normalizeManifest(modulePath, manifest))
  .sort((a, b) => a.categoryOrder - b.categoryOrder || a.templateOrder - b.templateOrder || a.name.localeCompare(b.name));

export const builtInTemplateCategories: TemplateCategoryPreset[] = Array.from(
  loadedManifests.reduce((categories, manifest) => {
    if (!categories.has(manifest.categoryId)) {
      categories.set(manifest.categoryId, {
        description: manifest.categoryDescription ?? categoryDefaults.get(manifest.categoryId)?.description ?? `${manifest.category} templates and starter settings.`,
        id: manifest.categoryId,
        name: manifest.category,
        order: manifest.categoryOrder
      });
    }

    return categories;
  }, new Map<string, TemplateCategoryPreset>()).values()
).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

export const builtInTemplatePresets: TemplatePreset[] = loadedManifests.map((manifest) => ({
  category: manifest.category,
  categoryId: manifest.categoryId,
  configCode: configByPath.get(manifest.configPath),
  configPath: manifest.configPath,
  dataType: manifest.dataType,
  description: manifest.description,
  id: manifest.id,
  labels: manifest.labels,
  manifestPath: manifest.manifestPath,
  name: manifest.name,
  settings: manifest.settings ?? {},
  source: "builtin",
  subtype: manifest.subtype,
  tools: manifest.tools
}));

export function getBuiltInTemplatePreset(templateId: string) {
  return builtInTemplatePresets.find((template) => template.id === templateId) ?? null;
}

function normalizeManifest(modulePath: string, manifestModule: Record<string, unknown>): LoadedManifest {
  const manifest = manifestModule as TemplateManifest;
  const categoryId = manifest.categoryId ?? categoryIdFromPath(modulePath);
  const categoryDefault = categoryDefaults.get(categoryId);
  const category = manifest.category || categoryDefault?.name || titleFromSlug(categoryId);
  const templateOrder = manifest.templateOrder ?? templateOrderFromPath(modulePath);
  const configPath = manifest.configPath ?? modulePathToTemplatePath(modulePath.replace(/manifest\.json$/, "template.xml"));

  return {
    ...manifest,
    category,
    categoryId,
    categoryOrder: manifest.categoryOrder ?? categoryDefault?.order ?? 100,
    configPath,
    labels: Array.isArray(manifest.labels) ? manifest.labels : [],
    manifestPath: modulePathToTemplatePath(modulePath),
    templateOrder,
    tools: Array.isArray(manifest.tools) ? manifest.tools : []
  };
}

function categoryIdFromPath(modulePath: string) {
  return modulePath.replace(/\\/g, "/").split("/").at(-3) ?? "custom-templates";
}

function modulePathToTemplatePath(modulePath: string) {
  return modulePath.replace(/\\/g, "/").replace(/^\.\.\//, "");
}

function templateOrderFromPath(modulePath: string) {
  const templateSlug = modulePath.replace(/\\/g, "/").split("/").at(-2) ?? "";

  return templateSlug.charCodeAt(0) || 100;
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
