import { useMemo, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { type LabelingSettings } from "../../../components/labeling/LabelingConfigBuilder";
import { formatEnum } from "../../../utils/format";
import {
  addLabelsToTemplateCode,
  colorWithAlpha,
  getToolLabel,
  labelPositions,
  setMediaAttributeInCode,
  setToolLabelPositionInCode,
  setToolStrokeWidthInCode,
  templateTools,
  toggleToolInCode,
  type ParsedTemplateConfig
} from "./templateFormUtils";

type TemplateEditorPanelProps = {
  configCodeValue: string;
  onConfigCodeChange: (value: string) => void;
  onUpdateConfigCode: (transform: (code: string) => string) => void;
  parsedConfig: ParsedTemplateConfig;
  saving: boolean;
};

export function TemplateEditorPanel({
  configCodeValue,
  onConfigCodeChange,
  onUpdateConfigCode,
  parsedConfig,
  saving
}: TemplateEditorPanelProps) {
  const [editorMode, setEditorMode] = useState<"code" | "visual">("visual");
  const [labelDraft, setLabelDraft] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const filteredLabels = useMemo(() => {
    const term = labelFilter.trim().toLowerCase();

    if (!term) {
      return parsedConfig.labels;
    }

    return parsedConfig.labels.filter((label) => label.name.toLowerCase().includes(term));
  }, [labelFilter, parsedConfig.labels]);

  function handleAddLabels() {
    const names = labelDraft
      .split(/[\n,]/)
      .map((label) => label.trim())
      .filter(Boolean);

    if (names.length === 0) {
      return;
    }

    onUpdateConfigCode((code) => addLabelsToTemplateCode(code, names));
    setLabelDraft("");
  }

  return (
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
            onChange={(event) => onConfigCodeChange(event.target.value)}
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
                    onChange={(event) => onUpdateConfigCode((code) => toggleToolInCode(code, tool, event.target.checked))}
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
                onChange={(event) => onUpdateConfigCode((code) => setToolStrokeWidthInCode(code, Number(event.target.value)))}
              />
            </label>
            <label className="inline-field">
              Display labels
              <select
                disabled={saving}
                value={parsedConfig.settings.labelPosition}
                onChange={(event) => onUpdateConfigCode((code) => setToolLabelPositionInCode(code, event.target.value as LabelingSettings["labelPosition"]))}
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
                onChange={(event) => onUpdateConfigCode((code) => setMediaAttributeInCode(code, "zoom", event.target.checked ? "true" : "false"))}
              />
              Allow image zoom (ctrl+wheel)
            </label>
            <label className="checkbox-row">
              <input
                checked={parsedConfig.settings.zoomControls}
                disabled={saving}
                type="checkbox"
                onChange={(event) => onUpdateConfigCode((code) => setMediaAttributeInCode(code, "zoomControl", event.target.checked ? "true" : "false"))}
              />
              Show controls to zoom in and out
            </label>
            <label className="checkbox-row">
              <input
                checked={parsedConfig.settings.rotateControls}
                disabled={saving}
                type="checkbox"
                onChange={(event) => onUpdateConfigCode((code) => setMediaAttributeInCode(code, "rotateControl", event.target.checked ? "true" : "false"))}
              />
              Show controls to rotate image
            </label>
          </section>
        </div>
      )}
    </aside>
  );
}
