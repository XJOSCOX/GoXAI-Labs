import { useState } from "react";
import { Trash2 } from "lucide-react";
import { formatControlName, type TemporalLabelControl, type TemporalRegionResponse } from "../templateForm";
export function TemporalRegionEditor({
  control,
  onChange,
  regions
}: {
  control: TemporalLabelControl;
  onChange: (regions: TemporalRegionResponse[]) => void;
  regions: TemporalRegionResponse[];
}) {
  const firstLabel = control.labels[0]?.value ?? "Region";
  const [draftLabel, setDraftLabel] = useState(firstLabel);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const isTimeSeries = control.type === "timeserieslabels";

  function addRegion() {
    const start = draftStart.trim();
    const end = (draftEnd.trim() || start).trim();

    if (!start || !end) {
      return;
    }

    onChange([
      ...regions,
      {
        end,
        id: `temporal-${Date.now()}`,
        label: draftLabel || firstLabel,
        start
      }
    ]);
    setDraftStart("");
    setDraftEnd("");
  }

  return (
    <div className="template-response-field temporal-region-editor">
      <span>
        {formatControlName(control.name)}
        {control.required && <strong>Required</strong>}
      </span>
      <div className="temporal-region-form">
        <label>
          Label
          <select value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)}>
            {control.labels.map((label) => (
              <option key={label.value} value={label.value}>{label.value}</option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input
            placeholder={isTimeSeries ? "2020-01-05 00:00:00" : "0.00"}
            value={draftStart}
            onChange={(event) => setDraftStart(event.target.value)}
          />
        </label>
        <label>
          End
          <input
            placeholder={isTimeSeries ? "2020-01-19 00:00:00" : "3.50"}
            value={draftEnd}
            onChange={(event) => setDraftEnd(event.target.value)}
          />
        </label>
        <button className="secondary-button compact-button" onClick={addRegion} type="button">Add region</button>
      </div>
      <div className="temporal-region-list">
        {regions.length > 0 ? regions.map((region, index) => (
          <div key={region.id}>
            <strong>{index + 1}. {region.label}</strong>
            <span>{region.start} to {region.end}</span>
            <button
              aria-label={`Delete ${region.label} region ${index + 1}`}
              className="annotation-region-delete"
              onClick={() => onChange(regions.filter((item) => item.id !== region.id))}
              title="Delete region"
              type="button"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )) : (
          <small className="muted-copy">Add time spans or instants for this source.</small>
        )}
      </div>
    </div>
  );
}

