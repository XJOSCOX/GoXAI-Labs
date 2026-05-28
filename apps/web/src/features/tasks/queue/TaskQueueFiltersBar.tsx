import { Search, X } from "lucide-react";
import type { TaskQueueFilters } from "../../../api";
import { dueFilterOptions, statusFilterOptions, type QualityFilterOption, type ResolvedTaskQueueFilters } from "./taskQueueTypes";
import { getAssignmentFilterOptions } from "./taskQueueFilters";

export function TaskQueueFiltersBar({
  filters,
  mode,
  onChange,
  onClear,
  options
}: {
  filters: ResolvedTaskQueueFilters;
  mode: "review" | "work";
  onChange: (name: keyof TaskQueueFilters, value: string) => void;
  onClear: () => void;
  options: QualityFilterOption[];
}) {
  const hasFilters =
    filters.assignment !== (mode === "review" ? "mine" : "all") ||
    filters.due !== "any" ||
    filters.minPriority !== undefined ||
    filters.quality !== "" ||
    filters.search !== "" ||
    filters.status !== "";

  return (
    <div className="task-queue-filters">
      <label className="search-field compact-search-field">
        <Search size={15} />
        <input
          aria-label="Search tasks"
          onChange={(event) => onChange("search", event.currentTarget.value)}
          placeholder="Search asset, dataset, project"
          type="search"
          value={filters.search}
        />
      </label>
      <select
        aria-label="Filter by assignee"
        onChange={(event) => onChange("assignment", event.currentTarget.value)}
        value={filters.assignment}
      >
        {getAssignmentFilterOptions(mode).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select aria-label="Filter by status" onChange={(event) => onChange("status", event.currentTarget.value)} value={filters.status}>
        {statusFilterOptions.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select aria-label="Filter by due date" onChange={(event) => onChange("due", event.currentTarget.value)} value={filters.due}>
        {dueFilterOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select aria-label="Filter by quality flag" onChange={(event) => onChange("quality", event.currentTarget.value)} value={options.some((option) => option.value === filters.quality) ? filters.quality : ""}>
        {options.map((option) => (
          <option key={option.value || "all"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <label className="compact-number-field">
        <span>Priority</span>
        <input
          aria-label="Minimum priority"
          max="10"
          min="0"
          onChange={(event) => onChange("minPriority", event.currentTarget.value)}
          placeholder="0+"
          type="number"
          value={filters.minPriority ?? ""}
        />
      </label>
      {hasFilters && (
        <button className="secondary-button compact-button" onClick={onClear} type="button">
          <X size={15} />
          Clear
        </button>
      )}
    </div>
  );
}
