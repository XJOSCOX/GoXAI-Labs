import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Pencil, Plus, Settings2, Shapes } from "lucide-react";
import {
  listAnnotationCategories,
  listAnnotationTemplates,
  type AnnotationCategorySummary,
  type AnnotationTemplateSummary
} from "../../api";
import {
  builtInTemplatePresets,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useAuth } from "../../auth";
import { formatEnum } from "../../utils/format";

type TemplateCard = TemplatePreset & {
  canManage?: boolean;
  description: string;
  source: "builtin" | "custom";
  sourceTemplateId?: string;
};

type CategoryItem =
  | {
      description: string;
      id: string;
      key: string;
      name: string;
      source: "builtin";
      templateCount: number;
    }
  | (AnnotationCategorySummary & {
      key: string;
      source: "custom";
    });

const fallbackCategories = [
  "Computer Vision",
  "Natural Language Processing",
  "Audio/Speech Processing",
  "Conversational AI",
  "Chat",
  "Ranking & Scoring",
  "Structured Data Parsing",
  "Time Series Analysis",
  "Videos",
  "Generative AI",
  "Community Contributions",
  "Custom Templates"
];

export function LabelTemplatesPage() {
  const { session } = useAuth();
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [activeCategoryKey, setActiveCategoryKey] = useState<string>("builtin:Computer Vision");
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session) {
        return;
      }

      try {
        const [nextCategories, nextTemplates] = await Promise.all([
          listAnnotationCategories(session),
          listAnnotationTemplates(session)
        ]);

        if (!cancelled) {
          setCategories(nextCategories);
          setTemplates(nextTemplates);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load label settings.");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const builtInCategories = useMemo(() => getBuiltInCategories(), []);
  const categoryItems = useMemo<CategoryItem[]>(
    () => [
      ...builtInCategories,
      ...categories.map((category) => ({
        ...category,
        key: `custom:${category.id}`,
        source: "custom" as const
      }))
    ],
    [builtInCategories, categories]
  );
  const activeCategory = categoryItems.find((category) => category.key === activeCategoryKey) ?? categoryItems[0] ?? null;
  const visibleTemplates = useMemo(
    () => (activeCategory ? getTemplatesForCategory(activeCategory, templates) : []),
    [activeCategory, templates]
  );
  const activeTemplate =
    visibleTemplates.find((template) => template.id === activeTemplateId) ?? visibleTemplates[0] ?? null;

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="settings-page-head">
          <div>
            <p className="eyebrow">Label settings</p>
            <h2>Template browser</h2>
          </div>
          <div className="row-actions compact">
            <Link className="secondary-button compact-button" to="/label-templates/manage">
              <Pencil size={16} />
              Manage templates
            </Link>
            <Link className="primary-button compact-button" to="/label-templates/manage">
              <Plus size={16} />
              New template
            </Link>
          </div>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="label-template-picker">
          <aside className="label-template-category-rail">
            {categoryItems.map((category) => (
              <button
                className={`label-template-category ${activeCategory?.key === category.key ? "active" : ""}`}
                key={category.key}
                type="button"
                onClick={() => {
                  setActiveCategoryKey(category.key);
                  setActiveTemplateId(null);
                }}
              >
                <span>
                  <strong>{category.name}</strong>
                  <small>{category.description || "Reusable label category"}</small>
                </span>
                <em>{category.templateCount}</em>
              </button>
            ))}
          </aside>

          <section className="label-template-gallery">
            <div className="settings-page-head">
              <div>
                <p className="eyebrow">{activeCategory?.source === "custom" ? "Custom category" : "Built-in category"}</p>
                <h3>{activeCategory?.name ?? "Templates"}</h3>
              </div>
              <span className="status-pill compact">{visibleTemplates.length} templates</span>
            </div>

            <div className="label-template-card-grid">
              {visibleTemplates.length > 0 ? (
                visibleTemplates.map((template) => (
                  <button
                    className={`label-template-card ${activeTemplate?.id === template.id ? "active" : ""}`}
                    key={template.id}
                    type="button"
                    onClick={() => setActiveTemplateId(template.id)}
                  >
                    <TemplatePreview template={template} />
                    <span>
                      <strong>{template.name}</strong>
                      <small>{template.subtype}</small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="template-empty-state">
                  <Database size={22} />
                  <strong>No templates in this category yet.</strong>
                  <small>Create templates from the management page.</small>
                </div>
              )}
            </div>
          </section>

          <aside className="label-template-detail-panel">
            {activeTemplate ? (
              <>
                <div>
                  <p className="eyebrow">Selected template</p>
                  <h3>{activeTemplate.name}</h3>
                  <p className="muted-copy">{activeTemplate.description}</p>
                </div>
                <dl className="detail-list compact">
                  <div>
                    <dt>Category</dt>
                    <dd>{activeTemplate.category}</dd>
                  </div>
                  <div>
                    <dt>Data type</dt>
                    <dd>{formatEnum(activeTemplate.dataType)}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{activeTemplate.subtype}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{formatEnum(activeTemplate.source)}</dd>
                  </div>
                </dl>
                <section>
                  <p className="eyebrow">Labels</p>
                  <div className="label-chip-list">
                    {activeTemplate.labels.map((label, index) => (
                      <span className="label-chip" key={`${label}-${index}`}>
                        {label}
                      </span>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="eyebrow">Tools</p>
                  <div className="label-chip-list">
                    {activeTemplate.tools.map((tool) => (
                      <span className="label-chip" key={tool}>
                        {formatEnum(tool)}
                      </span>
                    ))}
                  </div>
                </section>
                {activeTemplate.source === "custom" && activeTemplate.canManage && (
                  <Link className="secondary-button compact-button" to={`/label-templates/manage?template=${activeTemplate.sourceTemplateId ?? ""}`}>
                    <Settings2 size={16} />
                    Edit this template
                  </Link>
                )}
              </>
            ) : (
              <p className="muted-copy">Select a template to inspect its labels, tools, and settings.</p>
            )}
          </aside>
        </div>
      </section>
    </section>
  );
}

function getBuiltInCategories(): CategoryItem[] {
  return fallbackCategories.map((name) => ({
    description: `${name} templates and starter settings.`,
    id: name,
    key: `builtin:${name}`,
    name,
    source: "builtin",
    templateCount: builtInTemplatePresets.filter((template) => template.category === name).length
  }));
}

function getTemplatesForCategory(category: CategoryItem, templates: AnnotationTemplateSummary[]): TemplateCard[] {
  if (category.source === "builtin") {
    return builtInTemplatePresets
      .filter((template) => template.category === category.name)
      .map((template) => ({
        ...template,
        description: template.description,
        source: "builtin"
      }));
  }

  return templates
    .filter((template) => template.categoryId === category.id)
    .map(templateToCard);
}

function templateToCard(template: AnnotationTemplateSummary): TemplateCard {
  const config = template.configJson;

  return {
    canManage: template.canManage,
    category: template.category?.name ?? getConfigString(config, "category") ?? "Custom Templates",
    dataType: template.dataType,
    description: template.description ?? "Custom GoXAi Lab template.",
    id: `custom-${template.id}`,
    labels: getConfigStringArray(config, "labels"),
    name: template.name,
    settings: getConfigObject(config, "settings"),
    source: "custom",
    sourceTemplateId: template.id,
    subtype: getConfigString(config, "subtype") ?? "Custom",
    tools: getConfigStringArray(config, "tools")
  };
}

function TemplatePreview({ template }: { template: TemplateCard }) {
  return (
    <span className={`template-preview template-preview-large ${template.id}`}>
      <Shapes size={18} />
      {template.tools.includes("BBOX") && <i className="bbox-demo demo-one" />}
      {template.tools.includes("POLYGON") && <i className="polygon-demo" />}
      {template.tools.includes("TEXT_SPAN") && <i className="text-demo" />}
      {template.tools.includes("CLASSIFICATION") && <i className="class-demo" />}
      {template.tools.includes("KEYPOINT") && <i className="keypoint-demo" />}
      {template.tools.includes("BRUSH") && <i className="brush-demo" />}
    </span>
  );
}

function getConfigString(config: Record<string, unknown>, key: string) {
  const value = config[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getConfigObject(config: Record<string, unknown>, key: string) {
  const value = config[key];

  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function getConfigStringArray(config: Record<string, unknown>, key: string) {
  const value = config[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (entry && typeof entry === "object") {
        if ("name" in entry && typeof entry.name === "string") {
          return entry.name;
        }

        if ("tool" in entry && typeof entry.tool === "string") {
          return entry.tool;
        }
      }

      return "";
    })
    .filter(Boolean);
}
