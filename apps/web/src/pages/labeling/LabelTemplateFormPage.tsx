import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
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
  parseLabelInputsFromText,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { formatEnum } from "../../utils/format";

const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
const templateTools = ["BBOX", "POLYGON", "BRUSH", "TEXT_SPAN", "KEYPOINT", "CLASSIFICATION", "RELATION"];

export function LabelTemplateFormPage() {
  const { templateId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [categories, setCategories] = useState<AnnotationCategorySummary[]>([]);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editableCategories = useMemo(() => categories.filter((category) => category.canManage), [categories]);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const requestedCategoryId = searchParams.get("category");
  const requestedCategoryName = searchParams.get("categoryName");
  const defaultCategoryId =
    selectedTemplate?.categoryId ??
    (requestedCategoryId && editableCategories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : editableCategories.find((category) => category.name === requestedCategoryName)?.id ?? editableCategories[0]?.id ?? "");
  const selectedCategory = editableCategories.find((category) => category.id === defaultCategoryId) ?? null;
  const isEditing = Boolean(templateId);

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
    const labels = parseLabelInputsFromText(getFormValue(event, "labels"));
    const selectedTools = new FormData(form).getAll("tools").map(String);

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
      subtype,
      tools: selectedTools
    };

    setSaving(true);

    try {
      const payload = {
        categoryId: category.id,
        configJson: buildTemplateConfig(preset),
        dataType,
        description,
        name
      };

      if (selectedTemplate) {
        await updateAnnotationTemplate(session, selectedTemplate.id, payload);
        setMessage("Template updated.");
      } else {
        await createAnnotationTemplate(session, payload);
        setMessage("Template created.");
      }

      navigate("/label-templates");
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
      navigate("/label-templates");
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
            <h2>{isEditing ? "Edit template" : "New template"}</h2>
          </div>
          {selectedCategory && <span className="status-pill compact">{selectedCategory.name}</span>}
        </div>

        {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}

        <form className="panel template-form-page" onSubmit={handleSubmit}>
          {editableCategories.length === 0 && (
            <p className="form-error">Create a custom category before adding templates.</p>
          )}
          <div className="two-column-fields">
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
            <label>
              Data type
              <select defaultValue={selectedTemplate?.dataType ?? "IMAGE"} disabled={saving} name="dataType">
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
              <input defaultValue={selectedTemplate?.name ?? ""} disabled={saving} name="name" placeholder="Object detection" />
            </label>
            <label>
              Type
              <input
                defaultValue={getTemplateConfigString(selectedTemplate, "subtype") ?? ""}
                disabled={saving}
                name="subtype"
                placeholder="Detection, OCR, Chat..."
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              defaultValue={selectedTemplate?.description ?? ""}
              disabled={saving}
              name="description"
              placeholder="What this template helps label"
              rows={3}
            />
          </label>
          <label>
            Labels
            <textarea
              defaultValue={templateLabelsToText(selectedTemplate)}
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
                  defaultChecked={templateHasTool(selectedTemplate, tool)}
                  disabled={saving}
                  name="tools"
                  type="checkbox"
                  value={tool}
                />
                {formatEnum(tool)}
              </label>
            ))}
          </fieldset>
          <div className="row-actions">
            <button className="primary-button" disabled={saving || editableCategories.length === 0} type="submit">
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
