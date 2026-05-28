import type { AnnotationCategorySummary, AnnotationTemplateSummary } from "../../../api";
import type { TemplatePreset } from "../../../components/labeling/LabelingConfigBuilder";
import { formatEnum } from "../../../utils/format";
import { dataTypes, getToolLabel, type ParsedTemplateConfig } from "./templateFormUtils";

type TemplateSettingsPanelProps = {
  categoryLocked: boolean;
  defaultCategoryId: string;
  editableCategories: AnnotationCategorySummary[];
  fallbackCategoryName: string;
  parsedConfig: ParsedTemplateConfig;
  saving: boolean;
  seedDataType: string;
  seedDescription: string;
  seedName: string;
  seedSubtype: string;
  selectedCategory: AnnotationCategorySummary | null;
  selectedTemplate: AnnotationTemplateSummary | null;
  sourcePreset: TemplatePreset | null;
};

export function TemplateSettingsPanel({
  categoryLocked,
  defaultCategoryId,
  editableCategories,
  fallbackCategoryName,
  parsedConfig,
  saving,
  seedDataType,
  seedDescription,
  seedName,
  seedSubtype,
  selectedCategory,
  selectedTemplate,
  sourcePreset
}: TemplateSettingsPanelProps) {
  return (
    <aside className="labeling-config-panel template-settings-panel">
      <div className="two-column-fields">
        {categoryLocked ? (
          <label>
            Category
            <input disabled readOnly value={selectedCategory?.name ?? `${fallbackCategoryName} (will be created)`} />
            <input name="categoryId" type="hidden" value={selectedCategory?.id ?? ""} />
          </label>
        ) : (
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
        )}
        <label>
          Data type
          <select defaultValue={seedDataType} disabled={saving} name="dataType">
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
          <input defaultValue={seedName} disabled={saving} name="name" placeholder="Object detection" />
        </label>
        <label>
          Type
          <input
            defaultValue={seedSubtype}
            disabled={saving}
            name="subtype"
            placeholder="Detection, OCR, Chat..."
          />
        </label>
      </div>
      {(selectedTemplate || sourcePreset) && (
        <div className="detail-list compact">
          <div>
            <dt>{selectedTemplate ? "Template ID" : "Source template ID"}</dt>
            <dd>{selectedTemplate?.id ?? sourcePreset?.id}</dd>
          </div>
          {selectedCategory && (
            <div>
              <dt>Category ID</dt>
              <dd>{selectedCategory.id}</dd>
            </div>
          )}
        </div>
      )}
      <label>
        Description
        <textarea
          defaultValue={seedDescription}
          disabled={saving}
          name="description"
          placeholder="What this template helps label"
          rows={3}
        />
      </label>
      <section className="parsed-template-summary">
        <p className="eyebrow">Parsed from code</p>
        {parsedConfig.parseError ? (
          <p className="inline-error">{parsedConfig.parseError}</p>
        ) : (
          <>
            <div className="detail-list compact">
              <div>
                <dt>Data key</dt>
                <dd>{parsedConfig.dataKey}</dd>
              </div>
              <div>
                <dt>Border</dt>
                <dd>{parsedConfig.settings.regionBorderWidth}px</dd>
              </div>
              <div>
                <dt>Label position</dt>
                <dd>{formatEnum(parsedConfig.settings.labelPosition)}</dd>
              </div>
              <div>
                <dt>Zoom</dt>
                <dd>{parsedConfig.settings.imageZoom ? "On" : "Off"}</dd>
              </div>
            </div>
            <div>
              <p className="eyebrow">Labels</p>
              <div className="label-chip-list">
                {parsedConfig.labels.length > 0 ? (
                  parsedConfig.labels.map((label) => (
                    <span className="label-chip" key={`${label.name}-${label.color}`}>
                      <i style={{ background: label.color }} />
                      {label.name}
                    </span>
                  ))
                ) : (
                  <span className="muted-copy">No labels found.</span>
                )}
              </div>
            </div>
            <div>
              <p className="eyebrow">Tools</p>
              <div className="label-chip-list">
                {parsedConfig.tools.length > 0 ? (
                  parsedConfig.tools.map((tool) => <span className="label-chip" key={tool}>{getToolLabel(tool)}</span>)
                ) : (
                  <span className="muted-copy">No tools found.</span>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </aside>
  );
}
