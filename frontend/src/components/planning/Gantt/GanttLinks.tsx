import type { Dependency, TimelineBar } from "@/api/planning";

import { anchors, arrowPath } from "../gantt";

import { Linking, Preview } from "./types";

/** The dependency arrows — red where a preview or the plan breaks one — and the draft arrow while linking. */
export function GanttLinks({
  links,
  shown,
  preview,
  linking,
  critical,
  bars,
  px,
  rowHeight,
  labelWidth,
  width,
  height,
  canEdit,
  onUnlink,
}: {
  links: Dependency[];
  shown: ReturnType<typeof anchors>;
  preview: Preview | null;
  linking: Linking | null;
  critical: Set<string>;
  bars: Map<string, TimelineBar>;
  px: number;
  rowHeight: number;
  labelWidth: number;
  width: number;
  height: number;
  canEdit: boolean;
  onUnlink: (link: Dependency) => void;
}) {
  return (
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
  );
}
