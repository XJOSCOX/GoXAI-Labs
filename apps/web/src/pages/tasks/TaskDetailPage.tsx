import { type PointerEvent, type WheelEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  addTaskComment,
  getAssetAccessUrl,
  getNextTask,
  generateMockAIPrediction,
  importAIPredictions,
  listAIJobs,
  reviewTask,
  startTask,
  submitTaskAnnotation,
  type AIJobSummary,
  type TaskReviewPaymentSettlement,
  type TaskSummary
} from "../../api";
import { useAuth } from "../../auth";
import {
  annotationToShapes,
  areShapesEqual,
  clamp,
  clampScroll,
  cloneShapes,
  createBoxFromPoints,
  defaultLabel,
  findEditHandleAtPoint,
  findShapeAtPoint,
  getPointDistance,
  movePolygonPoint,
  resizeBoxShape,
  serializeAnnotationPayload,
  shapesToAnnotationPayload,
  shouldClosePolygon,
  translateShape,
  type AnnotationShape,
  type LabelOption,
  type Point
} from "../../features/tasks/annotation/geometry";
import {
  annotationToChoiceResponses,
  annotationToRatingResponses,
  annotationToScalarResponses,
  annotationToTemporalResponses,
  annotationToTextResponses,
  formResponsesToResults,
  isTextLikeAsset,
  type TemporalRegionResponse,
} from "../../features/tasks/annotation/templateForm";
import { cacheAssetAccessUrl, getAssetAccessCacheKey, getCachedAssetAccessUrl } from "../../features/tasks/assets/accessCache";
import { getAnnotationCanvasWidth, getPdfCanvasWidth } from "../../features/tasks/assets/canvasSizing";
import { type OcrBlock, type PdfPageInfo } from "../../features/tasks/assets/ocr";
import { buildAIReviewGuidance, buildTaskAIAssistanceSummary } from "../../features/tasks/ai/aiAssistance";
import { AnnotationLabelControls, TaskInlineActions } from "../../features/tasks/detail/TaskAnnotationControls";
import { TaskAssetWorkspace } from "../../features/tasks/detail/TaskAssetWorkspace";
import { CreatedRegionsPanel, TaskContextPanel } from "../../features/tasks/detail/TaskContextPanels";
import { AnnotationVersionPanel, TaskAIPredictionsPanel, TaskAIReviewPanel, TaskCommentsPanel, TaskHistoryPanel, TaskReviewPanel, TaskRevisionPanel } from "../../features/tasks/detail/TaskSidebarPanels";
import {
  clampZoom,
  getPredictionPreviewShapeId,
  getShapeBounds,
  maxUndoSteps,
  maxZoom,
  minZoom,
  zoomStep,
  type ActiveRegionEdit,
  type PanDrag,
  type PredictionPreviewState,
  type RegionEdit,
  type ShapeHistoryEntry,
  type ZoomAnchor
} from "../../features/tasks/detail/taskDetailCanvas";
import { formatDateTime, getNextTaskAction } from "../../features/tasks/detail/taskDetailUtils";
import {
  buildPredictionPreviewShapes,
  buildPredictionSavePayload,
  buildPredictionShapes,
  formatPrelabelCount,
  parsePredictionImportText
} from "../../features/tasks/detail/taskPredictionImports";
import { useTaskAnnotationConfig } from "../../features/tasks/detail/useTaskAnnotationConfig";
import { useTaskAnnotationDraft } from "../../features/tasks/detail/useTaskAnnotationDraft";
import { buildAnnotationVersionDiff, buildTaskHistoryItems } from "../../features/tasks/history/history";
import { formatReviewSettlementMessage, formatTaskCredits, getTaskPaymentDisplay, getTaskReviewSettlementDisplay } from "../../features/tasks/payment/payment";
import { getQueueFilters, getTaskDetailSearch, getTaskQueueLink } from "../../features/tasks/queue/navigation";
import { buildReviewGuidance } from "../../features/tasks/review/reviewGuidance";
import { useTask } from "../../hooks/useResources";

export function TaskDetailPage() {
  const { taskId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueDatasetId = searchParams.get("datasetId");
  const queuePage = searchParams.get("page");
  const queueProjectId = searchParams.get("projectId");
  const queueMode = searchParams.get("queue");
  const queueFilters = useMemo(() => getQueueFilters(searchParams), [searchParams]);
  const { features, session } = useAuth();
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
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [nextTask, setNextTask] = useState<TaskSummary | null>(null);
  const [nextTaskError, setNextTaskError] = useState<string | null>(null);
  const [nextTaskLoading, setNextTaskLoading] = useState(false);
  const [aiJobs, setAiJobs] = useState<AIJobSummary[]>([]);
  const [aiJobsLoading, setAiJobsLoading] = useState(false);
  const [aiImportError, setAiImportError] = useState<string | null>(null);
  const [aiImportSaving, setAiImportSaving] = useState(false);
  const [aiMockSaving, setAiMockSaving] = useState(false);
  const [aiImportText, setAiImportText] = useState("");
  const [predictionPreview, setPredictionPreview] = useState<PredictionPreviewState | null>(null);
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
  const accessUrlAssetIdRef = useRef<string | null>(null);
  const editRegionRef = useRef<RegionEdit | null>(null);
  const editShapeHistoryRef = useRef<ShapeHistoryEntry | null>(null);
  const panDragRef = useRef<PanDrag | null>(null);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);
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
  const taskPayment = task ? getTaskPaymentDisplay(task, queueMode === "review" ? "review" : "work") : null;
  const reviewSettlement = useMemo(() => task ? getTaskReviewSettlementDisplay(task) : null, [task]);
  const {
    choiceControls,
    dateTimeControls,
    drawingToolOptions,
    formControls,
    formToolLabels,
    labelOptions,
    numberControls,
    ocrBlocks,
    pdfSource,
    ratingControls,
    regionBorderWidth,
    supportsBbox,
    supportsPolygon,
    supportsRegionDrawing,
    temporalControls,
    templateSourceByName,
    templateSources,
    textAreaControls,
    usesTemplateForm
  } = useTaskAnnotationConfig({ pdfPageInfo, task });
  const isPdfRegionWorkspace = Boolean(supportsRegionDrawing && accessUrl && !isImage && (isPdf || pdfSource));
  const canDrawOnRegionSource = isImage || isPdfRegionWorkspace;
  const visibleShapes = useMemo(
    () => isPdfRegionWorkspace ? shapes.filter((shape) => (shape.page ?? 1) === activePdfPage) : shapes,
    [activePdfPage, isPdfRegionWorkspace, shapes]
  );
  const predictionPreviewJob = useMemo(
    () => predictionPreview ? aiJobs.find((job) => job.id === predictionPreview.jobId) ?? null : null,
    [aiJobs, predictionPreview]
  );
  const predictionPreviewShapes = useMemo(() => {
    if (!predictionPreviewJob || !predictionPreview) {
      return [];
    }

    return buildPredictionPreviewShapes(predictionPreviewJob, predictionPreview);
  }, [predictionPreview, predictionPreviewJob]);
  const visiblePredictionPreviewShapes = useMemo(
    () => isPdfRegionWorkspace ? predictionPreviewShapes.filter((shape) => (shape.page ?? 1) === activePdfPage) : predictionPreviewShapes,
    [activePdfPage, isPdfRegionWorkspace, predictionPreviewShapes]
  );
  const predictionPreviewFocusId = predictionPreview && predictionPreview.focusedRegionIndex !== null
    ? getPredictionPreviewShapeId(predictionPreview.jobId, predictionPreview.focusedRegionIndex)
    : null;
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
  const aiAssistanceSummary = useMemo(
    () => buildTaskAIAssistanceSummary(features.aiEnabled ? aiJobs : [], features.aiEnabled ? shapes : []),
    [aiJobs, features.aiEnabled, shapes]
  );
  const reviewGuidance = useMemo(
    () => (task ? [...buildReviewGuidance(task, annotationHistory), ...(features.aiEnabled ? buildAIReviewGuidance(aiAssistanceSummary) : [])] : []),
    [aiAssistanceSummary, annotationHistory, features.aiEnabled, task]
  );
  const blocksApproval = reviewGuidance.some((item) => item.blocksApproval);
  const latestRejectedReview = useMemo(
    () => reviews.find((review) => review.status === "NEEDS_CHANGES") ?? null,
    [reviews]
  );
  const annotationVersionDiff = useMemo(() => buildAnnotationVersionDiff(annotationHistory), [annotationHistory]);
  const polygonInProgress = activeTool === "POLYGON" && polygonPoints.length > 0;
  const canStartPolygon = activeTool === "POLYGON" && (labelArmed || labelDrawLock);

  const handlePreviewPredictions = useCallback((job: AIJobSummary, selectedRegionIndexes: number[], focusedRegionIndex: number | null) => {
    setPredictionPreview({
      focusedRegionIndex: focusedRegionIndex ?? selectedRegionIndexes[0] ?? null,
      jobId: job.id,
      selectedRegionIndexes
    });
  }, []);

  const handleClearPredictionPreview = useCallback(() => {
    setPredictionPreview(null);
  }, []);

  useEffect(() => {
    const nextShapes = annotationToShapes(annotation);
    const nextChoiceResponses = annotationToChoiceResponses(annotation);
    const nextDateTimeResponses = annotationToScalarResponses(annotation, "datetime");
    const nextNumberResponses = annotationToScalarResponses(annotation, "number");
    const nextRatingResponses = annotationToRatingResponses(annotation);
    const nextTemporalResponses = annotationToTemporalResponses(annotation);
    const nextTextResponses = annotationToTextResponses(annotation);

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
  }, [annotation?.id, annotation?.updatedAt]);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    selectedShapeIdRef.current = selectedShapeId;
  }, [selectedShapeId]);

  useEffect(() => {
    setPredictionPreview(null);
  }, [task?.id]);

  useLayoutEffect(() => {
    if (!predictionPreviewFocusId) {
      return;
    }

    const shape = visiblePredictionPreviewShapes.find((candidate) => candidate.id === predictionPreviewFocusId);
    const stageElement = annotationStageRef.current;
    const canvasElement = annotationCanvasRef.current;

    if (!shape || !stageElement || !canvasElement) {
      return;
    }

    const bounds = getShapeBounds(shape);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const nextLeft = canvasElement.offsetLeft + canvasElement.offsetWidth * centerX - stageElement.clientWidth / 2;
    const nextTop = canvasElement.offsetTop + canvasElement.offsetHeight * centerY - stageElement.clientHeight / 2;

    stageElement.scrollTo({
      behavior: "smooth",
      left: clampScroll(nextLeft, stageElement.scrollWidth - stageElement.clientWidth),
      top: clampScroll(nextTop, stageElement.scrollHeight - stageElement.clientHeight)
    });
  }, [annotationStageSize, predictionPreviewFocusId, visiblePredictionPreviewShapes, zoom]);

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
    setSavedMessage(null);
    setNextTask(null);
    setNextTaskError(null);
    setAiImportError(null);
    setAiImportText("");
  }, [task?.id]);

  useEffect(() => {
    if (!session || !task?.id || !features.aiEnabled) {
      setAiJobs([]);
      setPredictionPreview(null);
      setAiJobsLoading(false);
      return;
    }

    let active = true;
    setAiJobsLoading(true);
    setAiImportError(null);

    listAIJobs(session, { taskId: task.id })
      .then((jobs) => {
        if (active) {
          setAiJobs(jobs);
        }
      })
      .catch((reason) => {
        if (active) {
          setAiImportError(reason instanceof Error ? reason.message : "Unable to load AI predictions.");
        }
      })
      .finally(() => {
        if (active) {
          setAiJobsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [features.aiEnabled, session, task?.id]);

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
          cacheAssetAccessUrl(cacheKey, result.accessUrl, result.expiresInSeconds);
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
  const savedAnnotationPayloadText = useMemo(() => {
    const savedShapes = annotationToShapes(annotation);
    const savedChoiceResponses = annotationToChoiceResponses(annotation);
    const savedDateTimeResponses = annotationToScalarResponses(annotation, "datetime");
    const savedNumberResponses = annotationToScalarResponses(annotation, "number");
    const savedRatingResponses = annotationToRatingResponses(annotation);
    const savedTemporalResponses = annotationToTemporalResponses(annotation);
    const savedTextResponses = annotationToTextResponses(annotation);

    return serializeAnnotationPayload({
      ...shapesToAnnotationPayload(savedShapes),
      results: formResponsesToResults({
        choiceControls,
        choiceResponses: savedChoiceResponses,
        dateTimeControls,
        dateTimeResponses: savedDateTimeResponses,
        numberControls,
        numberResponses: savedNumberResponses,
        ratingControls,
        ratingResponses: savedRatingResponses,
        temporalControls,
        temporalResponses: savedTemporalResponses,
        textControls: textAreaControls,
        textResponses: savedTextResponses
      })
    });
  }, [annotation, choiceControls, dateTimeControls, numberControls, ratingControls, temporalControls, textAreaControls]);
  const {
    clearPendingSave,
    draftSaving,
    hasUnsavedChanges,
    saveDraft,
    saveErrorMessage,
    saveStatus,
    setLatestPayloadText
  } = useTaskAnnotationDraft({
    annotationPayload,
    annotationPayloadText,
    canAnnotate,
    loading,
    onError: setError,
    onSaved: (result) => {
      setAnnotation(result.annotation);
      setTask(result.task);
    },
    onSavedMessage: setSavedMessage,
    savedPayloadKey: `${task?.id ?? "new"}:${annotation?.id ?? "none"}:${annotation?.updatedAt ?? "none"}`,
    savedPayloadText: savedAnnotationPayloadText,
    session,
    task
  });
  const savingInProgress = saving || draftSaving;

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
    clearPendingSave();
    await saveDraft(annotationPayload, { auto: false });
  }

  async function handleImportPredictions() {
    if (!session || !task || !aiImportText.trim()) {
      return;
    }

    const parsed = parsePredictionImportText(aiImportText);

    if (!parsed.ok) {
      setAiImportError(parsed.message);
      return;
    }

    setAiImportSaving(true);
    setAiImportError(null);

    try {
      const job = await importAIPredictions(session, {
        predictions: parsed.predictions,
        taskId: task.id
      });
      setAiJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
      setAiImportText("");

      if (canAnnotate) {
        const addedCount = await addPredictionShapesToCanvas(job, undefined, "This prediction import does not have drawable regions.");

        if (addedCount > 0) {
          setAiImportError(null);
          return;
        }
      }

      setSavedMessage("Prelabels imported.");
    } catch (reason) {
      setAiImportError(reason instanceof Error ? reason.message : "Unable to import AI predictions.");
    } finally {
      setAiImportSaving(false);
    }
  }

  async function handleGenerateMockPrediction() {
    if (!session || !task) {
      return;
    }

    setAiMockSaving(true);
    setAiImportError(null);

    try {
      const job = await generateMockAIPrediction(session, {
        taskId: task.id
      });
      setAiJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)]);
      setSavedMessage("Test prelabel generated. Review it before adding it to the canvas.");
    } catch (reason) {
      setAiImportError(reason instanceof Error ? reason.message : "Unable to generate test prelabel.");
    } finally {
      setAiMockSaving(false);
    }
  }

  function handleAddPredictions(job: AIJobSummary, selectedRegionIndexes: number[]) {
    if (!canAnnotate) {
      return;
    }

    setPredictionPreview(null);
    void addPredictionShapesToCanvas(job, selectedRegionIndexes, "This prediction job does not have drawable regions.");
  }

  async function addPredictionShapesToCanvas(job: AIJobSummary, selectedRegionIndexes: number[] | undefined, emptyMessage: string) {
    const predictionShapes = buildPredictionShapes(job, selectedRegionIndexes);

    if (predictionShapes.length === 0) {
      setAiImportError(emptyMessage);
      return 0;
    }

    const { nextPayload, nextShapes } = buildPredictionSavePayload(shapesRef.current, predictionShapes, annotationPayload.results);
    const nextPayloadText = serializeAnnotationPayload(nextPayload);

    setLatestPayloadText(nextPayloadText);
    commitShapeEdit("Added prelabels", () => nextShapes, predictionShapes[0]?.id ?? null);
    setSavedMessage(`${formatPrelabelCount(predictionShapes.length)} added.`);
    clearPendingSave();
    const saved = await saveDraft(nextPayload, { auto: false });

    if (saved) {
      setSavedMessage(`${formatPrelabelCount(predictionShapes.length)} added and saved.`);
    }

    return predictionShapes.length;
  }

  async function handleGoToNextTask() {
    if (!nextTask) {
      return;
    }

    if (canAnnotate && hasUnsavedChanges()) {
      clearPendingSave();
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

  async function handleSubmitAnnotation() {
    if (!session || !task) {
      return;
    }

    clearPendingSave({ cancelInFlight: true });

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

    const settlementPreview = getTaskReviewSettlementDisplay(task);

    if (decision === "approve") {
      const confirmed = window.confirm(
        `Approve this task?\n\n${formatReviewSettlementMessage(settlementPreview)}\nEscrow used ${settlementPreview.escrowText}.`
      );

      if (!confirmed) {
        return;
      }
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
      setSavedMessage(decision === "approve" ? getReviewSuccessMessage(result.settlement, settlementPreview) : "Task sent back with feedback.");
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
              <TaskAssetWorkspace
                accessUrl={accessUrl}
                activeEdit={activeEdit}
                activeLabel={activeLabel}
                activePdfPage={activePdfPage}
                annotationCanvasRef={annotationCanvasRef}
                annotationCanvasWidth={annotationCanvasWidth}
                annotationStageRef={annotationStageRef}
                assetLoading={assetLoading}
                canAnnotate={canAnnotate}
                canDrawOnRegionSource={canDrawOnRegionSource}
                canRedoShapeEdit={canRedoShapeEdit}
                canUndoShapeEdit={canUndoShapeEdit}
                choiceControls={choiceControls}
                choiceResponses={choiceResponses}
                dateTimeControls={dateTimeControls}
                dateTimeResponses={dateTimeResponses}
                draftShape={draftShape}
                finishPolygon={finishPolygon}
                fullscreenAnnotator={fullscreenAnnotator}
                handlePointerDown={handlePointerDown}
                handlePointerLeave={handlePointerLeave}
                handlePointerMove={handlePointerMove}
                handlePointerUp={handlePointerUp}
                handleStageWheel={handleStageWheel}
                isImage={isImage}
                isPanning={isPanning}
                isPdfRegionWorkspace={isPdfRegionWorkspace}
                labelOptions={labelOptions}
                livePolygonPoints={livePolygonPoints}
                numberControls={numberControls}
                numberResponses={numberResponses}
                ocrBlocks={ocrBlocks}
                onAddOcrBlockRegion={addOcrBlockRegion}
                onChoiceChange={setChoiceResponses}
                onDateTimeChange={setDateTimeResponses}
                onImageNaturalSize={setImageNaturalSize}
                onNumberChange={setNumberResponses}
                onPdfPageInfo={setPdfPageInfo}
                onRatingChange={setRatingResponses}
                onRedoShapeEdit={redoShapeEdit}
                onResetZoom={resetZoom}
                onSetActivePdfPage={setActivePdfPage}
                onSetPanMode={setPanMode}
                onTemporalChange={setTemporalResponses}
                onTextChange={setTextResponses}
                onToggleFullscreen={() => setFullscreenAnnotator((current) => !current)}
                onUndoShapeEdit={undoShapeEdit}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                pageTitle={pageTitle}
                panMode={panMode}
                pdfCanvasWidth={pdfCanvasWidth}
                pdfPageInfo={pdfPageInfo}
                polygonClosePointHover={polygonClosePointHover}
                polygonPoints={polygonPoints}
                predictionPreviewFocusId={predictionPreviewFocusId}
                predictionPreviewShapes={visiblePredictionPreviewShapes}
                ratingControls={ratingControls}
                ratingResponses={ratingResponses}
                regionBorderWidth={regionBorderWidth}
                selectedShape={selectedShape}
                selectedShapeId={selectedShapeId}
                sourceByName={templateSourceByName}
                sources={templateSources}
                task={task}
                temporalControls={temporalControls}
                temporalResponses={temporalResponses}
                textAssetContent={textAssetContent}
                textControls={textAreaControls}
                textResponses={textResponses}
                usesTemplateForm={usesTemplateForm}
                visibleOcrBlocks={visibleOcrBlocks}
                visibleShapes={visibleShapes}
                zoom={zoom}
              >
                {!usesTemplateForm && (
                  <AnnotationLabelControls
                    activeLabel={activeLabel}
                    canAnnotate={canAnnotate}
                    labelArmed={labelArmed}
                    labelDrawLock={labelDrawLock}
                    labelOptions={labelOptions}
                    onCustomLabelChange={(label) => {
                      setActiveLabel(label);
                      setActiveTool("POLYGON");
                      setLabelArmed(true);
                    }}
                    onSelectLabel={(label) => {
                      setActiveLabel(label);
                      setActiveTool("POLYGON");
                      setLabelArmed(true);
                      setPanMode(false);
                    }}
                    onToggleLabelLock={() => {
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
                    polygonInProgress={polygonInProgress}
                  />
                )}
                <TaskInlineActions
                  canAnnotate={canAnnotate}
                  canWork={task.canWork}
                  nextAction={nextAction}
                  nextTask={nextTask}
                  nextTaskError={nextTaskError}
                  nextTaskLoading={nextTaskLoading}
                  onGoToNextTask={handleGoToNextTask}
                  onSaveDraft={() => void handleSaveDraft()}
                  onSubmitAnnotation={() => void handleSubmitAnnotation()}
                  onTaskAction={() => void handleTaskAction()}
                  saving={savingInProgress}
                />
              </TaskAssetWorkspace>
            </section>
            <aside className="side-column task-side-panel">
              <TaskContextPanel
                activeTool={activeTool}
                annotationStatus={annotationStatus}
                canAnnotate={canAnnotate}
                formToolLabels={formToolLabels}
                labelDrawLock={labelDrawLock}
                onCancelPolygon={() => {
                  setPolygonClosePointHover(false);
                  setLabelArmed(labelDrawLock);
                  setPolygonPoints([]);
                  setPolygonPreviewPoint(null);
                }}
                onFinishPolygon={finishPolygon}
                onSelectBoxTool={() => {
                  setActiveTool("BBOX");
                  setLabelArmed(false);
                  setPolygonPoints([]);
                  setPolygonPreviewPoint(null);
                }}
                onSelectPolygonTool={() => setActiveTool("POLYGON")}
                polygonInProgress={polygonInProgress}
                polygonPointCount={polygonPoints.length}
                saveErrorMessage={saveErrorMessage}
                savedMessage={savedMessage}
                saveStatus={saveStatus}
                supportsBbox={supportsBbox}
                supportsPolygon={supportsPolygon}
                task={task}
                taskPayment={taskPayment}
                usesTemplateForm={usesTemplateForm}
              />
              <CreatedRegionsPanel
                canAnnotate={canAnnotate}
                choiceResponses={choiceResponses}
                dateTimeResponses={dateTimeResponses}
                formControls={formControls}
                isPdfRegionWorkspace={isPdfRegionWorkspace}
                numberResponses={numberResponses}
                onRemoveRegion={removeBox}
                onSelectRegion={setSelectedShapeId}
                ratingResponses={ratingResponses}
                selectedShapeId={selectedShapeId}
                showAIBadges={features.aiEnabled}
                shapes={shapes}
                temporalResponses={temporalResponses}
                textResponses={textResponses}
                usesTemplateForm={usesTemplateForm}
              />
              {features.aiEnabled ? (
                <>
                  <TaskAIPredictionsPanel
                    canAddPredictions={canAnnotate}
                    canImportPredictions={Boolean(task.canManage)}
                    importError={aiImportError}
                    importText={aiImportText}
                    jobs={aiJobs}
                    jobsLoading={aiJobsLoading}
                    focusedPreviewRegionIndex={predictionPreviewJob && predictionPreview?.jobId === predictionPreviewJob.id ? predictionPreview.focusedRegionIndex : null}
                    onAddPredictions={handleAddPredictions}
                    onClearPredictionPreview={handleClearPredictionPreview}
                    onGenerateMock={() => void handleGenerateMockPrediction()}
                    onImportPredictions={() => void handleImportPredictions()}
                    onPreviewPredictions={handlePreviewPredictions}
                    setImportText={setAiImportText}
                    mockGenerating={aiMockSaving}
                    submitting={aiImportSaving}
                  />
                  <TaskAIReviewPanel summary={aiAssistanceSummary} />
                </>
              ) : null}
              {task.status === "REJECTED" && <TaskRevisionPanel latestRejectedReview={latestRejectedReview} />}
              <AnnotationVersionPanel annotationVersionDiff={annotationVersionDiff} />
              {canReviewTask && (
                <TaskReviewPanel
                  blocksApproval={blocksApproval}
                  onReviewDecision={(decision) => void handleReviewDecision(decision)}
                  reviewFeedback={reviewFeedback}
                  reviewGuidance={reviewGuidance}
                  reviewReason={reviewReason}
                  reviewSaving={reviewSaving}
                  reviewScore={reviewScore}
                  reviewSettlement={reviewSettlement ?? getTaskReviewSettlementDisplay(task)}
                  reviewSeverity={reviewSeverity}
                  setReviewFeedback={setReviewFeedback}
                  setReviewReason={setReviewReason}
                  setReviewScore={setReviewScore}
                  setReviewSeverity={setReviewSeverity}
                />
              )}
              <TaskCommentsPanel
                commentBody={commentBody}
                commentSaving={commentSaving}
                comments={comments}
                onAddComment={() => void handleAddComment()}
                setCommentBody={setCommentBody}
                taskCanWork={task.canWork}
              />
              <TaskHistoryPanel taskHistoryItems={taskHistoryItems} />
            </aside>
          </div>
        ) : (
          <p className="muted-copy">Task was not found.</p>
        )}
      </section>
    </section>
  );
}

function getReviewSuccessMessage(
  settlement: TaskReviewPaymentSettlement | null,
  fallback: NonNullable<ReturnType<typeof getTaskReviewSettlementDisplay>>
) {
  if (!settlement) {
    return `Task approved. ${formatReviewSettlementMessage(fallback)}`;
  }

  return [
    "Task approved.",
    `Worker credited ${formatTaskCredits(settlement.approvedCredits, settlement.currency)}.`,
    `Platform fee ${formatTaskCredits(settlement.feeCredits, settlement.currency)}.`,
    `Creator refund ${formatTaskCredits(settlement.refundCredits, settlement.currency)}.`
  ].join(" ");
}
