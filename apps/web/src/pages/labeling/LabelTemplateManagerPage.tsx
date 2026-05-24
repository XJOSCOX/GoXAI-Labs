import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Database, Plus, Save, Trash2 } from "lucide-react";
import {
  createAnnotationCategory,
  createAnnotationTemplate,
  deleteAnnotationCategory,
  deleteAnnotationTemplate,
  listAnnotationCategories,
  listAnnotationTemplates,
  updateAnnotationCategory,
  updateAnnotationTemplate,
  type AnnotationCategorySummary,
  type AnnotationTemplateSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import {
  buildTemplateConfig,
  builtInTemplatePresets,
  parseLabelInputsFromText,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useOrganizations } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
const templateTools = ["BBOX", "POLYGON", "BRUSH", "TEXT_SPAN", "KEYPOINT", "CLASSIFICATION", "RELATION"];

type CategoryItem =
  | {
      canManage: false;
      description: string;
      id: string;
      key: string;
      name: string;
      organizationId: null;
      source: "builtin";
      templateCount: number;
    }
  | (AnnotationCategorySummary & {
      key: string;
      source: "custom";
    });

export function LabelTemplateManagerPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const selectedCategory =
    categoryItems.find((category) => category.key === selectedCategoryKey) ?? categoryItems[0] ?? null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedTemplates =
    selectedCategory?.source === "custom"
      ? templates.filter((template) => template.categoryId === selectedCategory.id)
      : [];
  const selectedBuiltIns =
    selectedCategory?.source === "builtin"
      ? builtInTemplatePresets.filter((template) => template.category === selectedCategory.name)
      : [];
  const canManageSelectedCategory = selectedCategory?.source === "custom" && selectedCategory.canManage;

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

    const requestedTemplateId = searchParams.get("template");
    const requestedTemplate = requestedTemplateId
      ? nextTemplates.find((template) => template.id === requestedTemplateId)
      : null;

    if (requestedTemplate) {
      setSelectedTemplateId(requestedTemplate.id);
      setSelectedCategoryKey(requestedTemplate.categoryId ? `custom:${requestedTemplate.categoryId}` : null);
    } else if (!selectedCategoryKey && nextCategories.length > 0) {
      setSelectedCategoryKey(`custom:${nextCategories[0].id}`);
    }
  }

  useEffect(() => {
    void reload().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unable to load label settings.");
    });
  }, [session]);

  async function handleSaveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = event.currentTarget;

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const name = getFormValue(event, "categoryName");
    const description = getFormValue(event, "categoryDescription");
    const organizationId = getFormValue(event, "categoryOrganizationId") || null;

    if (!name) {
      setError("Category name is required.");
      return;
    }

    setSaving(true);

    try {
      if (selectedCategory?.source === "custom" && selectedCategory.canManage) {
        const updated = await updateAnnotationCategory(session, selectedCategory.id, { description, name });
        setSelectedCategoryKey(`custom:${updated.id}`);
        setMessage("Category updated.");
      } else {
        const created = await createAnnotationCategory(session, { description, name, organizationId });
        setSelectedCategoryKey(`custom:${created.id}`);
        setMessage("Category created.");
        form.reset();
      }

      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save category.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCategory() {
    if (!session || selectedCategory?.source !== "custom" || !selectedCategory.canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await deleteAnnotationCategory(session, selectedCategory.id);
      setSelectedCategoryKey(null);
      setSelectedTemplateId(null);
      await reload();
      setMessage("Category deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete category.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    if (selectedCategory?.source !== "custom") {
      setError("Select one of your custom categories before adding a template.");
      return;
    }

    if (!selectedCategory.canManage) {
      setError("You can use this category, but only its owner or a super admin can edit it.");
      return;
    }

    const form = event.currentTarget;
    const name = getFormValue(event, "name");
    const description = getFormValue(event, "description");
    const subtype = getFormValue(event, "subtype") || "Custom";
    const dataType = getFormValue(event, "dataType") || "IMAGE";
    const labels = parseLabelInputsFromText(getFormValue(event, "labels"));
    const selectedTools = new FormData(form).getAll("tools").map(String);

    if (!name) {
      setError("Template name is required.");
      return;
    }

    if (labels.length === 0) {
      setError("Add at least one label.");
      return;
    }

    if (selectedTools.length === 0) {
      setError("Enable at least one tool.");
      return;
    }

    const preset: TemplatePreset = {
      category: selectedCategory.name,
      dataType,
      description,
      id: selectedTemplate?.id ?? `custom-${Date.now()}`,
      labels: labels.map((label) => label.name),
      name,
      subtype,
      tools: selectedTools
    };

    setSaving(true);

    try {
      if (selectedTemplate) {
        await updateAnnotationTemplate(session, selectedTemplate.id, {
          categoryId: selectedCategory.id,
          configJson: buildTemplateConfig(preset),
          dataType,
          description,
          name
        });
        setMessage("Template updated.");
      } else {
        await createAnnotationTemplate(session, {
          categoryId: selectedCategory.id,
          configJson: buildTemplateConfig(preset),
          dataType,
          description,
          name
        });
        setMessage("Template created.");
        form.reset();
      }

      await reload();
      setSelectedTemplateId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!session || !selectedTemplate || !selectedTemplate.canManage) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await deleteAnnotationTemplate(session, selectedTemplate.id);
      await reload();
      setSelectedTemplateId(null);
      setMessage("Template deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="settings-page-head">
          <div>
            <p className="eyebrow">Label settings</p>
            <h2>Categories and templates</h2>
          </div>
          <div className="row-actions compact">
            <Link className="secondary-button compact-button" to="/label-templates">
              Template browser
            </Link>
            <span className="status-pill compact">{categoryItems.length} categories</span>
          </div>
        </div>
        {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}

        <div className="template-settings-layout">
          <section className="panel template-settings-library">
            <div className="settings-page-head">
              <div>
                <p className="eyebrow">Categories</p>
                <h3>Reusable label groups</h3>
              </div>
              <Database size={18} />
            </div>
            <div className="template-category-list">
              {categoryItems.map((category) => (
                <button
                  className={`template-category-item ${selectedCategory?.key === category.key ? "active" : ""}`}
                  key={category.key}
                  type="button"
                  onClick={() => {
                    setSelectedCategoryKey(category.key);
                    setSelectedTemplateId(null);
                  }}
                >
                  <span>
                    <strong>{category.name}</strong>
                    <small>{category.description || "No description added."}</small>
                  </span>
                  <span className="status-pill compact">{category.templateCount}</span>
                </button>
              ))}
            </div>
          </section>

          <aside className="panel template-settings-editor">
            <p className="eyebrow">{canManageSelectedCategory ? "Edit category" : "New category"}</p>
            <h3>{canManageSelectedCategory ? selectedCategory.name : "Create category"}</h3>
            {!canCreateCategory && (
              <p className="muted-copy">Only super admins or organization owners/admins can create categories.</p>
            )}
            <form key={canManageSelectedCategory ? selectedCategory.id : "new-category"} onSubmit={handleSaveCategory}>
              <label>
                Scope
                <select
                  defaultValue={canManageSelectedCategory ? selectedCategory.organizationId ?? "" : dbUser?.globalRole === "SUPER_ADMIN" ? "" : manageableOrganizations[0]?.id ?? ""}
                  disabled={!canCreateCategory || canManageSelectedCategory}
                  name="categoryOrganizationId"
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
                <input
                  defaultValue={canManageSelectedCategory ? selectedCategory.name : ""}
                  disabled={!canCreateCategory}
                  name="categoryName"
                  placeholder="Computer Vision"
                />
              </label>
              <label>
                Description
                <textarea
                  defaultValue={canManageSelectedCategory ? selectedCategory.description ?? "" : ""}
                  disabled={!canCreateCategory}
                  name="categoryDescription"
                  placeholder="Templates for image, video, text, chat, or domain-specific labeling"
                  rows={3}
                />
              </label>
              <div className="row-actions">
                <button className="primary-button" disabled={!canCreateCategory || saving} type="submit">
                  {canManageSelectedCategory ? <Save size={18} /> : <Plus size={18} />}
                  {canManageSelectedCategory ? "Save category" : "Create category"}
                </button>
                {canManageSelectedCategory && (
                  <button className="danger-button" disabled={saving} type="button" onClick={handleDeleteCategory}>
                    <Trash2 size={18} />
                    Delete
                  </button>
                )}
              </div>
            </form>
          </aside>
        </div>

        {selectedCategory && (
          <section className="panel">
            <div className="settings-page-head">
              <div>
                <p className="eyebrow">{selectedCategory.source === "builtin" ? "Built-in category" : "Category templates"}</p>
                <h3>{selectedCategory.name}</h3>
                <p className="muted-copy">
                  {selectedCategory.source === "builtin"
                    ? "Built-in templates are reusable starting points. Create your own category to add editable templates."
                    : selectedCategory.canManage
                      ? "Add, update, or delete templates inside this category."
                      : "You can use these templates, but only the owner or a super admin can edit them."}
                </p>
              </div>
              <span className="status-pill compact">
                {selectedCategory.source === "builtin" ? selectedBuiltIns.length : selectedTemplates.length} templates
              </span>
            </div>

            <div className="template-settings-card-grid">
              {selectedBuiltIns.map((template) => (
                <article className="template-settings-card" key={template.id}>
                  <strong>{template.name}</strong>
                  <span>{template.subtype}</span>
                  <small>{template.description}</small>
                </article>
              ))}
              {selectedTemplates.map((template) => (
                <button
                  className={`template-settings-card selectable ${selectedTemplateId === template.id ? "active" : ""}`}
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span>{getTemplateConfigString(template, "subtype") ?? "Custom"}</span>
                  <small>{template.description ?? "No description added."}</small>
                </button>
              ))}
              {selectedBuiltIns.length === 0 && selectedTemplates.length === 0 && (
                <p className="muted-copy">No templates in this category yet.</p>
              )}
            </div>
          </section>
        )}

        {selectedCategory?.source === "custom" && (
          <section className="panel template-settings-editor wide">
            <p className="eyebrow">{selectedTemplate ? "Edit template" : "New template"}</p>
            <h3>{selectedTemplate ? selectedTemplate.name : `Add template to ${selectedCategory.name}`}</h3>
            {!selectedCategory.canManage && (
              <p className="muted-copy">This category is reusable, but you cannot edit templates that belong to someone else.</p>
            )}
            <form key={selectedTemplate?.id ?? selectedCategory.id} onSubmit={handleSaveTemplate}>
              <div className="two-column-fields">
                <label>
                  Template name
                  <input
                    defaultValue={selectedTemplate?.name ?? ""}
                    disabled={!selectedCategory.canManage}
                    name="name"
                    placeholder="Object detection"
                  />
                </label>
                <label>
                  Type
                  <input
                    defaultValue={getTemplateConfigString(selectedTemplate, "subtype") ?? ""}
                    disabled={!selectedCategory.canManage}
                    name="subtype"
                    placeholder="Detection, OCR, Chat..."
                  />
                </label>
              </div>
              <label>
                Description
                <textarea
                  defaultValue={selectedTemplate?.description ?? ""}
                  disabled={!selectedCategory.canManage}
                  name="description"
                  placeholder="What this template helps label"
                  rows={3}
                />
              </label>
              <label>
                Data type
                <select defaultValue={selectedTemplate?.dataType ?? "IMAGE"} disabled={!selectedCategory.canManage} name="dataType">
                  {dataTypes.map((dataType) => (
                    <option key={dataType} value={dataType}>
                      {formatEnum(dataType)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Labels
                <textarea
                  defaultValue={templateLabelsToText(selectedTemplate)}
                  disabled={!selectedCategory.canManage}
                  name="labels"
                  placeholder="Car&#10;Person&#10;Traffic light"
                  rows={5}
                />
              </label>
              <fieldset className="template-tool-checks">
                <legend>Tools</legend>
                {templateTools.map((tool) => (
                  <label className="checkbox-row" key={tool}>
                    <input
                      defaultChecked={templateHasTool(selectedTemplate, tool)}
                      disabled={!selectedCategory.canManage}
                      name="tools"
                      type="checkbox"
                      value={tool}
                    />
                    {formatEnum(tool)}
                  </label>
                ))}
              </fieldset>
              <div className="row-actions">
                <button className="primary-button" disabled={!selectedCategory.canManage || saving} type="submit">
                  {selectedTemplate ? <Save size={18} /> : <Plus size={18} />}
                  {selectedTemplate ? "Save template" : "Create template"}
                </button>
                {selectedTemplate && selectedTemplate.canManage && (
                  <button className="danger-button" disabled={saving} type="button" onClick={handleDeleteTemplate}>
                    <Trash2 size={18} />
                    Delete
                  </button>
                )}
              </div>
            </form>
          </section>
        )}
      </section>
    </section>
  );
}

function getBuiltInCategories(): CategoryItem[] {
  return Array.from(new Set(builtInTemplatePresets.map((template) => template.category))).map((name) => ({
    canManage: false,
    description: `${name} presets included with GoXAi Lab.`,
    id: name,
    key: `builtin:${name}`,
    name,
    organizationId: null,
    source: "builtin",
    templateCount: builtInTemplatePresets.filter((template) => template.category === name).length
  }));
}

function getTemplateConfigString(template: AnnotationTemplateSummary | null, key: string) {
  const value = template?.configJson?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function templateLabelsToText(template: AnnotationTemplateSummary | null) {
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

function templateHasTool(template: AnnotationTemplateSummary | null, toolName: string) {
  const tools = template?.configJson.tools;

  if (!template || !Array.isArray(tools)) {
    return toolName === "BBOX";
  }

  return tools.some((tool) => {
    if (typeof tool === "string") {
      return tool === toolName;
    }

    return Boolean(tool && typeof tool === "object" && "tool" in tool && tool.tool === toolName);
  });
}
