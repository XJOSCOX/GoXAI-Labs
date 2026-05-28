import { type LabelOption } from "../annotation/geometry";

type LabelPickerProps = {
  activeLabel: string;
  canAnnotate: boolean;
  labelArmed: boolean;
  locked: boolean;
  labelOptions: LabelOption[];
  onSelectLabel: (label: string) => void;
};

export function LabelPicker({
  activeLabel,
  canAnnotate,
  labelArmed,
  locked,
  labelOptions,
  onSelectLabel
}: LabelPickerProps) {
  return (
    <div className="label-picker">
      {labelOptions.map((label, index) => (
        <button
          className={activeLabel === label.name && labelArmed ? "label-option active armed" : activeLabel === label.name ? "label-option active" : "label-option"}
          key={label.name}
          onClick={() => onSelectLabel(label.name)}
          style={{ ["--label-color" as string]: label.color }}
          type="button"
          disabled={!canAnnotate || locked}
        >
          <span>{index + 1}</span>
          {label.name}
        </button>
      ))}
    </div>
  );
}
