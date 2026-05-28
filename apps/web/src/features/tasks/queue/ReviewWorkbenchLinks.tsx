import type { TaskQueueFilters } from "../../../api";
import type { QualityFilterOption, ResolvedTaskQueueFilters } from "./taskQueueTypes";

export function ReviewWorkbenchLinks({
  counts,
  filters,
  onChange,
  options
}: {
  counts: Partial<Record<NonNullable<TaskQueueFilters["quality"]>, number>>;
  filters: ResolvedTaskQueueFilters;
  onChange: (name: keyof TaskQueueFilters, value: string) => void;
  options: QualityFilterOption[];
}) {
  return (
    <div className="review-workbench-links">
      {options.slice(1).map((option) => (
        <button
          className={filters.quality === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onChange("quality", filters.quality === option.value ? "" : option.value)}
          type="button"
        >
          <span>{option.label}</span>
          <strong>{counts[option.value] ?? 0}</strong>
        </button>
      ))}
    </div>
  );
}
