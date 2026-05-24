import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Database, Plus, Settings2, Shapes, X } from "lucide-react";
import {
  createAnnotationCategory,
  listAnnotationCategories,
  listAnnotationTemplates,
  type AnnotationCategorySummary,
  type AnnotationTemplateSummary
} from "../../api";
import {
  builtInTemplatePresets,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { getFormValue, useAuth } from "../../auth";
import { useOrganizations } from "../../hooks/useResources";
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
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [activeCategoryKey, setActiveCategoryKey] = useState<string | null>(searchParams.get("category"));
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

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

  useEffect(() => {
    const categoryKey = searchParams.get("category");
    const templateId = searchParams.get("template");

    setActiveCategoryKey(categoryKey);
    setActiveTemplateId(templateId);
  }, [searchParams]);

  const manageableOrganizations = organizations.filter((organization) => ["OWNER", "ADMIN"].includes(organization.role));
  const canCreateCategory = dbUser?.globalRole === "SUPER_ADMIN" || manageableOrganizations.length > 0;
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
  const activeCategory = activeCategoryKey ? categoryItems.find((category) => category.key === activeCategoryKey) ?? null : null;
  const visibleTemplates = useMemo(
    () => (activeCategory ? getTemplatesForCategory(activeCategory, templates) : []),
    [activeCategory, templates]
  );
  const activeTemplate = visibleTemplates.find((template) => template.id === activeTemplateId) ?? null;
  const selectedCategoryForNewTemplate =
    activeCategory?.source === "custom"
      ? activeCategory
      : categories.find((category) => category.name === activeCategory?.name && category.canManage) ?? null;
  const newTemplateCategoryKey = selectedCategoryForNewTemplate
    ? `custom:${selectedCategoryForNewTemplate.id}`
    : activeCategory?.key ?? "";
  const newTemplateHref = activeCategory
    ? `/label-templates/categories/${encodeURIComponent(newTemplateCategoryKey)}/templates/new`
    : null;
  const manageTemplateHref =
    activeTemplate && activeCategory
      ? getManageTemplateHref(activeTemplate, activeCategory, selectedCategoryForNewTemplate)
      : null;

  async function reload() {
    if (!session) {
      return;
    }

    const [nextCategories, nextTemplates] = await Promise.all([
      listAnnotationCategories(session),
      listAnnotationTemplates(session)
    ]);

    setCategories(nextCategories);
    setTemplates(nextTemplates);
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const name = getFormValue(event, "name");
    const description = getFormValue(event, "description");
    const organizationId = getFormValue(event, "organizationId") || null;

    if (!name) {
      setError("Category name is required.");
      return;
    }

    setSavingCategory(true);

    try {
      const category = await createAnnotationCategory(session, { description, name, organizationId });
      await reload();
      setActiveCategoryKey(`custom:${category.id}`);
      setActiveTemplateId(null);
      setSearchParams({ category: `custom:${category.id}` });
      setCategoryModalOpen(false);
      setMessage("Category created.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create category.");
    } finally {
      setSavingCategory(false);
    }
  }

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="settings-page-head">
          <div>
            <p className="eyebrow">Label settings</p>
            <h2>Template browser</h2>
          </div>
          <div className="row-actions compact">
            <button className="secondary-button compact-button" type="button" onClick={() => setCategoryModalOpen(true)}>
              <Plus size={16} />
              New category
            </button>
            {newTemplateHref && (
              <Link className="primary-button compact-button" to={newTemplateHref}>
                <Plus size={16} />
                New template
              </Link>
            )}
          </div>
        </div>

        {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}

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
                  setSearchParams({ category: category.key });
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
                <p className="eyebrow">
                  {activeCategory ? (activeCategory.source === "custom" ? "Custom category" : "Built-in category") : "No category selected"}
                </p>
                <h3>{activeCategory?.name ?? "Choose a category"}</h3>
              </div>
              {activeCategory && <span className="status-pill compact">{visibleTemplates.length} templates</span>}
            </div>

            <div className="label-template-card-grid">
              {!activeCategory ? (
                <div className="template-empty-state">
                  <Database size={22} />
                  <strong>Select a category first.</strong>
                  <small>Pick a category on the left to see its template cards and actions.</small>
                </div>
              ) : visibleTemplates.length > 0 ? (
                visibleTemplates.map((template) => (
                  <button
                    className={`label-template-card ${activeTemplate?.id === template.id ? "active" : ""}`}
                    key={template.id}
                    type="button"
                    onClick={() => {
                      setActiveTemplateId(template.id);
                      if (activeCategory) {
                        setSearchParams({ category: activeCategory.key, template: template.id });
                      }
                    }}
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
                  <small>Create a template in this category.</small>
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
                    <dt>Category ID</dt>
                    <dd>{activeCategory?.source === "custom" ? activeCategory.id : activeCategory?.key}</dd>
                  </div>
                  <div>
                    <dt>Template ID</dt>
                    <dd>{activeTemplate.sourceTemplateId ?? activeTemplate.id}</dd>
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
                {manageTemplateHref && (
                  <Link className="secondary-button compact-button" to={manageTemplateHref}>
                    <Settings2 size={16} />
                    Manage this template
                  </Link>
                )}
              </>
            ) : (
              <p className="muted-copy">Select a template to inspect its labels, tools, and settings.</p>
            )}
          </aside>
        </div>
      </section>
      {categoryModalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setCategoryModalOpen(false)}>
          <form
            aria-labelledby="category-modal-title"
            aria-modal="true"
            className="modal-panel category-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleCreateCategory}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Label settings</p>
                <h2 id="category-modal-title">New category</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setCategoryModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {!canCreateCategory && (
              <p className="form-error">Only super admins or organization owners/admins can create categories.</p>
            )}
            <label>
              Scope
              <select
                defaultValue={dbUser?.globalRole === "SUPER_ADMIN" ? "" : manageableOrganizations[0]?.id ?? ""}
                disabled={!canCreateCategory || savingCategory}
                name="organizationId"
              >
                {dbUser?.globalRole === "SUPER_ADMIN" && <option value="">Global</option>}
                {manageableOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category name
              <input disabled={!canCreateCategory || savingCategory} name="name" placeholder="Computer Vision" />
            </label>
            <label>
              Description
              <textarea
                disabled={!canCreateCategory || savingCategory}
                name="description"
                placeholder="Templates for image, video, text, chat, or domain-specific labeling"
                rows={4}
              />
            </label>
            <div className="row-actions">
              <button className="primary-button" disabled={!canCreateCategory || savingCategory} type="submit">
                <Plus size={18} />
                Create category
              </button>
            </div>
          </form>
        </div>
      )}
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

function getManageTemplateHref(template: TemplateCard, category: CategoryItem, writableCategory: AnnotationCategorySummary | null) {
  if (template.source === "custom") {
    return template.canManage && template.sourceTemplateId
      ? `/label-templates/templates/${encodeURIComponent(template.sourceTemplateId)}/edit?category=${encodeURIComponent(category.key)}`
      : null;
  }

  const targetCategoryKey = writableCategory ? `custom:${writableCategory.id}` : category.key;

  return `/label-templates/categories/${encodeURIComponent(targetCategoryKey)}/templates/new?sourceTemplate=${encodeURIComponent(template.id)}`;
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
