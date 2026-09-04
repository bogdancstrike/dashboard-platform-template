/**
 * The relationship graph, drawn as SVG (§50).
 *
 * A radial layout, not a force simulation: the picture has one subject at its
 * centre and everything else is one hop away, so the arrangement is known in
 * advance and can be laid out deterministically. A simulation would spend
 * frames converging on the same answer and land somewhere different each time,
 * which makes two screenshots of one record look like two different records.
 *
 * It is drawn with no charting dependency because it needs no scales, axes or
 * interpolation — twenty nodes on a circle is arithmetic.
 *
 * The list beside it is the accessible equivalent and the primary control; this
 * carries `role="img"` and one description of the whole picture rather than
 * pretending each circle is a focusable element that a screen reader can walk.
 */

import { useMemo } from "react";

import type { RelationGroup, RelatedNode } from "@/api/relationships";

export interface RelationshipGraphProps {
  root: RelatedNode;
  groups: RelationGroup[];
  /** Opens a node; only explorable ones are offered. */
  onOpen: (node: RelatedNode, entity: string) => void;
}

const SIZE = 560;
const CENTRE = SIZE / 2;
const RADIUS = 200;
/** Beyond this the ring is unreadable, and the list is the better answer. */
const MAX_NODES = 24;

interface Placed {
  node: RelatedNode;
  group: RelationGroup;
  x: number;
  y: number;
}

export function RelationshipGraph({ root, groups, onOpen }: RelationshipGraphProps) {
  const placed = useMemo<Placed[]>(() => {
    // One node per relation first, so every kind of connection is represented
    // before any single relation fills the ring.
    const ordered: Array<{ node: RelatedNode; group: RelationGroup }> = [];
    const remaining = groups.map((group) => ({ group, items: [...group.items] }));
    while (ordered.length < MAX_NODES && remaining.some((entry) => entry.items.length > 0)) {
      for (const entry of remaining) {
        const node = entry.items.shift();
        if (node) ordered.push({ node, group: entry.group });
        if (ordered.length >= MAX_NODES) break;
      }
    }

    return ordered.map((entry, index) => {
      const angle = (index / ordered.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...entry,
        x: CENTRE + Math.cos(angle) * RADIUS,
        y: CENTRE + Math.sin(angle) * RADIUS,
      };
    });
  }, [groups]);

  const hidden = groups.reduce((total, group) => total + group.items.length, 0) - placed.length;

  return (
    <figure className="nu-graph">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${root.label} and its ${placed.length} nearest connections`}
      >
        {placed.map(({ node, group, x, y }) => (
          <line
            key={`edge-${node.entity}-${node.id}`}
            className={`nu-graph-edge nu-graph-edge--${group.direction}`}
            x1={CENTRE}
            y1={CENTRE}
            x2={x}
            y2={y}
          />
        ))}

        {placed.map(({ node, group, x, y }) => (
          <g
            key={`node-${node.entity}-${node.id}`}
            className={`nu-graph-node${node.explorable ? " is-open" : ""}`}
            transform={`translate(${x} ${y})`}
            {...(node.explorable
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `Open ${node.label}`,
                  onClick: () => onOpen(node, group.target),
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(node, group.target);
                    }
                  },
                }
              : {})}
          >
            <circle r={26} />
            <text y={4}>{initials(node.label)}</text>
            <text className="nu-graph-caption" y={44}>
              {truncate(node.label, 18)}
            </text>
          </g>
        ))}

        <g className="nu-graph-node nu-graph-node--root" transform={`translate(${CENTRE} ${CENTRE})`}>
          <circle r={38} />
          <text y={5}>{initials(root.label)}</text>
          <text className="nu-graph-caption" y={58}>
            {truncate(root.label, 22)}
          </text>
        </g>
      </svg>
      <figcaption>
        {placed.length} of {placed.length + Math.max(0, hidden)} connections shown
        {hidden > 0 && " — the list has the rest"}.
      </figcaption>
    </figure>
  );
}

function initials(label: string): string {
  const words = label.split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  // A reference like TSK-00042 reads better as its number than as "T0".
  const digits = label.match(/\d{2,}/);
  if (digits && words.length <= 2) return digits[0].slice(-3);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

function truncate(value: string, at: number): string {
  return value.length <= at ? value : `${value.slice(0, at - 1)}…`;
}
