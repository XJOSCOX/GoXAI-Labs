import { useMemo, useState } from "react";
import { Check, ChevronRight, GalleryHorizontalEnd, ImageIcon, Plus, Settings2, Shapes, Trash2 } from "lucide-react";

export type LabelInput = {
  color: string;
  name: string;
  shortcutKey?: string;
};

export type ToolInput = {
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  tool: string;
};

export type LabelingSettings = {
  imageZoom: boolean;
  regionBorderWidth: number;
  rotateControls: boolean;
  zoomControls: boolean;
};

export type TemplatePreset = {
  category: string;
  dataType: string;
  description: string;
  id: string;
  labels: string[];
  name: string;
  settings?: Partial<LabelingSettings>;
  sourceTemplateId?: string;
  subtype: string;
  tools: string[];
};

type LabelingConfigBuilderProps = {
  defaultLabels?: string;
  defaultSettings?: Partial<LabelingSettings>;
  disabled?: boolean;
  selectedTools?: string[];
  templates?: TemplatePreset[];
};

type LabelRow = {
  color: string;
  name: string;
  shortcutKey: string;
};

export const annotationLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

const defaultSettings: LabelingSettings = {
  imageZoom: true,
  regionBorderWidth: 1,
  rotateControls: false,
  zoomControls: true
};

const annotationToolOptions = [
  {
    description: "Thin boxes for object detection.",
    label: "Bounding box",
    value: "BBOX"
  },
  {
    description: "Precise outlines with small points.",
    label: "Polygon",
    value: "POLYGON"
  },
  {
    description: "Dense mask painting.",
    label: "Brush",
    value: "BRUSH"
  },
  {
    description: "Named text ranges.",
    label: "Text span",
    value: "TEXT_SPAN"
  },
  {
    description: "Pose or landmark points.",
    label: "Keypoint",
    value: "KEYPOINT"
  },
  {
    description: "Whole asset labels.",
    label: "Classification",
    value: "CLASSIFICATION"
  },
  {
    description: "Link regions or entities together.",
    label: "Relation",
    value: "RELATION"
  }
];

export const builtInTemplatePresets: TemplatePreset[] = [
  {
    category: "Computer Vision",
    dataType: "Image",
    description: "Detect objects with thin bounding boxes.",
    id: "object-detection",
    labels: ["Car", "Person", "Traffic Light"],
    name: "Object Detection",
    subtype: "Bounding boxes",
    tools: ["BBOX"]
  },
  {
    category: "Computer Vision",
    dataType: "Image",
    description: "Trace object outlines with polygon points.",
    id: "polygon-segmentation",
    labels: ["Road", "Building", "Sidewalk"],
    name: "Semantic Segmentation",
    subtype: "Polygons",
    tools: ["POLYGON"],
    settings: {
      regionBorderWidth: 1
    }
  },
  {
    category: "Computer Vision",
    dataType: "Image",
    description: "Paint dense object masks.",
    id: "mask-segmentation",
    labels: ["Foreground", "Background", "Defect"],
    name: "Mask Segmentation",
    subtype: "Masks",
    tools: ["BRUSH", "POLYGON"]
  },
  {
    category: "Computer Vision",
    dataType: "Image",
    description: "Give the whole asset one label.",
    id: "image-classification",
    labels: ["Normal", "Abnormal", "Needs Review"],
    name: "Image Classification",
    subtype: "Classification",
    tools: ["CLASSIFICATION"]
  },
  {
    category: "Computer Vision",
    dataType: "Image/Video",
    description: "Track posture, landmarks, or pose points.",
    id: "keypoints",
    labels: ["Head", "Hand", "Foot"],
    name: "Keypoint Labeling",
    subtype: "Landmarks",
    tools: ["KEYPOINT"]
  },
  {
    category: "Computer Vision",
    dataType: "Video",
    description: "Label scenes, shots, objects, and cinematic events.",
    id: "cinematic-video",
    labels: ["Scene", "Actor", "Product", "Camera Cut"],
    name: "Cinematic Video Review",
    subtype: "Cinematic",
    tools: ["BBOX", "CLASSIFICATION"]
  },
  {
    category: "Natural Language Processing",
    dataType: "Text",
    description: "Tag entities inside text spans.",
    id: "ner",
    labels: ["Person", "Organization", "Location"],
    name: "Named Entity Recognition",
    subtype: "NER",
    tools: ["TEXT_SPAN"]
  },
  {
    category: "Natural Language Processing",
    dataType: "Text",
    description: "Sort documents by intent or type.",
    id: "text-classification",
    labels: ["Positive", "Negative", "Neutral"],
    name: "Text Classification",
    subtype: "Classification",
    tools: ["CLASSIFICATION"]
  },
  {
    category: "Audio/Speech Processing",
    dataType: "Audio",
    description: "Transcribe speakers, noise, and important moments.",
    id: "audio-transcription",
    labels: ["Speaker", "Noise", "Important"],
    name: "Audio Transcription",
    subtype: "Speech",
    tools: ["TEXT_SPAN", "CLASSIFICATION"]
  },
  {
    category: "Structured Data Parsing",
    dataType: "PDF/Image",
    description: "Capture document fields and text regions.",
    id: "ocr",
    labels: ["Name", "Address", "Phone Number"],
    name: "OCR Extraction",
    subtype: "OCR",
    tools: ["BBOX", "TEXT_SPAN"]
  },
  {
    category: "Time Series Analysis",
    dataType: "Time Series",
    description: "Mark ranges, spikes, and events.",
    id: "time-series-events",
    labels: ["Spike", "Drop", "Anomaly"],
    name: "Event Ranges",
    subtype: "Ranges",
    tools: ["CLASSIFICATION"]
  },
  {
    category: "Generative AI",
    dataType: "Multimodal",
    description: "Rate model output quality and correctness.",
    id: "llm-quality",
    labels: ["Correct", "Incorrect", "Unsafe", "Needs Review"],
    name: "LLM Quality Review",
    subtype: "Quality",
    tools: ["CLASSIFICATION", "TEXT_SPAN"]
  }
];

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

export function LabelingConfigBuilder({
  defaultLabels = "",
  defaultSettings: initialSettings,
  disabled = false,
  selectedTools = ["BBOX"],
  templates
}: LabelingConfigBuilderProps) {
  const allTemplates = useMemo(() => [...builtInTemplatePresets, ...(templates ?? [])], [templates]);
  const categories = useMemo(() => {
    const extraCategories = allTemplates
      .map((template) => template.category)
      .filter((category) => !fallbackCategories.includes(category));

    return [...fallbackCategories, ...Array.from(new Set(extraCategories))];
  }, [allTemplates]);
  const [mode, setMode] = useState<"visual" | "code">("visual");
  const [activeCategory, setActiveCategory] = useState(categories[0] ?? "Computer Vision");
  const [activeTemplate, setActiveTemplate] = useState<TemplatePreset | null>(null);
  const [labelRows, setLabelRows] = useState<LabelRow[]>(() => parseLabelRows(defaultLabels));
  const [newLabelName, setNewLabelName] = useState("");
  const [activeTools, setActiveTools] = useState<string[]>(selectedTools.length > 0 ? selectedTools : ["BBOX"]);
  const [settings, setSettings] = useState<LabelingSettings>({ ...defaultSettings, ...initialSettings });

  const visibleTemplates = allTemplates.filter((template) => template.category === activeCategory);
  const configCode = useMemo(() => buildConfigCode(labelRows, activeTools, settings), [activeTools, labelRows, settings]);

  function applyTemplate(template: TemplatePreset) {
    if (disabled) {
      return;
    }

    setActiveTemplate(template);
    setLabelRows(parseLabelRows(template.labels.join("\n")));
    setActiveTools(template.tools);
    setSettings({ ...defaultSettings, ...template.settings });
  }

  function addLabel() {
    const name = newLabelName.trim();

    if (!name || disabled) {
      return;
    }

    setLabelRows((current) => [
      ...current,
      {
        color: annotationLabelColors[current.length % annotationLabelColors.length],
        name,
        shortcutKey: getShortcutKey(current.length) ?? ""
      }
    ]);
    setNewLabelName("");
  }

  function updateLabel(index: number, update: Partial<LabelRow>) {
    setLabelRows((current) => current.map((label, labelIndex) => (labelIndex === index ? { ...label, ...update } : label)));
  }

  function removeLabel(index: number) {
    setLabelRows((current) => current.filter((_label, labelIndex) => labelIndex !== index));
  }

  function toggleTool(value: string) {
    setActiveTools((current) => {
      if (current.includes(value)) {
        const next = current.filter((tool) => tool !== value);
        return next.length > 0 ? next : current;
      }

      return [...current, value];
    });
  }

  function updateSetting<K extends keyof LabelingSettings>(key: K, value: LabelingSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="wide labeling-config-builder">
      <input name="annotationTemplateId" type="hidden" value={activeTemplate?.sourceTemplateId ?? ""} />
      <div className="labeling-config-head">
        <div>
          <p className="eyebrow">Labeling interface</p>
          <h3>Annotation configuration</h3>
        </div>
        <div className="row-actions compact">
          <span className="status-pill compact">
            <GalleryHorizontalEnd size={14} />
            {allTemplates.length} templates
          </span>
          <div className="segmented-control" aria-label="Config view">
            <button className={mode === "visual" ? "active" : ""} type="button" onClick={() => setMode("visual")}>
              Visual
            </button>
            <button className={mode === "code" ? "active" : ""} type="button" onClick={() => setMode("code")}>
              Code
            </button>
          </div>
        </div>
      </div>

      <div className="template-browser">
        <aside className="template-category-list">
          {categories.map((category) => {
            const categoryTemplates = allTemplates.filter((template) => template.category === category);
            const expanded = activeCategory === category;

            return (
              <div className={`template-category-group ${expanded ? "active" : ""}`} key={category}>
                <button
                  className="template-category-row"
                  type="button"
                  onClick={() => setActiveCategory(category)}
                >
                  <ChevronRight size={15} />
                  <span>{category}</span>
                  <small>{categoryTemplates.length}</small>
                </button>
                {expanded && (
                  <div className="template-sublist">
                    {categoryTemplates.length > 0 ? (
                      categoryTemplates.map((template) => (
                        <button
                          className={`template-subitem ${activeTemplate?.id === template.id ? "active" : ""}`}
                          disabled={disabled}
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template)}
                        >
                          <strong>{template.subtype}</strong>
                          <span>{template.name}</span>
                        </button>
                      ))
                    ) : (
                      <p>No label settings yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </aside>
        <div className="template-card-grid">
          {visibleTemplates.length > 0 ? visibleTemplates.map((template) => (
            <button
              className={`template-card ${activeTemplate?.id === template.id ? "active" : ""}`}
              disabled={disabled}
              key={template.id}
              type="button"
              onClick={() => applyTemplate(template)}
            >
              <TemplatePreview template={template} />
              <span>
                <strong>{template.name}</strong>
                <small>{template.description}</small>
              </span>
              <small>
                {template.subtype} · {template.dataType}
              </small>
            </button>
          )) : (
            <div className="template-empty-state">
              <strong>No templates in this category yet.</strong>
              <small>Create one from Label settings when this workflow is ready.</small>
            </div>
          )}
        </div>
      </div>

      <div className="label-config-layout">
        <div className="label-config-panel">
          <div className="configure-source">
            <ImageIcon size={18} />
            <span>Use asset from</span>
            <code>$image</code>
          </div>

          <label>
            Add label name
            <span className="field-help">Pick a template first, then adjust labels, colors, and keyboard shortcuts.</span>
            <div className="inline-form-row">
              <input
                disabled={disabled}
                onChange={(event) => setNewLabelName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLabel();
                  }
                }}
                placeholder="Car, Person, Address..."
                value={newLabelName}
              />
              <button className="secondary-button compact-button" disabled={disabled} type="button" onClick={addLabel}>
                <Plus size={16} />
                Add
              </button>
            </div>
          </label>

          <div className="label-editor-list">
            <span>Labels ({labelRows.length})</span>
            {labelRows.length > 0 ? (
              labelRows.map((label, index) => (
                <div className="label-editor-row" key={`${label.name}-${index}`}>
                  <input name="labelName" type="hidden" value={label.name} />
                  <input name="labelColor" type="hidden" value={label.color} />
                  <input name="labelShortcut" type="hidden" value={label.shortcutKey} />
                  <input
                    aria-label={`${label.name} color`}
                    disabled={disabled}
                    onChange={(event) => updateLabel(index, { color: event.target.value })}
                    type="color"
                    value={label.color}
                  />
                  <input
                    aria-label="Label name"
                    disabled={disabled}
                    onChange={(event) => updateLabel(index, { name: event.target.value })}
                    value={label.name}
                  />
                  <input
                    aria-label="Shortcut"
                    disabled={disabled}
                    maxLength={1}
                    onChange={(event) => updateLabel(index, { shortcutKey: event.target.value.trim().slice(0, 1) })}
                    placeholder="-"
                    value={label.shortcutKey}
                  />
                  <button className="icon-button danger" disabled={disabled} type="button" onClick={() => removeLabel(index)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <p>No labels configured yet.</p>
            )}
          </div>

          <fieldset className="label-settings-grid">
            <legend>
              <Settings2 size={16} />
              Configure settings
            </legend>
            <label>
              Region border width
              <input
                max="8"
                min="1"
                name="regionBorderWidth"
                onChange={(event) => updateSetting("regionBorderWidth", Number(event.target.value) || 1)}
                step="1"
                type="number"
                value={settings.regionBorderWidth}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={settings.imageZoom}
                name="imageZoom"
                onChange={(event) => updateSetting("imageZoom", event.target.checked)}
                type="checkbox"
              />
              Allow image zoom
            </label>
            <label className="checkbox-row">
              <input
                checked={settings.zoomControls}
                name="zoomControls"
                onChange={(event) => updateSetting("zoomControls", event.target.checked)}
                type="checkbox"
              />
              Show zoom controls
            </label>
            <label className="checkbox-row">
              <input
                checked={settings.rotateControls}
                name="rotateControls"
                onChange={(event) => updateSetting("rotateControls", event.target.checked)}
                type="checkbox"
              />
              Show rotate controls
            </label>
          </fieldset>
        </div>

        <div className="label-config-panel">
          {mode === "visual" ? (
            <>
              <div className="visual-config-preview">
                <div className="visual-canvas">
                  <span>{activeTemplate ? activeTemplate.name : "Select a template or build one manually"}</span>
                  {activeTools.includes("BBOX") && <i className="bbox-demo demo-one" />}
                  {activeTools.includes("BBOX") && <i className="bbox-demo demo-two" />}
                  {activeTools.includes("POLYGON") && <i className="polygon-demo" />}
                  {activeTools.includes("KEYPOINT") && <i className="keypoint-demo" />}
                </div>
              </div>
              <ToolGrid activeTools={activeTools} disabled={disabled} onToggle={toggleTool} />
            </>
          ) : (
            <label className="code-preview-wrap">
              <span>Generated Label Studio-style config</span>
              <textarea className="config-code-preview" readOnly rows={16} value={configCode} />
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

function ToolGrid({
  activeTools,
  disabled,
  onToggle
}: {
  activeTools: string[];
  disabled: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="tool-option-grid">
      <legend>Allowed tools</legend>
      {annotationToolOptions.map((tool) => (
        <label className={`tool-option-card ${activeTools.includes(tool.value) ? "active" : ""}`} key={tool.value}>
          <input
            checked={activeTools.includes(tool.value)}
            disabled={disabled}
            name="annotationTools"
            onChange={() => onToggle(tool.value)}
            type="checkbox"
            value={tool.value}
          />
          <span>
            <strong>{tool.label}</strong>
            <small>{tool.description}</small>
          </span>
          {activeTools.includes(tool.value) && <Check size={16} />}
        </label>
      ))}
    </fieldset>
  );
}

function TemplatePreview({ template }: { template: TemplatePreset }) {
  return (
    <span className={`template-preview ${template.id}`}>
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

function parseLabelRows(value: string) {
  return value
    .split(/[\n,]/)
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((name, index) => ({
      color: annotationLabelColors[index % annotationLabelColors.length],
      name,
      shortcutKey: getShortcutKey(index) ?? ""
    }));
}

export function parseLabelInputsFromForm(form: HTMLFormElement): LabelInput[] {
  const data = new FormData(form);
  const names = data.getAll("labelName").map(String);
  const colors = data.getAll("labelColor").map(String);
  const shortcuts = data.getAll("labelShortcut").map(String);

  return names
    .map((name, index) => ({
      color: colors[index] || annotationLabelColors[index % annotationLabelColors.length],
      name: name.trim(),
      shortcutKey: shortcuts[index]?.trim() || undefined
    }))
    .filter((label) => label.name.length > 0);
}

export function parseLabelInputsFromText(value: string) {
  return parseLabelRows(value).map((label) => ({
    color: label.color,
    name: label.name,
    shortcutKey: label.shortcutKey || undefined
  }));
}

export function parseToolInputsFromForm(form: HTMLFormElement): ToolInput[] {
  const selected = new FormData(form).getAll("annotationTools").map(String);
  const tools = selected.length > 0 ? selected : ["BBOX"];

  return tools.map((tool) => ({
    enabled: true,
    tool
  }));
}

export function parseLabelingSettingsFromForm(form: HTMLFormElement): LabelingSettings {
  const data = new FormData(form);
  const borderWidth = Number(data.get("regionBorderWidth"));

  return {
    imageZoom: data.get("imageZoom") === "on",
    regionBorderWidth: Number.isFinite(borderWidth) ? Math.max(1, Math.min(8, borderWidth)) : 1,
    rotateControls: data.get("rotateControls") === "on",
    zoomControls: data.get("zoomControls") === "on"
  };
}

export function getAnnotationTemplateIdFromForm(form: HTMLFormElement) {
  const value = new FormData(form).get("annotationTemplateId");

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildLabelingConfig(labels: LabelInput[], tools: ToolInput[], settings: LabelingSettings, template?: TemplatePreset | null) {
  return {
    category: template?.category ?? null,
    labels,
    settings,
    subtype: template?.subtype ?? null,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    tools,
    version: 1
  };
}

export function buildTemplateConfig(template: TemplatePreset) {
  const labels = parseLabelInputsFromText(template.labels.join("\n"));
  const tools = template.tools.map((tool) => ({ enabled: true, tool }));

  return buildLabelingConfig(labels, tools, { ...defaultSettings, ...template.settings }, template);
}

function buildConfigCode(labels: LabelRow[], tools: string[], settings: LabelingSettings) {
  const labelMarkup = labels.length > 0
    ? labels.map((label) => `    <Label value="${escapeXml(label.name)}" background="${label.color}" />`).join("\n")
    : `    <Label value="Label" background="#7dd3fc" />`;
  const zoom = settings.imageZoom ? "true" : "false";
  const tagMarkup = tools.map((tool) => buildToolMarkup(tool, labelMarkup, settings)).join("\n\n");

  return `<View>
  <Header value="Select label and annotate the asset" />
  <Image name="image" value="$image" zoom="${zoom}" />

${tagMarkup}
</View>`;
}

function buildToolMarkup(tool: string, labelMarkup: string, settings: LabelingSettings) {
  if (tool === "POLYGON") {
    return `  <PolygonLabels name="polygon_label" toName="image" strokeWidth="${settings.regionBorderWidth}" pointSize="small" opacity="0.9">
${labelMarkup}
  </PolygonLabels>`;
  }

  if (tool === "BRUSH") {
    return `  <BrushLabels name="mask_label" toName="image" opacity="0.45">
${labelMarkup}
  </BrushLabels>`;
  }

  if (tool === "TEXT_SPAN") {
    return `  <Labels name="text_label" toName="text">
${labelMarkup}
  </Labels>`;
  }

  if (tool === "KEYPOINT") {
    return `  <KeyPointLabels name="keypoint_label" toName="image" strokeWidth="${settings.regionBorderWidth}">
${labelMarkup}
  </KeyPointLabels>`;
  }

  if (tool === "CLASSIFICATION") {
    return `  <Choices name="classification" toName="image" choice="single">
${labelMarkup.replaceAll("<Label", "<Choice").replaceAll("background=", "valueColor=")}
  </Choices>`;
  }

  if (tool === "RELATION") {
    return `  <Relations>
    <Relation value="Related" />
  </Relations>`;
  }

  return `  <RectangleLabels name="box_label" toName="image" strokeWidth="${settings.regionBorderWidth}" opacity="0.9">
${labelMarkup}
  </RectangleLabels>`;
}

function getShortcutKey(index: number) {
  return index >= 0 && index < 9 ? String(index + 1) : undefined;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
