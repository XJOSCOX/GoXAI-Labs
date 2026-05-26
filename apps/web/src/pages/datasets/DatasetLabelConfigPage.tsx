import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, GalleryHorizontalEnd, Save, Settings2, X } from "lucide-react";
import {
  applyDatasetTaskWorkflow,
  listAnnotationTemplates,
  listBuiltInAnnotationTemplates,
  listTaskParticipants,
  updateDataset,
  type AnnotationTemplateSummary,
  type DatasetSummary,
  type TaskParticipantSummary,
  type TaskWorkflowInput
} from "../../api";
import { useAuth } from "../../auth";
import {
  annotationLabelColors,
  buildLabelingConfig,
  builtInTemplateCategories as fallbackBuiltInTemplateCategories,
  builtInTemplatePresets as fallbackBuiltInTemplatePresets,
  getAnnotationTemplateIdFromForm,
  getConfigCodeFromForm,
  hasAnnotatableConfigCode,
  LabelingConfigBuilder,
  parseLabelingSettingsFromForm,
  parseLabelInputsFromForm,
  parseToolInputsFromForm,
  type LabelInput,
  type LabelingSettings,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useDataset } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";
import { builtInTemplateToPreset } from "../../utils/templates";

const priorityPresets = [
  { label: "Normal", value: "0" },
  { label: "High", value: "5" },
  { label: "Urgent", value: "10" }
];
type DatasetTaskAssignmentMode = NonNullable<TaskWorkflowInput["assignmentMode"]>;

export function DatasetLabelConfigPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { dataset, error, loading, reload } = useDataset(session, datasetId);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);
  const [builtInTemplates, setBuiltInTemplates] = useState<TemplatePreset[]>(fallbackBuiltInTemplatePresets);
  const [builtInCategories, setBuiltInCategories] = useState(fallbackBuiltInTemplateCategories);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [configDraft, setConfigDraft] = useState<{ source: "dataset" | "template"; template: TemplatePreset } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      if (!session) {
        return;
      }

      try {
        const [builtIns, templateList] = await Promise.all([
          listBuiltInAnnotationTemplates(session),
          listAnnotationTemplates(session)
        ]);

        if (!cancelled) {
          setBuiltInCategories(builtIns.groups);
          setBuiltInTemplates(builtIns.templates.map(builtInTemplateToPreset));
          setTemplates(templateList);
        }
      } catch {
        if (!cancelled) {
          setTemplates([]);
        }
      }
    }

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [session]);

  const templatePresets = useMemo(() => templates.map(templateToPreset), [templates]);
  const allTemplatePresets = useMemo(
    () => [...builtInTemplates, ...templatePresets],
    [builtInTemplates, templatePresets]
  );
  const appliedTemplate = useMemo(
    () => dataset ? getAppliedTemplate(dataset, allTemplatePresets) : null,
    [allTemplatePresets, dataset]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);
    setMessage(null);

    if (!session || !dataset) {
      setPageError("Authentication required.");
      return;
    }

    const form = event.currentTarget;
    const labels = parseLabelInputsFromForm(form);
    const tools = parseToolInputsFromForm(event.currentTarget);
    const settings = parseLabelingSettingsFromForm(form);
    const annotationTemplateId = getAnnotationTemplateIdFromForm(form);
    const configCode = getConfigCodeFromForm(form);
    const selectedTemplate = getSelectedTemplateFromForm(form, allTemplatePresets);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const markReady = submitter?.value === "ready";

    if (labels.length === 0 && !hasAnnotatableConfigCode(configCode)) {
      setPageError("Add at least one label or provide Label Studio config code with an annotation control.");
      return;
    }

    if (tools.length === 0) {
      setPageError("Enable at least one annotation tool before saving this dataset labeling config.");
      return;
    }

    setSaving(true);

    try {
      await updateDataset(session, dataset.id, {
        annotationTemplateId,
        labelingConfig: buildLabelingConfig(labels, tools, settings, selectedTemplate, configCode),
        labels,
        tools,
        ...(markReady ? { status: "READY" } : {})
      });
      setMessage(markReady ? "Dataset template saved and marked ready." : "Dataset template saved.");
      await reload();
      setConfigDraft(null);
      setShowTemplatePicker(false);

      if (markReady) {
        navigate(`/datasets/${dataset.id}`);
      }
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save dataset template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <section className="panel dataset-detail-frame">
        <div className="organization-detail-nav">
          <Link className="secondary-button compact-button" to={dataset ? `/datasets/${dataset.id}` : "/datasets"}>
            <ArrowLeft size={16} />
            Back to dataset
          </Link>
        </div>
        {(error ?? pageError) && <p className="form-error">{error ?? pageError}</p>}
        {loading ? (
          <p className="muted-copy">Loading dataset template.</p>
        ) : dataset ? (
          <div className="label-config-page">
            <section className="panel">
              <div className="dataset-summary-head">
                <div>
                  <p className="eyebrow">Dataset template</p>
                  <h2>{dataset.name}</h2>
                </div>
                <span className="status-pill compact">{formatEnum(dataset.status)}</span>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Project</dt>
                  <dd>{dataset.project.name}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>v{dataset.version}</dd>
                </div>
                <div>
                  <dt>Labels</dt>
                  <dd>{dataset.labels.length}</dd>
                </div>
                <div>
                  <dt>Tools</dt>
                  <dd>{dataset.tools.filter((tool) => tool.enabled).length}</dd>
                </div>
              </dl>
              <p className="muted-copy">
                Apply a template to this dataset before making it ready for public or assigned work.
              </p>
            </section>

            <div className="dataset-config-grid">
              <DatasetControllerConfig
                dataset={dataset}
                onSaved={reload}
                session={session}
                setPageError={setPageError}
              />

              <section className="panel dataset-template-assignment">
              <div className="dataset-template-assignment-head">
                <div>
                  <p className="eyebrow">Template assignment</p>
                  <h3>{appliedTemplate?.name ?? "No template assigned"}</h3>
                    <p className="muted-copy">
                      {appliedTemplate
                        ? `${appliedTemplate.category} - ${appliedTemplate.dataType}`
                        : "Choose a reusable template, then configure labels, tools, and settings in the popup."}
                    </p>
                </div>
                <button className="primary-button" type="button" onClick={() => setShowTemplatePicker(true)}>
                  <GalleryHorizontalEnd size={18} />
                  {appliedTemplate ? "Change template" : "Assign template"}
                </button>
              </div>
              {appliedTemplate ? (
                <div className="dataset-template-card">
                  <TemplateMiniPreview template={appliedTemplate} />
                  <div>
                    <strong>{appliedTemplate.name}</strong>
                    <span>{appliedTemplate.description}</span>
                    <div className="label-chip-list compact">
                      <span className="label-chip">{dataset.labels.length || appliedTemplate.labels.length} labels</span>
                      <span className="label-chip">
                        {dataset.tools.filter((tool) => tool.enabled).length || appliedTemplate.tools.length} tools
                      </span>
                      <span className="label-chip">{appliedTemplate.source === "custom" ? "Custom" : "Built-in"}</span>
                    </div>
                  </div>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => setConfigDraft({ source: "dataset", template: appliedTemplate })}
                  >
                    <Settings2 size={16} />
                    Configure
                  </button>
                </div>
              ) : (
                <button className="dataset-template-empty" type="button" onClick={() => setShowTemplatePicker(true)}>
                  <GalleryHorizontalEnd size={24} />
                  <strong>Select a template</strong>
                  <span>Browse categories on the left, pick a template, then configure it before saving.</span>
                </button>
              )}
              {message && <p className="form-success">{message}</p>}
              </section>
            </div>
          </div>
        ) : !error ? (
          <p className="muted-copy">Dataset was not found.</p>
        ) : null}
      </section>
      {showTemplatePicker && (
        <TemplatePickerModal
          categories={builtInCategories.map((category) => category.name)}
          onClose={() => setShowTemplatePicker(false)}
          onSelectTemplate={(template) => {
            setShowTemplatePicker(false);
            setConfigDraft({ source: "template", template });
          }}
          selectedTemplateId={appliedTemplate?.id ?? null}
          templates={allTemplatePresets}
        />
      )}
      {dataset && configDraft && (
        <TemplateConfigModal
          datasetLabels={configDraft.source === "dataset" ? getDatasetLabelInputs(dataset) : getTemplateLabelInputs(configDraft.template)}
          defaultSettings={configDraft.source === "dataset" ? getDatasetSettings(dataset.labelingConfig) : configDraft.template.settings}
          onBack={() => {
            setConfigDraft(null);
            setShowTemplatePicker(true);
          }}
          onClose={() => setConfigDraft(null)}
          onSubmit={handleSubmit}
          saving={saving}
          selectedTools={
            configDraft.source === "dataset"
              ? dataset.tools.filter((tool) => tool.enabled).map((tool) => tool.tool)
              : configDraft.template.tools
          }
          template={configDraft.template}
          templatePresets={templatePresets}
          builtInCategories={builtInCategories}
          builtInTemplates={builtInTemplates}
        />
      )}
    </section>
  );
}

function DatasetControllerConfig({
  dataset,
  onSaved,
  session,
  setPageError
}: {
  dataset: DatasetSummary;
  onSaved: () => Promise<void>;
  session: ReturnType<typeof useAuth>["session"];
  setPageError: (error: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [participants, setParticipants] = useState<TaskParticipantSummary[]>([]);
  const [workflow, setWorkflow] = useState(() => getDatasetWorkflowDraft(dataset));
  const assignees = participants.filter((participant) => participant.canWork);
  const reviewers = participants.filter((participant) => participant.canReview);
  const selectedAssigneeNames = assignees
    .filter((participant) => workflow.assigneeIds.includes(participant.id))
    .map((participant) => participant.name);
  const priorityMeaning = getPriorityMeaning(workflow.priority);

  useEffect(() => {
    setWorkflow(getDatasetWorkflowDraft(dataset));
  }, [dataset.id]);

  useEffect(() => {
    let active = true;

    if (!session || !dataset.canGenerateTasks) {
      setParticipants([]);
      return () => {
        active = false;
      };
    }

    listTaskParticipants(session, dataset.projectId)
      .then((result) => {
        if (active) {
          setParticipants(result);
        }
      })
      .catch((reason) => {
        if (active) {
          setParticipants([]);
          setPageError(reason instanceof Error ? reason.message : "Unable to load dataset task members.");
        }
      });

    return () => {
      active = false;
    };
  }, [dataset.canGenerateTasks, dataset.projectId, session?.access_token]);

  function getWorkflowInput(): TaskWorkflowInput | null {
    const priority = workflow.priority.trim() === "" ? 0 : Number(workflow.priority);

    if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
      setPageError("Priority must be a whole number from 0 to 10.");
      return null;
    }

    let dueAt: string | null = null;

    if (workflow.dueAt) {
      const dueDate = new Date(workflow.dueAt);

      if (Number.isNaN(dueDate.getTime())) {
        setPageError("Due date must be a valid date.");
        return null;
      }

      dueAt = dueDate.toISOString();
    }

    if (workflow.assignmentMode === "single" && !workflow.assignedToId) {
      setPageError("Choose an assignee or switch assignment mode to Unassigned.");
      return null;
    }

    if (workflow.assignmentMode === "round_robin" && workflow.assigneeIds.length === 0) {
      setPageError("Choose at least one annotator for round-robin assignment.");
      return null;
    }

    return {
      assignedToId: workflow.assignmentMode === "single" ? workflow.assignedToId : null,
      assigneeIds: workflow.assignmentMode === "round_robin" ? workflow.assigneeIds : [],
      assignmentMode: workflow.assignmentMode,
      dueAt,
      priority,
      reviewerId: workflow.reviewerId || null,
      saveDefaults: true
    };
  }

  async function handleSaveController() {
    setMessage(null);
    setPageError(null);

    if (!session) {
      setPageError("Authentication required.");
      return;
    }

    const workflowInput = getWorkflowInput();

    if (!workflowInput) {
      return;
    }

    setSaving(true);

    try {
      const result = await applyDatasetTaskWorkflow(session, dataset.id, workflowInput);
      setMessage(
        result.updatedCount > 0
          ? `Controller saved. ${result.updatedCount} active task${result.updatedCount === 1 ? "" : "s"} updated.`
          : "Controller saved. No active tasks needed updates."
      );
      await onSaved();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save controller config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel dataset-controller-config">
      <div className="dataset-template-assignment-head">
        <div>
          <p className="eyebrow">Controller</p>
          <h3>Task controller config</h3>
          <p className="muted-copy">Set assignment, review, due date, and queue priority before generating tasks.</p>
        </div>
        <span className={`status-pill compact ${isDatasetControllerConfigured(dataset) ? "" : "warning"}`}>
          {isDatasetControllerConfigured(dataset) ? "Configured" : "Required"}
        </span>
      </div>
      <div className="dataset-workflow-controls stacked">
        <label>
          Assignment
          <select
            onChange={(event) => {
              const assignmentMode = event.currentTarget.value as DatasetTaskAssignmentMode;
              setWorkflow((current) => ({
                ...current,
                assignmentMode,
                assignedToId: assignmentMode === "single" ? current.assignedToId : "",
                assigneeIds: assignmentMode === "round_robin" ? current.assigneeIds : []
              }));
            }}
            value={workflow.assignmentMode}
          >
            <option value="unassigned">Unassigned</option>
            <option value="single">One annotator</option>
            <option value="round_robin">Round-robin</option>
          </select>
        </label>
        {workflow.assignmentMode === "single" ? (
          <label>
            Assign to
            <select
              onChange={(event) => {
                const assignedToId = event.currentTarget.value;
                setWorkflow((current) => ({ ...current, assignedToId }));
              }}
              value={workflow.assignedToId}
            >
              <option value="">Choose annotator</option>
              {assignees.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {workflow.assignmentMode === "round_robin" ? (
          <label className="wide">
            Round-robin annotators
            <select
              multiple
              onChange={(event) => {
                const assigneeIds = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
                setWorkflow((current) => ({ ...current, assigneeIds }));
              }}
              value={workflow.assigneeIds}
            >
              {assignees.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Reviewer
          <select
            onChange={(event) => {
              const reviewerId = event.currentTarget.value;
              setWorkflow((current) => ({ ...current, reviewerId }));
            }}
            value={workflow.reviewerId}
          >
            <option value="">No reviewer</option>
            {reviewers.map((participant) => (
              <option key={participant.id} value={participant.id}>
                {participant.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority preset
          <select
            onChange={(event) => {
              const priority = event.currentTarget.value;
              setWorkflow((current) => ({ ...current, priority }));
            }}
            value={workflow.priority}
          >
            {priorityPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label} ({preset.value})
              </option>
            ))}
            {!priorityPresets.some((preset) => preset.value === workflow.priority) ? (
              <option value={workflow.priority}>Custom ({workflow.priority})</option>
            ) : null}
          </select>
        </label>
        <label>
          Priority number
          <input
            max="10"
            min="0"
            onChange={(event) => {
              const priority = event.currentTarget.value;
              setWorkflow((current) => ({ ...current, priority }));
            }}
            type="number"
            value={workflow.priority}
          />
        </label>
        <label>
          Due date
          <input
            onChange={(event) => {
              const dueAt = event.currentTarget.value;
              setWorkflow((current) => ({ ...current, dueAt }));
            }}
            type="datetime-local"
            value={workflow.dueAt}
          />
        </label>
        <div className="workflow-summary wide">
          <strong>{priorityMeaning.title}</strong>
          <span>{priorityMeaning.description}</span>
          {workflow.assignmentMode === "round_robin" && selectedAssigneeNames.length > 0 ? (
            <span>Rotation: {selectedAssigneeNames.join(" -> ")}</span>
          ) : null}
        </div>
      </div>
      <button className="primary-button" disabled={saving} onClick={handleSaveController} type="button">
        <Save size={18} />
        {saving ? "Saving controller" : "Save controller"}
      </button>
      {message ? <p className="form-success">{message}</p> : null}
    </section>
  );
}

function TemplatePickerModal({
  categories,
  onClose,
  onSelectTemplate,
  selectedTemplateId,
  templates
}: {
  categories: string[];
  onClose: () => void;
  onSelectTemplate: (template: TemplatePreset) => void;
  selectedTemplateId: string | null;
  templates: TemplatePreset[];
}) {
  const categoryNames = useMemo(() => {
    const extras = templates.map((template) => template.category).filter((category) => !categories.includes(category));
    return [...categories, ...Array.from(new Set(extras))];
  }, [categories, templates]);
  const [activeCategory, setActiveCategory] = useState(categoryNames[0] ?? "Computer Vision");
  const visibleTemplates = templates.filter((template) => template.category === activeCategory);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="template-picker-title"
        aria-modal="true"
        className="modal-panel dataset-template-picker-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Assign template</p>
            <h2 id="template-picker-title">Choose a dataset template</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close template picker">
            <X size={17} />
          </button>
        </div>
        <div className="dataset-template-picker">
          <aside className="dataset-template-category-list">
            {categoryNames.map((category) => {
              const count = templates.filter((template) => template.category === category).length;

              return (
                <button
                  className={`dataset-template-category ${activeCategory === category ? "active" : ""}`}
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                >
                  <span>{category}</span>
                  <small>{count}</small>
                </button>
              );
            })}
          </aside>
          <div className="dataset-template-picker-grid">
            {visibleTemplates.map((template) => (
              <button
                className={`dataset-template-option ${selectedTemplateId === template.id ? "active" : ""}`}
                key={template.id}
                type="button"
                onClick={() => onSelectTemplate(template)}
              >
                <TemplateMiniPreview template={template} />
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <small>{template.subtype} - {template.dataType}</small>
              </button>
            ))}
            {visibleTemplates.length === 0 && (
              <div className="template-empty-state">
                <strong>No templates in this category yet.</strong>
                <small>Create one from Label settings first.</small>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function TemplateConfigModal({
  builtInCategories,
  builtInTemplates,
  datasetLabels,
  defaultSettings,
  onBack,
  onClose,
  onSubmit,
  saving,
  selectedTools,
  template,
  templatePresets
}: {
  builtInCategories: typeof fallbackBuiltInTemplateCategories;
  builtInTemplates: TemplatePreset[];
  datasetLabels: LabelInput[];
  defaultSettings?: Partial<LabelingSettings>;
  onBack: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  selectedTools: string[];
  template: TemplatePreset;
  templatePresets: TemplatePreset[];
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="template-config-title"
        aria-modal="true"
        className="modal-panel dataset-template-config-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Template configuration</p>
            <h2 id="template-config-title">{template.name}</h2>
          </div>
          <div className="row-actions compact">
            <button className="secondary-button compact-button" type="button" onClick={onBack}>
              <ArrowLeft size={16} />
              Back to templates
            </button>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close template configuration">
              <X size={17} />
            </button>
          </div>
        </div>
        <form className="labeling-config-form dataset-template-config-form" onSubmit={onSubmit}>
          <LabelingConfigBuilder
            builtInCategories={builtInCategories}
            builtInTemplates={builtInTemplates}
            defaultLabelInputs={datasetLabels}
            defaultLabels={template.labels.join("\n")}
            defaultSettings={defaultSettings}
            defaultTemplate={template}
            defaultTemplateId={template.sourceTemplateId ?? template.id}
            hideTemplateBrowser
            selectedTools={selectedTools.length > 0 ? selectedTools : template.tools}
            templates={templatePresets}
          />
          <div className="row-actions">
            <button className="primary-button" type="submit" value="save" disabled={saving}>
              <Save size={18} />
              {saving ? "Saving" : "Save template"}
            </button>
            <button className="secondary-button" type="submit" value="ready" disabled={saving}>
              <CheckCircle2 size={18} />
              Save and mark ready
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TemplateMiniPreview({ template }: { template: TemplatePreset }) {
  return (
    <span className="dataset-template-preview">
      {template.tools.includes("BBOX") && <i className="bbox-demo demo-one" />}
      {template.tools.includes("POLYGON") && <i className="polygon-demo" />}
      {template.tools.includes("TEXT_SPAN") && <i className="text-demo" />}
      {template.tools.some((tool) => ["CLASSIFICATION", "TAXONOMY", "RANKER", "RATING", "PAIRWISE"].includes(tool)) && <i className="class-demo" />}
      {template.tools.includes("KEYPOINT") && <i className="keypoint-demo" />}
      {template.tools.includes("BRUSH") && <i className="brush-demo" />}
    </span>
  );
}

function getDatasetLabelInputs(dataset: {
  labelingConfig: Record<string, unknown> | null;
  labels: Array<{ color: string; name: string; shortcutKey: string | null }>;
}): LabelInput[] {
  if (dataset.labels.length > 0) {
    return dataset.labels.map((label) => ({
      color: label.color,
      name: label.name,
      shortcutKey: label.shortcutKey ?? undefined
    }));
  }

  const config = dataset.labelingConfig;

  if (!config || !Array.isArray(config.labels)) {
    return [];
  }

  return config.labels
    .flatMap((label, index): LabelInput[] => {
      if (typeof label === "string") {
        return [{
          color: annotationLabelColors[index % annotationLabelColors.length],
          name: label,
          shortcutKey: index < 9 ? String(index + 1) : undefined
        }];
      }

      if (!label || typeof label !== "object") {
        return [];
      }

      const record = label as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";

      if (!name) {
        return [];
      }

      return [{
        color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : annotationLabelColors[index % annotationLabelColors.length],
        name,
        shortcutKey: typeof record.shortcutKey === "string" && record.shortcutKey.trim() ? record.shortcutKey.trim().slice(0, 1) : undefined
      }];
    });
}

function getDatasetSettings(config: Record<string, unknown> | null) {
  const settings = config?.settings;

  return settings && typeof settings === "object" ? (settings as Partial<LabelingSettings>) : undefined;
}

function templateToPreset(template: AnnotationTemplateSummary): TemplatePreset {
  const config = template.configJson;
  const labels = Array.isArray(config.labels)
    ? config.labels
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
    : [];
  const tools = Array.isArray(config.tools)
    ? config.tools
        .map((tool) => {
          if (typeof tool === "string") {
            return tool;
          }

          if (tool && typeof tool === "object" && "tool" in tool && typeof tool.tool === "string") {
            return tool.tool;
          }

          return "";
        })
        .filter(Boolean)
    : [];

  return {
    category: template.category?.name ?? getConfigString(config, "category") ?? "Custom Templates",
    configCode: getConfigString(config, "configCode") ?? undefined,
    configPath: getConfigString(config, "configPath") ?? undefined,
    dataType: template.dataType,
    description: template.description ?? "Custom GoXAi Lab labeling template.",
    id: `custom-${template.id}`,
    labels,
    name: template.name,
    settings: getDatasetSettings(config),
    source: "custom",
    sourceRepo: getConfigString(config, "sourceRepo") ?? undefined,
    sourceTemplateId: template.id,
    subtype: getConfigString(config, "subtype") ?? "Custom",
    tools: tools.length > 0 ? tools : ["BBOX"]
  };
}

function getConfigString(config: Record<string, unknown>, key: string) {
  const value = config[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getDatasetWorkflowDraft(dataset: DatasetSummary) {
  const defaults = isRecord(dataset.metadata) && isRecord(dataset.metadata.taskWorkflowDefaults) ? dataset.metadata.taskWorkflowDefaults : null;
  const assignedToId = getOptionalString(defaults?.assignedToId);
  const assigneeIds = Array.isArray(defaults?.assigneeIds)
    ? [...new Set(defaults.assigneeIds.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : [];
  const assignmentMode = getDatasetAssignmentMode(defaults?.assignmentMode, assignedToId, assigneeIds);

  return {
    assignedToId: assignmentMode === "single" ? assignedToId : "",
    assigneeIds: assignmentMode === "round_robin" ? assigneeIds : [],
    assignmentMode,
    dueAt: getDateTimeLocalValue(defaults?.dueAt),
    priority: getPriorityDraftValue(defaults?.priority),
    reviewerId: getOptionalString(defaults?.reviewerId)
  };
}

function getDatasetAssignmentMode(value: unknown, assignedToId: string, assigneeIds: string[]): DatasetTaskAssignmentMode {
  if (value === "single" || value === "round_robin" || value === "unassigned") {
    return value;
  }

  if (assigneeIds.length > 0) {
    return "round_robin";
  }

  return assignedToId ? "single" : "unassigned";
}

function getOptionalString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function getPriorityDraftValue(value: unknown) {
  const priority = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;

  return Number.isInteger(priority) && priority >= 0 && priority <= 10 ? String(priority) : "0";
}

function getDateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPriorityMeaning(value: string) {
  const priority = Number(value);

  if (Number.isFinite(priority) && priority >= 10) {
    return {
      description: "Use 10 for urgent work. Higher priority appears first in task queues.",
      title: "Urgent priority"
    };
  }

  if (Number.isFinite(priority) && priority >= 5) {
    return {
      description: "Use 5 for important work that should appear before normal tasks.",
      title: "High priority"
    };
  }

  return {
    description: "Use 0 for normal work. The allowed range is 0 to 10.",
    title: "Normal priority"
  };
}

function isDatasetControllerConfigured(dataset: DatasetSummary) {
  return isRecord(dataset.metadata) && isRecord(dataset.metadata.taskWorkflowDefaults);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getSelectedTemplateFromForm(form: HTMLFormElement, templates: TemplatePreset[]) {
  const annotationTemplateId = getAnnotationTemplateIdFromForm(form);
  const configTemplateId = new FormData(form).get("templateId");
  const selectedId = typeof configTemplateId === "string" && configTemplateId.trim() ? configTemplateId.trim() : null;

  return templates.find((template) =>
    Boolean(
      (annotationTemplateId && template.sourceTemplateId === annotationTemplateId) ||
      (selectedId && (template.id === selectedId || template.sourceTemplateId === selectedId))
    )
  ) ?? null;
}

function getDatasetTemplateId(dataset: {
  annotationTemplateId: string | null;
  labelingConfig: Record<string, unknown> | null;
}) {
  if (dataset.annotationTemplateId) {
    return dataset.annotationTemplateId;
  }

  const config = dataset.labelingConfig;
  const templateId = getConfigString(config ?? {}, "templateId");
  const sourceTemplateId = getConfigString(config ?? {}, "sourceTemplateId");

  return templateId ?? sourceTemplateId;
}

function getTemplateLabelInputs(template: TemplatePreset): LabelInput[] {
  return template.labels.map((name, index) => ({
    color: annotationLabelColors[index % annotationLabelColors.length],
    name,
    shortcutKey: index < 9 ? String(index + 1) : undefined
  }));
}

function getAppliedTemplate(
  dataset: {
    annotationTemplate: AnnotationTemplateSummary | null;
    annotationTemplateId: string | null;
    labelingConfig: Record<string, unknown> | null;
  },
  templates: TemplatePreset[]
) {
  const selectedId = getDatasetTemplateId(dataset);
  const matchedTemplate = selectedId
    ? templates.find((template) => template.id === selectedId || template.sourceTemplateId === selectedId)
    : null;

  if (matchedTemplate) {
    return matchedTemplate;
  }

  const config = dataset.labelingConfig;
  const templateName = getConfigString(config ?? {}, "templateName") ?? dataset.annotationTemplate?.name;

  if (!templateName) {
    return null;
  }

  const labels = Array.isArray(config?.labels)
    ? config.labels
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
    : [];
  const tools = Array.isArray(config?.tools)
    ? config.tools
        .map((tool) => {
          if (typeof tool === "string") {
            return tool;
          }

          if (tool && typeof tool === "object" && "tool" in tool && typeof tool.tool === "string") {
            return tool.tool;
          }

          return "";
        })
        .filter(Boolean)
    : [];

  return {
    category: getConfigString(config ?? {}, "category") ?? dataset.annotationTemplate?.category?.name ?? "Custom Templates",
    configCode: getConfigString(config ?? {}, "configCode") ?? undefined,
    configPath: getConfigString(config ?? {}, "configPath") ?? undefined,
    dataType: getConfigString(config ?? {}, "dataType") ?? dataset.annotationTemplate?.dataType ?? "IMAGE",
    description: dataset.annotationTemplate?.description ?? "Dataset template snapshot.",
    id: getConfigString(config ?? {}, "templateId") ?? dataset.annotationTemplateId ?? "dataset-template",
    labels,
    name: templateName,
    settings: getDatasetSettings(config),
    source: getConfigString(config ?? {}, "source") === "custom" ? "custom" : "builtin",
    sourceRepo: getConfigString(config ?? {}, "sourceRepo") ?? undefined,
    sourceTemplateId: dataset.annotationTemplateId ?? getConfigString(config ?? {}, "sourceTemplateId") ?? undefined,
    subtype: getConfigString(config ?? {}, "subtype") ?? templateName,
    tools: tools.length > 0 ? tools : ["BBOX"]
  } satisfies TemplatePreset;
}
