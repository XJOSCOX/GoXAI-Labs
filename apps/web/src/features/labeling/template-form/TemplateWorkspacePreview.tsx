import { colorWithAlpha, getPreviewColor, type ParsedTemplateConfig } from "./templateFormUtils";

export function TemplateWorkspacePreview({ parsedConfig }: { parsedConfig: ParsedTemplateConfig }) {
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

