/**
 * One live demo, with its code a toggle away (§60).
 *
 * The stage can be drawn in the reader's appearance, or forced light or dark,
 * by giving the stage its own theme and its own copy of the custom properties
 * — the same two things `AppearanceProvider` gives the whole document — so a
 * reviewer sees both without flipping the whole app.
 */
import { Button, ConfigProvider, Segmented } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppearance } from "@/theme/AppearanceProvider";
import { buildTheme, cssVariables } from "@/theme/antd";

import { CodeBlock } from "./CodeBlock";
import { DEMOS, DEMO_SOURCE } from "./sources";

type StageMode = "app" | "light" | "dark";

export function Stage({ mode, children, className }: { mode: StageMode; children: React.ReactNode; className?: string }) {
  const appearance = useAppearance();
  const drawn = mode === "app" ? appearance.mode : mode;
  const theme = useMemo(() => buildTheme(drawn, appearance.density), [drawn, appearance.density]);
  const vars = useMemo(() => {
    const all = cssVariables(drawn, appearance.density);
    delete all["--nu-zoom"];
    return all;
  }, [drawn, appearance.density]);
  if (mode === "app") return <div className={`nx-doc-stage ${className ?? ""}`}>{children}</div>;
  return (
    <ConfigProvider theme={theme}>
      <div className={`nx-doc-stage nx-doc-stage--${drawn} ${className ?? ""}`} style={vars} data-stage-theme={drawn}>
        {children}
      </div>
    </ConfigProvider>
  );
}

/**
 * True once the element has come near the viewport.
 *
 * Sixty-five live demos — charts among them — are a lot to mount at once, so a
 * demo draws when it is about to be seen. Where there is no
 * IntersectionObserver (a test's DOM) it waits for a press instead, unless the
 * caller says the page is small enough to draw everything.
 */
function useNear(eager: boolean) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [near]);
  return { ref, near, show: () => setNear(true) };
}

export function DemoFrame({
  id,
  title,
  note,
  eager = false,
}: {
  id: string;
  title: string;
  note?: string;
  /** Draw at once rather than when it scrolls near. */
  eager?: boolean;
}) {
  const { ref, near, show } = useNear(eager);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [mode, setMode] = useState<StageMode>("app");
  const Demo = DEMOS[id]?.default;
  const source = DEMO_SOURCE[id] ?? "";

  return (
    <figure className="nx-doc-demo" data-testid={`demo-file-${id}`} ref={ref}>
      <figcaption className="nx-doc-demohead">
        <span className="nx-doc-demotitle">
          <b>{title}</b>
          {note && <span>{note}</span>}
        </span>
        <span className="nx-doc-demotools">
          {view === "preview" && (
            <Segmented
              size="small"
              aria-label={`${title}: theme of the stage`}
              value={mode}
              onChange={(value) => setMode(value as StageMode)}
              options={[
                { value: "app", label: "App" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          )}
          <Segmented
            size="small"
            aria-label={`${title}: preview or code`}
            value={view}
            onChange={(value) => setView(value as "preview" | "code")}
            options={[
              { value: "preview", label: "Preview" },
              { value: "code", label: "Code" },
            ]}
          />
        </span>
      </figcaption>
      {view === "preview" && !near ? (
        <div className="nx-doc-stage nx-doc-stage--pending">
          <Button onClick={show}>Show the demo</Button>
        </div>
      ) : view === "preview" ? (
        <Stage mode={mode}>{Demo ? <Demo /> : <em>Missing demo file: {id}.tsx</em>}</Stage>
      ) : (
        <CodeBlock code={source} file={`${id}.tsx`} />
      )}
    </figure>
  );
}
