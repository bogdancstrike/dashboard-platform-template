import { useEffect, useRef, useState } from "react";
import { Button, Space, Spin, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";

import type { PassageBox } from "@/api/knowledge";

/**
 * One page of a PDF, drawn with pdf.js, with the cited passage marked (§44).
 *
 * The browser's own viewer can open a page (`#page=3`) but cannot mark a
 * passage on it, and a citation that lands on the right page and leaves the
 * reader to find the sentence is half a citation. The boxes come from the
 * converter — 0..1 from the top-left of the page — so they are drawn over the
 * canvas at whatever size it was rendered.
 *
 * pdf.js is loaded on first use, so it costs nothing to a page that never
 * opens a PDF.
 */

type PdfModule = typeof import("pdfjs-dist");
let loading: Promise<PdfModule> | null = null;

function loadPdf(): Promise<PdfModule> {
  loading ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return loading;
}

export function PdfPageHighlight({
  url,
  page: initialPage,
  boxes,
  loader = loadPdf,
}: {
  url: string;
  page: number;
  boxes: PassageBox[];
  /** Injected in tests; pdf.js needs a real canvas. */
  loader?: () => Promise<PdfModule>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(Math.max(1, initialPage || 1));
  const [pages, setPages] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [document, setDocument] = useState<Awaited<ReturnType<PdfModule["getDocument"]>["promise"]> | null>(
    null,
  );

  useEffect(() => setPage(Math.max(1, initialPage || 1)), [initialPage]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    loader()
      .then((pdfjs) => pdfjs.getDocument({ url }).promise)
      .then((loaded) => {
        if (cancelled) return;
        setDocument(loaded);
        setPages(loaded.numPages);
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [url, loader]);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    const target = canvas.current;
    document
      .getPage(Math.min(page, document.numPages))
      .then((pdfPage) => {
        const width = target.parentElement?.clientWidth || 640;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const ratio = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: (width / unscaled.width) * ratio });
        target.width = viewport.width;
        target.height = viewport.height;
        target.style.width = `${viewport.width / ratio}px`;
        target.style.height = `${viewport.height / ratio}px`;
        const context = target.getContext("2d");
        if (!context) throw new Error("no canvas");
        return pdfPage.render({ canvasContext: context, viewport }).promise;
      })
      .then(() => {
        if (cancelled) return;
        setState("ready");
        requestAnimationFrame(() => {
          const mark = target.parentElement?.querySelector(".nx-kn-mark");
          if (mark && typeof mark.scrollIntoView === "function") mark.scrollIntoView({ block: "center" });
        });
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [document, page]);

  const marks = boxes.filter((box) => box.page === page);

  return (
    <div className="nx-kn-pdf" data-testid="citation-pdf">
      <div className="nx-kn-pdf-bar">
        <Space size={6}>
          <Button
            shape="circle"
            aria-label="Previous page"
            icon={<LeftOutlined />}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          />
          <Typography.Text data-testid="citation-pdf-page">
            Page {page}
            {pages ? ` of ${pages}` : ""}
          </Typography.Text>
          <Button
            shape="circle"
            aria-label="Next page"
            icon={<RightOutlined />}
            disabled={pages !== null && page >= pages}
            onClick={() => setPage((p) => p + 1)}
          />
        </Space>
        {page !== initialPage && (
          <Button type="text" onClick={() => setPage(initialPage)}>
            Back to the cited page
          </Button>
        )}
      </div>
      <div className="nx-kn-pdf-page">
        {state === "loading" && (
          <div className="nx-kn-pdf-wait">
            <Spin />
          </div>
        )}
        {state === "error" && (
          <Typography.Text type="secondary" className="nx-kn-pdf-wait">
            The page could not be drawn here. Download the file to read it.
          </Typography.Text>
        )}
        <canvas ref={canvas} aria-label={`Page ${page}`} />
        {state === "ready" &&
          marks.map((box, index) => (
            <span
              key={index}
              className="nx-kn-mark"
              data-testid="citation-mark"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            />
          ))}
      </div>
    </div>
  );
}
