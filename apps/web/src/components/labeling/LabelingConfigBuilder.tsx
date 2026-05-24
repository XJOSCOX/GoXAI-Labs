import { useMemo, useState } from "react";
import { Check, ChevronRight, GalleryHorizontalEnd, ImageIcon, Plus, Settings2, Shapes, Trash2 } from "lucide-react";
import {
  annotationLabelColors,
  builtInTemplateCategories,
  builtInTemplatePresets,
  type LabelingSettings,
  type TemplatePreset
} from "@goxai/label-templates";

export { annotationLabelColors, builtInTemplateCategories, builtInTemplatePresets } from "@goxai/label-templates";
export type { LabelingSettings, TemplatePreset } from "@goxai/label-templates";

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

const defaultSettings: LabelingSettings = {
  imageZoom: true,
  labelPosition: "top",
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

export function LabelingConfigBuilder({
  defaultLabels = "",
  defaultSettings: initialSettings,
  disabled = false,
  selectedTools = ["BBOX"],
  templates
}: LabelingConfigBuilderProps) {
  const allTemplates = useMemo(() => [...builtInTemplatePresets, ...(templates ?? [])], [templates]);
  const categories = useMemo(() => {
    const builtInCategories = builtInTemplateCategories.map((category) => category.name);
    const extraCategories = allTemplates
      .map((template) => template.category)
      .filter((category) => !builtInCategories.includes(category));

    return [...builtInCategories, ...Array.from(new Set(extraCategories)), "Custom Templates"];
  }, [allTemplates]);
  const [mode, setMode] = useState<"visual" | "code">("visual");
  const [activeCategory, setActiveCategory] = useState(categories[0] ?? "Computer Vision");
  const [activeTemplate, setActiveTemplate] = useState<TemplatePreset | null>(null);
  const [labelRows, setLabelRows] = useState<LabelRow[]>(() => parseLabelRows(defaultLabels));
  const [labelSearch, setLabelSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [activeTools, setActiveTools] = useState<string[]>(selectedTools.length > 0 ? selectedTools : ["BBOX"]);
  const [settings, setSettings] = useState<LabelingSettings>({ ...defaultSettings, ...initialSettings });

  const visibleTemplates = allTemplates.filter((template) => template.category === activeCategory);
  const visibleLabelRows = useMemo(() => {
    const term = labelSearch.trim().toLowerCase();
    const indexedLabels = labelRows.map((label, index) => ({ index, label }));

    if (!term) {
      return indexedLabels;
    }

    return indexedLabels.filter((entry) => entry.label.name.toLowerCase().includes(term));
  }, [labelRows, labelSearch]);
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
            {labelRows.length > 8 && (
              <input
                className="compact-filter-input"
                disabled={disabled}
                onChange={(event) => setLabelSearch(event.target.value)}
                placeholder="Filter labels"
                type="search"
                value={labelSearch}
              />
            )}
            {labelRows.length > 0 ? (
              visibleLabelRows.map(({ index, label }) => (
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
            {labelRows.length > 0 && visibleLabelRows.length === 0 && <p>No labels match this filter.</p>}
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
            <label>
              Display labels
              <select
                name="labelPosition"
                onChange={(event) => updateSetting("labelPosition", event.target.value as LabelingSettings["labelPosition"])}
                value={settings.labelPosition}
              >
                <option value="top">Top</option>
                <option value="right">Right</option>
                <option value="bottom">Bottom</option>
                <option value="left">Left</option>
              </select>
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
    labelPosition: parseLabelPosition(String(data.get("labelPosition") ?? "")),
    regionBorderWidth: Number.isFinite(borderWidth) ? Math.max(1, Math.min(8, borderWidth)) : 1,
    rotateControls: data.get("rotateControls") === "on",
    zoomControls: data.get("zoomControls") === "on"
  };
}

function parseLabelPosition(value: string): LabelingSettings["labelPosition"] {
  return value === "right" || value === "bottom" || value === "left" ? value : "top";
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

  return {
    ...buildLabelingConfig(labels, tools, { ...defaultSettings, ...template.settings }, template),
    configCode: template.configCode ?? null,
    configPath: template.configPath ?? null,
    manifestPath: template.manifestPath ?? null,
    source: template.source ?? null
  };
}

function buildConfigCode(labels: LabelRow[], tools: string[], settings: LabelingSettings) {
  const labelMarkup = labels.length > 0
    ? labels.map((label) => `    <Label value="${escapeXml(label.name)}" background="${label.color}" />`).join("\n")
    : `    <Label value="Label" background="#7dd3fc" />`;
  const zoom = settings.imageZoom ? "true" : "false";
  const tagMarkup = tools.map((tool) => buildToolMarkup(tool, labelMarkup, settings)).join("\n\n");

  return `<View>
  <Header value="Select label and annotate the asset" />
  <Image name="image" value="$image" zoom="${zoom}" zoomControl="${settings.zoomControls ? "true" : "false"}" rotateControl="${settings.rotateControls ? "true" : "false"}" />

${tagMarkup}
</View>`;
}

function buildToolMarkup(tool: string, labelMarkup: string, settings: LabelingSettings) {
  const labelsPosition = ` labelPosition="${settings.labelPosition}"`;

  if (tool === "POLYGON") {
    return `  <PolygonLabels name="polygon_label" toName="image" strokeWidth="${settings.regionBorderWidth}" pointSize="small" opacity="0.9"${labelsPosition}>
${labelMarkup}
  </PolygonLabels>`;
  }

  if (tool === "BRUSH") {
    return `  <BrushLabels name="mask_label" toName="image" opacity="0.45"${labelsPosition}>
${labelMarkup}
  </BrushLabels>`;
  }

  if (tool === "TEXT_SPAN") {
    return `  <Labels name="text_label" toName="text"${labelsPosition}>
${labelMarkup}
  </Labels>`;
  }

  if (tool === "KEYPOINT") {
    return `  <KeyPointLabels name="keypoint_label" toName="image" strokeWidth="${settings.regionBorderWidth}"${labelsPosition}>
${labelMarkup}
  </KeyPointLabels>`;
  }

  if (tool === "CLASSIFICATION") {
    return `  <Choices name="classification" toName="image" choice="single"${labelsPosition}>
${labelMarkup.replaceAll("<Label", "<Choice").replaceAll("background=", "valueColor=")}
  </Choices>`;
  }

  if (tool === "RELATION") {
    return `  <Relations>
    <Relation value="Related" />
  </Relations>`;
  }

  return `  <RectangleLabels name="box_label" toName="image" strokeWidth="${settings.regionBorderWidth}" opacity="0.9"${labelsPosition}>
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
