/**
 * The Gantt chart (§18): rows of work, bars in time, arrows between them.
 *
 * Built from DOM and one SVG layer rather than a charting library, because
 * every gesture on it is a *write* — drag a bar to move it, drag an end to
 * resize it, drag from a bar's end dot to another bar to make one wait on the
 * other — and a canvas chart that has to be taught each of those is more code
 * than drawing the rectangles.
 *
 * * **A drag previews before it writes.** The bar follows the pointer a whole
 *   day at a time, a label says the dates it will get, and it turns amber the
 *   moment it would break a dependency — so the warning comes before the drop
 *   rather than after the round trip.
 * * **The keyboard does the same.** A focused bar moves a day with ←/→, its end
 *   with Shift+←/→, and opens with Enter (§54).
 * * **The page owns the data and the writes**; this owns the gestures.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { Dependency, Timeline, TimelineBar } from "@/api/planning";

import {
  anchors,
  dragged,
  geometry,
  layout,
  ticks,
  toDay,
  visibleLinks,
  ZOOMS,
  type DragMode,
  type Zoom,
} from "../gantt";

import { Bar, GroupSpan } from "./GanttBar";
import { Linking, Preview } from "./types";

import { startBarDrag, startLinkDrag } from "./gestures";
import { GroupLabel } from "./GroupLabel";
import { GanttLinks } from "./GanttLinks";
import { GanttScale } from "./GanttScale";

export interface GanttProps {
  data: Timeline;
  zoom: Zoom;
  /** The window drawn — usually `data.range`. */
  from: string;
  to: string;
  showCritical?: boolean;
  canEdit: boolean;
  /** Narrow label column and shorter rows, for a phone. */
  compact?: boolean;
  onSchedule: (bar: TimelineBar, start: string, end: string) => void;
  onLink: (predecessorId: string, successorId: string) => void;
  onUnlink: (link: Dependency) => void;
  onOpen: (bar: TimelineBar) => void;
}

export function Gantt({
  data,
  zoom,
  from,
  to,
  showCritical = false,
  canEdit,
  compact = false,
  onSchedule,
  onLink,
  onUnlink,
  onOpen,
}: GanttProps) {
  const rowHeight = compact ? 34 : 40;
  const labelWidth = compact ? 132 : 268;
  const px = ZOOMS[zoom].px;
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => layout(data.groups, folded, rowHeight), [data.groups, folded, rowHeight]);
  const bars = useMemo(() => {
    const map = new Map<string, TimelineBar>();
    for (const group of data.groups) for (const bar of group.items) map.set(bar.id, bar);
    return map;
  }, [data.groups]);
  const span = toDay(to) - toDay(from) + 1;
  const width = Math.max(1, span * px);
  const height = rows.length * rowHeight;
  const scale = useMemo(() => ticks(from, to, zoom), [from, to, zoom]);
  const today = data.range.today;
  const todayX = (toDay(today) - toDay(from)) * px + px / 2;

  // With a preview in flight, arrows follow the bar being dragged.
  const shown = useMemo(() => {
    const placed = anchors(rows, from, zoom, rowHeight);
    if (preview) {
      const { x, width: w } = geometry(preview.start, preview.end, from, zoom);
      const anchor = placed.get(preview.id);
      if (anchor) placed.set(preview.id, { x1: x, x2: x + w, y: anchor.y });
    }
    return placed;
  }, [rows, from, zoom, rowHeight, preview]);
  const links = visibleLinks(data.dependencies, shown);
  const critical = new Set(showCritical ? data.critical_path : []);

  // Open on today, a little in from the left edge.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollLeft = Math.max(0, todayX - Math.min(element.clientWidth * 0.25, 240));
    // Only when the zoom or window changes — not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, from]);

  /** Pointer position in canvas coordinates. */
  const local = (clientX: number, clientY: number) => {
    const box = body.current?.getBoundingClientRect();
    return { x: clientX - (box?.left ?? 0) - labelWidth, y: clientY - (box?.top ?? 0) };
  };

  const beginDrag = (bar: TimelineBar, mode: DragMode) => (event: ReactPointerEvent<HTMLElement>) =>
    startBarDrag(event, { bar, mode, canEdit, zoom, dependencies: data.dependencies, bars, setPreview, onOpen, onSchedule });

  const beginLink = (bar: TimelineBar) => (event: ReactPointerEvent<HTMLElement>) =>
    startLinkDrag(event, { bar, canEdit, shown, local, setLinking, onLink });

  const onKey = (bar: TimelineBar) => (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onOpen(bar);
      return;
    }
    if (!canEdit || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    const next = dragged(bar.start, bar.end, event.shiftKey ? "end" : "move", delta);
    onSchedule(bar, next.start, next.end);
  };

  const style = { "--nx-pl-row": `${rowHeight}px`, "--nx-pl-label": `${labelWidth}px` } as CSSProperties;

  return (
    <div className={`nx-pl-gantt${compact ? " is-compact" : ""}`} style={style} data-testid="gantt">
      <div className="nx-pl-gantt-scroll" ref={scroller} data-drag-scroll>
        <div className="nx-pl-gantt-inner" style={{ width: labelWidth + width }}>
          <GanttScale scale={scale} todayX={todayX} width={width} zoom={zoom} px={px} />

          <div className="nx-pl-gantt-body" ref={body} style={{ height }}>
            <div className="nx-pl-gantt-grid" style={{ left: labelWidth, width, height }} aria-hidden>
              {scale.minor.map((tick) => (
                <i
                  key={`g${tick.x}`}
                  className={tick.weekend ? "is-weekend" : undefined}
                  style={{ left: tick.x, width: tick.weekend ? px : undefined }}
                />
              ))}
              {todayX >= 0 && todayX <= width && (
                <b className="nx-pl-today" style={{ left: todayX }} data-testid="gantt-today" />
              )}
            </div>

            {rows.map((row) =>
              row.kind === "group" ? (
                <div key={row.key} className="nx-pl-row is-group" style={{ height: rowHeight }}>
                  <GroupLabel
                    group={row.group}
                    folded={folded.has(row.group.key)}
                    onToggle={() =>
                      setFolded((current) => {
                        const next = new Set(current);
                        if (next.has(row.group.key)) next.delete(row.group.key);
                        else next.add(row.group.key);
                        return next;
                      })
                    }
                  />
                  <div className="nx-pl-track" style={{ width }}>
                    <GroupSpan group={row.group} from={from} zoom={zoom} />
                  </div>
                </div>
              ) : (
                <div key={row.key} className="nx-pl-row" style={{ height: rowHeight }}>
                  <div className="nx-pl-label" title={`${row.bar.reference} ${row.bar.title}`}>
                    <span className="nx-pl-ref">{row.bar.reference}</span>
                    <span className="nx-pl-title">{row.bar.title}</span>
                    {row.bar.assignee && !compact && (
                      <span className="nx-pl-who" title={row.bar.assignee.name}>
                        {row.bar.assignee.initials}
                      </span>
                    )}
                  </div>
                  <div className="nx-pl-track" style={{ width }}>
                    <Bar
                      bar={row.bar}
                      preview={preview?.id === row.bar.id ? preview : null}
                      from={from}
                      zoom={zoom}
                      critical={critical.has(row.bar.id)}
                      canEdit={canEdit}
                      linkTarget={linking?.over === row.bar.id}
                      onMove={beginDrag(row.bar, "move")}
                      onStart={beginDrag(row.bar, "start")}
                      onEnd={beginDrag(row.bar, "end")}
                      onLinkStart={beginLink(row.bar)}
                      onKeyDown={onKey(row.bar)}
                    />
                  </div>
                </div>
              ),
            )}

            <GanttLinks
              links={links}
              shown={shown}
              preview={preview}
              linking={linking}
              critical={critical}
              bars={bars}
              px={px}
              rowHeight={rowHeight}
              labelWidth={labelWidth}
              width={width}
              height={height}
              canEdit={canEdit}
              onUnlink={onUnlink}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
