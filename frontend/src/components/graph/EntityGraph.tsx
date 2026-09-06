/**
 * The platform's entity types and how they link, as a force graph (§50).
 *
 * The same D3 machinery the record network uses, over a much smaller graph:
 * eleven entities and forty foreign keys. Force rather than the fixed ring it
 * used to be, because the two pictures on this page should behave the same
 * way — a reader who has learned to drag and zoom one should not find the
 * other inert — and because the layout *says* something here: entities that
 * link to each other settle next to each other, which a ring cannot show.
 *
 * Node size is the row count, on a square-root scale so that a table with a
 * hundred times more rows is ten times wider rather than a hundred: area is
 * what the eye reads, and a linear radius makes the largest entity swallow the
 * canvas. Edge width is how many rows actually carry the foreign key.
 */

import { useMemo } from "react";

import type { MapEdge, MapNode } from "@/api/relationships";
import { ForceGraph, type GraphLink, type GraphNode } from "@/components/graph/ForceGraph";
import { SERIES } from "@/theme/tokens";

export interface EntityGraphProps {
  nodes: MapNode[];
  edges: MapEdge[];
  /** The relation being inspected — its two ends are spotlit. */
  selected?: MapEdge | null;
  onSelectNode?: (node: MapNode) => void;
}

export function EntityGraph({ nodes, edges, selected, onSelectNode }: EntityGraphProps) {
  const biggest = Math.max(...nodes.map((node) => node.count), 1);
  const heaviest = Math.max(...edges.map((edge) => edge.count), 1);

  const drawn = useMemo<GraphNode[]>(
    () =>
      nodes.map((node, index) => ({
        key: node.key,
        label: node.label,
        // √ scale: the eye reads area, and 15 000 orders next to 6 regions on
        // a linear radius is one circle and five dots.
        size: 10 + Math.sqrt(node.count / biggest) * 22,
        color: SERIES[index % SERIES.length] ?? SERIES[0],
        group: node.key,
        ring: node.explorable,
        labelled: true,
        openable: node.explorable,
        title: `${node.label}, ${node.count.toLocaleString()} records`,
      })),
    [nodes, biggest],
  );

  const links = useMemo<GraphLink[]>(
    () =>
      edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        label: `${edge.source_label} → ${edge.target_label} as ${edge.label.toLowerCase()} · ${edge.count.toLocaleString()} links`,
        weight: 0.8 + (edge.count / heaviest) * 3.4,
      })),
    [edges, heaviest],
  );

  const byKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);

  return (
    <ForceGraph
      nodes={drawn}
      links={links}
      height={440}
      charge={-900}
      spotlight={selected ? [selected.source, selected.target] : null}
      onSelect={(key) => {
        const node = key ? byKey.get(key) : undefined;
        if (node) onSelectNode?.(node);
      }}
      onOpen={(key) => {
        const node = byKey.get(key);
        if (node) onSelectNode?.(node);
      }}
      description={`${nodes.length} entities connected by ${edges.length} relations`}
    />
  );
}
