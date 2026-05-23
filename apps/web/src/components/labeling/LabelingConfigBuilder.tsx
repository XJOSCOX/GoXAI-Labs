import { useMemo, useState } from "react";
import { Check, GalleryHorizontalEnd, ImageIcon, Shapes } from "lucide-react";

type LabelingConfigBuilderProps = {
  defaultLabels?: string;
  disabled?: boolean;
  selectedTools?: string[];
};

type TemplatePreset = {
  category: string;
  dataType: string;
  description: string;
  id: string;
  labels: string[];
  name: string;
  tools: string[];
};

export const annotationLabelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];

const annotationToolOptions = [
  {
    description: "Object detection boxes",
    label: "Bounding box",
    value: "BBOX"
  },
  {
    description: "Precise object outlines",
    label: "Polygon",
    value: "POLYGON"
  },
  {
    description: "Dense mask painting",
    label: "Brush",
    value: "BRUSH"
  },
  {
    description: "Named text ranges",
    label: "Text span",
    value: "TEXT_SPAN"
  },
  {
    description: "Pose or landmark points",
    label: "Keypoint",
    value: "KEYPOINT"
  },
  {
    description: "Whole asset labels",
    label: "Classification",
    value: "CLASSIFICATION"
  }
];

const templatePresets: TemplatePreset[] = [
  {
    category: "Computer vision",
    dataType: "Image",
    description: "Detect objects with thin bounding boxes.",
    id: "object-detection",
    labels: ["Car", "Person", "Traffic light"],
    name: "Object Detection",
    tools: ["BBOX"]
  },
  {
    category: "Computer vision",
    dataType: "Image",
    description: "Trace object outlines with polygon points.",
    id: "polygon-segmentation",
    labels: ["Road", "Building", "Sidewalk"],
    name: "Semantic Segmentation",
    tools: ["POLYGON"]
  },
  {
    category: "Computer vision",
    dataType: "Image",
    description: "Paint dense regions for masks.",
    id: "mask-segmentation",
    labels: ["Foreground", "Background", "Defect"],
    name: "Mask Segmentation",
    tools: ["BRUSH", "POLYGON"]
  },
  {
    category: "Documents",
    dataType: "PDF/Image",
    description: "Capture text regions and named fields.",
    id: "ocr",
    labels: ["Name", "Address", "Phone number"],
    name: "OCR Extraction",
    tools: ["BBOX", "TEXT_SPAN"]
  },
  {
    category: "Computer vision",
    dataType: "Image",
    description: "Classify the whole asset.",
    id: "classification",
    labels: ["Normal", "Abnormal", "Needs review"],
    name: "Image Classification",
    tools: ["CLASSIFICATION"]
  },
  {
    category: "Computer vision",
    dataType: "Image/Video",
    description: "Mark landmarks and pose points.",
    id: "keypoints",
    labels: ["Head", "Hand", "Foot"],
    name: "Keypoint Labeling",
    tools: ["KEYPOINT"]
  },
  {
    category: "Natural language",
    dataType: "Text",
    description: "Tag entities inside text spans.",
    id: "ner",
    labels: ["Person", "Organization", "Location"],
    name: "Named Entity Recognition",
    tools: ["TEXT_SPAN"]
  },
  {
    category: "Audio/Speech",
    dataType: "Audio",
    description: "Transcribe speech segments.",
    id: "audio-transcription",
    labels: ["Speaker", "Noise", "Important"],
    name: "Audio Transcription",
    tools: ["TEXT_SPAN", "CLASSIFICATION"]
  }
];

export function LabelingConfigBuilder({
  defaultLabels = "",
  disabled = false,
  selectedTools = ["BBOX"]
}: LabelingConfigBuilderProps) {
  const [mode, setMode] = useState<"visual" | "code">("visual");
  const [showTemplates, setShowTemplates] = useState(false);
  const [labelsText, setLabelsText] = useState(defaultLabels);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [activeTools, setActiveTools] = useState<string[]>(selectedTools.length > 0 ? selectedTools : ["BBOX"]);

  const labels = useMemo(() => parseLabels(labelsText), [labelsText]);
  const configCode = useMemo(() => buildConfigCode(labels, activeTools), [activeTools, labels]);

  function applyTemplate(template: TemplatePreset) {
    if (disabled) {
      return;
    }

    setActiveTemplate(template.id);
    setLabelsText(template.labels.join("\n"));
    setActiveTools(template.tools);
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

  return (
    <section className="wide labeling-config-builder">
      <div className="labeling-config-head">
        <div>
          <p className="eyebrow">Labeling interface</p>
          <h3>Annotation configuration</h3>
        </div>
        <div className="row-actions compact">
          <button
            className="secondary-button"
            type="button"
            disabled={disabled}
            onClick={() => setShowTemplates((value) => !value)}
          >
            <GalleryHorizontalEnd size={16} />
            Browse templates
          </button>
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

      {showTemplates && (
        <div className="template-gallery">
          {templatePresets.map((template) => (
            <button
              className={`template-card ${activeTemplate === template.id ? "active" : ""}`}
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
              <small>{template.category}</small>
            </button>
          ))}
        </div>
      )}

      <div className="label-config-layout">
        <div className="label-config-panel">
          <div className="configure-source">
            <ImageIcon size={18} />
            <span>Use asset from</span>
            <code>$image</code>
          </div>
          <label>
            Add label names
            <span className="field-help">Use a new line for each label. Shortcuts are assigned from 1 to 9.</span>
            <textarea
              disabled={disabled}
              name="labelNames"
              onChange={(event) => setLabelsText(event.target.value)}
              placeholder="Car&#10;Person&#10;Traffic light"
              rows={5}
              value={labelsText}
            />
          </label>

          <div className="label-list-preview">
            <span>Labels ({labels.length})</span>
            {labels.length > 0 ? (
              labels.map((label, index) => (
                <div className="label-row" key={`${label.name}-${index}`}>
                  <i style={{ background: label.color }} />
                  <strong>{label.name}</strong>
                  {index < 9 && <kbd>{index + 1}</kbd>}
                </div>
              ))
            ) : (
              <p>No labels configured yet.</p>
            )}
          </div>
        </div>

        <div className="label-config-panel">
          {mode === "visual" ? (
            <>
              <div className="visual-config-preview">
                <div className="visual-canvas">
                  <span>Select label and click the image to start</span>
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

function parseLabels(value: string) {
  return value
    .split(/[\n,]/)
    .map((label) => label.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((name, index) => ({
      color: annotationLabelColors[index % annotationLabelColors.length],
      name
    }));
}

export function parseLabelInputsFromText(value: string) {
  return parseLabels(value).map((label, index) => ({
    color: label.color,
    name: label.name,
    shortcutKey: index < 9 ? String(index + 1) : undefined
  }));
}

export function parseToolInputsFromForm(form: HTMLFormElement) {
  const selected = new FormData(form).getAll("annotationTools").map(String);
  const tools = selected.length > 0 ? selected : ["BBOX"];

  return tools.map((tool) => ({
    enabled: true,
    tool
  }));
}

export function buildLabelingConfig(labelsText: string, tools: Array<{ enabled?: boolean; tool: string }>) {
  const labels = parseLabelInputsFromText(labelsText);

  return {
    labels,
    tools,
    version: 1
  };
}

function buildConfigCode(labels: Array<{ color: string; name: string }>, tools: string[]) {
  const labelMarkup = labels.length > 0
    ? labels.map((label) => `    <Label value="${escapeXml(label.name)}" background="${label.color}" />`).join("\n")
    : `    <Label value="Label" background="#7dd3fc" />`;

  const tagMarkup = tools.map((tool) => buildToolMarkup(tool, labelMarkup)).join("\n\n");

  return `<View>
  <Header value="Select label and annotate the asset" />
  <Image name="image" value="$image" zoom="true" />

${tagMarkup}
</View>`;
}

function buildToolMarkup(tool: string, labelMarkup: string) {
  if (tool === "POLYGON") {
    return `  <PolygonLabels name="polygon_label" toName="image" strokeWidth="1" pointSize="small" opacity="0.9">
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
    return `  <KeyPointLabels name="keypoint_label" toName="image" strokeWidth="1">
${labelMarkup}
  </KeyPointLabels>`;
  }

  if (tool === "CLASSIFICATION") {
    return `  <Choices name="classification" toName="image" choice="single">
${labelMarkup.replaceAll("<Label", "<Choice").replaceAll("background=", "valueColor=")}
  </Choices>`;
  }

  return `  <RectangleLabels name="box_label" toName="image" strokeWidth="1" opacity="0.9">
${labelMarkup}
  </RectangleLabels>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
