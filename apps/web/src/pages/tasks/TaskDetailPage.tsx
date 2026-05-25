import { type PointerEvent, type WheelEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, Hand, Lock, Maximize2, Minimize2, Minus, Plus, RotateCcw, Save, Send, SquareDashedMousePointer, Trash2, Unlock } from "lucide-react";
import { getAssetAccessUrl, saveTaskAnnotation, startTask, submitTaskAnnotation, type AnnotationSummary, type SaveAnnotationInput } from "../../api";
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

interface TemplateSource {
  binding: string | null;
  name: string;
  type: "AUDIO" | "IMAGE" | "PDF" | "TEXT" | "TIME_SERIES" | "VIDEO" | "UNKNOWN";
}

interface TextAreaControl {
  maxSubmissions: number | null;
  name: string;
  placeholder: string | null;
  required: boolean;
  toName: string;
}

interface ChoiceControl {
  choice: "multiple" | "single";
  choices: {
    color: string | null;
    value: string;
  }[];
  name: string;
  required: boolean;
  toName: string;
}

interface ZoomAnchor {
  stageX: number;
  stageY: number;
  x: number;
  y: number;
}

type BoxHandle = "nw" | "ne" | "se" | "sw";

type RegionEdit =
  | {
      id: string;
      kind: "move";
      originalShape: AnnotationShape;
      startPoint: Point;
    }
  | {
      handle: BoxHandle;
      id: string;
      kind: "resize-box";
      originalShape: AnnotationShape;
      startPoint: Point;
    }
  | {
      id: string;
      kind: "move-point";
      originalShape: AnnotationShape;
      pointIndex: number;
    };

interface ActiveRegionEdit {
  id: string;
  kind: RegionEdit["kind"];
}

interface PanDrag {
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

const defaultLabel = "Object";
const labelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];
const zoomStep = 0.25;
const minZoom = 1;
const maxZoom = 3;
const autoSaveDelayMs = 650;
const editHandleHitRadius = 0.018;
const polygonCloseHitRadius = 0.02;
const assetAccessUrlCache = new Map<string, { accessUrl: string; expiresAt: number }>();

export function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const { session } = useAuth();
  const { annotation, error, loading, reload, setAnnotation, setError, setTask, task } = useTask(session, taskId);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [polygonClosePointHover, setPolygonClosePointHover] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [polygonPreviewPoint, setPolygonPreviewPoint] = useState<Point | null>(null);
  const [activeLabel, setActiveLabel] = useState(defaultLabel);
  const [activeTool, setActiveTool] = useState<"BBOX" | "POLYGON">("BBOX");
  const [zoom, setZoom] = useState(1);
  const [fullscreenAnnotator, setFullscreenAnnotator] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ height: number; width: number } | null>(null);
  const [annotationStageSize, setAnnotationStageSize] = useState<{ height: number; width: number }>({ height: 0, width: 0 });
  const [activeEdit, setActiveEdit] = useState<ActiveRegionEdit | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [labelArmed, setLabelArmed] = useState(false);
  const [labelDrawLock, setLabelDrawLock] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [choiceResponses, setChoiceResponses] = useState<Record<string, string[]>>({});
  const [textAssetContent, setTextAssetContent] = useState<string | null>(null);
  const [textResponses, setTextResponses] = useState<Record<string, string>>({});
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const annotationStageRef = useRef<HTMLDivElement | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessUrlAssetIdRef = useRef<string | null>(null);
  const editRegionRef = useRef<RegionEdit | null>(null);
  const latestPayloadTextRef = useRef("");
  const lastSavedPayloadTextRef = useRef("");
  const panDragRef = useRef<PanDrag | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const isImage = task?.asset?.mimeType.startsWith("image/") ?? false;
  const canAnnotate = Boolean(task?.canWork && task.status !== "SUBMITTED" && task.status !== "APPROVED");
  const nextAction = task ? getNextTaskAction(task.status) : null;
  const annotationStatus = annotation?.status ?? "No draft";
  const pageTitle = task?.asset?.fileName ?? "Task workspace";
  const configCode = getConfigString(task?.dataset?.labelingConfig, "configCode") ?? "";
  const templateSources = useMemo(() => parseTemplateSources(configCode), [configCode]);
  const choiceControls = useMemo(() => parseChoiceControls(configCode), [configCode]);
  const textAreaControls = useMemo(() => parseTextAreaControls(configCode), [configCode]);
  const templateSourceByName = useMemo(() => new Map(templateSources.map((source) => [source.name, source])), [templateSources]);
  const labelOptions = useMemo(() => getLabelOptions(task?.dataset?.labels, task?.dataset?.labelingConfig), [task?.dataset?.labels, task?.dataset?.labelingConfig]);
  const toolOptions = useMemo(() => getToolOptions(task?.dataset?.tools), [task?.dataset?.tools]);
  const regionBorderWidth = useMemo(() => getRegionBorderWidth(task?.dataset?.labelingConfig), [task?.dataset?.labelingConfig]);
  const drawingToolOptions = useMemo(() => toolOptions.filter((tool): tool is "BBOX" | "POLYGON" => tool === "BBOX" || tool === "POLYGON"), [toolOptions]);
  const supportsBbox = drawingToolOptions.includes("BBOX");
  const supportsPolygon = drawingToolOptions.includes("POLYGON");
  const supportsRegionDrawing = supportsBbox || supportsPolygon;
  const formControls = useMemo(() => [...choiceControls, ...textAreaControls], [choiceControls, textAreaControls]);
  const formToolLabels = useMemo(
    () => formControls.length > 0 ? formControls.map((control) => formatControlName(control.name)) : toolOptions.filter((tool) => !["BBOX", "POLYGON"].includes(tool)).map(formatEnum),
    [formControls, toolOptions]
  );
  const usesTemplateForm = !supportsRegionDrawing && (formControls.length > 0 || templateSources.some((source) => source.type !== "UNKNOWN"));
  const selectedShape = useMemo(
    () => shapes.find((shape) => shape.id === selectedShapeId) ?? null,
    [selectedShapeId, shapes]
  );
  const polygonInProgress = activeTool === "POLYGON" && polygonPoints.length > 0;
  const canStartPolygon = activeTool === "POLYGON" && (labelArmed || labelDrawLock);

  useEffect(() => {
    const nextShapes = annotationToShapes(annotation);
    const nextChoiceResponses = annotationToChoiceResponses(annotation);
    const nextTextResponses = annotationToTextResponses(annotation);
    const nextPayloadText = serializeAnnotationPayload({
      ...shapesToAnnotationPayload(nextShapes),
      results: formResponsesToResults(nextTextResponses, textAreaControls, nextChoiceResponses, choiceControls)
    });

    setShapes(nextShapes);
    setChoiceResponses(nextChoiceResponses);
    setTextResponses(nextTextResponses);
    setSelectedShapeId(null);
    latestPayloadTextRef.current = nextPayloadText;
    lastSavedPayloadTextRef.current = nextPayloadText;
  }, [annotation?.id, annotation?.updatedAt, choiceControls, textAreaControls]);

  useEffect(() => {
    setActiveTool((current) => (drawingToolOptions.includes(current) ? current : drawingToolOptions[0] ?? "BBOX"));
    setLabelArmed(false);
    setPolygonClosePointHover(false);
    setPolygonPoints([]);
    setPolygonPreviewPoint(null);
  }, [drawingToolOptions]);

  useEffect(() => {
    if (labelOptions.length > 0 && (activeLabel === defaultLabel || activeLabel.trim().length === 0)) {
      setActiveLabel(labelOptions[0].name);
    }
  }, [activeLabel, labelOptions]);

  useEffect(() => {
    if (!savedMessage) {
      return;
    }

    const timer = window.setTimeout(() => setSavedMessage(null), 5000);

    return () => window.clearTimeout(timer);
  }, [savedMessage]);

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
          setPolygonPoints((current) => {
            const next = current.slice(0, -1);
            if (next.length < 3) {
              setPolygonClosePointHover(false);
            }
            if (next.length === 0) {
              setPolygonPreviewPoint(null);
            }
            return next;
          });
        } else if (selectedShapeId) {
          removeBox(selectedShapeId);
        }
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        const option = labelOptions[Number(event.key) - 1];

        if (option && !polygonInProgress) {
          setActiveLabel(option.name);
          setActiveTool("POLYGON");
          setLabelArmed(true);
          setPanMode(false);
        }
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      } else if (event.key.toLowerCase() === "b" && supportsBbox) {
        if (polygonInProgress) {
          return;
        }
        setActiveTool("BBOX");
        setLabelArmed(false);
        setPolygonClosePointHover(false);
        setPolygonPoints([]);
        setPolygonPreviewPoint(null);
      } else if (event.key.toLowerCase() === "p" && supportsPolygon) {
        if (polygonInProgress) {
          return;
        }
        setActiveTool("POLYGON");
      } else if (event.key === "Enter" && activeTool === "POLYGON" && polygonPoints.length >= 3) {
        event.preventDefault();
        finishPolygon();
      } else if (event.key === "Escape") {
        setPolygonClosePointHover(false);
        setLabelArmed(labelDrawLock);
        setPolygonPoints([]);
        setPolygonPreviewPoint(null);
        setSelectedShapeId(null);
        setDraftShape(null);
      }
    }

    window.addEventListener("keydown", handleKeyboard);

    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [activeTool, canAnnotate, handleSaveDraft, handleSubmitAnnotation, labelOptions, polygonInProgress, polygonPoints.length, selectedShapeId, supportsBbox, supportsPolygon]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccessUrl() {
      if (!session || !task?.assetId) {
        accessUrlAssetIdRef.current = null;
        setAccessUrl(null);
        setAssetLoading(false);
        return;
      }

      const assetId = task.assetId;
      const cacheKey = getAssetAccessCacheKey(session, assetId);
      const cachedAccessUrl = getCachedAssetAccessUrl(cacheKey);

      if (cachedAccessUrl) {
        accessUrlAssetIdRef.current = assetId;
        setAccessUrl(cachedAccessUrl);
        setAssetLoading(false);
        setAssetError(null);
        return;
      }

      if (accessUrlAssetIdRef.current !== assetId) {
        setAccessUrl(null);
      }

      setAssetLoading(accessUrlAssetIdRef.current !== assetId);
      setAssetError(null);

      try {
        const result = await getAssetAccessUrl(session, assetId);

        if (!cancelled) {
          assetAccessUrlCache.set(cacheKey, {
            accessUrl: result.accessUrl,
            expiresAt: Date.now() + result.expiresInSeconds * 1000
          });
          accessUrlAssetIdRef.current = assetId;
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

  useEffect(() => {
    let cancelled = false;

    async function loadTextAsset() {
      if (!accessUrl || !isTextLikeAsset(task?.asset?.mimeType)) {
        setTextAssetContent(null);
        return;
      }

      try {
        const response = await fetch(accessUrl);

        if (!response.ok) {
          throw new Error("Unable to read text asset.");
        }

        const text = await response.text();

        if (!cancelled) {
          setTextAssetContent(text);
        }
      } catch {
        if (!cancelled) {
          setTextAssetContent(null);
        }
      }
    }

    void loadTextAsset();

    return () => {
      cancelled = true;
    };
  }, [accessUrl, task?.asset?.mimeType]);

  useEffect(() => {
    const stageElement = annotationStageRef.current;

    if (!stageElement) {
      return;
    }

    const observedStage: HTMLDivElement = stageElement;

    function updateStageSize() {
      const rect = observedStage.getBoundingClientRect();
      setAnnotationStageSize({
        height: rect.height,
        width: rect.width
      });
    }

    updateStageSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => window.removeEventListener("resize", updateStageSize);
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(observedStage);

    return () => observer.disconnect();
  }, [fullscreenAnnotator, accessUrl, isImage]);

  const annotationPayload = useMemo(
    () => ({
      ...shapesToAnnotationPayload(shapes),
      results: formResponsesToResults(textResponses, textAreaControls, choiceResponses, choiceControls)
    }),
    [choiceControls, choiceResponses, shapes, textAreaControls, textResponses]
  );
  const annotationPayloadText = useMemo(() => serializeAnnotationPayload(annotationPayload), [annotationPayload]);

  useEffect(() => {
    latestPayloadTextRef.current = annotationPayloadText;
  }, [annotationPayloadText]);

  useEffect(() => {
    if (!session || !task || !canAnnotate || loading) {
      return;
    }

    if (annotationPayloadText === lastSavedPayloadTextRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveDraft(annotationPayload, { auto: true });
    }, autoSaveDelayMs);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [annotationPayload, annotationPayloadText, canAnnotate, loading, session, task?.id]);

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    },
    []
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

    if (panMode) {
      const stageElement = annotationStageRef.current;

      if (stageElement) {
        panDragRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          scrollLeft: stageElement.scrollLeft,
          scrollTop: stageElement.scrollTop
        };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }

    const point = getPoint(event);

    if (!point) {
      return;
    }

    if (polygonInProgress) {
      if (shouldClosePolygon(polygonPoints, point)) {
        finishPolygon();
        return;
      }

      setPolygonClosePointHover(false);
      setPolygonPoints((current) => [...current, point]);
      setPolygonPreviewPoint(point);
      return;
    }

    const selectedForEdit = selectedShape;
    const handleHit = selectedForEdit ? findEditHandleAtPoint(selectedForEdit, point) : null;

    if (selectedForEdit && handleHit) {
      editRegionRef.current = handleHit.kind === "move-point"
        ? {
            id: selectedForEdit.id,
            kind: "move-point",
            originalShape: selectedForEdit,
            pointIndex: handleHit.pointIndex
          }
        : {
            handle: handleHit.handle,
            id: selectedForEdit.id,
            kind: "resize-box",
            originalShape: selectedForEdit,
            startPoint: point
          };
      setActiveEdit({ id: selectedForEdit.id, kind: handleHit.kind });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (polygonPoints.length === 0) {
      const hitShape = findShapeAtPoint(shapes, point);

      if (hitShape) {
        editRegionRef.current = {
          id: hitShape.id,
          kind: "move",
          originalShape: hitShape,
          startPoint: point
        };
        setActiveEdit({ id: hitShape.id, kind: "move" });
        setSelectedShapeId(hitShape.id);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    setSelectedShapeId(null);

    if (activeTool === "POLYGON") {
      if (!canStartPolygon) {
        return;
      }

      setPolygonClosePointHover(false);
      setPolygonPoints((current) => [...current, point]);
      setPolygonPreviewPoint(point);
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
    if (panDragRef.current) {
      const stageElement = annotationStageRef.current;

      if (stageElement) {
        stageElement.scrollLeft = panDragRef.current.scrollLeft - (event.clientX - panDragRef.current.clientX);
        stageElement.scrollTop = panDragRef.current.scrollTop - (event.clientY - panDragRef.current.clientY);
      }
      return;
    }

    if (editRegionRef.current) {
      const point = getPoint(event);

      if (!point) {
        return;
      }

      const edit = editRegionRef.current;
      const nextShape =
        edit.kind === "move"
          ? translateShape(edit.originalShape, point.x - edit.startPoint.x, point.y - edit.startPoint.y)
          : edit.kind === "resize-box"
            ? resizeBoxShape(edit.originalShape, edit.handle, point)
            : movePolygonPoint(edit.originalShape, edit.pointIndex, point);

      setShapes((current) => current.map((shape) => (shape.id === edit.id ? nextShape : shape)));
      return;
    }

    if (activeTool === "POLYGON") {
      const point = getPoint(event);

      if (point && polygonPoints.length > 0) {
        setPolygonClosePointHover(shouldClosePolygon(polygonPoints, point));
        setPolygonPreviewPoint(point);
      }

      return;
    }

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
    if (panDragRef.current) {
      panDragRef.current = null;
      setIsPanning(false);
      return;
    }

    if (editRegionRef.current) {
      editRegionRef.current = null;
      setActiveEdit(null);
      return;
    }

    if (!drawStartRef.current || !draftShape) {
      return;
    }

    drawStartRef.current = null;

    if ((draftShape.width ?? 0) > 0.01 && (draftShape.height ?? 0) > 0.01) {
      const boxId = `box-${Date.now()}`;
      setShapes((current) => [...current, { ...draftShape, id: boxId }]);
      setSelectedShapeId(boxId);
    }

    setDraftShape(null);
  }

  function handlePointerLeave() {
    if (polygonInProgress) {
      setPolygonClosePointHover(false);
    }

    handlePointerUp();
  }

  function removeBox(boxId: string) {
    setShapes((current) => current.filter((shape) => shape.id !== boxId));
    setSelectedShapeId((current) => (current === boxId ? null : current));
  }

  function finishPolygon() {
    if (polygonPoints.length < 3) {
      return;
    }

    const nextLabelArmed = labelDrawLock;
    const polygonId = `polygon-${Date.now()}`;
    setShapes((current) => [
      ...current,
      {
        id: polygonId,
        label: activeLabel.trim() || defaultLabel,
        points: polygonPoints,
        type: "POLYGON"
      }
    ]);
    setPolygonClosePointHover(false);
    setPolygonPoints([]);
    setPolygonPreviewPoint(null);
    setLabelArmed(nextLabelArmed);
    setSelectedShapeId(null);
  }

  function captureZoomAnchor(clientX?: number, clientY?: number) {
    const stageElement = annotationStageRef.current;
    const canvasElement = annotationCanvasRef.current;

    if (!stageElement || !canvasElement) {
      pendingZoomAnchorRef.current = null;
      return;
    }

    const stageRect = stageElement.getBoundingClientRect();
    const canvasRect = canvasElement.getBoundingClientRect();
    const anchorClientX = clientX ?? stageRect.left + stageRect.width / 2;
    const anchorClientY = clientY ?? stageRect.top + stageRect.height / 2;

    pendingZoomAnchorRef.current = {
      stageX: anchorClientX - stageRect.left,
      stageY: anchorClientY - stageRect.top,
      x: clamp((anchorClientX - canvasRect.left) / Math.max(canvasRect.width, 1)),
      y: clamp((anchorClientY - canvasRect.top) / Math.max(canvasRect.height, 1))
    };
  }

  function setZoomWithAnchor(update: (current: number) => number, clientX?: number, clientY?: number) {
    captureZoomAnchor(clientX, clientY);
    setZoom((current) => clampZoom(update(current)));
  }

  function zoomIn() {
    setZoomWithAnchor((current) => current + zoomStep);
  }

  function zoomOut() {
    setZoomWithAnchor((current) => current - zoomStep);
  }

  function resetZoom() {
    setZoomWithAnchor(() => 1);
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey || !isImage) {
      return;
    }

    event.preventDefault();
    setZoomWithAnchor((current) => current + (event.deltaY < 0 ? zoomStep : -zoomStep), event.clientX, event.clientY);
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
    await saveDraft(annotationPayload, { auto: false });
  }

  async function saveDraft(payload: SaveAnnotationInput, options: { auto: boolean }) {
    if (!session || !task) {
      return;
    }

    const payloadText = serializeAnnotationPayload(payload);

    if (payloadText === lastSavedPayloadTextRef.current && options.auto) {
      return;
    }

    setSaving(true);
    if (!options.auto) {
      setSavedMessage(null);
    }
    setError(null);

    try {
      const result = await saveTaskAnnotation(session, task.id, payload);
      lastSavedPayloadTextRef.current = payloadText;

      if (latestPayloadTextRef.current === payloadText) {
        setAnnotation(result.annotation);
        setTask(result.task);
      }

      setSavedMessage(options.auto ? "Autosaved." : "Annotation draft saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : options.auto ? "Unable to autosave annotation." : "Unable to save annotation.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitAnnotation() {
    if (!session || !task) {
      return;
    }

    const hasTextResults = (annotationPayload.results ?? []).length > 0;

    const missingRequiredText = textAreaControls.some((control) => control.required && !textResponses[control.name]?.trim());
    const missingRequiredChoice = choiceControls.some((control) => control.required && (choiceResponses[control.name]?.length ?? 0) === 0);

    if (usesTemplateForm && (missingRequiredText || missingRequiredChoice || (formControls.length > 0 && !hasTextResults))) {
      setError("Complete the required response before submitting.");
      return;
    }

    if (!usesTemplateForm && shapes.length === 0 && !window.confirm("Submit this task without any regions?")) {
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

  const livePolygonPoints = polygonPoints.length > 0 && polygonPreviewPoint
    ? [...polygonPoints, polygonPreviewPoint]
    : polygonPoints;
  const annotationCanvasWidth = useMemo(
    () => getAnnotationCanvasWidth({
      fullscreen: fullscreenAnnotator,
      imageNaturalSize,
      stageSize: annotationStageSize,
      zoom
    }),
    [annotationStageSize, fullscreenAnnotator, imageNaturalSize, zoom]
  );

  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    const stageElement = annotationStageRef.current;
    const canvasElement = annotationCanvasRef.current;

    if (!anchor || !stageElement || !canvasElement) {
      return;
    }

    pendingZoomAnchorRef.current = null;

    const nextScrollLeft = canvasElement.offsetLeft + anchor.x * canvasElement.offsetWidth - anchor.stageX;
    const nextScrollTop = canvasElement.offsetTop + anchor.y * canvasElement.offsetHeight - anchor.stageY;

    stageElement.scrollLeft = clampScroll(nextScrollLeft, stageElement.scrollWidth - stageElement.clientWidth);
    stageElement.scrollTop = clampScroll(nextScrollTop, stageElement.scrollHeight - stageElement.clientHeight);
  }, [annotationCanvasWidth, zoom]);

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
        {loading ? (
          <p className="muted-copy">Loading task workspace.</p>
        ) : task ? (
          <div className="task-detail-layout">
            <section className="task-annotation-column">
              <section className={`panel task-asset-panel${fullscreenAnnotator ? " fullscreen-annotation-panel" : ""}`}>
                <div className="task-asset-head">
                  <div>
                    <p className="eyebrow">Task asset</p>
                    <h2>{pageTitle}</h2>
                  </div>
                  <div className="annotation-toolbar">
                    {!usesTemplateForm && (
                      <>
                        <button className="icon-button" type="button" onClick={zoomOut} disabled={zoom <= minZoom} aria-label="Zoom out" title="Zoom out">
                          <Minus size={16} />
                        </button>
                        <span>{Math.round(zoom * 100)}%</span>
                        <button className="icon-button" type="button" onClick={zoomIn} disabled={zoom >= maxZoom} aria-label="Zoom in" title="Zoom in">
                          <Plus size={16} />
                        </button>
                        <button className="icon-button" type="button" onClick={resetZoom} aria-label="Reset zoom" title="Reset zoom">
                          <RotateCcw size={16} />
                        </button>
                        <button
                          className={panMode ? "icon-button active" : "icon-button"}
                          type="button"
                          onClick={() => setPanMode((current) => !current)}
                          aria-label={panMode ? "Turn off pan mode" : "Pan image"}
                          title={panMode ? "Turn off pan" : "Pan image"}
                        >
                          <Hand size={16} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => setFullscreenAnnotator((current) => !current)}
                          aria-label={fullscreenAnnotator ? "Exit full screen annotation" : "Open full screen annotation"}
                          title={fullscreenAnnotator ? "Exit full screen" : "Full screen"}
                        >
                          {fullscreenAnnotator ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                      </>
                    )}
                    <span className="status-pill compact">{formatEnum(task.status)}</span>
                  </div>
                </div>
                <div
                  className={`annotation-stage${canAnnotate && isImage ? " drawing-enabled" : ""}${panMode ? " pan-mode" : ""}${isPanning ? " panning" : ""}${activeEdit ? ` editing-region ${activeEdit.kind}` : ""}`}
                  onWheel={handleStageWheel}
                  ref={annotationStageRef}
                >
                  {usesTemplateForm ? (
                    <TemplateResponseWorkspace
                      accessUrl={accessUrl}
                      assetLoading={assetLoading}
                      choiceControls={choiceControls}
                      choiceResponses={choiceResponses}
                      controls={textAreaControls}
                      onChoiceChange={setChoiceResponses}
                      onChange={setTextResponses}
                      responses={textResponses}
                      sources={templateSources}
                      sourceByName={templateSourceByName}
                      task={task}
                      textAssetContent={textAssetContent}
                    />
                  ) : accessUrl && isImage ? (
                    <div
                      className="annotation-canvas"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerLeave}
                      onDoubleClick={finishPolygon}
                      ref={annotationCanvasRef}
                      style={{ width: annotationCanvasWidth }}
                    >
                      <img
                        alt={task.asset?.fileName ?? "Task asset"}
                        draggable={false}
                        onLoad={(event) => {
                          setImageNaturalSize({
                            height: event.currentTarget.naturalHeight,
                            width: event.currentTarget.naturalWidth
                          });
                        }}
                        src={accessUrl}
                      />
                      <svg
                        className="annotation-overlay"
                        preserveAspectRatio="none"
                        style={{ ["--annotation-stroke-width" as string]: `${regionBorderWidth}px` }}
                        viewBox="0 0 1 1"
                      >
                        {[...shapes, ...(draftShape ? [draftShape] : [])].map((shape) => (
                          <AnnotationSvgShape
                            activeEditKind={activeEdit?.id === shape.id ? activeEdit.kind : null}
                            isSelected={shape.id === selectedShapeId}
                            key={shape.id}
                            labelOptions={labelOptions}
                            shape={shape}
                          />
                        ))}
                        {selectedShape && (
                          <AnnotationEditHandles
                            color={getLabelColor(selectedShape.label, labelOptions)}
                            shape={selectedShape}
                          />
                        )}
                        {livePolygonPoints.length > 1 && (
                          <polyline className="annotation-draft-line" points={pointsToSvg(livePolygonPoints)} style={{ stroke: getLabelColor(activeLabel, labelOptions) }} />
                        )}
                        {polygonPoints.map((point, index) => (
                          <circle
                            className={index === 0 && polygonClosePointHover ? "annotation-point closing" : "annotation-point"}
                            cx={point.x}
                            cy={point.y}
                            key={`${point.x}-${point.y}-${index}`}
                            r={index === 0 && polygonClosePointHover ? "0.012" : "0.006"}
                            style={{ fill: getLabelColor(activeLabel, labelOptions) }}
                          />
                        ))}
                      </svg>
                    </div>
                  ) : assetLoading ? (
                    <span className="muted-copy">Preparing preview.</span>
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
                {!usesTemplateForm && (
                  <>
                    <div className="annotation-shortcuts">
                      <span>1-9 labels</span>
                      <span>{labelDrawLock ? "Label lock repeats polygons" : "Label click arms one polygon"}</span>
                      <span>B/P switches tool</span>
                      <span>Enter closes polygon</span>
                      <span>Delete removes selected region</span>
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
                          onClick={() => {
                            setLabelDrawLock((current) => {
                              const next = !current;
                              if (next) {
                                setLabelArmed(true);
                                setActiveTool("POLYGON");
                                setPanMode(false);
                              }
                              return next;
                            });
                          }}
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
                          onSelectLabel={(label) => {
                            setActiveLabel(label);
                            setActiveTool("POLYGON");
                            setLabelArmed(true);
                            setPanMode(false);
                          }}
                        />
                      ) : (
                        <label className="annotation-label-input">
                          Label
                          <input
                            value={activeLabel}
                            onChange={(event) => {
                              setActiveLabel(event.target.value);
                              setActiveTool("POLYGON");
                              setLabelArmed(true);
                            }}
                            disabled={!canAnnotate || polygonInProgress}
                          />
                        </label>
                      )}
                    </div>
                  </>
                )}
              </section>
            </section>
            <aside className="side-column task-side-panel">
              <section className="panel task-context-panel">
                <div className="task-context-head">
                  <p className="eyebrow">Context</p>
                  {(saving || savedMessage) && (
                    <p className={saving ? "task-save-status saving" : "task-save-status"}>
                      {saving ? "Saving draft..." : savedMessage}
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
                      type="button"
                      onClick={() => {
                        setActiveTool("BBOX");
                        setLabelArmed(false);
                        setPolygonPoints([]);
                        setPolygonPreviewPoint(null);
                      }}
                      disabled={!canAnnotate || polygonInProgress}
                    >
                      Box
                    </button>
                      )}
                      {supportsPolygon && (
                    <button
                      className={activeTool === "POLYGON" ? "active" : ""}
                      type="button"
                      onClick={() => setActiveTool("POLYGON")}
                      disabled={!canAnnotate || polygonInProgress}
                    >
                      Polygon
                    </button>
                      )}
                    </>
                  )}
                </div>
                {activeTool === "POLYGON" && polygonPoints.length > 0 && (
                  <div className="row-actions compact-row">
                    <span className="muted-copy">{polygonPoints.length} points</span>
                    <button className="secondary-button compact-button" type="button" onClick={finishPolygon} disabled={polygonPoints.length < 3}>
                      Finish polygon
                    </button>
                    <button
                      className="ghost-button compact-button"
                      type="button"
                      onClick={() => {
                        setPolygonClosePointHover(false);
                        setLabelArmed(labelDrawLock);
                        setPolygonPoints([]);
                        setPolygonPreviewPoint(null);
                      }}
                    >
                      Cancel polygon
                    </button>
                  </div>
                )}
              </section>
              <section className="panel created-regions-panel">
                <p className="eyebrow">{usesTemplateForm ? "Responses" : "Created regions"}</p>
                <div className="annotation-region-list">
                  {usesTemplateForm ? (
                    formControls.length > 0 ? formControls.map((control) => (
                      <div className="annotation-region-row single" key={control.name}>
                        <button className="annotation-region-chip" type="button" disabled>
                          <span>{formatControlName(control.name)}</span>
                          <small>{hasControlResponse(control, textResponses, choiceResponses) ? "Draft" : control.required ? "Required" : "Optional"}</small>
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
                          type="button"
                          onClick={() => setSelectedShapeId(shape.id)}
                          disabled={!canAnnotate}
                        >
                          <span>{index + 1}. {shape.label}</span>
                          <small>{shape.type === "POLYGON" ? `${shape.points?.length ?? 0} points` : `${Math.round((shape.width ?? 0) * 100)}% x ${Math.round((shape.height ?? 0) * 100)}%`}</small>
                        </button>
                        <button
                          aria-label={`Delete ${shape.label} region ${index + 1}`}
                          className="annotation-region-delete"
                          disabled={!canAnnotate}
                          onClick={() => removeBox(shape.id)}
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

function TemplateResponseWorkspace({
  accessUrl,
  assetLoading,
  choiceControls,
  choiceResponses,
  controls,
  onChoiceChange,
  onChange,
  responses,
  sourceByName,
  sources,
  task,
  textAssetContent
}: {
  accessUrl: string | null;
  assetLoading: boolean;
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  controls: TextAreaControl[];
  onChoiceChange: (responses: Record<string, string[]>) => void;
  onChange: (responses: Record<string, string>) => void;
  responses: Record<string, string>;
  sourceByName: Map<string, TemplateSource>;
  sources: TemplateSource[];
  task: NonNullable<ReturnType<typeof useTask>["task"]>;
  textAssetContent: string | null;
}) {
  const referencedSources = [...choiceControls, ...controls]
    .map((control) => sourceByName.get(control.toName))
    .filter((source): source is TemplateSource => Boolean(source));
  const visibleSources = dedupeSources([...sources, ...referencedSources]);

  return (
    <div className="template-response-workspace">
      <div className="template-source-stack">
        {assetLoading ? (
          <span className="muted-copy">Preparing preview.</span>
        ) : visibleSources.length > 0 ? (
          visibleSources.map((source) => (
            <TemplateSourcePreview
              accessUrl={accessUrl}
              key={source.name}
              source={source}
              task={task}
              textAssetContent={textAssetContent}
            />
          ))
        ) : (
          <div className="template-source-card">
            <p className="eyebrow">Task data</p>
            <p className="muted-copy">No source field was found in this template.</p>
          </div>
        )}
      </div>
      <div className="template-response-fields">
        {choiceControls.map((control) => (
          <div className="template-response-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <div className="template-choice-grid">
              {control.choices.map((choice) => {
                const selected = choiceResponses[control.name]?.includes(choice.value) ?? false;

                return (
                  <button
                    className={selected ? "template-choice active" : "template-choice"}
                    key={choice.value}
                    onClick={() => {
                      onChoiceChange({
                        ...choiceResponses,
                        [control.name]: toggleChoiceValue(choiceResponses[control.name] ?? [], choice.value, control.choice)
                      });
                    }}
                    style={choice.color ? { ["--choice-color" as string]: choice.color } : undefined}
                    type="button"
                  >
                    {choice.value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {controls.map((control) => (
          <label className="template-response-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <textarea
              value={responses[control.name] ?? ""}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...responses,
                  [control.name]: nextValue
                });
              }}
              placeholder={control.placeholder ?? "Type the answer here..."}
              rows={control.maxSubmissions === 1 ? 6 : 9}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function TemplateSourcePreview({
  accessUrl,
  source,
  task,
  textAssetContent
}: {
  accessUrl: string | null;
  source: TemplateSource;
  task: NonNullable<ReturnType<typeof useTask>["task"]>;
  textAssetContent: string | null;
}) {
  const sourceValue = getTemplateSourceValue(task, source, textAssetContent);

  if (source.type === "IMAGE") {
    const imageUrl = sourceValue || accessUrl;

    return (
      <div className="template-source-card image-source-card">
        <p className="eyebrow">{source.name}</p>
        {imageUrl ? (
          <img alt={task.asset?.fileName ?? source.name} src={imageUrl} />
        ) : (
          <p className="muted-copy">No image source is available.</p>
        )}
      </div>
    );
  }

  if (source.type === "TEXT") {
    return (
      <div className="template-source-card text-source-card">
        <p className="eyebrow">{source.name}</p>
        <div>{sourceValue || "No text source is available for this task."}</div>
      </div>
    );
  }

  return (
    <div className="template-source-card">
      <p className="eyebrow">{source.name}</p>
      {accessUrl ? (
        <a className="secondary-button compact-button" href={accessUrl} target="_blank" rel="noreferrer">
          Open asset
        </a>
      ) : (
        <p className="muted-copy">No preview is available.</p>
      )}
    </div>
  );
}

function AnnotationSvgShape({
  activeEditKind,
  isSelected,
  labelOptions,
  shape
}: {
  activeEditKind: RegionEdit["kind"] | null;
  isSelected: boolean;
  labelOptions: LabelOption[];
  shape: AnnotationShape;
}) {
  const color = getLabelColor(shape.label, labelOptions);
  const className = [
    "annotation-shape",
    isSelected ? "selected" : "",
    activeEditKind ? `editing ${activeEditKind}` : ""
  ].filter(Boolean).join(" ");

  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    return (
      <g className={className}>
        <polygon points={pointsToSvg(shape.points)} style={{ stroke: color }} />
      </g>
    );
  }

  return (
    <g className={className}>
      <rect
        height={shape.height ?? 0}
        width={shape.width ?? 0}
        x={shape.x ?? 0}
        y={shape.y ?? 0}
        style={{ stroke: color }}
      />
    </g>
  );
}

function AnnotationEditHandles({ color, shape }: { color: string; shape: AnnotationShape }) {
  if (shape.type === "POLYGON" && shape.points) {
    return (
      <g className="annotation-edit-handles polygon-handles">
        {shape.points.map((point, index) => (
          <circle
            cx={point.x}
            cy={point.y}
            key={`${shape.id}-${index}`}
            r="0.008"
            style={{ fill: color }}
          />
        ))}
      </g>
    );
  }

  return (
    <g className="annotation-edit-handles box-handles">
      {getBoxHandlePoints(shape).map((handle) => (
        <rect
          height="0.018"
          key={handle.handle}
          style={{ fill: color }}
          width="0.018"
          x={handle.point.x - 0.009}
          y={handle.point.y - 0.009}
        />
      ))}
    </g>
  );
}

function LabelPicker({
  activeLabel,
  canAnnotate,
  labelArmed,
  locked,
  labelOptions,
  onSelectLabel
}: {
  activeLabel: string;
  canAnnotate: boolean;
  labelArmed: boolean;
  locked: boolean;
  labelOptions: LabelOption[];
  onSelectLabel: (label: string) => void;
}) {
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

function parseTemplateSources(configCode: string): TemplateSource[] {
  const sources: TemplateSource[] = [];
  const objectTagPattern = /<(Image|Text|HyperText|Paragraphs|Audio|Video|TimeSeries|Table|List|Chat|Pdf|PDF)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = objectTagPattern.exec(configCode))) {
    const tagName = match[1];
    const attributes = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");

    if (!name) {
      continue;
    }

    sources.push({
      binding: normalizeBinding(getXmlAttribute(attributes, "value") ?? getXmlAttribute(attributes, "valueList")),
      name,
      type: getSourceType(tagName)
    });
  }

  return dedupeSources(sources);
}

function getConfigString(config: unknown, key: string) {
  if (!config || typeof config !== "object") {
    return null;
  }

  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function parseChoiceControls(configCode: string): ChoiceControl[] {
  const controls: ChoiceControl[] = [];
  const choicesPattern = /<Choices\b([^>]*)>([\s\S]*?)<\/Choices>/gi;
  let match: RegExpExecArray | null;

  while ((match = choicesPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    const choices = parseChoiceValues(body);

    if (choices.length === 0) {
      continue;
    }

    controls.push({
      choice: getXmlAttribute(attributes, "choice") === "multiple" ? "multiple" : "single",
      choices,
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function parseChoiceValues(body: string): ChoiceControl["choices"] {
  const choices: ChoiceControl["choices"] = [];
  const choicePattern = /<Choice\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = choicePattern.exec(body))) {
    const attributes = match[1] ?? "";
    const value = getXmlAttribute(attributes, "value");

    if (!value) {
      continue;
    }

    choices.push({
      color: getXmlAttribute(attributes, "background") ?? getXmlAttribute(attributes, "valueColor"),
      value
    });
  }

  return choices;
}

function parseTextAreaControls(configCode: string): TextAreaControl[] {
  const controls: TextAreaControl[] = [];
  const textAreaPattern = /<TextArea\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = textAreaPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      maxSubmissions: parsePositiveInteger(getXmlAttribute(attributes, "maxSubmissions")),
      name,
      placeholder: getXmlAttribute(attributes, "placeholder"),
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function getXmlAttribute(attributes: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2] ?? null;
}

function normalizeBinding(value: string | null) {
  if (!value?.startsWith("$")) {
    return null;
  }

  return value.slice(1);
}

function getSourceType(tagName: string): TemplateSource["type"] {
  const normalized = tagName.toUpperCase();

  if (normalized === "IMAGE") return "IMAGE";
  if (normalized === "AUDIO") return "AUDIO";
  if (normalized === "VIDEO") return "VIDEO";
  if (normalized === "PDF") return "PDF";
  if (normalized === "TIMESERIES") return "TIME_SERIES";
  if (["TEXT", "HYPERTEXT", "PARAGRAPHS", "TABLE", "LIST", "CHAT"].includes(normalized)) return "TEXT";

  return "UNKNOWN";
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function dedupeSources(sources: TemplateSource[]) {
  const seen = new Set<string>();
  const deduped: TemplateSource[] = [];

  sources.forEach((source) => {
    if (seen.has(source.name)) {
      return;
    }

    seen.add(source.name);
    deduped.push(source);
  });

  return deduped;
}

function annotationToTextResponses(annotation: AnnotationSummary | null): Record<string, string> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, string> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    if (!rawResult || typeof rawResult !== "object") {
      return;
    }

    const result = rawResult as Record<string, unknown>;
    const fromName = typeof result.from_name === "string" ? result.from_name : typeof result.fromName === "string" ? result.fromName : null;
    const value = result.value;

    if (!fromName || !value || typeof value !== "object") {
      return;
    }

    const textValue = (value as Record<string, unknown>).text;

    if (Array.isArray(textValue) && typeof textValue[0] === "string") {
      responses[fromName] = textValue[0];
    } else if (typeof textValue === "string") {
      responses[fromName] = textValue;
    }
  });

  return responses;
}

function annotationToChoiceResponses(annotation: AnnotationSummary | null): Record<string, string[]> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, string[]> = {};

  annotation.resultJson.results.forEach((rawResult) => {
    if (!rawResult || typeof rawResult !== "object") {
      return;
    }

    const result = rawResult as Record<string, unknown>;
    const fromName = typeof result.from_name === "string" ? result.from_name : typeof result.fromName === "string" ? result.fromName : null;
    const value = result.value;

    if (!fromName || !value || typeof value !== "object") {
      return;
    }

    const choicesValue = (value as Record<string, unknown>).choices;

    if (Array.isArray(choicesValue)) {
      responses[fromName] = choicesValue.filter((choice): choice is string => typeof choice === "string");
    }
  });

  return responses;
}

function formResponsesToResults(
  textResponses: Record<string, string>,
  textControls: TextAreaControl[],
  choiceResponses: Record<string, string[]>,
  choiceControls: ChoiceControl[]
): SaveAnnotationInput["results"] {
  const textResults = textControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "textarea",
      value: {
        text: [(textResponses[control.name] ?? "").trim()]
      }
    }))
    .filter((result) => result.value.text[0].length > 0);

  const choiceResults = choiceControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "choices",
      value: {
        choices: choiceResponses[control.name] ?? []
      }
    }))
    .filter((result) => result.value.choices.length > 0);

  return [...choiceResults, ...textResults];
}

function toggleChoiceValue(current: string[], value: string, mode: ChoiceControl["choice"]) {
  if (mode === "single") {
    return current.includes(value) ? [] : [value];
  }

  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function hasControlResponse(
  control: ChoiceControl | TextAreaControl,
  textResponses: Record<string, string>,
  choiceResponses: Record<string, string[]>
) {
  return "choices" in control
    ? (choiceResponses[control.name]?.length ?? 0) > 0
    : Boolean(textResponses[control.name]?.trim());
}

function getTemplateSourceValue(
  task: NonNullable<ReturnType<typeof useTask>["task"]>,
  source: TemplateSource,
  textAssetContent: string | null
) {
  const binding = source.binding;
  const taskMetadata = isRecord(task.metadata) ? task.metadata : {};
  const assetMetadata = isRecord(task.asset?.metadata) ? task.asset.metadata : {};
  const taskData = isRecord(taskMetadata.data) ? taskMetadata.data : {};
  const assetData = isRecord(assetMetadata.data) ? assetMetadata.data : {};

  if (binding) {
    const value = taskData[binding] ?? assetData[binding] ?? taskMetadata[binding] ?? assetMetadata[binding];

    if (typeof value === "string") {
      return value;
    }

    if (value != null) {
      return JSON.stringify(value, null, 2);
    }
  }

  if (source.type === "TEXT") {
    return textAssetContent ?? getStringValue(assetMetadata.text) ?? getStringValue(taskMetadata.text) ?? task.asset?.fileName ?? "";
  }

  return "";
}

function isTextLikeAsset(mimeType?: string | null) {
  if (!mimeType) {
    return false;
  }

  return mimeType.startsWith("text/") || ["application/json", "application/ld+json", "application/xml"].includes(mimeType);
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatControlName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
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

function shouldClosePolygon(points: Point[], point: Point) {
  if (points.length < 3) {
    return false;
  }

  return getPointDistance(points[0], point) <= polygonCloseHitRadius;
}

function findEditHandleAtPoint(shape: AnnotationShape, point: Point) {
  if (shape.type === "POLYGON" && shape.points) {
    const pointIndex = shape.points.findIndex((shapePoint) => getPointDistance(shapePoint, point) <= editHandleHitRadius);

    return pointIndex >= 0 ? { kind: "move-point" as const, pointIndex } : null;
  }

  const handle = getBoxHandlePoints(shape).find((candidate) => getPointDistance(candidate.point, point) <= editHandleHitRadius);

  return handle ? { handle: handle.handle, kind: "resize-box" as const } : null;
}

function getBoxHandlePoints(shape: AnnotationShape): Array<{ handle: BoxHandle; point: Point }> {
  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;

  return [
    { handle: "nw", point: { x, y } },
    { handle: "ne", point: { x: x + width, y } },
    { handle: "se", point: { x: x + width, y: y + height } },
    { handle: "sw", point: { x, y: y + height } }
  ];
}

function resizeBoxShape(shape: AnnotationShape, handle: BoxHandle, point: Point): AnnotationShape {
  const left = shape.x ?? 0;
  const top = shape.y ?? 0;
  const right = left + (shape.width ?? 0);
  const bottom = top + (shape.height ?? 0);
  const minSize = 0.01;

  const nextLeft = handle === "nw" || handle === "sw" ? Math.min(point.x, right - minSize) : left;
  const nextRight = handle === "ne" || handle === "se" ? Math.max(point.x, left + minSize) : right;
  const nextTop = handle === "nw" || handle === "ne" ? Math.min(point.y, bottom - minSize) : top;
  const nextBottom = handle === "sw" || handle === "se" ? Math.max(point.y, top + minSize) : bottom;
  const clampedLeft = clamp(nextLeft);
  const clampedRight = clamp(nextRight);
  const clampedTop = clamp(nextTop);
  const clampedBottom = clamp(nextBottom);

  return {
    ...shape,
    height: Math.max(minSize, clampedBottom - clampedTop),
    width: Math.max(minSize, clampedRight - clampedLeft),
    x: Math.min(clampedLeft, clampedRight - minSize),
    y: Math.min(clampedTop, clampedBottom - minSize)
  };
}

function movePolygonPoint(shape: AnnotationShape, pointIndex: number, point: Point): AnnotationShape {
  if (shape.type !== "POLYGON" || !shape.points) {
    return shape;
  }

  return {
    ...shape,
    points: shape.points.map((shapePoint, index) => (index === pointIndex ? { x: clamp(point.x), y: clamp(point.y) } : shapePoint))
  };
}

function shapesToAnnotationPayload(shapes: AnnotationShape[]): SaveAnnotationInput {
  return {
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
  };
}

function serializeAnnotationPayload(payload: SaveAnnotationInput) {
  return JSON.stringify(payload);
}

function findShapeAtPoint(shapes: AnnotationShape[], point: Point) {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index];

    if (shapeContainsPoint(shape, point)) {
      return shape;
    }
  }

  return null;
}

function getPointDistance(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function shapeContainsPoint(shape: AnnotationShape, point: Point) {
  if (shape.type === "POLYGON" && shape.points && shape.points.length >= 3) {
    return pointInPolygon(point, shape.points);
  }

  const x = shape.x ?? 0;
  const y = shape.y ?? 0;
  const width = shape.width ?? 0;
  const height = shape.height ?? 0;

  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;

  for (let currentIndex = 0, previousIndex = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y || Number.EPSILON) + current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function translateShape(shape: AnnotationShape, deltaX: number, deltaY: number): AnnotationShape {
  const bounds = getShapeBounds(shape);
  const clampedDeltaX = clampDelta(deltaX, bounds.minX, bounds.maxX);
  const clampedDeltaY = clampDelta(deltaY, bounds.minY, bounds.maxY);

  if (shape.type === "POLYGON" && shape.points) {
    return {
      ...shape,
      points: shape.points.map((point) => ({
        x: point.x + clampedDeltaX,
        y: point.y + clampedDeltaY
      }))
    };
  }

  return {
    ...shape,
    x: (shape.x ?? 0) + clampedDeltaX,
    y: (shape.y ?? 0) + clampedDeltaY
  };
}

function getShapeBounds(shape: AnnotationShape) {
  if (shape.type === "POLYGON" && shape.points && shape.points.length > 0) {
    const xValues = shape.points.map((point) => point.x);
    const yValues = shape.points.map((point) => point.y);

    return {
      maxX: Math.max(...xValues),
      maxY: Math.max(...yValues),
      minX: Math.min(...xValues),
      minY: Math.min(...yValues)
    };
  }

  const x = shape.x ?? 0;
  const y = shape.y ?? 0;

  return {
    maxX: x + (shape.width ?? 0),
    maxY: y + (shape.height ?? 0),
    minX: x,
    minY: y
  };
}

function clampDelta(delta: number, min: number, max: number) {
  return Math.max(-min, Math.min(1 - max, delta));
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampScroll(value: number, max: number) {
  return Math.max(0, Math.min(Math.max(0, max), value));
}

function clampZoom(value: number) {
  return Math.max(minZoom, Math.min(maxZoom, value));
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

function getToolOptions(datasetTools: { enabled: boolean; tool: string }[] | undefined): string[] {
  const enabledTools = (datasetTools ?? []).filter((tool) => tool.enabled).map((tool) => tool.tool);

  return enabledTools.length > 0 ? enabledTools : ["BBOX"];
}

function getRegionBorderWidth(config: Record<string, unknown> | null | undefined) {
  const settings = config?.settings;

  if (!settings || typeof settings !== "object") {
    return 2;
  }

  const width = (settings as Record<string, unknown>).regionBorderWidth;

  return typeof width === "number" && Number.isFinite(width) ? Math.max(1, Math.min(8, width)) : 2;
}

function getAssetAccessCacheKey(session: NonNullable<ReturnType<typeof useAuth>["session"]>, assetId: string) {
  return `${session.user.id}:${assetId}`;
}

function getCachedAssetAccessUrl(cacheKey: string) {
  const cached = assetAccessUrlCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now() + 30_000) {
    assetAccessUrlCache.delete(cacheKey);
    return null;
  }

  return cached.accessUrl;
}

function getAnnotationCanvasWidth({
  fullscreen,
  imageNaturalSize,
  stageSize,
  zoom
}: {
  fullscreen: boolean;
  imageNaturalSize: { height: number; width: number } | null;
  stageSize: { height: number; width: number };
  zoom: number;
}) {
  if (!imageNaturalSize || stageSize.width <= 0 || stageSize.height <= 0) {
    return "100%";
  }

  const aspectRatio = imageNaturalSize.width / imageNaturalSize.height;
  const availableWidth = Math.max(280, stageSize.width - 24);
  const availableHeight = Math.max(280, stageSize.height - 24);
  const cappedWidth = fullscreen ? availableWidth : Math.min(availableWidth, 980);
  const cappedHeight = fullscreen ? availableHeight : Math.min(availableHeight, 680);
  const baseWidth = Math.min(cappedWidth, cappedHeight * aspectRatio);

  return `${Math.max(260, Math.round(baseWidth * zoom))}px`;
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
