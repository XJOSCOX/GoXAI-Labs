import type { PdfPageInfo } from "./ocr";

export function getAnnotationCanvasWidth({
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

export function getPdfCanvasWidth({
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
