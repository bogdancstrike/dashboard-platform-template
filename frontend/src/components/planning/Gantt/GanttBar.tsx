import { type PointerEvent as ReactPointerEvent } from "react";

import type { Timeline, TimelineBar } from "@/api/planning";
import { knownStatusColor } from "@/theme/tokens";

import { geometry, shortDate, type Zoom } from "../gantt";

import { Preview } from "./types";

export function GroupSpan({ group, from, zoom }: { group: Timeline["groups"][number]; from: string; zoom: Zoom }) {
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

export function Bar({
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
