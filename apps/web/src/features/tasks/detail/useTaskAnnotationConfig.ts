import { useMemo } from "react";

import type { TaskSummary } from "../../../api";
import {
  dedupeDrawingTools,
  formatControlName,
  getConfigString,
  parseChoiceControls,
  parseDateTimeControls,
  parseNumberControls,
  parseRatingControls,
  parseRegionDrawingTools,
  parseTemplateSources,
  parseTemporalLabelControls,
  parseTextAreaControls
} from "../annotation/templateForm";
import { getLabelOptions, getRegionBorderWidth, getToolOptions } from "../annotation/geometry";
import { extractOcrBlocks, type PdfPageInfo } from "../assets/ocr";
import { formatEnum } from "../../../utils/format";

type UseTaskAnnotationConfigInput = {
  pdfPageInfo: PdfPageInfo | null;
  task: TaskSummary | null;
};

export function useTaskAnnotationConfig({ pdfPageInfo, task }: UseTaskAnnotationConfigInput) {
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
  const ocrBlocks = useMemo(
    () => extractOcrBlocks(task, pdfPageInfo, pdfSource?.name ?? "pdf"),
    [pdfPageInfo, pdfSource?.name, task]
  );
  const formControls = useMemo(
    () => [...choiceControls, ...textAreaControls, ...numberControls, ...ratingControls, ...dateTimeControls, ...temporalControls],
    [choiceControls, dateTimeControls, numberControls, ratingControls, temporalControls, textAreaControls]
  );
  const formToolLabels = useMemo(
    () => formControls.length > 0
      ? formControls.map((control) => formatControlName(control.name))
      : toolOptions.filter((tool) => !["BBOX", "POLYGON"].includes(tool)).map(formatEnum),
    [formControls, toolOptions]
  );
  const usesTemplateForm = !supportsRegionDrawing && (formControls.length > 0 || templateSources.some((source) => source.type !== "UNKNOWN"));

  return {
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
    toolOptions,
    usesTemplateForm
  };
}
