import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Minus, Plus, RotateCcw, Save, Send, SquareDashedMousePointer } from "lucide-react";
import { getAssetAccessUrl, saveTaskAnnotation, startTask, submitTaskAnnotation, type AnnotationSummary } from "../../api";
import { useAuth } from "../../auth";
import { useTask } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

interface AnnotationShape {
  height?: number;
  id: string;
  label: string;
  points?: Point[];
  type: "BBOX" | "POLYGON";
  width?: number;
  x?: number;
  y?: number;
}

interface LabelOption {
  color: string;
  name: string;
  shortcutKey?: string | null;
}

interface Point {
  x: number;
  y: number;
}

const defaultLabel = "Object";
const labelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];
const zoomStep = 0.25;

export function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { session } = useAuth();
  const { annotation, error, loading, reload, setAnnotation, setError, setTask, task } = useTask(session, taskId);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [activeLabel, setActiveLabel] = useState(defaultLabel);
  const [activeTool, setActiveTool] = useState<"BBOX" | "POLYGON">("BBOX");
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const isImage = task?.asset?.mimeType.startsWith("image/") ?? false;
  const canAnnotate = Boolean(task?.canWork && task.status !== "SUBMITTED" && task.status !== "APPROVED");
  const nextAction = task ? getNextTaskAction(task.status) : null;
  const annotationStatus = annotation?.status ?? "No draft";
  const pageTitle = task?.asset?.fileName ?? "Task workspace";
  const labelOptions = useMemo(() => getLabelOptions(task?.dataset?.labels, task?.dataset?.labelingConfig), [task?.dataset?.labels, task?.dataset?.labelingConfig]);
  const toolOptions = useMemo(() => getToolOptions(task?.dataset?.tools), [task?.dataset?.tools]);
  const supportsBbox = toolOptions.includes("BBOX");
  const supportsPolygon = toolOptions.includes("POLYGON");

  useEffect(() => {
    setShapes(annotationToShapes(annotation));
  }, [annotation?.id, annotation?.updatedAt]);

  useEffect(() => {
    setActiveTool((current) => (toolOptions.includes(current) ? current : toolOptions[0] ?? "BBOX"));
    setPolygonPoints([]);
  }, [toolOptions]);

  useEffect(() => {
    if (labelOptions.length > 0 && (activeLabel === defaultLabel || activeLabel.trim().length === 0)) {
      setActiveLabel(labelOptions[0].name);
    }
  }, [activeLabel, labelOptions]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (target?.closest("input, textarea, select, button")) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSaveDraft();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSubmitAnnotation();
        return;
      }

      if ((event.key === "Backspace" || event.key === "Delete") && canAnnotate) {
        event.preventDefault();
        if (polygonPoints.length > 0) {
          setPolygonPoints((current) => current.slice(0, -1));
        } else {
          setShapes((current) => current.slice(0, -1));
        }
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        const option = labelOptions[Number(event.key) - 1];

        if (option) {
          setActiveLabel(option.name);
        }
        return;
      }

      if (event.key === "+" || event.key === "=") {
        setZoom((current) => Math.min(3, current + zoomStep));
      } else if (event.key === "-" || event.key === "_") {
        setZoom((current) => Math.max(1, current - zoomStep));
      } else if (event.key === "0") {
        setZoom(1);
      } else if (event.key.toLowerCase() === "b" && supportsBbox) {
        setActiveTool("BBOX");
        setPolygonPoints([]);
      } else if (event.key.toLowerCase() === "p" && supportsPolygon) {
        setActiveTool("POLYGON");
      } else if (event.key === "Enter" && activeTool === "POLYGON" && polygonPoints.length >= 3) {
        event.preventDefault();
        finishPolygon();
      } else if (event.key === "Escape") {
        setPolygonPoints([]);
        setDraftShape(null);
      }
    }

    window.addEventListener("keydown", handleKeyboard);

    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [activeTool, canAnnotate, handleSaveDraft, handleSubmitAnnotation, labelOptions, polygonPoints.length, supportsBbox, supportsPolygon]);

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

  const annotationPayload = useMemo(
    () => ({
      regions: shapes.map((shape) => ({
        geometry:
          shape.type === "POLYGON"
            ? {
                points: shape.points ?? []
              }
            : {
                height: shape.height ?? 0,
                width: shape.width ?? 0,
                x: shape.x ?? 0,
                y: shape.y ?? 0
              },
        label: shape.label,
        type: shape.type
      }))
    }),
    [shapes]
  );

  function getPoint(event: PointerEvent<HTMLDivElement>) {
    const frame = annotationCanvasRef.current;

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

    if (activeTool === "POLYGON") {
      setPolygonPoints((current) => [...current, point]);
      return;
    }

    drawStartRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftShape({
      height: 0,
      id: `draft-${Date.now()}`,
      label: activeLabel.trim() || defaultLabel,
      type: "BBOX",
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

    setDraftShape(createBoxFromPoints(drawStartRef.current, point, activeLabel.trim() || defaultLabel));
  }

  function handlePointerUp() {
    if (!drawStartRef.current || !draftShape) {
      return;
    }

    drawStartRef.current = null;

    if ((draftShape.width ?? 0) > 0.01 && (draftShape.height ?? 0) > 0.01) {
      setShapes((current) => [...current, { ...draftShape, id: `box-${Date.now()}` }]);
    }

    setDraftShape(null);
  }

  function removeBox(boxId: string) {
    setShapes((current) => current.filter((shape) => shape.id !== boxId));
  }

  function finishPolygon() {
    if (polygonPoints.length < 3) {
      return;
    }

    setShapes((current) => [
      ...current,
      {
        id: `polygon-${Date.now()}`,
        label: activeLabel.trim() || defaultLabel,
        points: polygonPoints,
        type: "POLYGON"
      }
    ]);
    setPolygonPoints([]);
  }

  function zoomIn() {
    setZoom((current) => Math.min(3, current + zoomStep));
  }

  function zoomOut() {
    setZoom((current) => Math.max(1, current - zoomStep));
  }

  async function handleTaskAction() {
    if (!session || !task || !nextAction) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updatedTask = await startTask(session, task.id);
      setTask(updatedTask);
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
      const result = await saveTaskAnnotation(session, task.id, annotationPayload);
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

    if (shapes.length === 0 && !window.confirm("Submit this task without any regions?")) {
      return;
    }

    setSaving(true);
    setSavedMessage(null);
    setError(null);

    try {
      const result = await submitTaskAnnotation(session, task.id, annotationPayload);
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
                  <div className="annotation-toolbar">
                    <button className="icon-button" type="button" onClick={zoomOut} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out">
                      <Minus size={16} />
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button className="icon-button" type="button" onClick={zoomIn} disabled={zoom >= 3} aria-label="Zoom in" title="Zoom in">
                      <Plus size={16} />
                    </button>
                    <button className="icon-button" type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom">
                      <RotateCcw size={16} />
                    </button>
                    <span className="status-pill compact">{formatEnum(task.status)}</span>
                  </div>
                </div>
                <div className={`annotation-stage${canAnnotate && isImage ? " drawing-enabled" : ""}`}>
                  {assetLoading ? (
                    <span className="muted-copy">Preparing preview.</span>
                  ) : accessUrl && isImage ? (
                    <div
                      className="annotation-canvas"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                      onDoubleClick={finishPolygon}
                      ref={annotationCanvasRef}
                      style={{ width: `${zoom * 100}%` }}
                    >
                      <img alt={task.asset?.fileName ?? "Task asset"} draggable={false} src={accessUrl} />
                      <svg className="annotation-overlay" preserveAspectRatio="none" viewBox="0 0 1 1">
                        {[...shapes, ...(draftShape ? [draftShape] : [])].map((shape) => (
                          <AnnotationSvgShape key={shape.id} labelOptions={labelOptions} shape={shape} />
                        ))}
                        {polygonPoints.length > 0 && (
                          <polyline className="annotation-draft-line" points={pointsToSvg(polygonPoints)} style={{ stroke: getLabelColor(activeLabel, labelOptions) }} />
                        )}
                        {polygonPoints.map((point, index) => (
                          <circle
                            className="annotation-point"
                            cx={point.x}
                            cy={point.y}
                            key={`${point.x}-${point.y}-${index}`}
                            r="0.006"
                            style={{ fill: getLabelColor(activeLabel, labelOptions) }}
                          />
                        ))}
                      </svg>
                    </div>
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
                <div className="annotation-shortcuts">
                  <span>1-9 labels</span>
                  <span>B/P switches tool</span>
                  <span>Enter closes polygon</span>
                  <span>Delete removes last region</span>
                  <span>Ctrl+S saves</span>
                  <span>Ctrl+Enter submits</span>
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
                <p className="eyebrow">Tools</p>
                <div className="annotation-tool-tabs">
                  {supportsBbox && (
                    <button className={activeTool === "BBOX" ? "active" : ""} type="button" onClick={() => setActiveTool("BBOX")} disabled={!canAnnotate}>
                      Box
                    </button>
                  )}
                  {supportsPolygon && (
                    <button
                      className={activeTool === "POLYGON" ? "active" : ""}
                      type="button"
                      onClick={() => setActiveTool("POLYGON")}
                      disabled={!canAnnotate}
                    >
                      Polygon
                    </button>
                  )}
                </div>
                {activeTool === "POLYGON" && polygonPoints.length > 0 && (
                  <div className="row-actions compact-row">
                    <span className="muted-copy">{polygonPoints.length} points</span>
                    <button className="secondary-button compact-button" type="button" onClick={finishPolygon} disabled={polygonPoints.length < 3}>
                      Finish polygon
                    </button>
                    <button className="ghost-button compact-button" type="button" onClick={() => setPolygonPoints([])}>
                      Clear
                    </button>
                  </div>
                )}
              </section>
              <section className="panel">
                <p className="eyebrow">Labels</p>
                {labelOptions.length > 0 ? (
                  <div className="label-picker">
                    {labelOptions.map((label, index) => (
                      <button
                        className={activeLabel === label.name ? "label-option active" : "label-option"}
                        key={label.name}
                        onClick={() => setActiveLabel(label.name)}
                        style={{ ["--label-color" as string]: label.color }}
                        type="button"
                        disabled={!canAnnotate}
                      >
                        <span>{index + 1}</span>
                        {label.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <label>
                    Label
                    <input value={activeLabel} onChange={(event) => setActiveLabel(event.target.value)} disabled={!canAnnotate} />
                  </label>
                )}
                <div className="annotation-region-list">
                  {shapes.length > 0 ? (
                    shapes.map((shape, index) => (
                      <button key={shape.id} className="annotation-region-chip" type="button" onClick={() => removeBox(shape.id)} disabled={!canAnnotate}>
                        <span>{index + 1}. {shape.label}</span>
                        <small>{shape.type === "POLYGON" ? `${shape.points?.length ?? 0} points` : `${Math.round((shape.width ?? 0) * 100)}% x ${Math.round((shape.height ?? 0) * 100)}%`}</small>
                      </button>
                    ))
                  ) : (
                    <span className="muted-copy">Use the active tool on the image to add regions.</span>
                  )}
                </div>
              </section>
              <section className="panel">
                <p className="eyebrow">Actions</p>
                {task.canWork ? (
                  <div className="task-action-stack">
                    {nextAction && (
                      <button className="secondary-button" type="button" onClick={handleTaskAction} disabled={saving}>
                        <Eye size={17} />
                        {saving ? "Saving" : "Start task"}
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

function AnnotationSvgShape({ labelOptions, shape }: { labelOptions: LabelOption[]; shape: AnnotationShape }) {
  const color = getLabelColor(shape.label, labelOptions);

  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    const firstPoint = shape.points[0];

    return (
      <g>
        <polygon points={pointsToSvg(shape.points)} style={{ stroke: color }} />
        <text fill={color} x={firstPoint.x} y={Math.max(0.03, firstPoint.y - 0.01)}>
          {shape.label}
        </text>
      </g>
    );
  }

  return (
    <g>
      <rect
        height={shape.height ?? 0}
        width={shape.width ?? 0}
        x={shape.x ?? 0}
        y={shape.y ?? 0}
        style={{ stroke: color }}
      />
      <text fill={color} x={shape.x ?? 0} y={Math.max(0.03, (shape.y ?? 0) - 0.01)}>
        {shape.label}
      </text>
    </g>
  );
}

function annotationToShapes(annotation: AnnotationSummary | null): AnnotationShape[] {
  if (!annotation) {
    return [];
  }

  const shapes: AnnotationShape[] = [];

  annotation.regions.forEach((region, index) => {
    const geometry = region.geometryJson;

    if (region.type === "POLYGON" && isPolygonGeometry(geometry)) {
      shapes.push({
        id: region.id || `region-${index}`,
        label: region.label ?? defaultLabel,
        points: geometry.points,
        type: "POLYGON"
      });
      return;
    }

    if (!isBoxGeometry(geometry)) {
      return;
    }

    shapes.push({
      height: geometry.height,
      id: region.id || `region-${index}`,
      label: region.label ?? defaultLabel,
      type: "BBOX",
      width: geometry.width,
      x: geometry.x,
      y: geometry.y
    });
  });

  return shapes;
}

function isBoxGeometry(value: unknown): value is { height: number; width: number; x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const geometry = value as Record<string, unknown>;
  return ["height", "width", "x", "y"].every((key) => typeof geometry[key] === "number");
}

function isPolygonGeometry(value: unknown): value is { points: Point[] } {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).points)) {
    return false;
  }

  return ((value as { points: unknown[] }).points).every((point) => {
    if (!point || typeof point !== "object") {
      return false;
    }

    const record = point as Record<string, unknown>;
    return typeof record.x === "number" && typeof record.y === "number";
  });
}

function createBoxFromPoints(start: { x: number; y: number }, end: { x: number; y: number }, label: string): AnnotationShape {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  return {
    height,
    id: "draft",
    label,
    type: "BBOX",
    width,
    x,
    y
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getLabelOptions(
  datasetLabels: { color: string; name: string; shortcutKey: string | null }[] | undefined,
  config: Record<string, unknown> | null | undefined
): LabelOption[] {
  if (datasetLabels && datasetLabels.length > 0) {
    return datasetLabels.map((label, index) => ({
      color: label.color || labelColors[index % labelColors.length],
      name: label.name,
      shortcutKey: label.shortcutKey
    }));
  }

  if (!config || !Array.isArray(config.labels)) {
    return [];
  }

  const labels: LabelOption[] = [];

  config.labels.forEach((label, index) => {
    if (typeof label === "string") {
      labels.push({
        color: labelColors[index % labelColors.length],
        name: label,
        shortcutKey: getShortcutKey(index)
      });
      return;
    }

    if (!label || typeof label !== "object") {
      return;
    }

    const record = label as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const color = typeof record.color === "string" && record.color.trim().length > 0 ? record.color.trim() : labelColors[index % labelColors.length];

    if (name) {
      labels.push({
        color,
        name,
        shortcutKey: getShortcutKey(index)
      });
    }
  });

  return labels;
}

function getLabelColor(labelName: string, options: LabelOption[]) {
  return options.find((option) => option.name === labelName)?.color ?? labelColors[0];
}

function getToolOptions(datasetTools: { enabled: boolean; tool: string }[] | undefined): Array<"BBOX" | "POLYGON"> {
  const enabledTools = (datasetTools ?? []).filter((tool) => tool.enabled).map((tool) => tool.tool);
  const supported = enabledTools.filter((tool): tool is "BBOX" | "POLYGON" => tool === "BBOX" || tool === "POLYGON");

  return supported.length > 0 ? supported : ["BBOX"];
}

function pointsToSvg(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getShortcutKey(index: number) {
  return index >= 0 && index < 9 ? String(index + 1) : undefined;
}

function getNextTaskAction(status: string) {
  if (status === "PENDING" || status === "ASSIGNED") {
    return "start";
  }

  return null;
}
