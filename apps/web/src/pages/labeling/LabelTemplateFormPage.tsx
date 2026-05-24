import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Code2, Eye, Save, Trash2 } from "lucide-react";
import {
  createAnnotationTemplate,
  deleteAnnotationTemplate,
  listAnnotationCategories,
  listAnnotationTemplates,
  updateAnnotationTemplate,
  type AnnotationCategorySummary,
  type AnnotationTemplateSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import {
  buildTemplateConfig,
  builtInTemplatePresets,
  parseLabelInputsFromText,
  type LabelingSettings,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { formatEnum } from "../../utils/format";

const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
const templateTools = ["BBOX", "POLYGON", "BRUSH", "TEXT_SPAN", "KEYPOINT", "CLASSIFICATION", "RELATION"];

export function LabelTemplateFormPage() {
  const { categoryKey, templateId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"code" | "visual">("visual");
  const [configCodeDraft, setConfigCodeDraft] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editableCategories = useMemo(() => categories.filter((category) => category.canManage), [categories]);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const sourceTemplateId = searchParams.get("sourceTemplate");
  const sourcePreset = builtInTemplatePresets.find((template) => template.id === sourceTemplateId) ?? null;
  const requestedCategoryId = searchParams.get("category");
  const requestedCategoryName = searchParams.get("categoryName");
  const routeCategoryId = getCustomCategoryId(categoryKey);
  const routeCategoryName = getBuiltInCategoryName(categoryKey);
  const routeEditableCategoryId =
    routeCategoryId && editableCategories.some((category) => category.id === routeCategoryId)
      ? routeCategoryId
      : routeCategoryName
        ? editableCategories.find((category) => category.name === routeCategoryName)?.id ?? ""
        : "";
  const requestedEditableCategoryId =
    requestedCategoryId && editableCategories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : editableCategories.find((category) => category.name === requestedCategoryName)?.id ?? "";
  const defaultCategoryId =
    selectedTemplate?.categoryId ??
    (routeEditableCategoryId || requestedEditableCategoryId || editableCategories[0]?.id || "");
  const selectedCategory = editableCategories.find((category) => category.id === defaultCategoryId) ?? null;
  const isEditing = Boolean(templateId);
  const categoryLocked = Boolean(categoryKey);
  const seedName = selectedTemplate?.name ?? sourcePreset?.name ?? "";
  const seedDescription = selectedTemplate?.description ?? sourcePreset?.description ?? "";
  const seedSubtype = getTemplateConfigString(selectedTemplate, "subtype") ?? sourcePreset?.subtype ?? "";
  const seedDataType = selectedTemplate?.dataType ?? normalizePresetDataType(sourcePreset?.dataType) ?? "IMAGE";
  const seedLabels = templateLabelsToText(selectedTemplate) || sourcePreset?.labels.join("\n") || "";
  const seedTools = getTemplateTools(selectedTemplate, sourcePreset);
  const seedSettings = getTemplateSettings(selectedTemplate, sourcePreset);
  const seedHeader = getTemplateConfigString(selectedTemplate, "header") ?? "Select label and annotate the asset";
  const seedDataKey = getTemplateConfigString(selectedTemplate, "dataKey") ?? "$image";
  const initialConfigCode =
    getTemplateConfigString(selectedTemplate, "configCode") ??
    buildTemplateMarkup(seedHeader, seedDataKey, seedLabels, seedTools, seedSettings);
  const configCodeValue = configCodeDraft ?? initialConfigCode;

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
          setError(reason instanceof Error ? reason.message : "Unable to load template form.");
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const form = event.currentTarget;
    const categoryId = getFormValue(event, "categoryId");
    const category = editableCategories.find((item) => item.id === categoryId);
    const name = getFormValue(event, "name");
    const description = getFormValue(event, "description");
    const subtype = getFormValue(event, "subtype") || "Custom";
    const dataType = getFormValue(event, "dataType") || "IMAGE";
    const header = getFormValue(event, "header") || "Select label and annotate the asset";
    const dataKey = getFormValue(event, "dataKey") || "$image";
    const regionBorderWidth = Number(new FormData(form).get("regionBorderWidth"));
    const settings: Partial<LabelingSettings> = {
      imageZoom: new FormData(form).get("imageZoom") === "on",
      regionBorderWidth: Number.isFinite(regionBorderWidth) ? Math.max(1, Math.min(8, regionBorderWidth)) : 1,
      rotateControls: new FormData(form).get("rotateControls") === "on",
      zoomControls: new FormData(form).get("zoomControls") === "on"
    };
    const labels = parseLabelInputsFromText(getFormValue(event, "labels"));
    const selectedTools = new FormData(form).getAll("tools").map(String);
    const configCode = getFormValue(event, "configCode") || buildTemplateMarkup(header, dataKey, getFormValue(event, "labels"), selectedTools, settings);

    if (!category) {
      setError("Choose a category you own before saving this template.");
      return;
    }

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
      category: category.name,
      dataType,
      description,
      id: selectedTemplate?.id ?? `custom-${Date.now()}`,
      labels: labels.map((label) => label.name),
      name,
      settings,
      subtype,
      tools: selectedTools
    };

    setSaving(true);

    try {
      const payload = {
        categoryId: category.id,
        configJson: {
          ...buildTemplateConfig(preset),
          configCode,
          dataKey,
          header,
          sourceTemplateId: sourcePreset?.id ?? selectedTemplate?.id ?? null
        },
        dataType,
        description,
        name
      };

      let savedTemplate: AnnotationTemplateSummary;
      if (selectedTemplate) {
        savedTemplate = await updateAnnotationTemplate(session, selectedTemplate.id, payload);
        setMessage("Template updated.");
      } else {
        savedTemplate = await createAnnotationTemplate(session, payload);
        setMessage("Template created.");
      }

      navigate(`/label-templates?category=${encodeURIComponent(`custom:${category.id}`)}&template=${encodeURIComponent(`custom-${savedTemplate.id}`)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!session || !selectedTemplate?.canManage) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await deleteAnnotationTemplate(session, selectedTemplate.id);
      navigate(`/label-templates${selectedTemplate.categoryId ? `?category=${encodeURIComponent(`custom:${selectedTemplate.categoryId}`)}` : ""}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="organization-detail-nav">
          <Link className="secondary-button compact-button" to="/label-templates">
            <ArrowLeft size={16} />
            Back to templates
          </Link>
        </div>

        <div className="settings-page-head">
          <div>
            <p className="eyebrow">Label settings</p>
            <h2>{isEditing ? "Edit template" : sourcePreset ? `New template from ${sourcePreset.name}` : "New template"}</h2>
          </div>
          {selectedCategory && <span className="status-pill compact">{selectedCategory.name}</span>}
        </div>

        {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}

        <form className="panel template-form-page" onSubmit={handleSubmit}>
          {editableCategories.length === 0 && (
            <p className="form-error">Create a custom category before adding templates.</p>
          )}
          {categoryLocked && !selectedCategory && (
            <p className="form-error">
              Create a custom category named {routeCategoryName ?? "this category"} before saving templates here.
            </p>
          )}
          <input name="configCode" type="hidden" value={configCodeValue} />
          <div className="labeling-interface-builder">
            <aside className="labeling-config-panel">
              <div className="template-editor-tabs" role="tablist" aria-label="Template editor mode">
                <button
                  className={editorMode === "code" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorMode("code")}
                >
                  <Code2 size={16} />
                  Code
                </button>
                <button
                  className={editorMode === "visual" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorMode("visual")}
                >
                  <Eye size={16} />
                  Visual
                </button>
              </div>
              {editorMode === "code" ? (
                <label className="template-code-editor">
                  Template code
                  <textarea
                    disabled={saving}
                    spellCheck={false}
                    value={configCodeValue}
                    onChange={(event) => setConfigCodeDraft(event.target.value)}
                  />
                </label>
              ) : (
                <div className="template-visual-editor">
          <div className="two-column-fields">
            {categoryLocked ? (
              <label>
                Category
                <input disabled readOnly value={selectedCategory?.name ?? routeCategoryName ?? "Unavailable category"} />
                <input name="categoryId" type="hidden" value={selectedCategory?.id ?? ""} />
              </label>
            ) : (
              <label>
                Category
                <select defaultValue={defaultCategoryId} disabled={saving || editableCategories.length === 0} name="categoryId">
                  {editableCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Data type
              <select defaultValue={seedDataType} disabled={saving} name="dataType">
                {dataTypes.map((dataType) => (
                  <option key={dataType} value={dataType}>
                    {formatEnum(dataType)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-column-fields">
            <label>
              Template name
              <input defaultValue={seedName} disabled={saving} name="name" placeholder="Object detection" />
            </label>
            <label>
              Type
              <input
                defaultValue={seedSubtype}
                disabled={saving}
                name="subtype"
                placeholder="Detection, OCR, Chat..."
              />
            </label>
          </div>
          {(selectedTemplate || sourcePreset) && (
            <div className="detail-list compact">
              <div>
                <dt>{selectedTemplate ? "Template ID" : "Source template ID"}</dt>
                <dd>{selectedTemplate?.id ?? sourcePreset?.id}</dd>
              </div>
              {selectedCategory && (
                <div>
                  <dt>Category ID</dt>
                  <dd>{selectedCategory.id}</dd>
                </div>
              )}
            </div>
          )}
          <div className="two-column-fields">
            <label>
              Header text
              <input defaultValue={seedHeader} disabled={saving} name="header" placeholder="Select label and annotate the asset" />
            </label>
            <label>
              Data value key
              <input defaultValue={seedDataKey} disabled={saving} name="dataKey" placeholder="$image" />
            </label>
          </div>
          <label>
            Description
            <textarea
              defaultValue={seedDescription}
              disabled={saving}
              name="description"
              placeholder="What this template helps label"
              rows={3}
            />
          </label>
          <label>
            Labels
            <textarea
              defaultValue={seedLabels}
              disabled={saving}
              name="labels"
              placeholder="Car&#10;Person&#10;Traffic light"
              rows={6}
            />
          </label>
          <fieldset className="template-tool-checks">
            <legend>Tools</legend>
            {templateTools.map((tool) => (
              <label className="checkbox-row" key={tool}>
                <input
                  defaultChecked={seedTools.includes(tool)}
                  disabled={saving}
                  name="tools"
                  type="checkbox"
                  value={tool}
                />
                {formatEnum(tool)}
              </label>
            ))}
          </fieldset>
          <fieldset className="template-tool-checks">
            <legend>Interface settings</legend>
            <label>
              Region border width
              <input
                defaultValue={seedSettings.regionBorderWidth}
                disabled={saving}
                max={8}
                min={1}
                name="regionBorderWidth"
                type="number"
              />
            </label>
            <label className="checkbox-row">
              <input defaultChecked={seedSettings.imageZoom} disabled={saving} name="imageZoom" type="checkbox" />
              Allow image zoom
            </label>
            <label className="checkbox-row">
              <input defaultChecked={seedSettings.zoomControls} disabled={saving} name="zoomControls" type="checkbox" />
              Show zoom controls
            </label>
            <label className="checkbox-row">
              <input defaultChecked={seedSettings.rotateControls} disabled={saving} name="rotateControls" type="checkbox" />
              Show rotate controls
            </label>
          </fieldset>
                </div>
              )}
            </aside>
            <TemplateWorkspacePreview
              dataKey={seedDataKey}
              header={seedHeader}
              labels={seedLabels}
              settings={seedSettings}
              tools={seedTools}
            />
          </div>
          <div className="row-actions">
            <button className="primary-button" disabled={saving || editableCategories.length === 0 || !selectedCategory} type="submit">
              <Save size={18} />
              {isEditing ? "Save template" : "Create template"}
            </button>
            {selectedTemplate?.canManage && (
              <button className="danger-button" disabled={saving} type="button" onClick={handleDelete}>
                <Trash2 size={18} />
                Delete template
              </button>
            )}
          </div>
        </form>
      </section>
    </section>
  );
}

function TemplateWorkspacePreview({
  dataKey,
  header,
  labels,
  settings,
  tools
}: {
  dataKey: string;
  header: string;
  labels: string;
  settings: LabelingSettings;
  tools: string[];
}) {
  const labelNames = parseLabelInputsFromText(labels).map((label) => label.name).slice(0, 5);

  return (
    <section className="template-workspace-preview" aria-label="Template visual preview">
      <div className="template-preview-stage">
        <div className="template-preview-toolbar">
          <span>Preview</span>
          <em>{dataKey}</em>
        </div>
        <strong>{header}</strong>
        <div className="template-preview-canvas">
          {tools.includes("BBOX") && <i className="preview-box one" />}
          {tools.includes("BBOX") && <i className="preview-box two" />}
          {tools.includes("POLYGON") && <i className="preview-polygon" />}
          {tools.includes("KEYPOINT") && <i className="preview-point" />}
          {tools.includes("BRUSH") && <i className="preview-brush" />}
          {settings.zoomControls && (
            <div className="template-preview-tools">
              <span>+</span>
              <span>-</span>
            </div>
          )}
        </div>
      </div>
      <aside className="template-preview-side">
        <div>
          <p className="eyebrow">Labels</p>
          <div className="label-chip-list">
            {labelNames.length > 0 ? labelNames.map((label) => <span className="label-chip" key={label}>{label}</span>) : <span className="label-chip">Label</span>}
          </div>
        </div>
        <div>
          <p className="eyebrow">Tools</p>
          <div className="label-chip-list">
            {tools.map((tool) => <span className="label-chip" key={tool}>{formatEnum(tool)}</span>)}
          </div>
        </div>
      </aside>
    </section>
  );
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

function getTemplateTools(template: AnnotationTemplateSummary | null, sourcePreset: TemplatePreset | null) {
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

function getTemplateSettings(template: AnnotationTemplateSummary | null, sourcePreset: TemplatePreset | null): LabelingSettings {
  const rawSettings = template?.configJson.settings;
  const presetSettings = sourcePreset?.settings ?? {};

  return {
    imageZoom: getBooleanSetting(rawSettings, "imageZoom", presetSettings.imageZoom ?? true),
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

function getCustomCategoryId(categoryKey?: string) {
  return categoryKey?.startsWith("custom:") ? categoryKey.replace("custom:", "") : null;
}

function getBuiltInCategoryName(categoryKey?: string) {
  if (!categoryKey?.startsWith("builtin:")) {
    return null;
  }

  return categoryKey.replace("builtin:", "");
}

function normalizePresetDataType(dataType?: string) {
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

function buildTemplateMarkup(
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
  <Image name="image" value="${escapeTemplateMarkup(dataKey)}" zoom="${settings.imageZoom !== false ? "true" : "false"}" />

${tagMarkup}
</View>`;
}

function buildToolMarkup(tool: string, labelMarkup: string, settings: Partial<LabelingSettings>) {
  const strokeWidth = settings.regionBorderWidth ?? 1;

  if (tool === "POLYGON") {
    return `  <PolygonLabels name="label" toName="image" strokeWidth="${strokeWidth}" pointSize="small" opacity="0.9">
${labelMarkup}
  </PolygonLabels>`;
  }

  if (tool === "BRUSH") {
    return `  <BrushLabels name="label" toName="image" opacity="0.65">
${labelMarkup}
  </BrushLabels>`;
  }

  if (tool === "TEXT_SPAN") {
    return `  <Labels name="label" toName="text">
${labelMarkup}
  </Labels>`;
  }

  if (tool === "KEYPOINT") {
    return `  <KeyPointLabels name="label" toName="image" strokeWidth="${strokeWidth}">
${labelMarkup}
  </KeyPointLabels>`;
  }

  if (tool === "CLASSIFICATION") {
    return `  <Choices name="label" toName="image" choice="single">
${labelMarkup}
  </Choices>`;
  }

  if (tool === "RELATION") {
    return `  <Relations>
    <Relation value="related" />
  </Relations>`;
  }

  return `  <RectangleLabels name="label" toName="image" strokeWidth="${strokeWidth}">
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
