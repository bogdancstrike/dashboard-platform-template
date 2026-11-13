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

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import type { Dependency, Timeline, TimelineBar } from "@/api/planning";
import { knownStatusColor } from "@/theme/tokens";

import {
  anchors,
  arrowPath,
  brokenBy,
  daysFor,
  dragged,
  geometry,
  layout,
  shortDate,
  ticks,
  toDay,
  visibleLinks,
  ZOOMS,
  type DragMode,
  type Zoom,
} from "./gantt";

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

interface Preview {
  id: string;
  start: string;
  end: string;
  broken: number;
}

interface Linking {
  from: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  over: string | null;
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

  const beginDrag = (bar: TimelineBar, mode: DragMode) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    let moved = false;
    let latest: Preview | null = null;
    const move = (e: PointerEvent) => {
      const delta = daysFor(e.clientX - startX, zoom);
      if (!moved && Math.abs(e.clientX - startX) < 3) return;
      moved = true;
      const next = dragged(bar.start, bar.end, mode, delta);
      latest = { id: bar.id, ...next, broken: brokenBy(bar.id, next.start, next.end, data.dependencies, bars).length };
      setPreview(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.body.classList.remove("nx-dragging");
      setPreview(null);
      if (!moved) {
        if (mode === "move") onOpen(bar);
        return;
      }
      if (latest && (latest.start !== bar.start || latest.end !== bar.end)) {
        onSchedule(bar, latest.start, latest.end);
      }
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.body.classList.remove("nx-dragging");
      setPreview(null);
    };
    document.body.classList.add("nx-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const beginLink = (bar: TimelineBar) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!canEdit || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const anchor = shown.get(bar.id);
    if (!anchor) return;
    const origin = { x1: anchor.x2, y1: anchor.y };
    const target = (e: PointerEvent) => {
      const element = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-bar-id]");
      const id = element?.dataset.barId ?? null;
      return id && id !== bar.id ? id : null;
    };
    const move = (e: PointerEvent) => {
      const point = local(e.clientX, e.clientY);
      setLinking({ from: bar.id, ...origin, x2: point.x, y2: point.y, over: target(e) });
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("nx-dragging");
      setLinking(null);
      const over = target(e);
      if (over) onLink(bar.id, over);
    };
    document.body.classList.add("nx-dragging");
    setLinking({ from: bar.id, ...origin, x2: origin.x1, y2: origin.y1, over: null });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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

  const style = {
    "--nx-pl-row": `${rowHeight}px`,
    "--nx-pl-label": `${labelWidth}px`,
  } as CSSProperties;

  return (
    <div className={`nx-pl-gantt${compact ? " is-compact" : ""}`} style={style} data-testid="gantt">
      <div className="nx-pl-gantt-scroll" ref={scroller} data-drag-scroll>
        <div className="nx-pl-gantt-inner" style={{ width: labelWidth + width }}>
          <div className="nx-pl-gantt-head">
            <div className="nx-pl-gantt-corner">Work</div>
            <div className="nx-pl-gantt-scale" style={{ width }}>
              <div className="nx-pl-gantt-major">
                {scale.major.map((tick) => (
                  <span key={`M${tick.x}`} style={{ left: tick.x }}>
                    {tick.label}
                  </span>
                ))}
              </div>
              {todayX >= 0 && todayX <= width && (
                <span className="nx-pl-today-flag" style={{ left: todayX }}>
                  Today
                </span>
              )}
              <div className="nx-pl-gantt-minor">
                {scale.minor.map((tick) => (
                  <span
                    key={`m${tick.x}`}
                    className={tick.weekend ? "is-weekend" : undefined}
                    style={{ left: tick.x, width: zoom === "day" ? px : undefined }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

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
                  <div className="nx-pl-label">
                    <button
                      type="button"
                      className="nx-pl-fold"
                      aria-expanded={!folded.has(row.group.key)}
                      aria-label={`${folded.has(row.group.key) ? "Expand" : "Collapse"} ${row.group.label}`}
                      onClick={() =>
                        setFolded((current) => {
                          const next = new Set(current);
                          if (next.has(row.group.key)) next.delete(row.group.key);
                          else next.add(row.group.key);
                          return next;
                        })
                      }
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                    <i className="nx-pl-dot" style={{ background: row.group.color ?? "var(--nu-accent)" }} />
                    <span className="nx-pl-group-name" title={row.group.label}>
                      {row.group.label}
                    </span>
                    <span className="nx-pl-count">{row.group.count}</span>
                  </div>
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

            <svg
              className="nx-pl-links"
              style={{ left: labelWidth, width, height }}
              width={width}
              height={height}
              data-testid="gantt-links"
            >
              <defs>
                <marker id="nx-pl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="nx-pl-arrowhead" />
                </marker>
                <marker id="nx-pl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="nx-pl-arrowhead is-bad" />
                </marker>
              </defs>
              {links.map((link) => {
                const a = shown.get(link.predecessor_id)!;
                const b = shown.get(link.successor_id)!;
                const broken =
                  preview && (preview.id === link.predecessor_id || preview.id === link.successor_id)
                    ? b.x1 <= a.x2 + (link.lag_days - 1) * px
                    : link.violated;
                const path = arrowPath({ x: a.x2, y: a.y }, { x: b.x1, y: b.y }, rowHeight);
                const hot = critical.has(link.predecessor_id) && critical.has(link.successor_id);
                const name = `${bars.get(link.predecessor_id)?.reference} → ${bars.get(link.successor_id)?.reference}`;
                return (
                  <g
                    key={link.id}
                    className={`nx-pl-link${broken ? " is-broken" : ""}${hot ? " is-critical" : ""}`}
                    data-testid={`gantt-link-${link.id}`}
                  >
                    <path d={path} className="nx-pl-link-line" markerEnd={`url(#${broken ? "nx-pl-arrow-bad" : "nx-pl-arrow"})`} />
                    {canEdit && (
                      <path
                        d={path}
                        className="nx-pl-link-hit"
                        role="button"
                        tabIndex={0}
                        aria-label={`Dependency ${name}. Press to remove.`}
                        onClick={() => onUnlink(link)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === "Delete") onUnlink(link);
                        }}
                      >
                        <title>{`${name} — click to remove`}</title>
                      </path>
                    )}
                  </g>
                );
              })}
              {linking && (
                <path
                  className="nx-pl-link-draft"
                  d={`M${linking.x1},${linking.y1} L${linking.x2},${linking.y2}`}
                  markerEnd="url(#nx-pl-arrow)"
                  data-testid="gantt-link-draft"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupSpan({ group, from, zoom }: { group: Timeline["groups"][number]; from: string; zoom: Zoom }) {
  const { x, width } = geometry(group.start, group.end, from, zoom);
  return (
    <span
      className="nx-pl-span"
      style={{ left: x, width, ["--nx-pl-tone" as string]: group.color ?? "var(--nu-accent)" }}
      title={`${group.label}: ${shortDate(group.start)} – ${shortDate(group.end)}`}
    >
      {group.progress !== null && <i style={{ width: `${Math.min(100, group.progress)}%` }} />}
    </span>
  );
}

function Bar({
  bar,
  preview,
  from,
  zoom,
  critical,
  canEdit,
  linkTarget,
  onMove,
  onStart,
  onEnd,
  onLinkStart,
  onKeyDown,
}: {
  bar: TimelineBar;
  preview: Preview | null;
  from: string;
  zoom: Zoom;
  critical: boolean;
  canEdit: boolean;
  linkTarget: boolean;
  onMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onEnd: (event: ReactPointerEvent<HTMLElement>) => void;
  onLinkStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const start = preview?.start ?? bar.start;
  const end = preview?.end ?? bar.end;
  const { x, width } = geometry(start, end, from, zoom);
  const tone = bar.cover_color ?? knownStatusColor(bar.status) ?? "var(--nu-accent)";
  const label = `${bar.reference} ${bar.title}, ${shortDate(start)} to ${shortDate(end)}`;
  const classes = [
    "nx-pl-bar",
    bar.is_milestone ? "is-milestone" : "",
    bar.status === "DONE" ? "is-done" : "",
    critical ? "is-critical" : "",
    preview ? "is-dragging" : "",
    preview && preview.broken > 0 ? "is-conflict" : "",
    linkTarget ? "is-link-target" : "",
    bar.scheduled ? "" : "is-unscheduled",
    canEdit ? "is-editable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (bar.is_milestone) {
    return (
      <div
        className={classes}
        style={{ left: x + Math.max(0, width / 2 - 9), ["--nx-pl-tone" as string]: tone }}
        data-bar-id={bar.id}
        data-testid={`gantt-bar-${bar.reference}`}
        role="button"
        tabIndex={0}
        aria-label={`Milestone ${label}`}
        onPointerDown={onMove}
        onKeyDown={onKeyDown}
      >
        <i className="nx-pl-diamond" />
        <span className="nx-pl-bar-outside">{bar.title}</span>
      </div>
    );
  }

  return (
    <div
      className={classes}
      style={{ left: x, width, ["--nx-pl-tone" as string]: tone }}
      data-bar-id={bar.id}
      data-testid={`gantt-bar-${bar.reference}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={onMove}
      onKeyDown={onKeyDown}
    >
      <i className="nx-pl-bar-fill" style={{ width: `${Math.min(100, bar.progress)}%` }} />
      <span className="nx-pl-bar-text">{width > 70 ? bar.title : ""}</span>
      {canEdit && (
        <>
          <span className="nx-pl-grip is-start" onPointerDown={onStart} aria-hidden data-testid={`gantt-start-${bar.reference}`} />
          <span className="nx-pl-grip is-end" onPointerDown={onEnd} aria-hidden data-testid={`gantt-end-${bar.reference}`} />
          <span
            className="nx-pl-connector"
            onPointerDown={onLinkStart}
            title="Drag to another bar to make it wait on this one"
            aria-hidden
            data-testid={`gantt-connector-${bar.reference}`}
          />
        </>
      )}
      {preview && (
        <span className="nx-pl-bar-tip" role="status">
          {shortDate(start)} – {shortDate(end)}
          {preview.broken > 0 ? ` · breaks ${preview.broken} link${preview.broken === 1 ? "" : "s"}` : ""}
        </span>
      )}
      {width <= 70 && <span className="nx-pl-bar-outside">{bar.title}</span>}
    </div>
  );
}
