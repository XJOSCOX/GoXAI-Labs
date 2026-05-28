import { useState } from "react";
import { BookmarkPlus, Download, SlidersHorizontal, Trash2 } from "lucide-react";
import type { TaskQueueColumnKey, TaskSavedView } from "../../../api";
import { defaultTaskColumns, taskColumnOptions } from "./taskQueueTypes";

export function TaskSavedViewsBar({
  activeViewId,
  columns,
  exporting,
  loading,
  onApply,
  onChange,
  onColumnsChange,
  onDelete,
  onExport,
  onSave,
  saving,
  value,
  views
}: {
  activeViewId: string | null;
  columns: TaskQueueColumnKey[];
  exporting: "csv" | "json" | null;
  loading: boolean;
  onApply: (view: TaskSavedView) => void;
  onChange: (value: string) => void;
  onColumnsChange: (columns: TaskQueueColumnKey[]) => void;
  onDelete: (view: TaskSavedView) => void;
  onExport: (format: "csv" | "json") => void;
  onSave: () => void;
  saving: boolean;
  value: string;
  views: TaskSavedView[];
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);

  function handleColumnToggle(column: TaskQueueColumnKey, checked: boolean) {
    const nextColumns = checked
      ? [...columns, column]
      : columns.filter((currentColumn) => currentColumn !== column);

    onColumnsChange(nextColumns.length > 0 ? nextColumns : defaultTaskColumns);
  }

  return (
    <div className="task-saved-views">
      <div className="task-saved-view-tabs" aria-label="Saved task views">
        {views.length === 0 ? (
          <span className="muted-copy">{loading ? "Loading saved views..." : "No saved views yet"}</span>
        ) : (
          views.map((view) => (
            <span className={`task-saved-view-chip${activeViewId === view.id ? " active" : ""}`} key={view.id}>
              <button onClick={() => onApply(view)} type="button">
                {view.name}
              </button>
              <button aria-label={`Delete ${view.name}`} className="icon-only-button subtle-icon-button" onClick={() => onDelete(view)} type="button">
                <Trash2 size={13} />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="task-saved-view-form">
        <input
          aria-label="Saved view name"
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSave();
            }
          }}
          placeholder="Save current filters"
          type="text"
          value={value}
        />
        <button className="secondary-button compact-button" disabled={saving || !value.trim()} onClick={onSave} type="button">
          <BookmarkPlus size={15} />
          {saving ? "Saving" : "Save view"}
        </button>
        <button className="secondary-button compact-button" disabled={exporting !== null} onClick={() => onExport("csv")} type="button">
          <Download size={15} />
          {exporting === "csv" ? "Exporting" : "CSV"}
        </button>
        <button className="secondary-button compact-button" disabled={exporting !== null} onClick={() => onExport("json")} type="button">
          <Download size={15} />
          {exporting === "json" ? "Exporting" : "JSON"}
        </button>
        <button className={`secondary-button compact-button ${columnsOpen ? "active" : ""}`} onClick={() => setColumnsOpen((open) => !open)} type="button">
          <SlidersHorizontal size={15} />
          Columns
        </button>
      </div>
      {columnsOpen ? (
        <div className="task-column-menu">
          {taskColumnOptions.map((option) => (
            <label key={option.key}>
              <input
                checked={columns.includes(option.key)}
                onChange={(event) => handleColumnToggle(option.key, event.currentTarget.checked)}
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          ))}
          <button className="secondary-button compact-button" onClick={() => onColumnsChange(defaultTaskColumns)} type="button">
            Reset
          </button>
        </div>
      ) : null}
    </div>
  );
}
