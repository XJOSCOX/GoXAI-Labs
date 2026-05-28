import type { TaskSummary } from "../../../../api";
import { dedupeSources, formatControlName, toggleChoiceValue, type ChoiceControl, type DateTimeControl, type NumberControl, type RatingControl, type TemplateSource, type TemporalLabelControl, type TemporalRegionResponse, type TextAreaControl } from "../templateForm";
import { TemplateSourcePreview } from "./TemplateSourcePreview";
import { TemporalRegionEditor } from "./TemporalRegionEditor";

export function TemplateResponseWorkspace({
  accessUrl,
  assetLoading,
  choiceControls,
  choiceResponses,
  controls,
  dateTimeControls,
  dateTimeResponses,
  numberControls,
  numberResponses,
  onChoiceChange,
  onDateTimeChange,
  onChange,
  onNumberChange,
  onRatingChange,
  onTemporalChange,
  ratingControls,
  ratingResponses,
  responses,
  sourceByName,
  sources,
  task,
  temporalControls,
  temporalResponses,
  textAssetContent
}: {
  accessUrl: string | null;
  assetLoading: boolean;
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  controls: TextAreaControl[];
  dateTimeControls: DateTimeControl[];
  dateTimeResponses: Record<string, string>;
  numberControls: NumberControl[];
  numberResponses: Record<string, string>;
  onChoiceChange: (responses: Record<string, string[]>) => void;
  onDateTimeChange: (responses: Record<string, string>) => void;
  onChange: (responses: Record<string, string>) => void;
  onNumberChange: (responses: Record<string, string>) => void;
  onRatingChange: (responses: Record<string, number>) => void;
  onTemporalChange: (responses: Record<string, TemporalRegionResponse[]>) => void;
  ratingControls: RatingControl[];
  ratingResponses: Record<string, number>;
  responses: Record<string, string>;
  sourceByName: Map<string, TemplateSource>;
  sources: TemplateSource[];
  task: TaskSummary;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textAssetContent: string | null;
}) {
  const referencedSources = [...choiceControls, ...controls, ...numberControls, ...ratingControls, ...dateTimeControls, ...temporalControls]
    .map((control) => sourceByName.get(control.toName))
    .filter((source): source is TemplateSource => Boolean(source));
  const visibleSources = dedupeSources([...sources, ...referencedSources]);

  return (
    <div className="template-response-workspace">
      <div className="template-source-stack">
        {assetLoading ? (
          <span className="muted-copy">Preparing preview.</span>
        ) : visibleSources.length > 0 ? (
          visibleSources.map((source) => (
            <TemplateSourcePreview
              accessUrl={accessUrl}
              key={source.name}
              onAddTemporalRegion={(controlName, region) => {
                onTemporalChange({
                  ...temporalResponses,
                  [controlName]: [
                    ...(temporalResponses[controlName] ?? []),
                    {
                      ...region,
                      id: `temporal-${Date.now()}`
                    }
                  ]
                });
              }}
              source={source}
              task={task}
              temporalControls={temporalControls}
              temporalResponses={temporalResponses}
              textAssetContent={textAssetContent}
            />
          ))
        ) : (
          <div className="template-source-card">
            <p className="eyebrow">Task data</p>
            <p className="muted-copy">No source field was found in this template.</p>
          </div>
        )}
      </div>
      <div className="template-response-fields">
        {choiceControls.map((control) => (
          <div className="template-response-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <div className="template-choice-grid">
              {control.choices.map((choice) => {
                const selected = choiceResponses[control.name]?.includes(choice.value) ?? false;

                return (
                  <button
                    className={selected ? "template-choice active" : "template-choice"}
                    key={choice.value}
                    onClick={() => {
                      onChoiceChange({
                        ...choiceResponses,
                        [control.name]: toggleChoiceValue(choiceResponses[control.name] ?? [], choice.value, control.choice)
                      });
                    }}
                    style={choice.color ? { ["--choice-color" as string]: choice.color } : undefined}
                    type="button"
                  >
                    {choice.value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {controls.map((control) => (
          <label className="template-response-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <textarea
              value={responses[control.name] ?? ""}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...responses,
                  [control.name]: nextValue
                });
              }}
              placeholder={control.placeholder ?? "Type the answer here..."}
              rows={control.maxSubmissions === 1 ? 6 : 9}
            />
          </label>
        ))}
        {numberControls.map((control) => (
          <label className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <input
              max={control.max ?? undefined}
              min={control.min ?? undefined}
              onChange={(event) => {
                onNumberChange({
                  ...numberResponses,
                  [control.name]: event.target.value
                });
              }}
              type="number"
              value={numberResponses[control.name] ?? ""}
            />
          </label>
        ))}
        {ratingControls.map((control) => (
          <div className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <div className="template-rating-row">
              {Array.from({ length: control.maxRating }, (_, index) => index + 1).map((rating) => (
                <button
                  className={(ratingResponses[control.name] ?? 0) >= rating ? "template-rating active" : "template-rating"}
                  key={rating}
                  onClick={() => {
                    onRatingChange({
                      ...ratingResponses,
                      [control.name]: rating
                    });
                  }}
                  type="button"
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>
        ))}
        {dateTimeControls.map((control) => (
          <label className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <input
              onChange={(event) => {
                onDateTimeChange({
                  ...dateTimeResponses,
                  [control.name]: event.target.value
                });
              }}
              type="datetime-local"
              value={dateTimeResponses[control.name] ?? ""}
            />
          </label>
        ))}
        {temporalControls.map((control) => (
          <TemporalRegionEditor
            control={control}
            key={control.name}
            onChange={(regions) => {
              onTemporalChange({
                ...temporalResponses,
                [control.name]: regions
              });
            }}
            regions={temporalResponses[control.name] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
