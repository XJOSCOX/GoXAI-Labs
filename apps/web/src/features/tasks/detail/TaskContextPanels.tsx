import { Trash2 } from "lucide-react";
import type { TaskSummary } from "../../../api";
import { type AnnotationShape } from "../annotation/geometry";
import { formatAIConfidence, getAIRegionStatus, isAIShape } from "../ai/aiAssistance";
import {
  formatControlName,
  hasControlResponse,
  type TemplateFormControl,
  type TemporalRegionResponse
} from "../annotation/templateForm";
import { formatEnum } from "../../../utils/format";

type SaveStatus = "dirty" | "error" | "idle" | "saved" | "saving";

type TaskPaymentDisplay = {
  activeText: string;
  totalText: string;
};

type TaskContextPanelProps = {
  activeTool: "BBOX" | "POLYGON";
  annotationStatus: string;
  canAnnotate: boolean;
  formToolLabels: string[];
  labelDrawLock: boolean;
  onCancelPolygon: () => void;
  onFinishPolygon: () => void;
  onSelectBoxTool: () => void;
  onSelectPolygonTool: () => void;
  polygonInProgress: boolean;
  polygonPointCount: number;
  saveErrorMessage: string | null;
  savedMessage: string | null;
  saveStatus: SaveStatus;
  supportsBbox: boolean;
  supportsPolygon: boolean;
  task: TaskSummary;
  taskPayment: TaskPaymentDisplay | null;
  usesTemplateForm: boolean;
};

export function TaskContextPanel({
  activeTool,
  annotationStatus,
  canAnnotate,
  formToolLabels,
  labelDrawLock,
  onCancelPolygon,
  onFinishPolygon,
  onSelectBoxTool,
  onSelectPolygonTool,
  polygonInProgress,
  polygonPointCount,
  saveErrorMessage,
  savedMessage,
  saveStatus,
  supportsBbox,
  supportsPolygon,
  task,
  taskPayment,
  usesTemplateForm
}: TaskContextPanelProps) {
  return (
    <section className="panel task-context-panel">
      <div className="task-context-head">
        <p className="eyebrow">Context</p>
        {(saveStatus !== "idle" || savedMessage) && (
          <p className={`task-save-status ${saveStatus}`}>
            {saveStatus === "dirty"
              ? "Unsaved changes"
              : saveStatus === "saving"
                ? "Saving draft..."
                : saveStatus === "error"
                  ? saveErrorMessage ?? "Autosave failed."
                  : savedMessage ?? "Saved"}
          </p>
        )}
      </div>
      <dl className="task-context-list">
        <div>
          <dt>Project</dt>
          <dd>{task.project.name}</dd>
        </div>
        <div>
          <dt>Dataset</dt>
          <dd>{task.dataset?.name ?? "No dataset"}</dd>
        </div>
        <div>
          <dt>Assigned</dt>
          <dd>{task.assignedTo?.name ?? "Unassigned"}</dd>
        </div>
        <div>
          <dt>Reviewer</dt>
          <dd>{task.reviewer?.name ?? "No reviewer"}</dd>
        </div>
        {taskPayment ? (
          <>
            <div>
              <dt>Price</dt>
              <dd>{taskPayment.activeText}</dd>
            </div>
            <div>
              <dt>Total budget</dt>
              <dd>{taskPayment.totalText}</dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>Status</dt>
          <dd>{formatEnum(task.status)}</dd>
        </div>
        <div>
          <dt>Annotation</dt>
          <dd>{formatEnum(annotationStatus)}</dd>
        </div>
      </dl>
      <p className="eyebrow compact-section-label">Tools</p>
      <div className="annotation-tool-tabs">
        {usesTemplateForm ? (
          formToolLabels.map((label) => (
            <button className="active" key={label} type="button" disabled>
              {label}
            </button>
          ))
        ) : (
          <>
            {supportsBbox && (
              <button
                className={activeTool === "BBOX" ? "active" : ""}
                disabled={!canAnnotate || polygonInProgress}
                onClick={onSelectBoxTool}
                type="button"
              >
                Box
              </button>
            )}
            {supportsPolygon && (
              <button
                className={activeTool === "POLYGON" ? "active" : ""}
                disabled={!canAnnotate || polygonInProgress}
                onClick={onSelectPolygonTool}
                type="button"
              >
                Polygon
              </button>
            )}
          </>
        )}
      </div>
      {activeTool === "POLYGON" && polygonPointCount > 0 && (
        <div className="row-actions compact-row">
          <span className="muted-copy">{polygonPointCount} points</span>
          <button className="secondary-button compact-button" disabled={polygonPointCount < 3} onClick={onFinishPolygon} type="button">
            Finish polygon
          </button>
          <button className="ghost-button compact-button" onClick={onCancelPolygon} type="button">
            Cancel polygon
          </button>
        </div>
      )}
    </section>
  );
}

type CreatedRegionsPanelProps = {
  canAnnotate: boolean;
  choiceResponses: Record<string, string[]>;
  dateTimeResponses: Record<string, string>;
  formControls: TemplateFormControl[];
  isPdfRegionWorkspace: boolean;
  numberResponses: Record<string, string>;
  onRemoveRegion: (shapeId: string) => void;
  onSelectRegion: (shapeId: string) => void;
  ratingResponses: Record<string, number>;
  selectedShapeId: string | null;
  showAIBadges?: boolean;
  shapes: AnnotationShape[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textResponses: Record<string, string>;
  usesTemplateForm: boolean;
};

export function CreatedRegionsPanel({
  canAnnotate,
  choiceResponses,
  dateTimeResponses,
  formControls,
  isPdfRegionWorkspace,
  numberResponses,
  onRemoveRegion,
  onSelectRegion,
  ratingResponses,
  selectedShapeId,
  showAIBadges = true,
  shapes,
  temporalResponses,
  textResponses,
  usesTemplateForm
}: CreatedRegionsPanelProps) {
  return (
    <section className="panel created-regions-panel">
      <p className="eyebrow">{usesTemplateForm ? "Responses" : "Created regions"}</p>
      <div className="annotation-region-list">
        {usesTemplateForm ? (
          formControls.length > 0 ? formControls.map((control) => (
            <div className="annotation-region-row single" key={control.name}>
              <button className="annotation-region-chip" type="button" disabled>
                <span>{formatControlName(control.name)}</span>
                <small>
                  {hasControlResponse(control, textResponses, choiceResponses, numberResponses, ratingResponses, dateTimeResponses, temporalResponses)
                    ? "Draft"
                    : control.required
                      ? "Required"
                      : "Optional"}
                </small>
              </button>
            </div>
          )) : (
            <span className="muted-copy">Use the template fields in the task asset panel.</span>
          )
        ) : shapes.length > 0 ? (
          shapes.map((shape, index) => (
            <div key={shape.id} className={selectedShapeId === shape.id ? "annotation-region-row active" : "annotation-region-row"}>
              <button
                className="annotation-region-chip"
                disabled={!canAnnotate}
                onClick={() => onSelectRegion(shape.id)}
                type="button"
              >
                <span>{index + 1}. {shape.label}</span>
                <small>{shape.type === "POLYGON" ? `${shape.points?.length ?? 0} points` : `${Math.round((shape.width ?? 0) * 100)}% x ${Math.round((shape.height ?? 0) * 100)}%`}</small>
                {showAIBadges && isAIShape(shape) && <AIRegionBadge shape={shape} />}
                {isPdfRegionWorkspace && <small>Page {shape.page ?? 1}</small>}
              </button>
              <button
                aria-label={`Delete ${shape.label} region ${index + 1}`}
                className="annotation-region-delete"
                disabled={!canAnnotate}
                onClick={() => onRemoveRegion(shape.id)}
                title="Delete region"
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        ) : (
          <span className="muted-copy">Use the active tool on the image to add regions.</span>
        )}
      </div>
    </section>
  );
}

function AIRegionBadge({ shape }: { shape: AnnotationShape }) {
  const status = getAIRegionStatus(shape);
  const label = status === "edited" ? "Edited" : status === "low_confidence" ? "Low confidence" : "Accepted";

  return (
    <small className={`annotation-region-ai-badge ${status ?? "accepted"}`}>
      AI {formatAIConfidence(shape.confidence)} - {label}
    </small>
  );
}
