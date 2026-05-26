import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Code2, Eye, Save, Trash2 } from "lucide-react";
import {
  createAnnotationCategory,
  createAnnotationTemplate,
  deleteAnnotationTemplate,
  listBuiltInAnnotationTemplates,
  listAnnotationCategories,
  listAnnotationTemplates,
  updateAnnotationTemplate,
  type AnnotationCategorySummary,
  type BuiltInAnnotationTemplateGroup,
  type AnnotationTemplateSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import {
  annotationLabelColors,
  buildTemplateConfig,
  builtInTemplateCategories as fallbackBuiltInTemplateCategories,
  builtInTemplatePresets as fallbackBuiltInTemplatePresets,
  parseLabelInputsFromText,
  type LabelingSettings,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useOrganizations } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";
import { builtInTemplateToPreset } from "../../utils/templates";

const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
const labelPositions: Array<LabelingSettings["labelPosition"]> = ["top", "right", "bottom", "left"];
const templateToolDefinitions = [
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
const templateTools = templateToolDefinitions.map((tool) => tool.id);

type ParsedTemplateConfig = {
  dataKey: string;
  header: string;
  labels: Array<{ color: string; name: string }>;
  parseError: string | null;
  settings: LabelingSettings;
  tools: string[];
};

export function LabelTemplateFormPage() {
  const { categoryKey, templateId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [builtInCategories, setBuiltInCategories] = useState<BuiltInAnnotationTemplateGroup[]>(fallbackBuiltInTemplateCategories);
  const [builtInTemplates, setBuiltInTemplates] = useState<TemplatePreset[]>(fallbackBuiltInTemplatePresets);
  const [error, setError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"code" | "visual">("visual");
  const [configCodeDraft, setConfigCodeDraft] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editableCategories = useMemo(() => categories.filter((category) => category.canManage), [categories]);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const sourceTemplateId = searchParams.get("sourceTemplate");
  const sourcePreset = builtInTemplates.find((template) => template.id === sourceTemplateId) ?? null;
  const requestedCategoryId = searchParams.get("category");
  const requestedCategoryName = searchParams.get("categoryName");
  const routeCategoryId = getCustomCategoryId(categoryKey);
  const routeCategoryName = getBuiltInCategoryName(categoryKey, builtInCategories);
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
  const manageableOrganizations = organizations.filter((organization) => ["OWNER", "ADMIN"].includes(organization.role));
  const canCreateCategory = dbUser?.globalRole === "SUPER_ADMIN" || manageableOrganizations.length > 0;
  const fallbackCategoryName = routeCategoryName ?? sourcePreset?.category ?? requestedCategoryName ?? "Custom Templates";
  const isEditing = Boolean(templateId);
  const categoryLocked = Boolean(categoryKey);
  const canAutoCreateCategory = !selectedCategory && categoryLocked && canCreateCategory && Boolean(fallbackCategoryName);
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
    sourcePreset?.configCode ??
    buildTemplateMarkup(seedHeader, seedDataKey, seedLabels, seedTools, seedSettings);
  const configCodeValue = configCodeDraft ?? initialConfigCode;
  const parsedConfig = useMemo(() => parseTemplateConfigCode(configCodeValue), [configCodeValue]);
  const filteredLabels = useMemo(() => {
    const term = labelFilter.trim().toLowerCase();

    if (!term) {
      return parsedConfig.labels;
    }

    return parsedConfig.labels.filter((label) => label.name.toLowerCase().includes(term));
  }, [labelFilter, parsedConfig.labels]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session) {
        return;
      }

      try {
        const [nextBuiltIns, nextCategories, nextTemplates] = await Promise.all([
          listBuiltInAnnotationTemplates(session),
          listAnnotationCategories(session),
          listAnnotationTemplates(session)
        ]);

        if (!cancelled) {
          setBuiltInCategories(nextBuiltIns.groups);
          setBuiltInTemplates(nextBuiltIns.templates.map(builtInTemplateToPreset));
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

    if (isEditing && !selectedTemplate) {
      setError("Template is still loading or could not be found. Go back to templates and select it again.");
      return;
    }

    const categoryId = getFormValue(event, "categoryId");
    let category = editableCategories.find((item) => item.id === categoryId) ?? null;
    const name = getFormValue(event, "name");
    const description = getFormValue(event, "description");
    const subtype = getFormValue(event, "subtype") || "Custom";
    const dataType = getFormValue(event, "dataType") || "IMAGE";
    const configCode = getFormValue(event, "configCode") || configCodeValue;
    const parsedForSave = parseTemplateConfigCode(configCode);
    const labels = parsedForSave.labels.map((label, index) => ({
      color: label.color || annotationLabelColors[index % annotationLabelColors.length],
      name: label.name,
      shortcutKey: index < 9 ? String(index + 1) : undefined
    }));
    const selectedTools = parsedForSave.tools;
    const settings = parsedForSave.settings;

    if (!category && !canAutoCreateCategory) {
      setError("Choose a category you own before saving this template.");
      return;
    }

    if (!name) {
      setError("Template name is required.");
      return;
    }

    if (parsedForSave.parseError) {
      setError(parsedForSave.parseError);
      return;
    }

    if (labels.length === 0) {
      setError("Add at least one label in the template code.");
      return;
    }

    if (selectedTools.length === 0) {
      setError("Add at least one labeling tool in the template code.");
      return;
    }

    setSaving(true);

    try {
      if (!category && canAutoCreateCategory) {
        category = await createAnnotationCategory(session, {
          description: `${fallbackCategoryName} templates and labeling presets.`,
          name: fallbackCategoryName,
          organizationId: dbUser?.globalRole === "SUPER_ADMIN" ? null : manageableOrganizations[0]?.id ?? null
        });
      }

      if (!category) {
        setError("Choose a category you own before saving this template.");
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

      const payload = {
        categoryId: category.id,
        configJson: {
          ...buildTemplateConfig(preset),
          configCode,
          dataKey: parsedForSave.dataKey,
          header: parsedForSave.header,
          sourceTemplateId:
            sourcePreset?.id ??
            getTemplateConfigString(selectedTemplate, "sourceTemplateId") ??
            selectedTemplate?.id ??
            null
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

  function updateConfigCode(transform: (code: string) => string) {
    setConfigCodeDraft(transform(configCodeValue));
  }

  function handleAddLabels() {
    const names = labelDraft
      .split(/[\n,]/)
      .map((label) => label.trim())
      .filter(Boolean);

    if (names.length === 0) {
      return;
    }

    updateConfigCode((code) => addLabelsToTemplateCode(code, names));
    setLabelDraft("");
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

        <form
          className="panel template-form-page"
          key={selectedTemplate?.id ?? sourcePreset?.id ?? defaultCategoryId ?? "new-template"}
          onSubmit={handleSubmit}
        >
          {canAutoCreateCategory && (
            <p className="form-note">
              This built-in category will be saved as your own {fallbackCategoryName} category when you create the template.
            </p>
          )}
          {!canAutoCreateCategory && editableCategories.length === 0 && (
            <p className="form-note">Create or join an organization with label-setting rights before adding templates.</p>
          )}
          <input name="configCode" type="hidden" value={configCodeValue} />
          <div className="labeling-interface-builder">
            <aside className="labeling-config-panel template-code-panel">
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
                  <section className="visual-editor-section">
                    <h3>Add label names</h3>
                    <p>Use new line as a separator to add multiple labels</p>
                    <textarea
                      disabled={saving}
                      rows={4}
                      value={labelDraft}
                      onChange={(event) => setLabelDraft(event.target.value)}
                    />
                    <button className="secondary-button compact-button" disabled={saving || !labelDraft.trim()} type="button" onClick={handleAddLabels}>
                      Add
                    </button>
                  </section>
                  <section className="visual-editor-section">
                    <h3>Labels ({parsedConfig.labels.length})</h3>
                    {parsedConfig.labels.length > 8 && (
                      <input
                        className="compact-filter-input"
                        disabled={saving}
                        placeholder="Filter labels"
                        type="search"
                        value={labelFilter}
                        onChange={(event) => setLabelFilter(event.target.value)}
                      />
                    )}
                    <div className="visual-label-list">
                      {parsedConfig.labels.length > 0 ? (
                        filteredLabels.map((label) => (
                          <span key={`${label.name}-${label.color}`} style={{ borderLeftColor: label.color, background: colorWithAlpha(label.color, 0.24) }}>
                            {label.name}
                          </span>
                        ))
                      ) : (
                        <p className="muted-copy">No labels found in the code.</p>
                      )}
                      {parsedConfig.labels.length > 0 && filteredLabels.length === 0 && (
                        <p className="muted-copy">No labels match this filter.</p>
                      )}
                    </div>
                  </section>
                  <section className="visual-editor-section">
                    <h3>Annotation tools</h3>
                    <div className="visual-tool-grid">
                      {templateTools.map((tool) => (
                        <label className="checkbox-row" key={tool}>
                          <input
                            checked={parsedConfig.tools.includes(tool)}
                            disabled={saving}
                            type="checkbox"
                            onChange={(event) => updateConfigCode((code) => toggleToolInCode(code, tool, event.target.checked))}
                          />
                          {getToolLabel(tool)}
                        </label>
                      ))}
                    </div>
                  </section>
                  <section className="visual-editor-section">
                    <h3>Configure settings</h3>
                    <label className="inline-field">
                      Width of region borders
                      <input
                        disabled={saving}
                        max={8}
                        min={1}
                        type="number"
                        value={parsedConfig.settings.regionBorderWidth}
                        onChange={(event) => updateConfigCode((code) => setToolStrokeWidthInCode(code, Number(event.target.value)))}
                      />
                    </label>
                    <label className="inline-field">
                      Display labels
                      <select
                        disabled={saving}
                        value={parsedConfig.settings.labelPosition}
                        onChange={(event) => updateConfigCode((code) => setToolLabelPositionInCode(code, event.target.value as LabelingSettings["labelPosition"]))}
                      >
                        {labelPositions.map((position) => (
                          <option key={position} value={position}>
                            {formatEnum(position)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="checkbox-row">
                      <input
                        checked={parsedConfig.settings.imageZoom}
                        disabled={saving}
                        type="checkbox"
                        onChange={(event) => updateConfigCode((code) => setMediaAttributeInCode(code, "zoom", event.target.checked ? "true" : "false"))}
                      />
                      Allow image zoom (ctrl+wheel)
                    </label>
                    <label className="checkbox-row">
                      <input
                        checked={parsedConfig.settings.zoomControls}
                        disabled={saving}
                        type="checkbox"
                        onChange={(event) => updateConfigCode((code) => setMediaAttributeInCode(code, "zoomControl", event.target.checked ? "true" : "false"))}
                      />
                      Show controls to zoom in and out
                    </label>
                    <label className="checkbox-row">
                      <input
                        checked={parsedConfig.settings.rotateControls}
                        disabled={saving}
                        type="checkbox"
                        onChange={(event) => updateConfigCode((code) => setMediaAttributeInCode(code, "rotateControl", event.target.checked ? "true" : "false"))}
                      />
                      Show controls to rotate image
                    </label>
                  </section>
                </div>
              )}
            </aside>
            <TemplateWorkspacePreview
              parsedConfig={parsedConfig}
            />
            <aside className="labeling-config-panel template-settings-panel">
              <div className="two-column-fields">
                {categoryLocked ? (
                  <label>
                    Category
                    <input disabled readOnly value={selectedCategory?.name ?? `${fallbackCategoryName} (will be created)`} />
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
              <section className="parsed-template-summary">
                <p className="eyebrow">Parsed from code</p>
                {parsedConfig.parseError ? (
                  <p className="inline-error">{parsedConfig.parseError}</p>
                ) : (
                  <>
                    <div className="detail-list compact">
                      <div>
                        <dt>Data key</dt>
                        <dd>{parsedConfig.dataKey}</dd>
                      </div>
                      <div>
                        <dt>Border</dt>
                        <dd>{parsedConfig.settings.regionBorderWidth}px</dd>
                      </div>
                      <div>
                        <dt>Label position</dt>
                        <dd>{formatEnum(parsedConfig.settings.labelPosition)}</dd>
                      </div>
                      <div>
                        <dt>Zoom</dt>
                        <dd>{parsedConfig.settings.imageZoom ? "On" : "Off"}</dd>
                      </div>
                    </div>
                    <div>
                      <p className="eyebrow">Labels</p>
                      <div className="label-chip-list">
                        {parsedConfig.labels.length > 0 ? (
                          parsedConfig.labels.map((label) => (
                            <span className="label-chip" key={`${label.name}-${label.color}`}>
                              <i style={{ background: label.color }} />
                              {label.name}
                            </span>
                          ))
                        ) : (
                          <span className="muted-copy">No labels found.</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="eyebrow">Tools</p>
                      <div className="label-chip-list">
                        {parsedConfig.tools.length > 0 ? (
                          parsedConfig.tools.map((tool) => <span className="label-chip" key={tool}>{getToolLabel(tool)}</span>)
                        ) : (
                          <span className="muted-copy">No tools found.</span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </section>
            </aside>
          </div>
          <div className="row-actions">
            <button
              className="primary-button"
              disabled={saving || (isEditing && !selectedTemplate) || (!selectedCategory && !canAutoCreateCategory)}
              type="submit"
            >
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

function TemplateWorkspacePreview({ parsedConfig }: { parsedConfig: ParsedTemplateConfig }) {
  return (
    <section className="template-workspace-preview" aria-label="Template visual preview">
      <div className="template-preview-stage">
        <div className="template-preview-toolbar">
          <span>Preview</span>
          <em>{parsedConfig.dataKey}</em>
        </div>
        <strong>{parsedConfig.header}</strong>
        {parsedConfig.parseError && <p className="inline-error">{parsedConfig.parseError}</p>}
        <div className="template-preview-canvas">
          {(parsedConfig.tools.includes("BBOX") || parsedConfig.tools.includes("RECTANGLE") || parsedConfig.tools.includes("VIDEO_RECTANGLE")) && (
            <i className="preview-box one" style={{ borderColor: getPreviewColor(parsedConfig.labels, 0) }} />
          )}
          {(parsedConfig.tools.includes("BBOX") || parsedConfig.tools.includes("RECTANGLE")) && (
            <i className="preview-box two" style={{ borderColor: getPreviewColor(parsedConfig.labels, 1) }} />
          )}
          {parsedConfig.tools.includes("POLYGON") && <i className="preview-polygon" style={{ borderColor: getPreviewColor(parsedConfig.labels, 0) }} />}
          {parsedConfig.tools.includes("ELLIPSE") && <i className="preview-ellipse" style={{ borderColor: getPreviewColor(parsedConfig.labels, 0) }} />}
          {parsedConfig.tools.includes("VECTOR") && <i className="preview-vector" style={{ borderColor: getPreviewColor(parsedConfig.labels, 0) }} />}
          {parsedConfig.tools.includes("KEYPOINT") && <i className="preview-point" style={{ borderColor: getPreviewColor(parsedConfig.labels, 0) }} />}
          {(parsedConfig.tools.includes("BRUSH") || parsedConfig.tools.includes("BITMASK") || parsedConfig.tools.includes("MAGIC_WAND")) && (
            <i className="preview-brush" style={{ background: colorWithAlpha(getPreviewColor(parsedConfig.labels, 0), 0.24) }} />
          )}
          {(parsedConfig.tools.includes("CLASSIFICATION") || parsedConfig.tools.includes("TAXONOMY") || parsedConfig.tools.includes("RANKER")) && (
            <div className="preview-choice-strip">
              {parsedConfig.labels.slice(0, 3).map((label) => (
                <span key={label.name} style={{ borderColor: label.color }}>{label.name}</span>
              ))}
            </div>
          )}
          {parsedConfig.labels.length > 0 && parsedConfig.tools.some((tool) => !["TEXT_AREA", "NUMBER", "RATING", "DATE_TIME", "PAIRWISE", "RELATION", "MAGIC_WAND", "SHORTCUT"].includes(tool)) && (
            <div className={`preview-label-position ${parsedConfig.settings.labelPosition}`}>
              {parsedConfig.labels.slice(0, 3).map((label) => (
                <span key={label.name} style={{ borderLeftColor: label.color }}>
                  {label.name}
                </span>
              ))}
            </div>
          )}
          {parsedConfig.settings.zoomControls && (
            <div className="template-preview-tools">
              <span>+</span>
              <span>-</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function parseTemplateConfigCode(configCode: string): ParsedTemplateConfig {
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

function getTemplateToolsFromDocument(document: Document) {
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

function getPreviewColor(labels: Array<{ color: string }>, index: number) {
  return labels[index]?.color || annotationLabelColors[index % annotationLabelColors.length];
}

function colorWithAlpha(color: string, alpha: number) {
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

function addLabelsToTemplateCode(configCode: string, labelNames: string[]) {
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

function setMediaAttributeInCode(configCode: string, attribute: string, value: string) {
  return configCode.replace(/<(Image|Video|Audio|Text|HyperText|Paragraphs|TimeSeries|Table|Pdf|PDF|List|Chat)\b([^>]*?)(\s*\/?)>/, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, attribute, value).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/" || tagName !== "Text";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

function setToolStrokeWidthInCode(configCode: string, value: number) {
  const width = Number.isFinite(value) ? String(Math.max(1, Math.min(8, value))) : "1";

  return configCode.replace(/<(RectangleLabels|Rectangle|PolygonLabels|Polygon|EllipseLabels|Ellipse|KeyPointLabels|KeyPoint|VectorLabels|Vector|VideoRectangle|VideoVectorLabels|VideoVector|TimeSeriesLabels|TimelineLabels)\b([^>]*?)(\s*\/?)>/g, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, "strokeWidth", width).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

function setToolLabelPositionInCode(configCode: string, value: LabelingSettings["labelPosition"]) {
  const position = parseLabelPosition(value);

  return configCode.replace(/<(RectangleLabels|PolygonLabels|BrushLabels|BitmaskLabels|EllipseLabels|KeyPointLabels|VectorLabels|VideoVectorLabels|TimeSeriesLabels|TimelineLabels|Labels|HyperTextLabels|ParagraphLabels|Choices|Taxonomy|Ranker)\b([^>]*?)(\s*\/?)>/g, (_match, tagName: string, attributes: string, closingSlash: string) => {
    const nextAttributes = setXmlAttribute(attributes, "labelPosition", position).replace(/\s*\/\s*$/, "");
    const shouldSelfClose = closingSlash.trim() === "/";

    return `<${tagName}${nextAttributes}${shouldSelfClose ? " /" : ""}>`;
  });
}

function toggleToolInCode(configCode: string, tool: string, enabled: boolean) {
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

function getToolLabel(tool: string) {
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

function getCustomCategoryId(categoryKey?: string) {
  return categoryKey?.startsWith("custom:") ? categoryKey.replace("custom:", "") : null;
}

function getBuiltInCategoryName(categoryKey: string | undefined, builtInCategories: BuiltInAnnotationTemplateGroup[]) {
  if (!categoryKey?.startsWith("builtin:")) {
    return null;
  }

  const categoryIdOrName = categoryKey.replace("builtin:", "");
  return builtInCategories.find((category) => category.id === categoryIdOrName)?.name ?? categoryIdOrName;
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
