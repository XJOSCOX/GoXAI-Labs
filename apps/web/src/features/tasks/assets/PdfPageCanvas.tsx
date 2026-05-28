import { useEffect, useRef, useState } from "react";
import type { PdfPageInfo } from "./ocr";

export function PdfPageCanvas({
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
