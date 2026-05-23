import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Save, Send, SquareDashedMousePointer, UserCheck } from "lucide-react";
import { assignTaskToSelf, getAssetAccessUrl, saveTaskAnnotation, startTask, submitTaskAnnotation, type AnnotationSummary } from "../../api";
import { useAuth } from "../../auth";
import { useTask } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

interface BBox {
  height: number;
  id: string;
  label: string;
  width: number;
  x: number;
  y: number;
}

const defaultLabel = "Object";

export function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { session } = useAuth();
  const { annotation, error, loading, reload, setAnnotation, setError, setTask, task } = useTask(session, taskId);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [boxes, setBoxes] = useState<BBox[]>([]);
  const [draftBox, setDraftBox] = useState<BBox | null>(null);
  const [activeLabel, setActiveLabel] = useState(defaultLabel);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const imageFrameRef = useRef<HTMLDivElement | null>(null);
  const isImage = task?.asset?.mimeType.startsWith("image/") ?? false;
  const canAnnotate = Boolean(task?.canWork && task.status !== "SUBMITTED" && task.status !== "APPROVED");
  const nextAction = task ? getNextTaskAction(task.status) : null;
  const annotationStatus = annotation?.status ?? "No draft";
  const pageTitle = task?.asset?.fileName ?? "Task workspace";

  useEffect(() => {
    setBoxes(annotationToBoxes(annotation));
  }, [annotation?.id, annotation?.updatedAt]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccessUrl() {
      if (!session || !task?.assetId) {
        setAccessUrl(null);
        return;
      }

      setAssetLoading(true);
      setAssetError(null);

      try {
        const result = await getAssetAccessUrl(session, task.assetId);

        if (!cancelled) {
          setAccessUrl(result.accessUrl);
        }
      } catch (reason) {
        if (!cancelled) {
          setAssetError(reason instanceof Error ? reason.message : "Unable to load asset preview.");
        }
      } finally {
        if (!cancelled) {
          setAssetLoading(false);
        }
      }
    }

    void loadAccessUrl();

    return () => {
      cancelled = true;
    };
  }, [session, task?.assetId]);

  const boxPayload = useMemo(
    () => ({
      regions: boxes.map((box) => ({
        geometry: {
          height: box.height,
          width: box.width,
          x: box.x,
          y: box.y
        },
        label: box.label
      }))
    }),
    [boxes]
  );

  function getPoint(event: PointerEvent<HTMLDivElement>) {
    const frame = imageFrameRef.current;

    if (!frame) {
      return null;
    }

    const rect = frame.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);

    return { x, y };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canAnnotate || !isImage) {
      return;
    }

    const point = getPoint(event);

    if (!point) {
      return;
    }

    drawStartRef.current = point;
    setDraftBox({
      height: 0,
      id: `draft-${Date.now()}`,
      label: activeLabel.trim() || defaultLabel,
      width: 0,
      x: point.x,
      y: point.y
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drawStartRef.current) {
      return;
    }

    const point = getPoint(event);

    if (!point) {
      return;
    }

    setDraftBox(createBoxFromPoints(drawStartRef.current, point, activeLabel.trim() || defaultLabel));
  }

  function handlePointerUp() {
    if (!drawStartRef.current || !draftBox) {
      return;
    }

    drawStartRef.current = null;

    if (draftBox.width > 0.01 && draftBox.height > 0.01) {
      setBoxes((current) => [...current, { ...draftBox, id: `box-${Date.now()}` }]);
    }

    setDraftBox(null);
  }

  function removeBox(boxId: string) {
    setBoxes((current) => current.filter((box) => box.id !== boxId));
  }

  async function handleTaskAction() {
    if (!session || !task || !nextAction) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updatedTask =
        nextAction === "assign" ? await assignTaskToSelf(session, task.id) : nextAction === "start" ? await startTask(session, task.id) : null;

      if (updatedTask) {
        setTask(updatedTask);
      } else {
        await handleSubmitAnnotation();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update task.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    if (!session || !task) {
      return;
    }

    setSaving(true);
    setSavedMessage(null);
    setError(null);

    try {
      const result = await saveTaskAnnotation(session, task.id, boxPayload);
      setAnnotation(result.annotation);
      setTask(result.task);
      setSavedMessage("Annotation draft saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save annotation.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitAnnotation() {
    if (!session || !task) {
      return;
    }

    if (boxes.length === 0 && !window.confirm("Submit this task without any boxes?")) {
      return;
    }

    setSaving(true);
    setSavedMessage(null);
    setError(null);

    try {
      const result = await submitTaskAnnotation(session, task.id, boxPayload);
      setAnnotation(result.annotation);
      setTask(result.task);
      setSavedMessage("Annotation submitted.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to submit annotation.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-stack">
      <section className="panel task-detail-frame">
        <div className="organization-detail-nav">
          <Link className="secondary-button compact-button" to={task?.projectId ? `/tasks?projectId=${task.projectId}` : "/tasks"}>
            <ArrowLeft size={16} />
            Back to task queue
          </Link>
        </div>
        {(error ?? assetError) && <p className="form-error">{error ?? assetError}</p>}
        {savedMessage && <p className="form-success">{savedMessage}</p>}
        {loading ? (
          <p className="muted-copy">Loading task workspace.</p>
        ) : task ? (
          <div className="task-detail-layout">
            <section className="task-annotation-column">
              <section className="panel task-asset-panel">
                <div className="task-asset-head">
                  <div>
                    <p className="eyebrow">Task asset</p>
                    <h2>{pageTitle}</h2>
                  </div>
                  <span className="status-pill compact">{formatEnum(task.status)}</span>
                </div>
                <div
                  className={`annotation-stage${canAnnotate && isImage ? " drawing-enabled" : ""}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  ref={imageFrameRef}
                >
                  {assetLoading ? (
                    <span className="muted-copy">Preparing preview.</span>
                  ) : accessUrl && isImage ? (
                    <>
                      <img alt={task.asset?.fileName ?? "Task asset"} draggable={false} src={accessUrl} />
                      <svg className="annotation-overlay" preserveAspectRatio="none" viewBox="0 0 1 1">
                        {[...boxes, ...(draftBox ? [draftBox] : [])].map((box) => (
                          <g key={box.id}>
                            <rect height={box.height} width={box.width} x={box.x} y={box.y} />
                            <text x={box.x} y={Math.max(0.03, box.y - 0.01)}>
                              {box.label}
                            </text>
                          </g>
                        ))}
                      </svg>
                    </>
                  ) : accessUrl ? (
                    <div className="empty-state compact-empty">
                      <Eye size={24} />
                      <strong>Preview opens separately</strong>
                      <a className="secondary-button compact-button" href={accessUrl} target="_blank" rel="noreferrer">
                        Open asset
                      </a>
                    </div>
                  ) : (
                    <div className="empty-state compact-empty">
                      <SquareDashedMousePointer size={24} />
                      <strong>No preview available</strong>
                      <span>This task has no registered image asset.</span>
                    </div>
                  )}
                </div>
              </section>
            </section>
            <aside className="side-column task-side-panel">
              <section className="panel">
                <p className="eyebrow">Context</p>
                <dl className="asset-detail-list">
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
                    <dt>Annotation</dt>
                    <dd>{formatEnum(annotationStatus)}</dd>
                  </div>
                </dl>
              </section>
              <section className="panel">
                <p className="eyebrow">Bounding boxes</p>
                <label>
                  Label
                  <input value={activeLabel} onChange={(event) => setActiveLabel(event.target.value)} disabled={!canAnnotate} />
                </label>
                <div className="annotation-region-list">
                  {boxes.length > 0 ? (
                    boxes.map((box, index) => (
                      <button key={box.id} className="annotation-region-chip" type="button" onClick={() => removeBox(box.id)} disabled={!canAnnotate}>
                        <span>{index + 1}. {box.label}</span>
                        <small>{Math.round(box.width * 100)}% x {Math.round(box.height * 100)}%</small>
                      </button>
                    ))
                  ) : (
                    <span className="muted-copy">Draw on the image to add boxes.</span>
                  )}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Actions</p>
                {task.canWork ? (
                  <div className="task-action-stack">
                    {nextAction && (
                      <button className="secondary-button" type="button" onClick={handleTaskAction} disabled={saving}>
                        {nextAction === "assign" ? <UserCheck size={17} /> : nextAction === "start" ? <Eye size={17} /> : <Send size={17} />}
                        {saving ? "Saving" : formatTaskAction(nextAction)}
                      </button>
                    )}
                    <button className="secondary-button" type="button" onClick={handleSaveDraft} disabled={!canAnnotate || saving}>
                      <Save size={17} />
                      Save draft
                    </button>
                    <button className="primary-button" type="button" onClick={handleSubmitAnnotation} disabled={!canAnnotate || saving}>
                      <Send size={17} />
                      Submit annotation
                    </button>
                  </div>
                ) : (
                  <p className="muted-copy">Read-only access. You can inspect this task but cannot submit annotations.</p>
                )}
              </section>
            </aside>
          </div>
        ) : (
          <p className="muted-copy">Task was not found.</p>
        )}
      </section>
    </section>
  );
}

function annotationToBoxes(annotation: AnnotationSummary | null): BBox[] {
  if (!annotation) {
    return [];
  }

  return annotation.regions
    .map((region, index) => {
      const geometry = region.geometryJson;

      if (!isBoxGeometry(geometry)) {
        return null;
      }

      return {
        height: geometry.height,
        id: region.id || `region-${index}`,
        label: region.label ?? defaultLabel,
        width: geometry.width,
        x: geometry.x,
        y: geometry.y
      };
    })
    .filter((box): box is BBox => Boolean(box));
}

function isBoxGeometry(value: unknown): value is { height: number; width: number; x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const geometry = value as Record<string, unknown>;
  return ["height", "width", "x", "y"].every((key) => typeof geometry[key] === "number");
}

function createBoxFromPoints(start: { x: number; y: number }, end: { x: number; y: number }, label: string): BBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return {
    height,
    id: "draft",
    label,
    width,
    x,
    y
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getNextTaskAction(status: string) {
  if (status === "PENDING") {
    return "assign";
  }

  if (status === "ASSIGNED") {
    return "start";
  }

  return null;
}

function formatTaskAction(action: "assign" | "start") {
  return action === "assign" ? "Assign to me" : "Start task";
}
