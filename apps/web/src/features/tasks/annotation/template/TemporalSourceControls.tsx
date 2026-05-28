import { formatControlName, type TemporalLabelControl } from "../templateForm";
export function TemporalSourceControls({
  activeControlName,
  activeLabel,
  controls,
  onControlChange,
  onLabelChange,
  regionCount
}: {
  activeControlName: string;
  activeLabel: string;
  controls: TemporalLabelControl[];
  onControlChange: (controlName: string) => void;
  onLabelChange: (label: string) => void;
  regionCount: number;
}) {
  const activeControl = controls.find((control) => control.name === activeControlName) ?? controls[0] ?? null;

  if (!activeControl) {
    return null;
  }

  return (
    <div className="temporal-source-controls">
      <label>
        Region tool
        <select value={activeControl.name} onChange={(event) => onControlChange(event.target.value)}>
          {controls.map((control) => (
            <option key={control.name} value={control.name}>{formatControlName(control.name)}</option>
          ))}
        </select>
      </label>
      <label>
        Label
        <select value={activeLabel} onChange={(event) => onLabelChange(event.target.value)}>
          {activeControl.labels.map((label) => (
            <option key={label.value} value={label.value}>{label.value}</option>
          ))}
        </select>
      </label>
      <span>{regionCount} regions</span>
    </div>
  );
}

