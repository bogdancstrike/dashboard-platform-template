/**
 * One record and everything around it, as a force graph (§50).
 *
 * The ego network: the subject in the middle, its connections one hop out,
 * grouped by the relation that produced them. It used to be laid out on a
 * fixed ring; force layout replaced it so that the relations *separate* —
 * eight orders settle into one arm and two tickets into another, which a ring
 * ordered by index cannot show — and so that this behaves like the other two
 * graphs on the page: drag it, zoom it, double-click to follow.
 *
 * Colour is the relation, not the entity type: "what is attached to this, and
 * how" is the question the picture answers, and two tickets that reach the
 * record by different foreign keys are two different answers.
 */

import { useMemo } from "react";

import type { RelatedNode, RelationGroup } from "@/api/relationships";
import { ForceGraph, type GraphLink, type GraphNode } from "@/components/graph/ForceGraph";
import { NEUTRAL, SERIES } from "@/theme/tokens";

/** Past this the picture is a hairball and the grouped list is the answer. */
const MAX_NODES = 60;

export interface EgoGraphProps {
  root: RelatedNode;
  groups: RelationGroup[];
  onOpen: (node: RelatedNode, entity: string) => void;
}

export function EgoGraph({ root, groups, onOpen }: EgoGraphProps) {
  /** Round-robin across relations, so no single relation fills the budget. */
  const drawn = useMemo(() => {
    const taken: Array<{ node: RelatedNode; group: RelationGroup; index: number }> = [];
    const queues = groups.map((group, index) => ({ group, index, items: [...group.items] }));
    while (taken.length < MAX_NODES && queues.some((queue) => queue.items.length > 0)) {
      for (const queue of queues) {
        const node = queue.items.shift();
        if (node) taken.push({ node, group: queue.group, index: queue.index });
        if (taken.length >= MAX_NODES) break;
      }
    }
    return taken;
  }, [groups]);

  const nodes = useMemo<GraphNode[]>(() => {
    const centre: GraphNode = {
      key: "root",
      label: root.label,
      size: 16,
      color: NEUTRAL[700],
      ring: true,
      labelled: true,
      title: [root.label, root.summary].filter(Boolean).join(" — "),
    };
    return [
      centre,
      ...drawn.map(({ node, group, index }) => ({
        key: `${group.target}:${node.id}`,
        label: node.label,
        size: 9,
        color: SERIES[index % SERIES.length] ?? SERIES[0],
        group: group.relation,
        labelled: drawn.length <= 24,
        openable: node.explorable,
        title: [node.label, node.summary, group.label].filter(Boolean).join(" — "),
      })),
    ];
  }, [drawn, root]);

  const links = useMemo<GraphLink[]>(
    () =>
      drawn.map(({ node, group }) => ({
        source: "root",
        target: `${group.target}:${node.id}`,
        label: group.label,
        // Inbound and outbound are different facts; dashed reads as "points
        // at this record" without a second colour channel.
        dashed: group.direction === "inbound",
      })),
    [drawn],
  );

  const byKey = useMemo(
    () =>
      new Map(
        drawn.map(({ node, group }) => [`${group.target}:${node.id}`, { node, entity: group.target }]),
      ),
    [drawn],
  );

  const total = groups.reduce((sum, group) => sum + group.total, 0);

  return (
    <figure className="nu-graph">
      <ForceGraph
        nodes={nodes}
        links={links}
        height={460}
        charge={-260}
        onOpen={(key) => {
          const found = byKey.get(key);
          if (found) onOpen(found.node, found.entity);
        }}
        description={`${root.label} and its ${drawn.length} nearest connections, grouped by ${groups.length} relations.`}
      />
      <figcaption>
        {drawn.length} of {total} connections shown
        {total > drawn.length && " — the list has the rest"}. Double-click one to follow it.
      </figcaption>
    </figure>
  );
}
