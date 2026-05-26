import { type PointerEvent, type WheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Hand, History, Lock, Maximize2, MessageSquare, Minimize2, Minus, Plus, Redo2, RotateCcw, Save, Send, SquareDashedMousePointer, Trash2, Undo2, Unlock, XCircle } from "lucide-react";
import {
  addTaskComment,
  getAssetAccessUrl,
  getNextTask,
  reviewTask,
  saveTaskAnnotation,
  startTask,
  submitTaskAnnotation,
  type AnnotationSummary,
  type ReviewSummary,
  type SaveAnnotationInput,
  type TaskQueueFilters,
  type TaskSummary
} from "../../api";
import { useAuth } from "../../auth";
import { useTask } from "../../hooks/useResources";
import { formatEnum } from "../../utils/format";

interface AnnotationShape {
  height?: number;
  id: string;
  label: string;
  ocrBlockId?: string;
  page?: number;
  points?: Point[];
  sourceName?: string;
  text?: string;
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

type ResolvedTaskQueueFilters = Omit<TaskQueueFilters, "assignment" | "due" | "search" | "status"> & {
  assignment: NonNullable<TaskQueueFilters["assignment"]>;
  due: NonNullable<TaskQueueFilters["due"]>;
  search: string;
  status: string;
};

const reviewReasonOptions = [
  { label: "Missing label", value: "missing_label" },
  { label: "Bad boundary", value: "bad_boundary" },
  { label: "Wrong class", value: "wrong_class" },
  { label: "Incomplete", value: "incomplete" },
  { label: "Other", value: "other" }
];

const reviewSeverityOptions = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Critical", value: "critical" }
];

interface PdfPageInfo {
  height: number;
  pageCount: number;
  width: number;
}

interface OcrBlock {
  height: number;
  id: string;
  page: number;
  sourceName?: string;
  text: string;
  width: number;
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

interface NumberControl {
  max: number | null;
  min: number | null;
  name: string;
  required: boolean;
  toName: string;
}

interface RatingControl {
  maxRating: number;
  name: string;
  required: boolean;
  toName: string;
}

interface DateTimeControl {
  name: string;
  required: boolean;
  toName: string;
}

interface TemporalLabelControl {
  labels: {
    color: string | null;
    value: string;
  }[];
  name: string;
  required: boolean;
  toName: string;
  type: "labels" | "timeserieslabels";
}

interface TemporalRegionResponse {
  end: string;
  id: string;
  label: string;
  page?: number;
  start: string;
}

type TemplateFormControl = ChoiceControl | DateTimeControl | NumberControl | RatingControl | TemporalLabelControl | TextAreaControl;

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

interface ShapeHistoryEntry {
  action: string;
  selectedShapeId: string | null;
  shapes: AnnotationShape[];
  timestamp: number;
}

interface TaskHistoryItem {
  body: string;
  id: string;
  meta: string;
  timestamp: string;
  title: string;
}

type SaveStatus = "dirty" | "error" | "idle" | "saved" | "saving";

const defaultLabel = "Object";
const labelColors = ["#7dd3fc", "#86efac", "#fda4af", "#fde047", "#c4b5fd", "#fdba74", "#67e8f9", "#f9a8d4"];
const zoomStep = 0.25;
const minZoom = 1;
const maxZoom = 3;
const autoSaveDelayMs = 650;
const autoSaveRetryDelayMs = 3000;
const editHandleHitRadius = 0.018;
const polygonCloseHitRadius = 0.02;
const maxUndoSteps = 60;
const assetAccessUrlCache = new Map<string, { accessUrl: string; expiresAt: number }>();

export function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueDatasetId = searchParams.get("datasetId");
  const queuePage = searchParams.get("page");
  const queueProjectId = searchParams.get("projectId");
  const queueMode = searchParams.get("queue");
  const queueFilters = useMemo(() => getQueueFilters(searchParams), [searchParams]);
  const { session } = useAuth();
  const {
    annotation,
    annotationHistory,
    comments,
    error,
    loading,
    reload,
    reviews,
    setAnnotation,
    setComments,
    setError,
    setReviews,
    setTask,
    task
  } = useTask(session, taskId);
  const [accessUrl, setAccessUrl] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [shapes, setShapes] = useState<AnnotationShape[]>([]);
  const [shapeRedoStack, setShapeRedoStack] = useState<ShapeHistoryEntry[]>([]);
  const [shapeUndoStack, setShapeUndoStack] = useState<ShapeHistoryEntry[]>([]);
  const [draftShape, setDraftShape] = useState<AnnotationShape | null>(null);
  const [polygonClosePointHover, setPolygonClosePointHover] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [polygonPreviewPoint, setPolygonPreviewPoint] = useState<Point | null>(null);
  const [activeLabel, setActiveLabel] = useState(defaultLabel);
  const [activeTool, setActiveTool] = useState<"BBOX" | "POLYGON">("BBOX");
  const [activePdfPage, setActivePdfPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fullscreenAnnotator, setFullscreenAnnotator] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ height: number; width: number } | null>(null);
  const [pdfPageInfo, setPdfPageInfo] = useState<PdfPageInfo | null>(null);
  const [annotationStageSize, setAnnotationStageSize] = useState<{ height: number; width: number }>({ height: 0, width: 0 });
  const [activeEdit, setActiveEdit] = useState<ActiveRegionEdit | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [labelArmed, setLabelArmed] = useState(false);
  const [labelDrawLock, setLabelDrawLock] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [nextTask, setNextTask] = useState<TaskSummary | null>(null);
  const [nextTaskError, setNextTaskError] = useState<string | null>(null);
  const [nextTaskLoading, setNextTaskLoading] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewScore, setReviewScore] = useState("");
  const [reviewSeverity, setReviewSeverity] = useState("medium");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [choiceResponses, setChoiceResponses] = useState<Record<string, string[]>>({});
  const [dateTimeResponses, setDateTimeResponses] = useState<Record<string, string>>({});
  const [numberResponses, setNumberResponses] = useState<Record<string, string>>({});
  const [ratingResponses, setRatingResponses] = useState<Record<string, number>>({});
  const [temporalResponses, setTemporalResponses] = useState<Record<string, TemporalRegionResponse[]>>({});
  const [textAssetContent, setTextAssetContent] = useState<string | null>(null);
  const [textResponses, setTextResponses] = useState<Record<string, string>>({});
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const annotationStageRef = useRef<HTMLDivElement | null>(null);
  const autoSaveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accessUrlAssetIdRef = useRef<string | null>(null);
  const editRegionRef = useRef<RegionEdit | null>(null);
  const editShapeHistoryRef = useRef<ShapeHistoryEntry | null>(null);
  const latestPayloadTextRef = useRef("");
  const lastSavedPayloadTextRef = useRef("");
  const panDragRef = useRef<PanDrag | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const saveRequestIdRef = useRef(0);
  const selectedShapeIdRef = useRef<string | null>(null);
  const shapesRef = useRef<AnnotationShape[]>([]);
  const isImage = task?.asset?.mimeType.startsWith("image/") ?? false;
  const isPdf = task?.asset?.mimeType === "application/pdf";
  const canAnnotate = Boolean(task?.canWork && !["APPROVED", "REVIEWING", "SUBMITTED"].includes(task.status));
  const nextAction = task ? getNextTaskAction(task.status) : null;
  const annotationStatus = annotation?.status ?? "No draft";
  const pageTitle = task?.asset?.fileName ?? "Task workspace";
  const taskQueueLink = getTaskQueueLink({ datasetId: queueDatasetId, filters: queueFilters, page: queuePage, projectId: queueProjectId, queue: queueMode }, task);
  const canReviewTask = Boolean(task?.canReview && (task.status === "SUBMITTED" || task.status === "REVIEWING"));
  const configCode = getConfigString(task?.dataset?.labelingConfig, "configCode") ?? "";
  const templateSources = useMemo(() => parseTemplateSources(configCode), [configCode]);
  const choiceControls = useMemo(() => parseChoiceControls(configCode), [configCode]);
  const dateTimeControls = useMemo(() => parseDateTimeControls(configCode), [configCode]);
  const numberControls = useMemo(() => parseNumberControls(configCode), [configCode]);
  const ratingControls = useMemo(() => parseRatingControls(configCode), [configCode]);
  const temporalControls = useMemo(() => parseTemporalLabelControls(configCode), [configCode]);
  const textAreaControls = useMemo(() => parseTextAreaControls(configCode), [configCode]);
  const templateSourceByName = useMemo(() => new Map(templateSources.map((source) => [source.name, source])), [templateSources]);
  const labelOptions = useMemo(() => getLabelOptions(task?.dataset?.labels, task?.dataset?.labelingConfig), [task?.dataset?.labels, task?.dataset?.labelingConfig]);
  const toolOptions = useMemo(() => getToolOptions(task?.dataset?.tools), [task?.dataset?.tools]);
  const regionBorderWidth = useMemo(() => getRegionBorderWidth(task?.dataset?.labelingConfig), [task?.dataset?.labelingConfig]);
  const configDrawingToolOptions = useMemo(() => parseRegionDrawingTools(configCode), [configCode]);
  const drawingToolOptions = useMemo(
    () => dedupeDrawingTools([
      ...toolOptions.filter((tool): tool is "BBOX" | "POLYGON" => tool === "BBOX" || tool === "POLYGON"),
      ...configDrawingToolOptions
    ]),
    [configDrawingToolOptions, toolOptions]
  );
  const supportsBbox = drawingToolOptions.includes("BBOX");
  const supportsPolygon = drawingToolOptions.includes("POLYGON");
  const supportsRegionDrawing = supportsBbox || supportsPolygon;
  const pdfSource = useMemo(() => templateSources.find((source) => source.type === "PDF") ?? null, [templateSources]);
  const isPdfRegionWorkspace = Boolean(supportsRegionDrawing && accessUrl && !isImage && (isPdf || pdfSource));
  const canDrawOnRegionSource = isImage || isPdfRegionWorkspace;
  const ocrBlocks = useMemo(
    () => extractOcrBlocks(task, pdfPageInfo, pdfSource?.name ?? "pdf"),
    [pdfPageInfo, pdfSource?.name, task]
  );
  const formControls = useMemo(
    () => [...choiceControls, ...textAreaControls, ...numberControls, ...ratingControls, ...dateTimeControls, ...temporalControls],
    [choiceControls, dateTimeControls, numberControls, ratingControls, temporalControls, textAreaControls]
  );
  const formToolLabels = useMemo(
    () => formControls.length > 0 ? formControls.map((control) => formatControlName(control.name)) : toolOptions.filter((tool) => !["BBOX", "POLYGON"].includes(tool)).map(formatEnum),
    [formControls, toolOptions]
  );
  const usesTemplateForm = !supportsRegionDrawing && (formControls.length > 0 || templateSources.some((source) => source.type !== "UNKNOWN"));
  const visibleShapes = useMemo(
    () => isPdfRegionWorkspace ? shapes.filter((shape) => (shape.page ?? 1) === activePdfPage) : shapes,
    [activePdfPage, isPdfRegionWorkspace, shapes]
  );
  const visibleOcrBlocks = useMemo(
    () => isPdfRegionWorkspace ? ocrBlocks.filter((block) => block.page === activePdfPage) : [],
    [activePdfPage, isPdfRegionWorkspace, ocrBlocks]
  );
  const selectedShape = useMemo(
    () => visibleShapes.find((shape) => shape.id === selectedShapeId) ?? null,
    [selectedShapeId, visibleShapes]
  );
  const canRedoShapeEdit = canAnnotate && shapeRedoStack.length > 0;
  const canUndoShapeEdit = canAnnotate && shapeUndoStack.length > 0;
  const taskHistoryItems = useMemo(() => buildTaskHistoryItems(annotationHistory, reviews), [annotationHistory, reviews]);
  const latestRejectedReview = useMemo(
    () => reviews.find((review) => review.status === "NEEDS_CHANGES") ?? null,
    [reviews]
  );
  const annotationVersionDiff = useMemo(() => buildAnnotationVersionDiff(annotationHistory), [annotationHistory]);
  const polygonInProgress = activeTool === "POLYGON" && polygonPoints.length > 0;
  const canStartPolygon = activeTool === "POLYGON" && (labelArmed || labelDrawLock);

  useEffect(() => {
    const nextShapes = annotationToShapes(annotation);
    const nextChoiceResponses = annotationToChoiceResponses(annotation);
    const nextDateTimeResponses = annotationToScalarResponses(annotation, "datetime");
    const nextNumberResponses = annotationToScalarResponses(annotation, "number");
    const nextRatingResponses = annotationToRatingResponses(annotation);
    const nextTemporalResponses = annotationToTemporalResponses(annotation);
    const nextTextResponses = annotationToTextResponses(annotation);
    const nextPayloadText = serializeAnnotationPayload({
      ...shapesToAnnotationPayload(nextShapes),
      results: formResponsesToResults({
        choiceControls,
        choiceResponses: nextChoiceResponses,
        dateTimeControls,
        dateTimeResponses: nextDateTimeResponses,
        numberControls,
        numberResponses: nextNumberResponses,
        ratingControls,
        ratingResponses: nextRatingResponses,
        temporalControls,
        temporalResponses: nextTemporalResponses,
        textControls: textAreaControls,
        textResponses: nextTextResponses
      })
    });

    setShapes(nextShapes);
    setChoiceResponses(nextChoiceResponses);
    setDateTimeResponses(nextDateTimeResponses);
    setNumberResponses(nextNumberResponses);
    setRatingResponses(nextRatingResponses);
    setTemporalResponses(nextTemporalResponses);
    setTextResponses(nextTextResponses);
    setSelectedShapeId(null);
    setShapeRedoStack([]);
    setShapeUndoStack([]);
    latestPayloadTextRef.current = nextPayloadText;
    lastSavedPayloadTextRef.current = nextPayloadText;
  }, [annotation?.id, annotation?.updatedAt, choiceControls, dateTimeControls, numberControls, ratingControls, temporalControls, textAreaControls]);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    selectedShapeIdRef.current = selectedShapeId;
  }, [selectedShapeId]);

  useEffect(() => {
    if (!isPdfRegionWorkspace || !selectedShapeId) {
      return;
    }

    const selected = shapes.find((shape) => shape.id === selectedShapeId);

    if (selected && (selected.page ?? 1) !== activePdfPage) {
      setSelectedShapeId(null);
    }
  }, [activePdfPage, isPdfRegionWorkspace, selectedShapeId, shapes]);

  useEffect(() => {
    if (!isPdfRegionWorkspace || !pdfPageInfo) {
      return;
    }

    setActivePdfPage((current) => Math.max(1, Math.min(pdfPageInfo.pageCount, current)));
  }, [isPdfRegionWorkspace, pdfPageInfo]);

  useEffect(() => {
    setSaveErrorMessage(null);
    setSavedMessage(null);
    setSaveStatus("idle");
    setNextTask(null);
    setNextTaskError(null);
  }, [task?.id]);

  useEffect(() => {
    if (!session || !task) {
      setNextTask(null);
      return;
    }

    let active = true;
    const datasetId = queueDatasetId ?? task.datasetId ?? undefined;
    const projectId = queueProjectId ?? task.projectId;

    setNextTaskLoading(true);
    setNextTaskError(null);

    getNextTask(session, task.id, { ...queueFilters, datasetId, projectId, queue: queueMode === "review" ? "review" : "work" })
      .then((result) => {
        if (active) {
          setNextTask(result.task);
        }
      })
      .catch((reason) => {
        if (active) {
          setNextTask(null);
          setNextTaskError(reason instanceof Error ? reason.message : "Unable to load the next task.");
        }
      })
      .finally(() => {
        if (active) {
          setNextTaskLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [queueDatasetId, queueFilters, queueMode, queueProjectId, session, task?.datasetId, task?.id, task?.projectId]);

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

    const timer = window.setTimeout(() => {
      setSavedMessage(null);
      setSaveStatus((current) => (current === "saved" ? "idle" : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [savedMessage]);

  const pushShapeHistoryEntry = useCallback((entry: ShapeHistoryEntry) => {
    setShapeUndoStack((current) => [...current.slice(-(maxUndoSteps - 1)), entry]);
    setShapeRedoStack([]);
  }, []);

  const createShapeHistoryEntry = useCallback((action: string): ShapeHistoryEntry => ({
    action,
    selectedShapeId: selectedShapeIdRef.current,
    shapes: cloneShapes(shapesRef.current),
    timestamp: Date.now()
  }), []);

  const clearTransientShapeState = useCallback(() => {
    drawStartRef.current = null;
    editRegionRef.current = null;
    editShapeHistoryRef.current = null;
    setActiveEdit(null);
    setDraftShape(null);
    setPolygonClosePointHover(false);
    setPolygonPoints([]);
    setPolygonPreviewPoint(null);
  }, []);

  const commitShapeEdit = useCallback(
    (action: string, update: (current: AnnotationShape[]) => AnnotationShape[], nextSelectedShapeId?: string | null) => {
      setShapes((current) => {
        const next = update(cloneShapes(current));

        if (areShapesEqual(current, next)) {
          return current;
        }

        setShapeUndoStack((stack) => [
          ...stack.slice(-(maxUndoSteps - 1)),
          {
            action,
            selectedShapeId: selectedShapeIdRef.current,
            shapes: cloneShapes(current),
            timestamp: Date.now()
          }
        ]);
        setShapeRedoStack([]);
        return cloneShapes(next);
      });

      if (nextSelectedShapeId !== undefined) {
        setSelectedShapeId(nextSelectedShapeId);
      }
    },
    []
  );

  const undoShapeEdit = useCallback(() => {
    if (!canAnnotate) {
      return;
    }

    setShapeUndoStack((current) => {
      const entry = current.at(-1);

      if (!entry) {
        return current;
      }

      setShapeRedoStack((redoStack) => [
        ...redoStack.slice(-(maxUndoSteps - 1)),
        {
          action: entry.action,
          selectedShapeId: selectedShapeIdRef.current,
          shapes: cloneShapes(shapesRef.current),
          timestamp: Date.now()
        }
      ]);
      setShapes(cloneShapes(entry.shapes));
      setSelectedShapeId(entry.selectedShapeId);
      clearTransientShapeState();

      return current.slice(0, -1);
    });
  }, [canAnnotate, clearTransientShapeState]);

  const redoShapeEdit = useCallback(() => {
    if (!canAnnotate) {
      return;
    }

    setShapeRedoStack((current) => {
      const entry = current.at(-1);

      if (!entry) {
        return current;
      }

      setShapeUndoStack((undoStack) => [
        ...undoStack.slice(-(maxUndoSteps - 1)),
        {
          action: entry.action,
          selectedShapeId: selectedShapeIdRef.current,
          shapes: cloneShapes(shapesRef.current),
          timestamp: Date.now()
        }
      ]);
      setShapes(cloneShapes(entry.shapes));
      setSelectedShapeId(entry.selectedShapeId);
      clearTransientShapeState();

      return current.slice(0, -1);
    });
  }, [canAnnotate, clearTransientShapeState]);

  useEffect(() => {
    function handleKeyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (target?.closest("input, textarea, select, button")) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoShapeEdit();
        } else {
          undoShapeEdit();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoShapeEdit();
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
  }, [activeTool, canAnnotate, handleSaveDraft, handleSubmitAnnotation, labelOptions, polygonInProgress, polygonPoints.length, redoShapeEdit, selectedShapeId, supportsBbox, supportsPolygon, undoShapeEdit]);

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
      results: formResponsesToResults({
        choiceControls,
        choiceResponses,
        dateTimeControls,
        dateTimeResponses,
        numberControls,
        numberResponses,
        ratingControls,
        ratingResponses,
        temporalControls,
        temporalResponses,
        textControls: textAreaControls,
        textResponses
      })
    }),
    [choiceControls, choiceResponses, dateTimeControls, dateTimeResponses, numberControls, numberResponses, ratingControls, ratingResponses, shapes, temporalControls, temporalResponses, textAreaControls, textResponses]
  );
  const annotationPayloadText = useMemo(() => serializeAnnotationPayload(annotationPayload), [annotationPayload]);

  useEffect(() => {
    latestPayloadTextRef.current = annotationPayloadText;

    if (!canAnnotate) {
      return;
    }

    if (annotationPayloadText === lastSavedPayloadTextRef.current) {
      setSaveStatus((current) => (current === "dirty" || current === "error" ? "idle" : current));
      return;
    }

    setSaveErrorMessage(null);
    setSaveStatus((current) => (current === "saving" ? current : "dirty"));
  }, [annotationPayloadText, canAnnotate]);

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

    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
      autoSaveRetryTimerRef.current = null;
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
      if (autoSaveRetryTimerRef.current) {
        clearTimeout(autoSaveRetryTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!canAnnotate || latestPayloadTextRef.current === lastSavedPayloadTextRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [canAnnotate]);

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
    if (!canAnnotate || !canDrawOnRegionSource) {
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
      editShapeHistoryRef.current = createShapeHistoryEntry(handleHit.kind === "move-point" ? "Moved polygon point" : "Resized box");
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
      const hitShape = findShapeAtPoint(visibleShapes, point);

      if (hitShape) {
        editShapeHistoryRef.current = createShapeHistoryEntry("Moved region");
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
      page: isPdfRegionWorkspace ? activePdfPage : undefined,
      sourceName: isPdfRegionWorkspace ? pdfSource?.name ?? "pdf" : undefined,
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

      setShapes((current) => {
        const next = current.map((shape) => (shape.id === edit.id ? nextShape : shape));
        shapesRef.current = next;
        return next;
      });
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

    setDraftShape(withCurrentRegionSource(createBoxFromPoints(drawStartRef.current, point, activeLabel.trim() || defaultLabel)));
  }

  function handlePointerUp() {
    if (panDragRef.current) {
      panDragRef.current = null;
      setIsPanning(false);
      return;
    }

    if (editRegionRef.current) {
      const historyEntry = editShapeHistoryRef.current;
      editRegionRef.current = null;
      editShapeHistoryRef.current = null;
      setActiveEdit(null);

      if (historyEntry && !areShapesEqual(historyEntry.shapes, shapesRef.current)) {
        pushShapeHistoryEntry(historyEntry);
      }

      return;
    }

    if (!drawStartRef.current || !draftShape) {
      return;
    }

    drawStartRef.current = null;

    if ((draftShape.width ?? 0) > 0.01 && (draftShape.height ?? 0) > 0.01) {
      const boxId = `box-${Date.now()}`;
      commitShapeEdit("Added box", (current) => [...current, { ...draftShape, id: boxId }], boxId);
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
    commitShapeEdit("Deleted region", (current) => current.filter((shape) => shape.id !== boxId), selectedShapeId === boxId ? null : selectedShapeId);
  }

  function finishPolygon() {
    if (polygonPoints.length < 3) {
      return;
    }

    const nextLabelArmed = labelDrawLock;
    const polygonId = `polygon-${Date.now()}`;
    commitShapeEdit("Added polygon", (current) => [
      ...current,
      {
        id: polygonId,
        label: activeLabel.trim() || defaultLabel,
        page: isPdfRegionWorkspace ? activePdfPage : undefined,
        points: polygonPoints,
        sourceName: isPdfRegionWorkspace ? pdfSource?.name ?? "pdf" : undefined,
        type: "POLYGON"
      }
    ], null);
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
    if (!event.ctrlKey || !canDrawOnRegionSource) {
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
    clearAutoSaveTimers();
    await saveDraft(annotationPayload, { auto: false });
  }

  async function handleGoToNextTask() {
    if (!nextTask) {
      return;
    }

    if (canAnnotate && latestPayloadTextRef.current !== lastSavedPayloadTextRef.current) {
      clearAutoSaveTimers();
      const saved = await saveDraft(annotationPayload, { auto: false });

      if (!saved) {
        return;
      }
    }

    navigate(
      `/tasks/${nextTask.id}${getTaskDetailSearch(
        { datasetId: queueDatasetId, filters: queueFilters, page: queuePage, projectId: queueProjectId, queue: queueMode },
        nextTask
      )}`
    );
  }

  function clearAutoSaveTimers() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
      autoSaveRetryTimerRef.current = null;
    }
  }

  function scheduleAutoSaveRetry(payload: SaveAnnotationInput) {
    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
    }

    autoSaveRetryTimerRef.current = setTimeout(() => {
      autoSaveRetryTimerRef.current = null;
      void saveDraft(payload, { auto: true });
    }, autoSaveRetryDelayMs);
  }

  async function saveDraft(payload: SaveAnnotationInput, options: { auto: boolean }) {
    if (!session || !task) {
      return false;
    }

    const payloadText = serializeAnnotationPayload(payload);

    if (payloadText === lastSavedPayloadTextRef.current && options.auto) {
      return true;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setSaving(true);
    setSaveStatus("saving");
    setSaveErrorMessage(null);
    if (!options.auto) {
      setSavedMessage(null);
    }
    setError(null);

    try {
      const result = await saveTaskAnnotation(session, task.id, payload);

      if (requestId !== saveRequestIdRef.current) {
        return;
      }

      if (latestPayloadTextRef.current === payloadText) {
        lastSavedPayloadTextRef.current = payloadText;
        setAnnotation(result.annotation);
        setTask(result.task);
        setSaveStatus("saved");
        setSaveErrorMessage(null);
        setSavedMessage(options.auto ? "Autosaved." : "Annotation draft saved.");
      } else {
        setSaveStatus("dirty");
      }
      return true;
    } catch (reason) {
      if (requestId !== saveRequestIdRef.current) {
        return;
      }

      const message = reason instanceof Error ? reason.message : options.auto ? "Unable to autosave annotation." : "Unable to save annotation.";

      setSaveStatus("error");
      setSaveErrorMessage(options.auto ? "Autosave failed. Retrying..." : message);

      if (options.auto) {
        scheduleAutoSaveRetry(payload);
      } else {
        setError(message);
      }
      return false;
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setSaving(false);
      }
    }
  }

  async function handleSubmitAnnotation() {
    if (!session || !task) {
      return;
    }

    clearAutoSaveTimers();
    saveRequestIdRef.current += 1;

    const hasTextResults = (annotationPayload.results ?? []).length > 0;

    const missingRequiredText = textAreaControls.some((control) => control.required && !textResponses[control.name]?.trim());
    const missingRequiredChoice = choiceControls.some((control) => control.required && (choiceResponses[control.name]?.length ?? 0) === 0);
    const missingRequiredNumber = numberControls.some((control) => control.required && !numberResponses[control.name]?.trim());
    const missingRequiredRating = ratingControls.some((control) => control.required && !ratingResponses[control.name]);
    const missingRequiredDateTime = dateTimeControls.some((control) => control.required && !dateTimeResponses[control.name]?.trim());

    if (usesTemplateForm && (missingRequiredText || missingRequiredChoice || missingRequiredNumber || missingRequiredRating || missingRequiredDateTime || (formControls.length > 0 && !hasTextResults))) {
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

  async function handleReviewDecision(decision: "approve" | "reject") {
    if (!session || !task) {
      return;
    }

    if (decision === "reject" && !reviewFeedback.trim()) {
      setError("Add review feedback before rejecting.");
      return;
    }

    if (decision === "reject" && !reviewReason) {
      setError("Choose a rejection reason before sending the task back.");
      return;
    }

    const normalizedScore = reviewScore.trim() ? Number(reviewScore) : null;

    if (normalizedScore !== null && (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 5)) {
      setError("Review score must be a whole number from 1 to 5.");
      return;
    }

    setReviewSaving(true);
    setSavedMessage(null);
    setError(null);

    try {
      const result = await reviewTask(session, task.id, {
        decision,
        feedback: reviewFeedback,
        reason: decision === "reject" ? reviewReason : undefined,
        score: normalizedScore,
        severity: decision === "reject" ? reviewSeverity : undefined
      });

      setAnnotation(result.annotation);
      setTask(result.task);
      setReviews((current) => [result.review, ...current]);
      if (result.comment) {
        setComments((current) => [...current, result.comment!]);
      }
      setReviewFeedback("");
      setReviewReason("");
      setReviewScore("");
      setReviewSeverity("medium");
      setSavedMessage(decision === "approve" ? "Task approved." : "Task sent back with feedback.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to review task.");
    } finally {
      setReviewSaving(false);
    }
  }

  async function handleAddComment() {
    if (!session || !task || !commentBody.trim()) {
      return;
    }

    setCommentSaving(true);
    setError(null);

    try {
      const comment = await addTaskComment(session, task.id, {
        annotationId: annotation?.id,
        body: commentBody
      });
      setComments((current) => [...current, comment]);
      setCommentBody("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add comment.");
    } finally {
      setCommentSaving(false);
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
  const pdfCanvasWidth = useMemo(
    () => getPdfCanvasWidth({
      fullscreen: fullscreenAnnotator,
      pageInfo: pdfPageInfo,
      stageSize: annotationStageSize,
      zoom
    }),
    [annotationStageSize, fullscreenAnnotator, pdfPageInfo, zoom]
  );

  function withCurrentRegionSource(shape: AnnotationShape): AnnotationShape {
    if (!isPdfRegionWorkspace) {
      return shape;
    }

    return {
      ...shape,
      page: activePdfPage,
      sourceName: pdfSource?.name ?? "pdf"
    };
  }

  function addOcrBlockRegion(block: OcrBlock) {
    if (!canAnnotate || polygonInProgress) {
      return;
    }

    const label = activeLabel.trim() || labelOptions[0]?.name || defaultLabel;
    const shape: AnnotationShape = {
      height: block.height,
      id: `ocr-${block.id}-${Date.now()}`,
      label,
      ocrBlockId: block.id,
      page: block.page,
      sourceName: block.sourceName ?? pdfSource?.name ?? "pdf",
      text: block.text,
      type: "BBOX",
      width: block.width,
      x: block.x,
      y: block.y
    };

    commitShapeEdit("Added OCR block", (current) => [...current, shape], shape.id);
    setLabelArmed(labelDrawLock);
  }

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
  }, [annotationCanvasWidth, pdfCanvasWidth, zoom]);

  return (
    <section className="page-stack">
      <section className="panel task-detail-frame">
        <div className="organization-detail-nav">
          <Link className="secondary-button compact-button" to={taskQueueLink}>
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
                        <button
                          className="icon-button"
                          type="button"
                          onClick={undoShapeEdit}
                          disabled={!canUndoShapeEdit}
                          aria-label="Undo annotation edit"
                          title="Undo"
                        >
                          <Undo2 size={16} />
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={redoShapeEdit}
                          disabled={!canRedoShapeEdit}
                          aria-label="Redo annotation edit"
                          title="Redo"
                        >
                          <Redo2 size={16} />
                        </button>
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
                        {isPdfRegionWorkspace && (
                          <div className="pdf-region-page-control">
                            <button
                              aria-label="Previous PDF page"
                              disabled={activePdfPage <= 1}
                              onClick={() => setActivePdfPage((current) => Math.max(1, current - 1))}
                              type="button"
                            >
                              <ArrowLeft size={14} />
                            </button>
                            <label>
                              Page
                              <input
                                max={pdfPageInfo?.pageCount}
                                min={1}
                                onChange={(event) => {
                                  const page = Math.max(1, Number(event.target.value) || 1);
                                  setActivePdfPage(pdfPageInfo ? Math.min(pdfPageInfo.pageCount, page) : page);
                                }}
                                type="number"
                                value={activePdfPage}
                              />
                            </label>
                            <span>/ {pdfPageInfo?.pageCount ?? "..."}</span>
                            <button
                              aria-label="Next PDF page"
                              disabled={Boolean(pdfPageInfo && activePdfPage >= pdfPageInfo.pageCount)}
                              onClick={() => setActivePdfPage((current) => Math.min(pdfPageInfo?.pageCount ?? current + 1, current + 1))}
                              type="button"
                            >
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
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
                  className={`annotation-stage${canAnnotate && canDrawOnRegionSource ? " drawing-enabled" : ""}${isPdfRegionWorkspace ? " pdf-region-stage" : ""}${panMode ? " pan-mode" : ""}${isPanning ? " panning" : ""}${activeEdit ? ` editing-region ${activeEdit.kind}` : ""}`}
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
                      dateTimeControls={dateTimeControls}
                      dateTimeResponses={dateTimeResponses}
                      numberControls={numberControls}
                      numberResponses={numberResponses}
                      onChoiceChange={setChoiceResponses}
                      onDateTimeChange={setDateTimeResponses}
                      onChange={setTextResponses}
                      onNumberChange={setNumberResponses}
                      onRatingChange={setRatingResponses}
                      onTemporalChange={setTemporalResponses}
                      ratingControls={ratingControls}
                      ratingResponses={ratingResponses}
                      responses={textResponses}
                      sources={templateSources}
                      sourceByName={templateSourceByName}
                      task={task}
                      temporalControls={temporalControls}
                      temporalResponses={temporalResponses}
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
                        {[...visibleShapes, ...(draftShape ? [draftShape] : [])].map((shape) => (
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
                  ) : isPdfRegionWorkspace && accessUrl ? (
                    <div
                      className="annotation-canvas pdf-annotation-canvas"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerLeave}
                      onDoubleClick={finishPolygon}
                      ref={annotationCanvasRef}
                      style={{
                        width: pdfCanvasWidth,
                        ...(pdfPageInfo ? { aspectRatio: `${pdfPageInfo.width} / ${pdfPageInfo.height}` } : {})
                      }}
                    >
                      <PdfPageCanvas
                        fileName={task.asset?.fileName ?? "PDF task asset"}
                        onPageInfo={setPdfPageInfo}
                        pageNumber={activePdfPage}
                        pdfUrl={accessUrl}
                      />
                      {ocrBlocks.length > 0 && (
                        <span className="pdf-ocr-status">{visibleOcrBlocks.length} OCR blocks</span>
                      )}
                      <svg
                        className="annotation-overlay"
                        preserveAspectRatio="none"
                        style={{ ["--annotation-stroke-width" as string]: `${regionBorderWidth}px` }}
                        viewBox="0 0 1 1"
                      >
                        {visibleOcrBlocks.map((block) => (
                          <g
                            className="ocr-overlay-block"
                            key={block.id}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              addOcrBlockRegion(block);
                            }}
                          >
                            <rect
                              height={block.height}
                              rx="0.004"
                              width={block.width}
                              x={block.x}
                              y={block.y}
                            />
                            <title>{block.text}</title>
                          </g>
                        ))}
                        {[...visibleShapes, ...(draftShape ? [draftShape] : [])].map((shape) => (
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
                <div className="task-inline-actions">
                  <div>
                    <p className="eyebrow">Actions</p>
                    {nextTaskError && <p className="form-error compact-error">{nextTaskError}</p>}
                  </div>
                  {task.canWork ? (
                    <div className="task-action-stack horizontal">
                      {nextAction && (
                        <button className="secondary-button" type="button" onClick={handleTaskAction} disabled={saving}>
                          <Eye size={17} />
                          {saving ? "Saving" : nextAction.label}
                        </button>
                      )}
                      <button className="secondary-button" type="button" onClick={handleSaveDraft} disabled={!canAnnotate || saving}>
                        <Save size={17} />
                        Save draft
                      </button>
                      <button className="secondary-button" type="button" onClick={handleGoToNextTask} disabled={saving || nextTaskLoading || !nextTask}>
                        <ArrowRight size={17} />
                        {nextTaskLoading ? "Finding next" : nextTask ? "Next task" : "No next task"}
                      </button>
                      <button className="primary-button" type="button" onClick={handleSubmitAnnotation} disabled={!canAnnotate || saving}>
                        <Send size={17} />
                        Submit annotation
                      </button>
                    </div>
                  ) : (
                    <p className="muted-copy">Read-only access. You can inspect this task but cannot submit annotations.</p>
                  )}
                </div>
              </section>
            </section>
            <aside className="side-column task-side-panel">
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
                          type="button"
                          onClick={() => setSelectedShapeId(shape.id)}
                          disabled={!canAnnotate}
                        >
                          <span>{index + 1}. {shape.label}</span>
                          <small>{shape.type === "POLYGON" ? `${shape.points?.length ?? 0} points` : `${Math.round((shape.width ?? 0) * 100)}% x ${Math.round((shape.height ?? 0) * 100)}%`}</small>
                          {isPdfRegionWorkspace && <small>Page {shape.page ?? 1}</small>}
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
              {task.status === "REJECTED" && latestRejectedReview ? (
                <section className="panel task-revision-panel">
                  <p className="eyebrow">Needs revision</p>
                  <strong>{latestRejectedReview.reviewer.name}</strong>
                  <small>{formatReviewMetadata(latestRejectedReview)}</small>
                  <span>{latestRejectedReview.feedback?.trim() || "Reviewer requested changes."}</span>
                  <small>{formatDateTime(latestRejectedReview.createdAt)}</small>
                </section>
              ) : null}
              {annotationVersionDiff ? (
                <section className="panel annotation-version-panel">
                  <p className="eyebrow">Version compare</p>
                  <strong>
                    v{annotationVersionDiff.previousVersion} to v{annotationVersionDiff.currentVersion}
                  </strong>
                  <div className="version-diff-grid">
                    <span>
                      <small>Regions</small>
                      <strong>{formatSignedCount(annotationVersionDiff.regionDelta)}</strong>
                    </span>
                    <span>
                      <small>Responses</small>
                      <strong>{formatSignedCount(annotationVersionDiff.responseDelta)}</strong>
                    </span>
                    <span>
                      <small>Status</small>
                      <strong>{formatEnum(annotationVersionDiff.currentStatus)}</strong>
                    </span>
                  </div>
                </section>
              ) : null}
              {canReviewTask && (
                <section className="panel task-review-panel">
                  <p className="eyebrow">Review decision</p>
                  <div className="review-meta-grid">
                    <label>
                      Score
                      <input
                        max="5"
                        min="1"
                        onChange={(event) => setReviewScore(event.currentTarget.value)}
                        placeholder="1-5"
                        type="number"
                        value={reviewScore}
                      />
                    </label>
                    <label>
                      Reason
                      <select onChange={(event) => setReviewReason(event.currentTarget.value)} value={reviewReason}>
                        <option value="">Choose reason</option>
                        {reviewReasonOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Severity
                      <select onChange={(event) => setReviewSeverity(event.currentTarget.value)} value={reviewSeverity}>
                        {reviewSeverityOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <textarea
                    className="review-feedback-input"
                    onChange={(event) => setReviewFeedback(event.currentTarget.value)}
                    placeholder="Feedback for the annotator..."
                    value={reviewFeedback}
                  />
                  <div className="task-action-stack">
                    <button className="primary-button" disabled={reviewSaving} onClick={() => void handleReviewDecision("approve")} type="button">
                      <CheckCircle2 size={17} />
                      {reviewSaving ? "Saving" : "Approve"}
                    </button>
                    <button className="secondary-button danger-button" disabled={reviewSaving} onClick={() => void handleReviewDecision("reject")} type="button">
                      <XCircle size={17} />
                      Send back
                    </button>
                  </div>
                </section>
              )}
              <section className="panel task-comments-panel">
                <div className="task-panel-title">
                  <p className="eyebrow">Comments</p>
                  <MessageSquare size={16} />
                </div>
                <div className="task-timeline-list">
                  {comments.length > 0 ? (
                    comments.map((comment) => (
                      <article className="task-timeline-item" key={comment.id}>
                        <strong>{comment.user.name}</strong>
                        <span>{comment.body}</span>
                        <small>{formatDateTime(comment.createdAt)}</small>
                      </article>
                    ))
                  ) : (
                    <span className="muted-copy">No comments yet.</span>
                  )}
                </div>
                {task.canWork && (
                  <div className="task-comment-form">
                    <textarea
                      onChange={(event) => setCommentBody(event.currentTarget.value)}
                      placeholder="Add a task comment..."
                      value={commentBody}
                    />
                    <button className="secondary-button compact-button" disabled={commentSaving || !commentBody.trim()} onClick={handleAddComment} type="button">
                      {commentSaving ? "Adding" : "Add comment"}
                    </button>
                  </div>
                )}
              </section>
              <section className="panel task-history-panel">
                <div className="task-panel-title">
                  <p className="eyebrow">History</p>
                  <History size={16} />
                </div>
                <div className="task-timeline-list">
                  {taskHistoryItems.map((item) => (
                    <article className="task-timeline-item" key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.body}</span>
                      <small>{item.meta}</small>
                      <small>{formatDateTime(item.timestamp)}</small>
                    </article>
                  ))}
                  {taskHistoryItems.length === 0 && <span className="muted-copy">No history yet.</span>}
                </div>
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
  dateTimeControls,
  dateTimeResponses,
  numberControls,
  numberResponses,
  onChoiceChange,
  onDateTimeChange,
  onChange,
  onNumberChange,
  onRatingChange,
  onTemporalChange,
  ratingControls,
  ratingResponses,
  responses,
  sourceByName,
  sources,
  task,
  temporalControls,
  temporalResponses,
  textAssetContent
}: {
  accessUrl: string | null;
  assetLoading: boolean;
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  controls: TextAreaControl[];
  dateTimeControls: DateTimeControl[];
  dateTimeResponses: Record<string, string>;
  numberControls: NumberControl[];
  numberResponses: Record<string, string>;
  onChoiceChange: (responses: Record<string, string[]>) => void;
  onDateTimeChange: (responses: Record<string, string>) => void;
  onChange: (responses: Record<string, string>) => void;
  onNumberChange: (responses: Record<string, string>) => void;
  onRatingChange: (responses: Record<string, number>) => void;
  onTemporalChange: (responses: Record<string, TemporalRegionResponse[]>) => void;
  ratingControls: RatingControl[];
  ratingResponses: Record<string, number>;
  responses: Record<string, string>;
  sourceByName: Map<string, TemplateSource>;
  sources: TemplateSource[];
  task: NonNullable<ReturnType<typeof useTask>["task"]>;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textAssetContent: string | null;
}) {
  const referencedSources = [...choiceControls, ...controls, ...numberControls, ...ratingControls, ...dateTimeControls, ...temporalControls]
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
              onAddTemporalRegion={(controlName, region) => {
                onTemporalChange({
                  ...temporalResponses,
                  [controlName]: [
                    ...(temporalResponses[controlName] ?? []),
                    {
                      ...region,
                      id: `temporal-${Date.now()}`
                    }
                  ]
                });
              }}
              source={source}
              task={task}
              temporalControls={temporalControls}
              temporalResponses={temporalResponses}
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
        {numberControls.map((control) => (
          <label className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <input
              max={control.max ?? undefined}
              min={control.min ?? undefined}
              onChange={(event) => {
                onNumberChange({
                  ...numberResponses,
                  [control.name]: event.target.value
                });
              }}
              type="number"
              value={numberResponses[control.name] ?? ""}
            />
          </label>
        ))}
        {ratingControls.map((control) => (
          <div className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <div className="template-rating-row">
              {Array.from({ length: control.maxRating }, (_, index) => index + 1).map((rating) => (
                <button
                  className={(ratingResponses[control.name] ?? 0) >= rating ? "template-rating active" : "template-rating"}
                  key={rating}
                  onClick={() => {
                    onRatingChange({
                      ...ratingResponses,
                      [control.name]: rating
                    });
                  }}
                  type="button"
                >
                  {rating}
                </button>
              ))}
            </div>
          </div>
        ))}
        {dateTimeControls.map((control) => (
          <label className="template-response-field compact-template-field" key={control.name}>
            <span>
              {formatControlName(control.name)}
              {control.required && <strong>Required</strong>}
            </span>
            <input
              onChange={(event) => {
                onDateTimeChange({
                  ...dateTimeResponses,
                  [control.name]: event.target.value
                });
              }}
              type="datetime-local"
              value={dateTimeResponses[control.name] ?? ""}
            />
          </label>
        ))}
        {temporalControls.map((control) => (
          <TemporalRegionEditor
            control={control}
            key={control.name}
            onChange={(regions) => {
              onTemporalChange({
                ...temporalResponses,
                [control.name]: regions
              });
            }}
            regions={temporalResponses[control.name] ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateSourcePreview({
  accessUrl,
  onAddTemporalRegion,
  source,
  task,
  temporalControls,
  temporalResponses,
  textAssetContent
}: {
  accessUrl: string | null;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  source: TemplateSource;
  task: NonNullable<ReturnType<typeof useTask>["task"]>;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textAssetContent: string | null;
}) {
  const sourceValue = getTemplateSourceValue(task, source, textAssetContent);
  const sourceTemporalControls = temporalControls.filter((control) => control.toName === source.name);

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

  if (source.type === "VIDEO") {
    const videoUrl = sourceValue || accessUrl;

    return (
      <VideoSourceCard
        fileName={task.asset?.fileName ?? source.name}
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
        videoUrl={videoUrl}
      />
    );
  }

  if (source.type === "AUDIO") {
    const audioUrl = sourceValue || accessUrl;

    return (
      <AudioSourceCard
        audioUrl={audioUrl}
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
    );
  }

  if (source.type === "PDF") {
    const pdfUrl = sourceValue || accessUrl;

    return (
      <PdfSourceCard
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        pdfUrl={pdfUrl}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
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

  if (source.type === "TIME_SERIES") {
    return (
      <TimeSeriesSourceCard
        name={source.name}
        onAddTemporalRegion={onAddTemporalRegion}
        sourceText={sourceValue || textAssetContent || ""}
        sourceUrl={accessUrl}
        temporalControls={sourceTemporalControls}
        temporalResponses={temporalResponses}
      />
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

function VideoSourceCard({
  fileName,
  name,
  onAddTemporalRegion,
  temporalControls,
  temporalResponses,
  videoUrl
}: {
  fileName: string;
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  videoUrl: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [segmentStart, setSegmentStart] = useState<number | null>(null);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      setSegmentStart(null);
      return;
    }

    if (nextControl.name !== activeControlName) {
      setActiveControlName(nextControl.name);
    }

    if (!nextControl.labels.some((label) => label.value === activeLabel)) {
      setActiveLabel(nextControl.labels[0]?.value ?? "");
    }
  }, [activeControlName, activeLabel, temporalControls]);

  function seekBy(seconds: number) {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.currentTime = Math.max(0, Math.min(duration || video.duration || 0, video.currentTime + seconds));
  }

  function updatePlaybackRate(nextRate: number) {
    const video = videoRef.current;
    setPlaybackRate(nextRate);

    if (video) {
      video.playbackRate = nextRate;
    }
  }

  function captureSegmentStart() {
    setSegmentStart(currentTime);
  }

  function addCurrentTimestamp() {
    if (!activeControl || !activeLabel) {
      return;
    }

    const timestamp = currentTime.toFixed(2);
    onAddTemporalRegion(activeControl.name, {
      end: timestamp,
      label: activeLabel,
      start: timestamp
    });
  }

  function addSegmentEnd() {
    if (!activeControl || !activeLabel || segmentStart === null) {
      return;
    }

    const start = Math.min(segmentStart, currentTime);
    const end = Math.max(segmentStart, currentTime);

    if (end - start < 0.01) {
      addCurrentTimestamp();
    } else {
      onAddTemporalRegion(activeControl.name, {
        end: end.toFixed(2),
        label: activeLabel,
        start: start.toFixed(2)
      });
    }

    setSegmentStart(null);
  }

  return (
    <div className="template-source-card media-source-card video-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>{fileName}</strong>
        </div>
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
      </div>
      {videoUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          <video
            controls
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            ref={videoRef}
            src={videoUrl}
          />
          <div className="media-control-row">
            <button className="secondary-button compact-button" onClick={() => seekBy(-1)} type="button">-1s</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1 / 30)} type="button">+1 frame</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1)} type="button">+1s</button>
            <button className="secondary-button compact-button" onClick={captureSegmentStart} disabled={!activeControl} type="button">Mark start</button>
            <button className="secondary-button compact-button" onClick={addSegmentEnd} disabled={!activeControl || segmentStart === null} type="button">
              {segmentStart === null ? "Mark end" : `End from ${formatMediaTime(segmentStart)}`}
            </button>
            <button className="secondary-button compact-button" onClick={addCurrentTimestamp} disabled={!activeControl} type="button">Add instant</button>
            <select value={playbackRate} onChange={(event) => updatePlaybackRate(Number(event.target.value))}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <a className="secondary-button compact-button" href={videoUrl} target="_blank" rel="noreferrer">Open source</a>
          </div>
        </>
      ) : (
        <p className="muted-copy">No video source is available.</p>
      )}
    </div>
  );
}

function AudioSourceCard({
  audioUrl,
  name,
  onAddTemporalRegion,
  temporalControls,
  temporalResponses
}: {
  audioUrl: string | null;
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [dragSelection, setDragSelection] = useState<{ end: number; start: number } | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const canSelectRange = Boolean(activeControl && duration > 0);
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      return;
    }

    if (nextControl.name !== activeControlName) {
      setActiveControlName(nextControl.name);
    }

    if (!nextControl.labels.some((label) => label.value === activeLabel)) {
      setActiveLabel(nextControl.labels[0]?.value ?? "");
    }
  }, [activeControlName, activeLabel, temporalControls]);

  function seekBy(seconds: number) {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, audio.currentTime + seconds));
  }

  function updatePlaybackRate(nextRate: number) {
    const audio = audioRef.current;
    setPlaybackRate(nextRate);

    if (audio) {
      audio.playbackRate = nextRate;
    }
  }

  function getWaveformPercent(event: PointerEvent<HTMLDivElement>) {
    const element = waveformRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
  }

  function handleWaveformPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canSelectRange) {
      return;
    }

    const percent = getWaveformPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection({ end: percent, start: percent });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleWaveformPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragSelection) {
      return;
    }

    const percent = getWaveformPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection((current) => current ? { ...current, end: percent } : current);
  }

  function handleWaveformPointerUp() {
    if (!dragSelection || !activeControl || !activeLabel || duration <= 0) {
      setDragSelection(null);
      return;
    }

    const startPercent = Math.min(dragSelection.start, dragSelection.end);
    const endPercent = Math.max(dragSelection.start, dragSelection.end);

    if (endPercent - startPercent >= 0.006) {
      onAddTemporalRegion(activeControl.name, {
        end: (endPercent * duration).toFixed(2),
        label: activeLabel,
        start: (startPercent * duration).toFixed(2)
      });
    }

    setDragSelection(null);
  }

  return (
    <div className="template-source-card media-source-card audio-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>Audio waveform workspace</strong>
        </div>
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
      </div>
      {audioUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          <div
            className={canSelectRange ? "audio-waveform-preview selectable" : "audio-waveform-preview"}
            onPointerDown={handleWaveformPointerDown}
            onPointerMove={handleWaveformPointerMove}
            onPointerUp={handleWaveformPointerUp}
            onPointerLeave={handleWaveformPointerUp}
            ref={waveformRef}
          >
            {Array.from({ length: 56 }, (_, index) => (
              <span key={index} style={{ height: `${22 + Math.round(Math.abs(Math.sin(index * 1.7)) * 44)}%` }} />
            ))}
            {dragSelection && (
              <div
                className="audio-waveform-selection"
                style={{
                  left: `${Math.min(dragSelection.start, dragSelection.end) * 100}%`,
                  width: `${Math.abs(dragSelection.end - dragSelection.start) * 100}%`
                }}
              />
            )}
          </div>
          <audio
            controls
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            ref={audioRef}
            src={audioUrl}
          />
          <div className="media-control-row">
            <button className="secondary-button compact-button" onClick={() => seekBy(-1)} type="button">-1s</button>
            <button className="secondary-button compact-button" onClick={() => seekBy(1)} type="button">+1s</button>
            <select value={playbackRate} onChange={(event) => updatePlaybackRate(Number(event.target.value))}>
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
            <a className="secondary-button compact-button" href={audioUrl} target="_blank" rel="noreferrer">Open source</a>
          </div>
        </>
      ) : (
        <p className="muted-copy">No audio source is available.</p>
      )}
    </div>
  );
}

function PdfSourceCard({
  name,
  onAddTemporalRegion,
  pdfUrl,
  temporalControls,
  temporalResponses
}: {
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  pdfUrl: string | null;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [activePage, setActivePage] = useState(1);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      return;
    }

    if (nextControl.name !== activeControlName) {
      setActiveControlName(nextControl.name);
    }

    if (!nextControl.labels.some((label) => label.value === activeLabel)) {
      setActiveLabel(nextControl.labels[0]?.value ?? "");
    }
  }, [activeControlName, activeLabel, temporalControls]);

  function addPageMarker() {
    if (!activeControl || !activeLabel) {
      return;
    }

    const page = Math.max(1, Math.round(activePage));
    onAddTemporalRegion(activeControl.name, {
      end: String(page),
      label: activeLabel,
      page,
      start: String(page)
    });
  }

  return (
    <div className="template-source-card pdf-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>Document workspace</strong>
        </div>
        {pdfUrl && (
          <a className="secondary-button compact-button" href={pdfUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}
      </div>
      {pdfUrl ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          {activeControl && (
            <div className="pdf-page-marker-controls">
              <label>
                Page
                <input
                  min={1}
                  onChange={(event) => setActivePage(Number(event.target.value))}
                  type="number"
                  value={activePage}
                />
              </label>
              <button className="secondary-button compact-button" onClick={addPageMarker} type="button">Add page marker</button>
            </div>
          )}
          <iframe src={pdfUrl} title={name} />
        </>
      ) : (
        <p className="muted-copy">No PDF source is available.</p>
      )}
    </div>
  );
}

function TimeSeriesSourceCard({
  name,
  onAddTemporalRegion,
  sourceText,
  sourceUrl,
  temporalControls,
  temporalResponses
}: {
  name: string;
  onAddTemporalRegion: (controlName: string, region: Omit<TemporalRegionResponse, "id">) => void;
  sourceText: string;
  sourceUrl: string | null;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [activeControlName, setActiveControlName] = useState(temporalControls[0]?.name ?? "");
  const [activeLabel, setActiveLabel] = useState(temporalControls[0]?.labels[0]?.value ?? "");
  const [dragSelection, setDragSelection] = useState<{ end: number; start: number } | null>(null);
  const preview = buildTimeSeriesPreview(sourceText);
  const activeControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;
  const canSelectRange = Boolean(activeControl && preview && preview.rows.length > 0);
  const selectedRegionCount = activeControl ? temporalResponses[activeControl.name]?.length ?? 0 : 0;

  useEffect(() => {
    const nextControl = temporalControls.find((control) => control.name === activeControlName) ?? temporalControls[0] ?? null;

    if (!nextControl) {
      setActiveControlName("");
      setActiveLabel("");
      return;
    }

    if (nextControl.name !== activeControlName) {
      setActiveControlName(nextControl.name);
    }

    if (!nextControl.labels.some((label) => label.value === activeLabel)) {
      setActiveLabel(nextControl.labels[0]?.value ?? "");
    }
  }, [activeControlName, activeLabel, temporalControls]);

  function getChartPercent(event: PointerEvent<HTMLDivElement>) {
    const element = chartRef.current;

    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / Math.max(rect.width, 1));
  }

  function handleChartPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canSelectRange) {
      return;
    }

    const percent = getChartPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection({ end: percent, start: percent });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleChartPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragSelection) {
      return;
    }

    const percent = getChartPercent(event);

    if (percent === null) {
      return;
    }

    setDragSelection((current) => current ? { ...current, end: percent } : current);
  }

  function handleChartPointerUp() {
    if (!dragSelection || !activeControl || !activeLabel || !preview) {
      setDragSelection(null);
      return;
    }

    const startPercent = Math.min(dragSelection.start, dragSelection.end);
    const endPercent = Math.max(dragSelection.start, dragSelection.end);
    const startIndex = getTimeSeriesRowIndex(startPercent, preview.rows.length);
    const endIndex = getTimeSeriesRowIndex(endPercent, preview.rows.length);
    const startRow = preview.rows[Math.min(startIndex, endIndex)];
    const endRow = preview.rows[Math.max(startIndex, endIndex)];

    if (startRow && endRow) {
      onAddTemporalRegion(activeControl.name, {
        end: endRow.label,
        label: activeLabel,
        start: startRow.label
      });
    }

    setDragSelection(null);
  }

  return (
    <div className="template-source-card time-series-source-card">
      <div className="template-source-head">
        <div>
          <p className="eyebrow">{name}</p>
          <strong>{preview ? preview.valueColumn : "Time series workspace"}</strong>
        </div>
        {sourceUrl && (
          <a className="secondary-button compact-button" href={sourceUrl} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}
      </div>
      {preview ? (
        <>
          <TemporalSourceControls
            activeControlName={activeControlName}
            activeLabel={activeLabel}
            controls={temporalControls}
            onControlChange={setActiveControlName}
            onLabelChange={setActiveLabel}
            regionCount={selectedRegionCount}
          />
          <div
            className={canSelectRange ? "time-series-chart-wrap selectable" : "time-series-chart-wrap"}
            onPointerDown={handleChartPointerDown}
            onPointerMove={handleChartPointerMove}
            onPointerUp={handleChartPointerUp}
            onPointerLeave={handleChartPointerUp}
            ref={chartRef}
          >
            <svg className="time-series-chart" preserveAspectRatio="none" viewBox="0 0 100 42">
              <polyline points={preview.polyline} />
            </svg>
            {dragSelection && (
              <div
                className="time-series-selection"
                style={{
                  left: `${Math.min(dragSelection.start, dragSelection.end) * 100}%`,
                  width: `${Math.abs(dragSelection.end - dragSelection.start) * 100}%`
                }}
              />
            )}
          </div>
          <div className="time-series-table">
            {preview.rows.slice(0, 8).map((row, index) => (
              <div key={`${row.label}-${index}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-source-card">
          <div>{sourceText || "No inline time series data is available. Open the source file to inspect it."}</div>
        </div>
      )}
    </div>
  );
}

function TemporalSourceControls({
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

function TemporalRegionEditor({
  control,
  onChange,
  regions
}: {
  control: TemporalLabelControl;
  onChange: (regions: TemporalRegionResponse[]) => void;
  regions: TemporalRegionResponse[];
}) {
  const firstLabel = control.labels[0]?.value ?? "Region";
  const [draftLabel, setDraftLabel] = useState(firstLabel);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const isTimeSeries = control.type === "timeserieslabels";

  function addRegion() {
    const start = draftStart.trim();
    const end = (draftEnd.trim() || start).trim();

    if (!start || !end) {
      return;
    }

    onChange([
      ...regions,
      {
        end,
        id: `temporal-${Date.now()}`,
        label: draftLabel || firstLabel,
        start
      }
    ]);
    setDraftStart("");
    setDraftEnd("");
  }

  return (
    <div className="template-response-field temporal-region-editor">
      <span>
        {formatControlName(control.name)}
        {control.required && <strong>Required</strong>}
      </span>
      <div className="temporal-region-form">
        <label>
          Label
          <select value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)}>
            {control.labels.map((label) => (
              <option key={label.value} value={label.value}>{label.value}</option>
            ))}
          </select>
        </label>
        <label>
          Start
          <input
            placeholder={isTimeSeries ? "2020-01-05 00:00:00" : "0.00"}
            value={draftStart}
            onChange={(event) => setDraftStart(event.target.value)}
          />
        </label>
        <label>
          End
          <input
            placeholder={isTimeSeries ? "2020-01-19 00:00:00" : "3.50"}
            value={draftEnd}
            onChange={(event) => setDraftEnd(event.target.value)}
          />
        </label>
        <button className="secondary-button compact-button" onClick={addRegion} type="button">Add region</button>
      </div>
      <div className="temporal-region-list">
        {regions.length > 0 ? regions.map((region, index) => (
          <div key={region.id}>
            <strong>{index + 1}. {region.label}</strong>
            <span>{region.start} to {region.end}</span>
            <button
              aria-label={`Delete ${region.label} region ${index + 1}`}
              className="annotation-region-delete"
              onClick={() => onChange(regions.filter((item) => item.id !== region.id))}
              title="Delete region"
              type="button"
            >
              <Trash2 size={15} />
            </button>
          </div>
        )) : (
          <small className="muted-copy">Add time spans or instants for this source.</small>
        )}
      </div>
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

function PdfPageCanvas({
  fileName,
  onPageInfo,
  pageNumber,
  pdfUrl
}: {
  fileName: string;
  onPageInfo: (info: PdfPageInfo) => void;
  pageNumber: number;
  pdfUrl: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: { destroy: () => Promise<void> } | null = null;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderPage() {
      setError(null);
      setLoading(true);

      try {
        const [pdfjs, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.mjs?url")
        ]);

        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const nextLoadingTask = pdfjs.getDocument({ url: pdfUrl });
        loadingTask = nextLoadingTask;
        const document = await nextLoadingTask.promise;
        const safePageNumber = Math.max(1, Math.min(document.numPages, pageNumber));
        const page = await document.getPage(safePageNumber);
        const baseViewport = page.getViewport({ scale: 1 });

        if (cancelled) {
          return;
        }

        onPageInfo({
          height: baseViewport.height,
          pageCount: document.numPages,
          width: baseViewport.width
        });

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");

        if (!canvas || !context) {
          return;
        }

        const deviceScale = Math.max(1.5, Math.min(window.devicePixelRatio || 1, 3));
        const viewport = page.getViewport({ scale: deviceScale });

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport
        });

        await renderTask.promise;

        if (!cancelled) {
          setLoading(false);
        }
      } catch (reason) {
        if (!cancelled && reason instanceof Error && reason.name !== "RenderingCancelledException") {
          setError(reason.message || "Unable to render PDF page.");
          setLoading(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, [onPageInfo, pageNumber, pdfUrl]);

  return (
    <>
      <canvas aria-label={fileName} ref={canvasRef} />
      {loading && <span className="pdf-render-status">Rendering page...</span>}
      {error && <span className="pdf-render-status error">{error}</span>}
    </>
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

function parseNumberControls(configCode: string): NumberControl[] {
  const controls: NumberControl[] = [];
  const numberPattern = /<Number\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = numberPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      max: parseFiniteNumber(getXmlAttribute(attributes, "max")),
      min: parseFiniteNumber(getXmlAttribute(attributes, "min")),
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function parseRatingControls(configCode: string): RatingControl[] {
  const controls: RatingControl[] = [];
  const ratingPattern = /<Rating\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = ratingPattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      maxRating: Math.max(2, Math.min(10, parsePositiveInteger(getXmlAttribute(attributes, "maxRating")) ?? 5)),
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function parseDateTimeControls(configCode: string): DateTimeControl[] {
  const controls: DateTimeControl[] = [];
  const datePattern = /<DateTime\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = datePattern.exec(configCode))) {
    const attributes = match[1] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    controls.push({
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName
    });
  }

  return controls;
}

function parseTemporalLabelControls(configCode: string): TemporalLabelControl[] {
  const controls: TemporalLabelControl[] = [];
  const labelsPattern = /<(Labels|TimeSeriesLabels)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = labelsPattern.exec(configCode))) {
    const tagName = match[1];
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const name = getXmlAttribute(attributes, "name");
    const toName = getXmlAttribute(attributes, "toName");

    if (!name || !toName) {
      continue;
    }

    const labels = parseLabelValues(body);

    if (labels.length === 0) {
      continue;
    }

    controls.push({
      labels,
      name,
      required: getXmlAttribute(attributes, "required") === "true",
      toName,
      type: tagName === "TimeSeriesLabels" ? "timeserieslabels" : "labels"
    });
  }

  return controls;
}

function parseRegionDrawingTools(configCode: string): Array<"BBOX" | "POLYGON"> {
  const tools: Array<"BBOX" | "POLYGON"> = [];

  if (/<(?:RectangleLabels|Rectangle|OcrLabels)\b/i.test(configCode)) {
    tools.push("BBOX");
  }

  if (/<(?:PolygonLabels|Polygon)\b/i.test(configCode)) {
    tools.push("POLYGON");
  }

  return tools;
}

function dedupeDrawingTools(tools: Array<"BBOX" | "POLYGON">): Array<"BBOX" | "POLYGON"> {
  const seen = new Set<string>();
  const deduped: Array<"BBOX" | "POLYGON"> = [];

  tools.forEach((tool) => {
    if (seen.has(tool)) {
      return;
    }

    seen.add(tool);
    deduped.push(tool);
  });

  return deduped;
}

function parseLabelValues(body: string): TemporalLabelControl["labels"] {
  const labels: TemporalLabelControl["labels"] = [];
  const labelPattern = /<Label\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = labelPattern.exec(body))) {
    const attributes = match[1] ?? "";
    const value = getXmlAttribute(attributes, "value");

    if (!value) {
      continue;
    }

    labels.push({
      color: getXmlAttribute(attributes, "background") ?? getXmlAttribute(attributes, "valueColor"),
      value
    });
  }

  return labels;
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

function parseFiniteNumber(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function annotationToScalarResponses(annotation: AnnotationSummary | null, valueKey: "datetime" | "number"): Record<string, string> {
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

    const rawValue = (value as Record<string, unknown>)[valueKey];

    if (typeof rawValue === "string") {
      responses[fromName] = rawValue;
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      responses[fromName] = String(rawValue);
    }
  });

  return responses;
}

function annotationToRatingResponses(annotation: AnnotationSummary | null): Record<string, number> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, number> = {};

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

    const ratingValue = (value as Record<string, unknown>).rating;

    if (typeof ratingValue === "number" && Number.isFinite(ratingValue)) {
      responses[fromName] = ratingValue;
    }
  });

  return responses;
}

function annotationToTemporalResponses(annotation: AnnotationSummary | null): Record<string, TemporalRegionResponse[]> {
  if (!annotation?.resultJson || !Array.isArray(annotation.resultJson.results)) {
    return {};
  }

  const responses: Record<string, TemporalRegionResponse[]> = {};

  annotation.resultJson.results.forEach((rawResult, index) => {
    if (!rawResult || typeof rawResult !== "object") {
      return;
    }

    const result = rawResult as Record<string, unknown>;
    const fromName = typeof result.from_name === "string" ? result.from_name : typeof result.fromName === "string" ? result.fromName : null;
    const value = result.value;

    if (!fromName || !value || typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const rawLabelList = Array.isArray(record.labels) ? record.labels : Array.isArray(record.timeserieslabels) ? record.timeserieslabels : null;
    const rawLabel = rawLabelList?.find((item): item is string => typeof item === "string");
    const start = record.start;
    const end = record.end;

    if (!rawLabel || (typeof start !== "string" && typeof start !== "number") || (typeof end !== "string" && typeof end !== "number")) {
      return;
    }

    responses[fromName] = [
      ...(responses[fromName] ?? []),
      {
        end: String(end),
        id: typeof result.id === "string" ? result.id : `${fromName}-${index}`,
        label: rawLabel,
        start: String(start)
      }
    ];
  });

  return responses;
}

function formResponsesToResults({
  choiceControls,
  choiceResponses,
  dateTimeControls,
  dateTimeResponses,
  numberControls,
  numberResponses,
  ratingControls,
  ratingResponses,
  temporalControls,
  temporalResponses,
  textControls,
  textResponses
}: {
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  dateTimeControls: DateTimeControl[];
  dateTimeResponses: Record<string, string>;
  numberControls: NumberControl[];
  numberResponses: Record<string, string>;
  ratingControls: RatingControl[];
  ratingResponses: Record<string, number>;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textControls: TextAreaControl[];
  textResponses: Record<string, string>;
}): SaveAnnotationInput["results"] {
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

  const numberResults = numberControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "number",
      value: {
        number: Number(numberResponses[control.name])
      }
    }))
    .filter((result) => Number.isFinite(result.value.number));

  const ratingResults = ratingControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "rating",
      value: {
        rating: ratingResponses[control.name]
      }
    }))
    .filter((result) => typeof result.value.rating === "number" && Number.isFinite(result.value.rating));

  const dateTimeResults = dateTimeControls
    .map((control) => ({
      fromName: control.name,
      toName: control.toName,
      type: "datetime",
      value: {
        datetime: (dateTimeResponses[control.name] ?? "").trim()
      }
    }))
    .filter((result) => result.value.datetime.length > 0);

  const temporalResults = temporalControls.flatMap((control) =>
    (temporalResponses[control.name] ?? []).map((region) => ({
      fromName: control.name,
      toName: control.toName,
      type: control.type,
      value:
        control.type === "timeserieslabels"
          ? {
              end: region.end,
              instant: region.start === region.end,
              ...(region.page ? { page: region.page } : {}),
              start: region.start,
              timeserieslabels: [region.label]
            }
          : {
              end: Number(region.end),
              labels: [region.label],
              ...(region.page ? { page: region.page } : {}),
              start: Number(region.start)
            }
    }))
  ).filter((result) => {
    if (result.type === "timeserieslabels") {
      return typeof result.value.start === "string" && result.value.start.length > 0 && typeof result.value.end === "string" && result.value.end.length > 0;
    }

    return (
      Number.isFinite(result.value.start) &&
      Number.isFinite(result.value.end) &&
      result.value.end >= result.value.start &&
      (!("page" in result.value) || Number.isFinite(result.value.page))
    );
  });

  return [...choiceResults, ...textResults, ...numberResults, ...ratingResults, ...dateTimeResults, ...temporalResults];
}

function toggleChoiceValue(current: string[], value: string, mode: ChoiceControl["choice"]) {
  if (mode === "single") {
    return current.includes(value) ? [] : [value];
  }

  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function hasControlResponse(
  control: TemplateFormControl,
  textResponses: Record<string, string>,
  choiceResponses: Record<string, string[]>,
  numberResponses: Record<string, string>,
  ratingResponses: Record<string, number>,
  dateTimeResponses: Record<string, string>,
  temporalResponses: Record<string, TemporalRegionResponse[]>
) {
  if ("choices" in control) {
    return (choiceResponses[control.name]?.length ?? 0) > 0;
  }

  if ("labels" in control) {
    return (temporalResponses[control.name]?.length ?? 0) > 0;
  }

  if ("maxRating" in control) {
    return Boolean(ratingResponses[control.name]);
  }

  if ("min" in control) {
    return Boolean(numberResponses[control.name]?.trim());
  }

  if (!("placeholder" in control)) {
    return Boolean(dateTimeResponses[control.name]?.trim());
  }

  return Boolean(textResponses[control.name]?.trim());
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

function extractOcrBlocks(task: TaskSummary | null | undefined, pageInfo: PdfPageInfo | null, defaultSourceName: string): OcrBlock[] {
  if (!task) {
    return [];
  }

  const roots = [
    task.metadata,
    isRecord(task.metadata) ? task.metadata.data : null,
    task.asset?.metadata,
    isRecord(task.asset?.metadata) ? task.asset.metadata.data : null
  ].filter(isRecord);
  const blocks: OcrBlock[] = [];
  const seen = new Set<string>();

  roots.forEach((root) => {
    collectOcrBlocks(root, {
      blocks,
      defaultSourceName,
      pageInfo,
      seen
    });
  });

  return blocks;
}

function collectOcrBlocks(
  value: unknown,
  context: {
    blocks: OcrBlock[];
    defaultSourceName: string;
    fallbackHeight?: number;
    fallbackPage?: number;
    fallbackWidth?: number;
    pageInfo: PdfPageInfo | null;
    seen: Set<string>;
  },
  depth = 0
) {
  if (!isRecord(value) || depth > 3) {
    return;
  }

  const page = getOcrPage(value, context.fallbackPage);
  const dimensions = getOcrDimensions(value, context.fallbackWidth, context.fallbackHeight);
  const candidate = normalizeOcrBlock(value, {
    defaultSourceName: context.defaultSourceName,
    fallbackHeight: dimensions.height,
    fallbackPage: page,
    fallbackWidth: dimensions.width,
    index: context.blocks.length,
    pageInfo: context.pageInfo
  });

  if (candidate) {
    const key = `${candidate.page}:${candidate.x}:${candidate.y}:${candidate.width}:${candidate.height}:${candidate.text}`;

    if (!context.seen.has(key)) {
      context.seen.add(key);
      context.blocks.push(candidate);
    }
  }

  const pages = value.pages;

  if (Array.isArray(pages)) {
    pages.forEach((pageValue, pageIndex) => {
      if (isRecord(pageValue)) {
        const pageNumber = getOcrPage(pageValue, pageIndex + 1);
        const pageDimensions = getOcrDimensions(pageValue, dimensions.width, dimensions.height);
        collectOcrBlocks(pageValue, {
          ...context,
          fallbackHeight: pageDimensions.height,
          fallbackPage: pageNumber,
          fallbackWidth: pageDimensions.width
        }, depth + 1);
      }
    });
  }

  for (const key of ["ocr", "ocrBlocks", "textBlocks", "blocks", "lines", "words", "tokens"]) {
    const list = value[key];

    if (!Array.isArray(list)) {
      continue;
    }

    list.forEach((item, index) => {
      if (isRecord(item)) {
        const nestedPage = getOcrPage(item, page);
        const nestedDimensions = getOcrDimensions(item, dimensions.width, dimensions.height);
        const block = normalizeOcrBlock(item, {
          defaultSourceName: context.defaultSourceName,
          fallbackHeight: nestedDimensions.height,
          fallbackPage: nestedPage,
          fallbackWidth: nestedDimensions.width,
          index,
          pageInfo: context.pageInfo
        });

        if (!block) {
          collectOcrBlocks(item, {
            ...context,
            fallbackHeight: nestedDimensions.height,
            fallbackPage: nestedPage,
            fallbackWidth: nestedDimensions.width
          }, depth + 1);
          return;
        }

        const dedupeKey = `${block.page}:${block.x}:${block.y}:${block.width}:${block.height}:${block.text}`;

        if (!context.seen.has(dedupeKey)) {
          context.seen.add(dedupeKey);
          context.blocks.push(block);
        }
      }
    });
  }
}

function normalizeOcrBlock(
  value: Record<string, unknown>,
  options: {
    defaultSourceName: string;
    fallbackHeight?: number;
    fallbackPage?: number;
    fallbackWidth?: number;
    index: number;
    pageInfo: PdfPageInfo | null;
  }
): OcrBlock | null {
  const text = getOcrText(value);
  const bounds = normalizeOcrBounds(value, options);

  if (!text || !bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const page = getOcrPage(value, options.fallbackPage) ?? 1;
  const sourceName = getStringValue(value.sourceName) ?? getStringValue(value.source_name) ?? options.defaultSourceName;
  const id = getStringValue(value.id) ?? getStringValue(value.blockId) ?? getStringValue(value.block_id) ?? `${page}-${options.index}-${bounds.x}-${bounds.y}`;

  return {
    height: bounds.height,
    id,
    page,
    sourceName,
    text,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y
  };
}

function getOcrText(value: Record<string, unknown>) {
  for (const key of ["text", "value", "content", "word"]) {
    const text = getStringValue(value[key]);

    if (text?.trim()) {
      return text.trim();
    }
  }

  return null;
}

function getOcrPage(value: Record<string, unknown>, fallback?: number) {
  const rawPage = value.page ?? value.pageNumber ?? value.page_number;
  const page = typeof rawPage === "number" && Number.isFinite(rawPage) ? Math.floor(rawPage) : null;

  if (page && page > 0) {
    return page;
  }

  const rawPageIndex = value.pageIndex ?? value.page_index;
  const pageIndex = typeof rawPageIndex === "number" && Number.isFinite(rawPageIndex) ? Math.floor(rawPageIndex) : null;

  if (pageIndex !== null && pageIndex >= 0) {
    return pageIndex + 1;
  }

  return fallback;
}

function getOcrDimensions(value: Record<string, unknown>, fallbackWidth?: number, fallbackHeight?: number) {
  return {
    height: getNumberValue(value.pageHeight ?? value.page_height ?? value.originalHeight ?? value.original_height ?? value.imageHeight ?? value.image_height) ?? fallbackHeight,
    width: getNumberValue(value.pageWidth ?? value.page_width ?? value.originalWidth ?? value.original_width ?? value.imageWidth ?? value.image_width) ?? fallbackWidth
  };
}

function normalizeOcrBounds(
  value: Record<string, unknown>,
  options: {
    fallbackHeight?: number;
    fallbackWidth?: number;
    pageInfo: PdfPageInfo | null;
  }
) {
  const dimensions = {
    height: options.fallbackHeight ?? options.pageInfo?.height,
    width: options.fallbackWidth ?? options.pageInfo?.width
  };
  const geometry = isRecord(value.geometry) ? value.geometry : value;
  const objectBox = getObjectOcrBox(geometry, dimensions);

  if (objectBox) {
    return objectBox;
  }

  const boxValue = value.bbox ?? value.boundingBox ?? value.bounding_box ?? value.box;

  if (Array.isArray(boxValue)) {
    return normalizeOcrBoxArray(boxValue, dimensions);
  }

  if (isRecord(boxValue)) {
    return getObjectOcrBox(boxValue, dimensions);
  }

  return null;
}

function getObjectOcrBox(value: Record<string, unknown>, dimensions: { height?: number; width?: number }) {
  const x = getNumberValue(value.x);
  const y = getNumberValue(value.y);
  const width = getNumberValue(value.width);
  const height = getNumberValue(value.height);

  if (x !== null && y !== null && width !== null && height !== null) {
    return normalizeOcrBoxNumbers(x, y, width, height, dimensions, "xywh");
  }

  const left = getNumberValue(value.left ?? value.xmin ?? value.minX);
  const top = getNumberValue(value.top ?? value.ymin ?? value.minY);
  const right = getNumberValue(value.right ?? value.xmax ?? value.maxX);
  const bottom = getNumberValue(value.bottom ?? value.ymax ?? value.maxY);

  if (left !== null && top !== null && right !== null && bottom !== null) {
    return normalizeOcrBoxNumbers(left, top, right, bottom, dimensions, "xyxy");
  }

  return null;
}

function normalizeOcrBoxArray(value: unknown[], dimensions: { height?: number; width?: number }) {
  const numbers = value.map(getNumberValue).filter((number): number is number => number !== null);

  if (numbers.length >= 8) {
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    return normalizeOcrBoxNumbers(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), dimensions, "xyxy");
  }

  if (numbers.length >= 4) {
    const [x, y, third, fourth] = numbers;
    const allUnit = [x, y, third, fourth].every((number) => number >= 0 && number <= 1);
    const preferXyxy = !allUnit && dimensions.width && dimensions.height && third > x && fourth > y && (x + third > dimensions.width || y + fourth > dimensions.height);

    return normalizeOcrBoxNumbers(x, y, third, fourth, dimensions, preferXyxy ? "xyxy" : "xywh");
  }

  return null;
}

function normalizeOcrBoxNumbers(
  x: number,
  y: number,
  third: number,
  fourth: number,
  dimensions: { height?: number; width?: number },
  mode: "xywh" | "xyxy"
) {
  const left = x;
  const top = y;
  const width = mode === "xyxy" ? third - x : third;
  const height = mode === "xyxy" ? fourth - y : fourth;
  const allUnit = [left, top, width, height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1);

  if (allUnit) {
    return {
      height: Math.max(0, Math.min(1 - clamp(top), height)),
      width: Math.max(0, Math.min(1 - clamp(left), width)),
      x: clamp(left),
      y: clamp(top)
    };
  }

  if (!dimensions.width || !dimensions.height || dimensions.width <= 0 || dimensions.height <= 0) {
    return null;
  }

  return {
    height: Math.max(0, Math.min(1 - clamp(top / dimensions.height), height / dimensions.height)),
    width: Math.max(0, Math.min(1 - clamp(left / dimensions.width), width / dimensions.width)),
    x: clamp(left / dimensions.width),
    y: clamp(top / dimensions.height)
  };
}

function getNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
        ocrBlockId: geometry.ocrBlockId,
        page: geometry.page,
        points: geometry.points,
        sourceName: geometry.sourceName,
        text: geometry.text,
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
      ocrBlockId: geometry.ocrBlockId,
      page: geometry.page,
      sourceName: geometry.sourceName,
      text: geometry.text,
      type: "BBOX",
      width: geometry.width,
      x: geometry.x,
      y: geometry.y
    });
  });

  return shapes;
}

function cloneShapes(shapes: AnnotationShape[]): AnnotationShape[] {
  return shapes.map((shape) => ({
    ...shape,
    points: shape.points?.map((point) => ({ ...point }))
  }));
}

function areShapesEqual(first: AnnotationShape[], second: AnnotationShape[]) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function isBoxGeometry(value: unknown): value is { height: number; ocrBlockId?: string; page?: number; sourceName?: string; text?: string; width: number; x: number; y: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const geometry = value as Record<string, unknown>;
  return ["height", "width", "x", "y"].every((key) => typeof geometry[key] === "number");
}

function isPolygonGeometry(value: unknown): value is { ocrBlockId?: string; page?: number; points: Point[]; sourceName?: string; text?: string } {
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
              ...(shape.ocrBlockId ? { ocrBlockId: shape.ocrBlockId } : {}),
              ...(shape.page ? { page: shape.page } : {}),
              points: shape.points ?? [],
              ...(shape.sourceName ? { sourceName: shape.sourceName } : {}),
              ...(shape.text ? { text: shape.text } : {})
            }
          : {
              height: shape.height ?? 0,
              ...(shape.ocrBlockId ? { ocrBlockId: shape.ocrBlockId } : {}),
              ...(shape.page ? { page: shape.page } : {}),
              ...(shape.sourceName ? { sourceName: shape.sourceName } : {}),
              ...(shape.text ? { text: shape.text } : {}),
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
  const baseWidth = Math.min(cappedWidth, availableHeight * aspectRatio);

  return `${Math.max(260, Math.round(baseWidth * zoom))}px`;
}

function getPdfCanvasWidth({
  fullscreen,
  pageInfo,
  stageSize,
  zoom
}: {
  fullscreen: boolean;
  pageInfo: PdfPageInfo | null;
  stageSize: { height: number; width: number };
  zoom: number;
}) {
  if (stageSize.width <= 0 || stageSize.height <= 0) {
    return "100%";
  }

  const availableWidth = Math.max(320, stageSize.width - 24);
  const availableHeight = Math.max(360, stageSize.height - 24);
  const pageAspectRatio = pageInfo ? pageInfo.width / pageInfo.height : 8.5 / 11;
  const cappedWidth = fullscreen ? availableWidth : Math.min(availableWidth, 960);
  const baseWidth = Math.min(cappedWidth, availableHeight * pageAspectRatio);

  return `${Math.max(300, Math.round(baseWidth * zoom))}px`;
}

function pointsToSvg(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getShortcutKey(index: number) {
  return index >= 0 && index < 9 ? String(index + 1) : undefined;
}

function getTaskQueueLink(
  queueQuery: { datasetId: string | null; filters: ResolvedTaskQueueFilters; page: string | null; projectId: string | null; queue: string | null },
  task: TaskSummary | null | undefined
) {
  const params = new URLSearchParams();
  const projectId = queueQuery.projectId ?? task?.projectId ?? null;
  const datasetId = queueQuery.datasetId ?? task?.datasetId ?? null;

  if (projectId) {
    params.set("projectId", projectId);
  }

  if (datasetId) {
    params.set("datasetId", datasetId);
  }

  if (datasetId && queueQuery.page) {
    params.set("page", queueQuery.page);
  }

  if (queueQuery.queue === "review") {
    params.set("queue", "review");
  }

  appendQueueFiltersToParams(params, queueQuery.filters);

  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

function getTaskDetailSearch(
  queueQuery: { datasetId: string | null; filters: ResolvedTaskQueueFilters; page: string | null; projectId: string | null; queue: string | null },
  task: TaskSummary
) {
  const params = new URLSearchParams();
  const projectId = queueQuery.projectId ?? task.projectId;
  const datasetId = queueQuery.datasetId ?? task.datasetId;

  params.set("projectId", projectId);

  if (datasetId) {
    params.set("datasetId", datasetId);
  }

  if (queueQuery.page) {
    params.set("page", queueQuery.page);
  }

  if (queueQuery.queue === "review") {
    params.set("queue", "review");
  }

  appendQueueFiltersToParams(params, queueQuery.filters);

  const query = params.toString();
  return query ? `?${query}` : "";
}

function getQueueFilters(params: URLSearchParams): ResolvedTaskQueueFilters {
  const assignment = params.get("assignment");
  const due = params.get("due");
  const minPriority = Number(params.get("minPriority"));

  return {
    assignment: assignment === "mine" || assignment === "unassigned" ? assignment : "all",
    due: due === "overdue" || due === "soon" || due === "none" ? due : "any",
    minPriority: Number.isInteger(minPriority) && minPriority >= 0 && minPriority <= 10 ? minPriority : undefined,
    search: params.get("search") ?? "",
    status: params.get("status") ?? ""
  };
}

function appendQueueFiltersToParams(params: URLSearchParams, filters: ResolvedTaskQueueFilters) {
  if (filters.assignment !== "all") {
    params.set("assignment", filters.assignment);
  }

  if (filters.due !== "any") {
    params.set("due", filters.due);
  }

  if (filters.minPriority !== undefined) {
    params.set("minPriority", String(filters.minPriority));
  }

  if (filters.search) {
    params.set("search", filters.search);
  }

  if (filters.status) {
    params.set("status", filters.status);
  }
}

function buildTaskHistoryItems(annotationHistory: AnnotationSummary[], reviews: ReviewSummary[]): TaskHistoryItem[] {
  const annotationItems = annotationHistory.map((item) => ({
    body: `${formatEnum(item.status)} by ${item.user.name}`,
    id: `annotation-${item.id}`,
    meta: item.submittedAt ? "Submitted annotation" : "Draft saved",
    timestamp: item.updatedAt,
    title: `Annotation v${item.version}`
  }));
  const reviewItems = reviews.map((review) => ({
    body: review.feedback?.trim() || `Reviewed by ${review.reviewer.name}`,
    id: `review-${review.id}`,
    meta: `Annotation v${review.annotation.version}`,
    timestamp: review.createdAt,
    title: formatEnum(review.status)
  }));

  return [...annotationItems, ...reviewItems].sort(
    (first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime()
  );
}

function formatReviewMetadata(review: ReviewSummary) {
  const metadata = isRecord(review.metadata) ? review.metadata : {};
  const details = [
    review.score ? `Score ${review.score}/5` : null,
    typeof metadata.reason === "string" ? formatEnum(metadata.reason) : null,
    typeof metadata.severity === "string" ? formatEnum(metadata.severity) : null
  ].filter(Boolean);

  return details.length > 0 ? details.join(" - ") : "Review feedback";
}

function buildAnnotationVersionDiff(annotationHistory: AnnotationSummary[]) {
  if (annotationHistory.length < 2) {
    return null;
  }

  const [current, previous] = [...annotationHistory].sort((left, right) => right.version - left.version);

  if (!current || !previous) {
    return null;
  }

  return {
    currentStatus: current.status,
    currentVersion: current.version,
    previousVersion: previous.version,
    regionDelta: current.regions.length - previous.regions.length,
    responseDelta: countAnnotationResponses(current) - countAnnotationResponses(previous)
  };
}

function countAnnotationResponses(annotation: AnnotationSummary) {
  const results = Array.isArray(annotation.resultJson.results) ? annotation.resultJson.results : [];
  return results.length;
}

function formatSignedCount(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatMediaTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function buildTimeSeriesPreview(sourceText: string) {
  const rows = parseDelimitedRows(sourceText);

  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0] ?? [];
  const dataRows = rows.slice(1).filter((row: string[]) => row.some((cell: string) => cell.trim().length > 0));
  const valueColumnIndex = headers.findIndex((_header: string, index: number) => index > 0 && dataRows.some((row: string[]) => Number.isFinite(Number(row[index]))));

  if (valueColumnIndex < 0) {
    return null;
  }

  const labelColumnIndex = headers.findIndex((header: string) => /time|date|timestamp/i.test(header));
  const normalizedLabelIndex = labelColumnIndex >= 0 ? labelColumnIndex : 0;
  const points = dataRows
    .map((row, index) => ({
      index,
      label: row[normalizedLabelIndex] ?? String(index + 1),
      value: Number(row[valueColumnIndex])
    }))
    .filter((point) => Number.isFinite(point.value));

  if (points.length < 2) {
    return null;
  }

  const minValue = Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const valueRange = maxValue - minValue || 1;
  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
      const y = 38 - ((point.value - minValue) / valueRange) * 34;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    polyline,
    rows: points.map((point) => ({
      label: point.label,
      value: Number.isInteger(point.value) ? String(point.value) : point.value.toFixed(3)
    })),
    valueColumn: headers[valueColumnIndex] ?? "Value"
  };
}

function getTimeSeriesRowIndex(percent: number, rowCount: number) {
  return Math.max(0, Math.min(Math.max(0, rowCount - 1), Math.round(clamp(percent) * Math.max(0, rowCount - 1))));
}

function parseDelimitedRows(sourceText: string): string[][] {
  const trimmed = sourceText.trim();

  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return [];
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const parsedRecord = isRecord(parsed) ? parsed : {};
      const objects = Array.isArray(parsed) ? parsed : Array.isArray(parsedRecord.data) ? parsedRecord.data : [];

      if (objects.every((item) => isRecord(item))) {
        const records = objects as Array<Record<string, unknown>>;
        const headers = Array.from(new Set<string>(records.flatMap((item) => Object.keys(item))));
        return [
          headers,
          ...records.map((item) => headers.map((header) => {
            const value = item[header];
            return value == null ? "" : String(value);
          }))
        ];
      }
    } catch {
      return [];
    }
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const delimiter = trimmed.includes("\t") ? "\t" : ",";
  return lines.map((line) => splitDelimitedLine(line, delimiter));
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === "\"" && nextCharacter === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (character === "\"") {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getNextTaskAction(status: string): { label: string } | null {
  if (status === "REJECTED") {
    return { label: "Revise task" };
  }

  if (status === "PENDING" || status === "ASSIGNED") {
    return { label: "Start task" };
  }

  return null;
}
