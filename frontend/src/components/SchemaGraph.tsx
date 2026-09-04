import { Typography } from "antd";
import { useMemo, useState } from "react";

import type { MapEdge, MapNode } from "@/api/relationships";
import { categoryColor } from "@/theme/tokens";

const { Text } = Typography;

/**
 * The platform's entities and how they link, as one picture (§50).
 *
 * Deterministic by construction: entities are laid out on a circle in a fixed
 * order, so two screenshots of the same data are the same picture. A force
 * simulation would settle somewhere different on every load, which makes a
 * diagram impossible to talk about — "the node on the left" stops meaning
 * anything.
 *
 * What the picture encodes, and nothing else:
 * * **node size** — how many records the entity holds;
 * * **edge thickness** — how many rows actually carry that foreign key;
 * * **edge colour** — only when one is selected, because a graph where every
 *   line is a different colour encodes nothing at all.
 *
 * Plain SVG rather than a graph library: eleven nodes and forty edges is a
 * layout that fits in a screenful of code, and it keeps the chart bundle out
 * of a page that is mostly a table.
 */
export interface SchemaGraphProps {
  nodes: MapNode[];
  edges: MapEdge[];
  /** The relation the reader is inspecting, drawn in the accent. */
  selected?: string;
  onSelectEdge?: (edge: MapEdge) => void;
  onSelectNode?: (node: MapNode) => void;
}

const SIZE = 640;
const CENTRE = SIZE / 2;
const RADIUS = SIZE / 2 - 96;

export function SchemaGraph({
  nodes,
  edges,
  selected,
  onSelectEdge,
  onSelectNode,
}: SchemaGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  /** Where each entity sits. Ordered by the server, so the layout is stable. */
  const placed = useMemo(() => {
    const step = (2 * Math.PI) / Math.max(nodes.length, 1);
    const biggest = Math.max(...nodes.map((node) => node.count), 1);
    return nodes.map((node, index) => {
      // Start at the top and go clockwise, so the largest entity is always at
      // twelve o'clock and the reader has a fixed anchor.
      const angle = -Math.PI / 2 + index * step;
      return {
        ...node,
        x: CENTRE + RADIUS * Math.cos(angle),
        y: CENTRE + RADIUS * Math.sin(angle),
        // Area, not radius, tracks the count — a radius scale exaggerates a
        // difference by squaring it.
        r: 14 + 20 * Math.sqrt(node.count / biggest),
        angle,
      };
    });
  }, [nodes]);

  const byKey = useMemo(
    () => new Map(placed.map((node) => [node.key, node])),
    [placed],
  );

  const heaviest = Math.max(...edges.map((edge) => edge.count), 1);

  const drawn = edges
    .map((edge) => ({
      edge,
      from: byKey.get(edge.source),
      to: byKey.get(edge.target),
    }))
    .filter((item) => item.from && item.to && item.from !== item.to);

  const activeKey = (edge: MapEdge) => `${edge.source}:${edge.relation}`;

  return (
    <div className="nu-schema-graph">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${nodes.length} entities connected by ${edges.length} relations`}
      >
        <g>
          {drawn.map(({ edge, from, to }) => {
            const key = activeKey(edge);
            const active = selected === key || hovered === key;
            // A quadratic curve bowed toward the centre: two entities linked
            // both ways get two visible lines instead of one drawn twice.
            const midX = (from!.x + to!.x) / 2;
            const midY = (from!.y + to!.y) / 2;
            const bow = 0.22;
            const cx = midX + (CENTRE - midX) * bow;
            const cy = midY + (CENTRE - midY) * bow;
            return (
              <path
                key={key}
                className={`nu-schema-edge${active ? " nu-schema-edge--active" : ""}`}
                d={`M ${from!.x} ${from!.y} Q ${cx} ${cy} ${to!.x} ${to!.y}`}
                strokeWidth={1 + 5 * Math.sqrt(edge.count / heaviest)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectEdge?.(edge)}
              >
                <title>
                  {edge.source_label} → {edge.target_label} · {edge.label} ·{" "}
                  {edge.count.toLocaleString()} links ({edge.coverage}% of{" "}
                  {edge.source_label.toLowerCase()})
                </title>
              </path>
            );
          })}
        </g>

        <g>
          {placed.map((node) => {
            const touching =
              hovered !== null &&
              drawn.some(
                ({ edge }) =>
                  activeKey(edge) === hovered &&
                  (edge.source === node.key || edge.target === node.key),
              );
            return (
              <g
                key={node.key}
                className={`nu-schema-node${touching ? " nu-schema-node--active" : ""}`}
                onClick={() => onSelectNode?.(node)}
                role={onSelectNode ? "button" : undefined}
                tabIndex={onSelectNode ? 0 : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectNode?.(node);
                  }
                }}
                aria-label={`${node.label}, ${node.count.toLocaleString()} records`}
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.r}
                  fill={categoryColor(node.key, placed.indexOf(node))}
                />
                <text x={node.x} y={node.y + node.r + 15} textAnchor="middle">
                  {node.label}
                </text>
                <text
                  x={node.x}
                  y={node.y + node.r + 29}
                  textAnchor="middle"
                  className="nu-schema-count"
                >
                  {node.count.toLocaleString()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <Text type="secondary" className="nu-schema-legend">
        Circle area is how many records an entity holds; line thickness is how
        many rows carry that link. Hover a line to read it, or click to see the
        records behind it.
      </Text>
    </div>
  );
}
