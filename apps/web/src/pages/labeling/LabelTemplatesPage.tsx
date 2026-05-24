import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Database, Plus, Save, Trash2 } from "lucide-react";
import {
  createAnnotationTemplate,
  deleteAnnotationTemplate,
  listAnnotationTemplates,
  updateAnnotationTemplate,
  type AnnotationTemplateSummary
} from "../../api";
import { getFormValue, useAuth } from "../../auth";
import { buildTemplateConfig, builtInTemplatePresets, parseLabelInputsFromText, type TemplatePreset } from "../../components/labeling/LabelingConfigBuilder";
import { useOrganizations } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

const dataTypes = ["IMAGE", "VIDEO", "AUDIO", "TEXT", "PDF", "TIME_SERIES", "MULTIMODAL"];
const templateCategories = [
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
const templateTools = ["BBOX", "POLYGON", "BRUSH", "TEXT_SPAN", "KEYPOINT", "CLASSIFICATION", "RELATION"];

export function LabelTemplatesPage() {
  const { dbUser, session } = useAuth();
  const { organizations } = useOrganizations(session);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const manageableOrganizations = organizations.filter((organization) => ["OWNER", "ADMIN"].includes(organization.role));
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const canCreate = dbUser?.globalRole === "SUPER_ADMIN" || manageableOrganizations.length > 0;
  const groupedBuiltIns = useMemo(() => groupPresetsByCategory(builtInTemplatePresets), []);

  async function reloadTemplates() {
    if (!session) {
      return;
    }

    setTemplates(await listAnnotationTemplates(session));
  }

  useEffect(() => {
    void reloadTemplates().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "Unable to load annotation templates.");
    });
  }, [session]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!session) {
      setError("Authentication required.");
      return;
    }

    const form = event.currentTarget;
    const name = getFormValue(event, "name");
    const description = getFormValue(event, "description");
    const category = getFormValue(event, "category") || "Custom Templates";
    const subtype = getFormValue(event, "subtype") || "Custom";
    const dataType = getFormValue(event, "dataType") || "IMAGE";
    const labels = parseLabelInputsFromText(getFormValue(event, "labels"));
    const selectedTools = new FormData(form).getAll("tools").map(String);
    const organizationId = getFormValue(event, "organizationId") || null;

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
      category,
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
          configJson: buildTemplateConfig(preset),
          dataType,
          description,
          name
        });
        setMessage("Template updated.");
      } else {
        await createAnnotationTemplate(session, {
          configJson: buildTemplateConfig(preset),
          dataType,
          description,
          name,
          organizationId
        });
        setMessage("Template created.");
        form.reset();
      }

      await reloadTemplates();
      setSelectedTemplateId(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!session || !selectedTemplate) {
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      await deleteAnnotationTemplate(session, selectedTemplate.id);
      await reloadTemplates();
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
            <h2>Annotation templates</h2>
          </div>
          <span className="status-pill compact">{templates.length} custom templates</span>
        </div>
        {(error || message) && <p className={error ? "form-error" : "form-success"}>{error ?? message}</p>}
        <div className="template-settings-layout">
          <section className="panel template-settings-library">
            <p className="eyebrow">Built-in template library</p>
            {groupedBuiltIns.map((group) => (
              <div className="template-settings-group" key={group.category}>
                <h3>{group.category}</h3>
                <div className="template-settings-card-grid">
                  {group.templates.map((template) => (
                    <article className="template-settings-card" key={template.id}>
                      <strong>{template.name}</strong>
                      <span>{template.subtype}</span>
                      <small>{template.description}</small>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <aside className="panel template-settings-editor">
            <p className="eyebrow">{selectedTemplate ? "Edit custom template" : "New custom template"}</p>
            <h3>{selectedTemplate ? selectedTemplate.name : "Create template"}</h3>
            {!canCreate && (
              <p className="muted-copy">Only super admins or organization owners/admins can create custom templates.</p>
            )}
            <form key={selectedTemplate?.id ?? "new-template"} onSubmit={handleSave}>
              <label>
                Scope
                <select
                  defaultValue={selectedTemplate?.organizationId ?? (dbUser?.globalRole === "SUPER_ADMIN" ? "" : manageableOrganizations[0]?.id ?? "")}
                  disabled={!canCreate || Boolean(selectedTemplate)}
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
                Template name
                <input defaultValue={selectedTemplate?.name ?? ""} disabled={!canCreate} name="name" placeholder="Vehicle damage detection" />
              </label>
              <label>
                Description
                <textarea
                  defaultValue={selectedTemplate?.description ?? ""}
                  disabled={!canCreate}
                  name="description"
                  placeholder="What this template helps label"
                  rows={3}
                />
              </label>
              <div className="two-column-fields">
                <label>
                  Category
                  <select defaultValue={getTemplateConfigString(selectedTemplate, "category") ?? "Computer Vision"} disabled={!canCreate} name="category">
                    {templateCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <input defaultValue={getTemplateConfigString(selectedTemplate, "subtype") ?? ""} disabled={!canCreate} name="subtype" placeholder="Detection, OCR, Cinematic..." />
                </label>
              </div>
              <label>
                Data type
                <select defaultValue={selectedTemplate?.dataType ?? "IMAGE"} disabled={!canCreate} name="dataType">
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
                  disabled={!canCreate}
                  name="labels"
                  placeholder="Car&#10;Person&#10;Traffic light"
                  rows={5}
                />
              </label>
              <fieldset className="template-tool-checks">
                <legend>Tools</legend>
                {templateTools.map((tool) => (
                  <label className="checkbox-row" key={tool}>
                    <input defaultChecked={templateHasTool(selectedTemplate, tool)} disabled={!canCreate} name="tools" type="checkbox" value={tool} />
                    {formatEnum(tool)}
                  </label>
                ))}
              </fieldset>
              <div className="row-actions">
                <button className="primary-button" disabled={!canCreate || saving} type="submit">
                  {selectedTemplate ? <Save size={18} /> : <Plus size={18} />}
                  {selectedTemplate ? "Save template" : "Create template"}
                </button>
                {selectedTemplate && (
                  <button className="danger-button" disabled={saving} type="button" onClick={handleDelete}>
                    <Trash2 size={18} />
                    Delete
                  </button>
                )}
              </div>
            </form>
          </aside>
        </div>

        <section className="panel">
          <div className="settings-page-head">
            <div>
              <p className="eyebrow">Custom templates</p>
              <h3>Saved templates</h3>
            </div>
            <Database size={18} />
          </div>
          <div className="template-settings-card-grid">
            {templates.length > 0 ? (
              templates.map((template) => (
                <button
                  className={`template-settings-card selectable ${selectedTemplateId === template.id ? "active" : ""}`}
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <strong>{template.name}</strong>
                  <span>{getTemplateConfigString(template, "category") ?? "Custom Templates"}</span>
                  <small>{template.description ?? "No description added."}</small>
                </button>
              ))
            ) : (
              <p className="muted-copy">No custom templates yet.</p>
            )}
          </div>
        </section>
      </section>
    </section>
  );
}

function groupPresetsByCategory(templates: TemplatePreset[]) {
  return Array.from(new Set(templates.map((template) => template.category))).map((category) => ({
    category,
    templates: templates.filter((template) => template.category === category)
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

  if (!Array.isArray(tools)) {
    return toolName === "BBOX";
  }

  return tools.some((tool) => {
    if (typeof tool === "string") {
      return tool === toolName;
    }

    return Boolean(tool && typeof tool === "object" && "tool" in tool && tool.tool === toolName);
  });
}
