import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Save } from "lucide-react";
import { listAnnotationTemplates, updateDataset, type AnnotationTemplateSummary } from "../../api";
import { useAuth } from "../../auth";
import {
  buildLabelingConfig,
  getAnnotationTemplateIdFromForm,
  LabelingConfigBuilder,
  parseLabelingSettingsFromForm,
  parseLabelInputsFromForm,
  parseLabelInputsFromText,
  parseToolInputsFromForm,
  type LabelingSettings,
  type TemplatePreset
} from "../../components/labeling/LabelingConfigBuilder";
import { useDataset } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

export function DatasetLabelConfigPage() {
  const { datasetId = "" } = useParams();
  const navigate = useNavigate();
  const { session } = useAuth();
  const { dataset, error, loading, reload } = useDataset(session, datasetId);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AnnotationTemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      if (!session) {
        return;
      }

      try {
        const templateList = await listAnnotationTemplates(session);

        if (!cancelled) {
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
    const selectedTemplate = templatePresets.find((template) => template.sourceTemplateId === annotationTemplateId) ?? null;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const markReady = submitter?.value === "ready";

    if (labels.length === 0) {
      setPageError("Add at least one label before saving this dataset labeling config.");
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
        labelingConfig: buildLabelingConfig(labels, tools, settings, selectedTemplate),
        labels,
        tools,
        ...(markReady ? { status: "READY" } : {})
      });
      setMessage(markReady ? "Dataset label config saved and marked ready." : "Dataset label config saved.");
      await reload();

      if (markReady) {
        navigate(`/datasets/${dataset.id}`);
      }
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Unable to save dataset label config.");
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
          <p className="muted-copy">Loading dataset label config.</p>
        ) : dataset ? (
          <div className="label-config-page">
            <section className="panel">
              <div className="dataset-summary-head">
                <div>
                  <p className="eyebrow">Dataset label setup</p>
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
                A dataset needs its own annotation template before it can be made ready for public or assigned work.
              </p>
            </section>

            <form className="panel labeling-config-form" onSubmit={handleSubmit}>
              <LabelingConfigBuilder
                defaultLabels={datasetLabelsToText(dataset)}
                defaultSettings={getDatasetSettings(dataset.labelingConfig)}
                selectedTools={dataset.tools.filter((tool) => tool.enabled).map((tool) => tool.tool)}
                templates={templatePresets}
              />
              {message && <p className="form-success">{message}</p>}
              <div className="row-actions">
                <button className="primary-button" type="submit" value="save" disabled={saving}>
                  <Save size={18} />
                  {saving ? "Saving" : "Save label config"}
                </button>
                <button className="secondary-button" type="submit" value="ready" disabled={saving}>
                  <CheckCircle2 size={18} />
                  Save and mark ready
                </button>
              </div>
            </form>
          </div>
        ) : !error ? (
          <p className="muted-copy">Dataset was not found.</p>
        ) : null}
      </section>
    </section>
  );
}

function datasetLabelsToText(dataset: {
  labelingConfig: Record<string, unknown> | null;
  labels: Array<{ name: string }>;
}) {
  if (dataset.labels.length > 0) {
    return dataset.labels.map((label) => label.name).join("\n");
  }

  const config = dataset.labelingConfig;

  if (!config || !Array.isArray(config.labels)) {
    return "";
  }

  return config.labels
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
    category: getConfigString(config, "category") ?? "Custom Templates",
    dataType: template.dataType,
    description: template.description ?? "Custom GoXAi Lab labeling template.",
    id: `custom-${template.id}`,
    labels,
    name: template.name,
    settings: getDatasetSettings(config),
    sourceTemplateId: template.id,
    subtype: getConfigString(config, "subtype") ?? "Custom",
    tools: tools.length > 0 ? tools : ["BBOX"]
  };
}

function getConfigString(config: Record<string, unknown>, key: string) {
  const value = config[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}
