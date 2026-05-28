import { type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, Hand, Maximize2, Minimize2, Minus, Plus, Redo2, RotateCcw, SquareDashedMousePointer, Undo2 } from "lucide-react";
import type { TaskSummary } from "../../../api";
import { getLabelColor, pointsToSvg, type AnnotationShape, type LabelOption, type Point } from "../annotation/geometry";
import {
  type ChoiceControl,
  type DateTimeControl,
  type NumberControl,
  type RatingControl,
  type TemplateSource,
  type TemporalLabelControl,
  type TemporalRegionResponse,
  type TextAreaControl
} from "../annotation/templateForm";
import { TemplateResponseWorkspace } from "../annotation/template/TemplateResponseWorkspace";
import type { OcrBlock, PdfPageInfo } from "../assets/ocr";
import { PdfPageCanvas } from "../assets/PdfPageCanvas";
import { formatEnum } from "../../../utils/format";
import { AnnotationEditHandles, AnnotationSvgShape, type RegionEditKind } from "./annotationShapes";

type TaskAssetWorkspaceProps = {
  accessUrl: string | null;
  activeEdit: { id: string; kind: RegionEditKind } | null;
  activeLabel: string;
  activePdfPage: number;
  annotationCanvasRef: RefObject<HTMLDivElement | null>;
  annotationCanvasWidth: number | string;
  annotationStageRef: RefObject<HTMLDivElement | null>;
  assetLoading: boolean;
  canAnnotate: boolean;
  canDrawOnRegionSource: boolean;
  canRedoShapeEdit: boolean;
  canUndoShapeEdit: boolean;
  children?: ReactNode;
  choiceControls: ChoiceControl[];
  choiceResponses: Record<string, string[]>;
  dateTimeControls: DateTimeControl[];
  dateTimeResponses: Record<string, string>;
  draftShape: AnnotationShape | null;
  finishPolygon: () => void;
  fullscreenAnnotator: boolean;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  handleStageWheel: (event: WheelEvent<HTMLDivElement>) => void;
  isImage: boolean;
  isPanning: boolean;
  isPdfRegionWorkspace: boolean;
  labelOptions: LabelOption[];
  livePolygonPoints: Point[];
  numberControls: NumberControl[];
  numberResponses: Record<string, string>;
  ocrBlocks: OcrBlock[];
  onAddOcrBlockRegion: (block: OcrBlock) => void;
  onChoiceChange: (responses: Record<string, string[]>) => void;
  onDateTimeChange: (responses: Record<string, string>) => void;
  onImageNaturalSize: (size: { height: number; width: number }) => void;
  onNumberChange: (responses: Record<string, string>) => void;
  onPdfPageInfo: (pageInfo: PdfPageInfo) => void;
  onRatingChange: (responses: Record<string, number>) => void;
  onRedoShapeEdit: () => void;
  onResetZoom: () => void;
  onSetActivePdfPage: (updater: number | ((current: number) => number)) => void;
  onSetPanMode: (updater: boolean | ((current: boolean) => boolean)) => void;
  onTemporalChange: (responses: Record<string, TemporalRegionResponse[]>) => void;
  onTextChange: (responses: Record<string, string>) => void;
  onToggleFullscreen: () => void;
  onUndoShapeEdit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pageTitle: string;
  panMode: boolean;
  pdfCanvasWidth: number | string;
  pdfPageInfo: PdfPageInfo | null;
  polygonClosePointHover: boolean;
  polygonPoints: Point[];
  predictionPreviewFocusId: string | null;
  predictionPreviewShapes: AnnotationShape[];
  ratingControls: RatingControl[];
  ratingResponses: Record<string, number>;
  regionBorderWidth: number;
  selectedShape: AnnotationShape | null;
  selectedShapeId: string | null;
  sourceByName: Map<string, TemplateSource>;
  sources: TemplateSource[];
  task: TaskSummary;
  temporalControls: TemporalLabelControl[];
  temporalResponses: Record<string, TemporalRegionResponse[]>;
  textAssetContent: string | null;
  textControls: TextAreaControl[];
  textResponses: Record<string, string>;
  usesTemplateForm: boolean;
  visibleOcrBlocks: OcrBlock[];
  visibleShapes: AnnotationShape[];
  zoom: number;
};

export function TaskAssetWorkspace({
  accessUrl,
  activeEdit,
  activeLabel,
  activePdfPage,
  annotationCanvasRef,
  annotationCanvasWidth,
  annotationStageRef,
  assetLoading,
  canAnnotate,
  canDrawOnRegionSource,
  canRedoShapeEdit,
  canUndoShapeEdit,
  children,
  choiceControls,
  choiceResponses,
  dateTimeControls,
  dateTimeResponses,
  draftShape,
  finishPolygon,
  fullscreenAnnotator,
  handlePointerDown,
  handlePointerLeave,
  handlePointerMove,
  handlePointerUp,
  handleStageWheel,
  isImage,
  isPanning,
  isPdfRegionWorkspace,
  labelOptions,
  livePolygonPoints,
  numberControls,
  numberResponses,
  ocrBlocks,
  onAddOcrBlockRegion,
  onChoiceChange,
  onDateTimeChange,
  onImageNaturalSize,
  onNumberChange,
  onPdfPageInfo,
  onRatingChange,
  onRedoShapeEdit,
  onResetZoom,
  onSetActivePdfPage,
  onSetPanMode,
  onTemporalChange,
  onTextChange,
  onToggleFullscreen,
  onUndoShapeEdit,
  onZoomIn,
  onZoomOut,
  pageTitle,
  panMode,
  pdfCanvasWidth,
  pdfPageInfo,
  polygonClosePointHover,
  polygonPoints,
  predictionPreviewFocusId,
  predictionPreviewShapes,
  ratingControls,
  ratingResponses,
  regionBorderWidth,
  selectedShape,
  selectedShapeId,
  sourceByName,
  sources,
  task,
  temporalControls,
  temporalResponses,
  textAssetContent,
  textControls,
  textResponses,
  usesTemplateForm,
  visibleOcrBlocks,
  visibleShapes,
  zoom
}: TaskAssetWorkspaceProps) {
  const stageClassName = [
    "annotation-stage",
    canAnnotate && canDrawOnRegionSource ? "drawing-enabled" : "",
    isPdfRegionWorkspace ? "pdf-region-stage" : "",
    panMode ? "pan-mode" : "",
    isPanning ? "panning" : "",
    activeEdit ? `editing-region ${activeEdit.kind}` : ""
  ].filter(Boolean).join(" ");

  return (
    <section className={`panel task-asset-panel${fullscreenAnnotator ? " fullscreen-annotation-panel" : ""}`}>
      <div className="task-asset-head">
        <div>
          <p className="eyebrow">Task asset</p>
          <h2>{pageTitle}</h2>
        </div>
        <TaskAssetToolbar
          activePdfPage={activePdfPage}
          canRedoShapeEdit={canRedoShapeEdit}
          canUndoShapeEdit={canUndoShapeEdit}
          fullscreenAnnotator={fullscreenAnnotator}
          isPdfRegionWorkspace={isPdfRegionWorkspace}
          onRedoShapeEdit={onRedoShapeEdit}
          onResetZoom={onResetZoom}
          onSetActivePdfPage={onSetActivePdfPage}
          onSetPanMode={onSetPanMode}
          onToggleFullscreen={onToggleFullscreen}
          onUndoShapeEdit={onUndoShapeEdit}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          panMode={panMode}
          pdfPageInfo={pdfPageInfo}
          status={task.status}
          usesTemplateForm={usesTemplateForm}
          zoom={zoom}
        />
      </div>
      <div className={stageClassName} onWheel={handleStageWheel} ref={annotationStageRef}>
        {usesTemplateForm ? (
          <TemplateResponseWorkspace
            accessUrl={accessUrl}
            assetLoading={assetLoading}
            choiceControls={choiceControls}
            choiceResponses={choiceResponses}
            controls={textControls}
            dateTimeControls={dateTimeControls}
            dateTimeResponses={dateTimeResponses}
            numberControls={numberControls}
            numberResponses={numberResponses}
            onChoiceChange={onChoiceChange}
            onDateTimeChange={onDateTimeChange}
            onChange={onTextChange}
            onNumberChange={onNumberChange}
            onRatingChange={onRatingChange}
            onTemporalChange={onTemporalChange}
            ratingControls={ratingControls}
            ratingResponses={ratingResponses}
            responses={textResponses}
            sources={sources}
            sourceByName={sourceByName}
            task={task}
            temporalControls={temporalControls}
            temporalResponses={temporalResponses}
            textAssetContent={textAssetContent}
          />
        ) : accessUrl && isImage ? (
          <ImageAnnotationCanvas
            accessUrl={accessUrl}
            activeEdit={activeEdit}
            activeLabel={activeLabel}
            annotationCanvasRef={annotationCanvasRef}
            annotationCanvasWidth={annotationCanvasWidth}
            draftShape={draftShape}
            finishPolygon={finishPolygon}
            handlePointerDown={handlePointerDown}
            handlePointerLeave={handlePointerLeave}
            handlePointerMove={handlePointerMove}
            handlePointerUp={handlePointerUp}
            labelOptions={labelOptions}
            livePolygonPoints={livePolygonPoints}
            onImageNaturalSize={onImageNaturalSize}
            polygonClosePointHover={polygonClosePointHover}
            polygonPoints={polygonPoints}
            predictionPreviewFocusId={predictionPreviewFocusId}
            predictionPreviewShapes={predictionPreviewShapes}
            regionBorderWidth={regionBorderWidth}
            selectedShape={selectedShape}
            selectedShapeId={selectedShapeId}
            task={task}
            visibleShapes={visibleShapes}
          />
        ) : isPdfRegionWorkspace && accessUrl ? (
          <PdfAnnotationCanvas
            accessUrl={accessUrl}
            activeEdit={activeEdit}
            activeLabel={activeLabel}
            activePdfPage={activePdfPage}
            annotationCanvasRef={annotationCanvasRef}
            draftShape={draftShape}
            finishPolygon={finishPolygon}
            handlePointerDown={handlePointerDown}
            handlePointerLeave={handlePointerLeave}
            handlePointerMove={handlePointerMove}
            handlePointerUp={handlePointerUp}
            labelOptions={labelOptions}
            livePolygonPoints={livePolygonPoints}
            ocrBlocks={ocrBlocks}
            onAddOcrBlockRegion={onAddOcrBlockRegion}
            onPdfPageInfo={onPdfPageInfo}
            pdfCanvasWidth={pdfCanvasWidth}
            pdfPageInfo={pdfPageInfo}
            polygonClosePointHover={polygonClosePointHover}
            polygonPoints={polygonPoints}
            predictionPreviewFocusId={predictionPreviewFocusId}
            predictionPreviewShapes={predictionPreviewShapes}
            regionBorderWidth={regionBorderWidth}
            selectedShape={selectedShape}
            selectedShapeId={selectedShapeId}
            task={task}
            visibleOcrBlocks={visibleOcrBlocks}
            visibleShapes={visibleShapes}
          />
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
      {children}
    </section>
  );
}

type TaskAssetToolbarProps = {
  activePdfPage: number;
  canRedoShapeEdit: boolean;
  canUndoShapeEdit: boolean;
  fullscreenAnnotator: boolean;
  isPdfRegionWorkspace: boolean;
  onRedoShapeEdit: () => void;
  onResetZoom: () => void;
  onSetActivePdfPage: (updater: number | ((current: number) => number)) => void;
  onSetPanMode: (updater: boolean | ((current: boolean) => boolean)) => void;
  onToggleFullscreen: () => void;
  onUndoShapeEdit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  panMode: boolean;
  pdfPageInfo: PdfPageInfo | null;
  status: string;
  usesTemplateForm: boolean;
  zoom: number;
};

function TaskAssetToolbar({
  activePdfPage,
  canRedoShapeEdit,
  canUndoShapeEdit,
  fullscreenAnnotator,
  isPdfRegionWorkspace,
  onRedoShapeEdit,
  onResetZoom,
  onSetActivePdfPage,
  onSetPanMode,
  onToggleFullscreen,
  onUndoShapeEdit,
  onZoomIn,
  onZoomOut,
  panMode,
  pdfPageInfo,
  status,
  usesTemplateForm,
  zoom
}: TaskAssetToolbarProps) {
  return (
    <div className="annotation-toolbar">
      {!usesTemplateForm && (
        <>
          <button
            aria-label="Undo annotation edit"
            className="icon-button"
            disabled={!canUndoShapeEdit}
            onClick={onUndoShapeEdit}
            title="Undo"
            type="button"
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="Redo annotation edit"
            className="icon-button"
            disabled={!canRedoShapeEdit}
            onClick={onRedoShapeEdit}
            title="Redo"
            type="button"
          >
            <Redo2 size={16} />
          </button>
          <button aria-label="Zoom out" className="icon-button" disabled={zoom <= 1} onClick={onZoomOut} title="Zoom out" type="button">
            <Minus size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button aria-label="Zoom in" className="icon-button" disabled={zoom >= 3} onClick={onZoomIn} title="Zoom in" type="button">
            <Plus size={16} />
          </button>
          <button aria-label="Reset zoom" className="icon-button" onClick={onResetZoom} title="Reset zoom" type="button">
            <RotateCcw size={16} />
          </button>
          {isPdfRegionWorkspace && (
            <div className="pdf-region-page-control">
              <button
                aria-label="Previous PDF page"
                disabled={activePdfPage <= 1}
                onClick={() => onSetActivePdfPage((current) => Math.max(1, current - 1))}
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
                    onSetActivePdfPage(pdfPageInfo ? Math.min(pdfPageInfo.pageCount, page) : page);
                  }}
                  type="number"
                  value={activePdfPage}
                />
              </label>
              <span>/ {pdfPageInfo?.pageCount ?? "..."}</span>
              <button
                aria-label="Next PDF page"
                disabled={Boolean(pdfPageInfo && activePdfPage >= pdfPageInfo.pageCount)}
                onClick={() => onSetActivePdfPage((current) => Math.min(pdfPageInfo?.pageCount ?? current + 1, current + 1))}
                type="button"
              >
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <button
            aria-label={panMode ? "Turn off pan mode" : "Pan image"}
            className={panMode ? "icon-button active" : "icon-button"}
            onClick={() => onSetPanMode((current) => !current)}
            title={panMode ? "Turn off pan" : "Pan image"}
            type="button"
          >
            <Hand size={16} />
          </button>
          <button
            aria-label={fullscreenAnnotator ? "Exit full screen annotation" : "Open full screen annotation"}
            className="icon-button"
            onClick={onToggleFullscreen}
            title={fullscreenAnnotator ? "Exit full screen" : "Full screen"}
            type="button"
          >
            {fullscreenAnnotator ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </>
      )}
      <span className="status-pill compact">{formatEnum(status)}</span>
    </div>
  );
}

type CanvasBaseProps = {
  activeEdit: { id: string; kind: RegionEditKind } | null;
  activeLabel: string;
  annotationCanvasRef: RefObject<HTMLDivElement | null>;
  draftShape: AnnotationShape | null;
  finishPolygon: () => void;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: () => void;
  labelOptions: LabelOption[];
  livePolygonPoints: Point[];
  polygonClosePointHover: boolean;
  polygonPoints: Point[];
  predictionPreviewFocusId: string | null;
  predictionPreviewShapes: AnnotationShape[];
  regionBorderWidth: number;
  selectedShape: AnnotationShape | null;
  selectedShapeId: string | null;
  task: TaskSummary;
  visibleShapes: AnnotationShape[];
};

type ImageAnnotationCanvasProps = CanvasBaseProps & {
  accessUrl: string;
  annotationCanvasWidth: number | string;
  onImageNaturalSize: (size: { height: number; width: number }) => void;
};

function ImageAnnotationCanvas({
  accessUrl,
  activeEdit,
  activeLabel,
  annotationCanvasRef,
  annotationCanvasWidth,
  draftShape,
  finishPolygon,
  handlePointerDown,
  handlePointerLeave,
  handlePointerMove,
  handlePointerUp,
  labelOptions,
  livePolygonPoints,
  onImageNaturalSize,
  polygonClosePointHover,
  polygonPoints,
  predictionPreviewFocusId,
  predictionPreviewShapes,
  regionBorderWidth,
  selectedShape,
  selectedShapeId,
  task,
  visibleShapes
}: ImageAnnotationCanvasProps) {
  return (
    <div
      className="annotation-canvas"
      onDoubleClick={finishPolygon}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={annotationCanvasRef}
      style={{ width: annotationCanvasWidth }}
    >
      <img
        alt={task.asset?.fileName ?? "Task asset"}
        draggable={false}
        onLoad={(event) => {
          onImageNaturalSize({
            height: event.currentTarget.naturalHeight,
            width: event.currentTarget.naturalWidth
          });
        }}
        src={accessUrl}
      />
      <AnnotationOverlay
        activeEdit={activeEdit}
        activeLabel={activeLabel}
        draftShape={draftShape}
        labelOptions={labelOptions}
        livePolygonPoints={livePolygonPoints}
        polygonClosePointHover={polygonClosePointHover}
        polygonPoints={polygonPoints}
        predictionPreviewFocusId={predictionPreviewFocusId}
        predictionPreviewShapes={predictionPreviewShapes}
        regionBorderWidth={regionBorderWidth}
        selectedShape={selectedShape}
        selectedShapeId={selectedShapeId}
        visibleShapes={visibleShapes}
      />
    </div>
  );
}

type PdfAnnotationCanvasProps = CanvasBaseProps & {
  accessUrl: string;
  activePdfPage: number;
  ocrBlocks: OcrBlock[];
  onAddOcrBlockRegion: (block: OcrBlock) => void;
  onPdfPageInfo: (pageInfo: PdfPageInfo) => void;
  pdfCanvasWidth: number | string;
  pdfPageInfo: PdfPageInfo | null;
  visibleOcrBlocks: OcrBlock[];
};

function PdfAnnotationCanvas({
  accessUrl,
  activeEdit,
  activeLabel,
  activePdfPage,
  annotationCanvasRef,
  draftShape,
  finishPolygon,
  handlePointerDown,
  handlePointerLeave,
  handlePointerMove,
  handlePointerUp,
  labelOptions,
  livePolygonPoints,
  ocrBlocks,
  onAddOcrBlockRegion,
  onPdfPageInfo,
  pdfCanvasWidth,
  pdfPageInfo,
  polygonClosePointHover,
  polygonPoints,
  predictionPreviewFocusId,
  predictionPreviewShapes,
  regionBorderWidth,
  selectedShape,
  selectedShapeId,
  task,
  visibleOcrBlocks,
  visibleShapes
}: PdfAnnotationCanvasProps) {
  return (
    <div
      className="annotation-canvas pdf-annotation-canvas"
      onDoubleClick={finishPolygon}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      ref={annotationCanvasRef}
      style={{
        width: pdfCanvasWidth,
        ...(pdfPageInfo ? { aspectRatio: `${pdfPageInfo.width} / ${pdfPageInfo.height}` } : {})
      }}
    >
      <PdfPageCanvas
        fileName={task.asset?.fileName ?? "PDF task asset"}
        onPageInfo={onPdfPageInfo}
        pageNumber={activePdfPage}
        pdfUrl={accessUrl}
      />
      {ocrBlocks.length > 0 && <span className="pdf-ocr-status">{visibleOcrBlocks.length} OCR blocks</span>}
      <AnnotationOverlay
        activeEdit={activeEdit}
        activeLabel={activeLabel}
        draftShape={draftShape}
        labelOptions={labelOptions}
        livePolygonPoints={livePolygonPoints}
        onAddOcrBlockRegion={onAddOcrBlockRegion}
        polygonClosePointHover={polygonClosePointHover}
        polygonPoints={polygonPoints}
        predictionPreviewFocusId={predictionPreviewFocusId}
        predictionPreviewShapes={predictionPreviewShapes}
        regionBorderWidth={regionBorderWidth}
        selectedShape={selectedShape}
        selectedShapeId={selectedShapeId}
        visibleOcrBlocks={visibleOcrBlocks}
        visibleShapes={visibleShapes}
      />
    </div>
  );
}

type AnnotationOverlayProps = {
  activeEdit: { id: string; kind: RegionEditKind } | null;
  activeLabel: string;
  draftShape: AnnotationShape | null;
  labelOptions: LabelOption[];
  livePolygonPoints: Point[];
  onAddOcrBlockRegion?: (block: OcrBlock) => void;
  polygonClosePointHover: boolean;
  polygonPoints: Point[];
  predictionPreviewFocusId: string | null;
  predictionPreviewShapes: AnnotationShape[];
  regionBorderWidth: number;
  selectedShape: AnnotationShape | null;
  selectedShapeId: string | null;
  visibleOcrBlocks?: OcrBlock[];
  visibleShapes: AnnotationShape[];
};

function AnnotationOverlay({
  activeEdit,
  activeLabel,
  draftShape,
  labelOptions,
  livePolygonPoints,
  onAddOcrBlockRegion,
  polygonClosePointHover,
  polygonPoints,
  predictionPreviewFocusId,
  predictionPreviewShapes,
  regionBorderWidth,
  selectedShape,
  selectedShapeId,
  visibleOcrBlocks = [],
  visibleShapes
}: AnnotationOverlayProps) {
  return (
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
            onAddOcrBlockRegion?.(block);
          }}
        >
          <rect height={block.height} rx="0.004" width={block.width} x={block.x} y={block.y} />
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
      {predictionPreviewShapes.map((shape) => (
        <AnnotationSvgShape
          activeEditKind={null}
          isSelected={shape.id === predictionPreviewFocusId}
          key={shape.id}
          labelOptions={labelOptions}
          mode="preview"
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
  );
}
