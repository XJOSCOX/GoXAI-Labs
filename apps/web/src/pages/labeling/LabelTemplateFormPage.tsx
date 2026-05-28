import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
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
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useOrganizations } from "../../hooks/useResources";
import { builtInTemplateToPreset } from "../../utils/templates";
import { TemplateEditorPanel } from "../../features/labeling/template-form/TemplateEditorPanel";
import { TemplateSettingsPanel } from "../../features/labeling/template-form/TemplateSettingsPanel";
import { TemplateWorkspacePreview } from "../../features/labeling/template-form/TemplateWorkspacePreview";
import {
  buildTemplateMarkup,
  getBuiltInCategoryName,
  getCustomCategoryId,
  getTemplateConfigString,
  getTemplateSettings,
  getTemplateTools,
  normalizePresetDataType,
  parseTemplateConfigCode,
  templateLabelsToText
} from "../../features/labeling/template-form/templateFormUtils";

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
  const [configCodeDraft, setConfigCodeDraft] = useState<string | null>(null);
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
            <TemplateEditorPanel
              configCodeValue={configCodeValue}
              onConfigCodeChange={setConfigCodeDraft}
              onUpdateConfigCode={updateConfigCode}
              parsedConfig={parsedConfig}
              saving={saving}
            />
            <TemplateWorkspacePreview parsedConfig={parsedConfig} />
            <TemplateSettingsPanel
              categoryLocked={categoryLocked}
              defaultCategoryId={defaultCategoryId}
              editableCategories={editableCategories}
              fallbackCategoryName={fallbackCategoryName}
              parsedConfig={parsedConfig}
              saving={saving}
              seedDataType={seedDataType}
              seedDescription={seedDescription}
              seedName={seedName}
              seedSubtype={seedSubtype}
              selectedCategory={selectedCategory}
              selectedTemplate={selectedTemplate}
              sourcePreset={sourcePreset}
            />
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
