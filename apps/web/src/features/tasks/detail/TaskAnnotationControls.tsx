import { ArrowRight, Eye, Lock, Save, Send, Unlock } from "lucide-react";
import type { TaskSummary } from "../../../api";
import type { LabelOption } from "../annotation/geometry";
import { LabelPicker } from "./LabelPicker";

type AnnotationLabelControlsProps = {
  activeLabel: string;
  canAnnotate: boolean;
  labelArmed: boolean;
  labelDrawLock: boolean;
  labelOptions: LabelOption[];
  onCustomLabelChange: (label: string) => void;
  onSelectLabel: (label: string) => void;
  onToggleLabelLock: () => void;
  polygonInProgress: boolean;
};

export function AnnotationLabelControls({
  activeLabel,
  canAnnotate,
  labelArmed,
  labelDrawLock,
  labelOptions,
  onCustomLabelChange,
  onSelectLabel,
  onToggleLabelLock,
  polygonInProgress
}: AnnotationLabelControlsProps) {
  return (
    <>
      <div className="annotation-shortcuts">
        <span>1-9 labels</span>
        <span>{labelDrawLock ? "Label lock repeats polygons" : "Label click arms one polygon"}</span>
        <span>B/P switches tool</span>
        <span>Enter closes polygon</span>
        <span>Delete removes selected region</span>
        <span>Ctrl+Z undo</span>
        <span>Ctrl+Y redo</span>
        <span>Ctrl+S saves</span>
        <span>Ctrl+Enter submits</span>
      </div>
      <div className="annotation-label-strip">
        <div className="annotation-label-strip-head">
          <span className={labelArmed || labelDrawLock ? "label-armed-status active" : "label-armed-status"}>
            {polygonInProgress
              ? "Finish or cancel this polygon"
              : labelDrawLock
                ? `${activeLabel} locked`
                : labelArmed
                  ? `${activeLabel} ready`
                  : "Click a label to draw one polygon"}
          </span>
          <button
            className={labelDrawLock ? "secondary-button compact-button active" : "secondary-button compact-button"}
            disabled={!canAnnotate || polygonInProgress}
            onClick={onToggleLabelLock}
            type="button"
          >
            {labelDrawLock ? <Lock size={15} /> : <Unlock size={15} />}
            {labelDrawLock ? "Locked" : "Lock"}
          </button>
        </div>
        {labelOptions.length > 0 ? (
          <LabelPicker
            activeLabel={activeLabel}
            canAnnotate={canAnnotate}
            labelArmed={labelArmed || labelDrawLock}
            locked={polygonInProgress}
            labelOptions={labelOptions}
            onSelectLabel={onSelectLabel}
          />
        ) : (
          <label className="annotation-label-input">
            Label
            <input
              disabled={!canAnnotate || polygonInProgress}
              onChange={(event) => onCustomLabelChange(event.target.value)}
              value={activeLabel}
            />
          </label>
        )}
      </div>
    </>
  );
}

type TaskInlineActionsProps = {
  canAnnotate: boolean;
  canWork: boolean;
  nextAction: { label: string } | null;
  nextTask: TaskSummary | null;
  nextTaskError: string | null;
  nextTaskLoading: boolean;
  onGoToNextTask: () => void;
  onSaveDraft: () => void;
  onSubmitAnnotation: () => void;
  onTaskAction: () => void;
  saving: boolean;
};

export function TaskInlineActions({
  canAnnotate,
  canWork,
  nextAction,
  nextTask,
  nextTaskError,
  nextTaskLoading,
  onGoToNextTask,
  onSaveDraft,
  onSubmitAnnotation,
  onTaskAction,
  saving
}: TaskInlineActionsProps) {
  return (
    <div className="task-inline-actions">
      <div>
        <p className="eyebrow">Actions</p>
        {nextTaskError && <p className="form-error compact-error">{nextTaskError}</p>}
      </div>
      {canWork ? (
        <div className="task-action-stack horizontal">
          {nextAction && (
            <button className="secondary-button" disabled={saving} onClick={onTaskAction} type="button">
              <Eye size={17} />
              {saving ? "Saving" : nextAction.label}
            </button>
          )}
          <button className="secondary-button" disabled={!canAnnotate || saving} onClick={onSaveDraft} type="button">
            <Save size={17} />
            Save draft
          </button>
          <button className="secondary-button" disabled={saving || nextTaskLoading || !nextTask} onClick={onGoToNextTask} type="button">
            <ArrowRight size={17} />
            {nextTaskLoading ? "Finding next" : nextTask ? "Next task" : "No next task"}
          </button>
          <button className="primary-button" disabled={!canAnnotate || saving} onClick={onSubmitAnnotation} type="button">
            <Send size={17} />
            Submit annotation
          </button>
        </div>
      ) : (
        <p className="muted-copy">Read-only access. You can inspect this task but cannot submit annotations.</p>
      )}
    </div>
  );
}
