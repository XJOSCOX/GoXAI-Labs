import type { TaskSummary } from "../../../api";
import { clamp } from "../annotation/geometry";

export interface PdfPageInfo {
  height: number;
  pageCount: number;
  width: number;
}

export interface OcrBlock {
  height: number;
  id: string;
  page: number;
  sourceName?: string;
  text: string;
  width: number;
  x: number;
  y: number;
}

export function extractOcrBlocks(task: TaskSummary | null | undefined, pageInfo: PdfPageInfo | null, defaultSourceName: string): OcrBlock[] {
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

function getStringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getNumberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
