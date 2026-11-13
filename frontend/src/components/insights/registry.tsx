/**
 * The insight UI-spec registry: which component draws each node type (§43).
 *
 * Keyed on the node's `type`, so a component the spec grows without an entry
 * here fails to compile rather than leaving an empty card. Sections are not
 * here: they hold other nodes and are drawn by `InsightView`'s `Block`.
 */

import { MiniMarkdown } from "@/components/knowledge/MiniMarkdown";

import { Chart } from "./nodes/Chart";
import { Comparison } from "./nodes/Comparison";
import { DataList } from "./nodes/DataList";
import { DataTable } from "./nodes/DataTable";
import { Kpi } from "./nodes/Kpi";
import { ProgressBlock } from "./nodes/ProgressBlock";
import { TimelineBlock } from "./nodes/TimelineBlock";
import type { InsightNode } from "./spec";

type Drawn = Exclude<InsightNode, { type: "section" }>;

/** The node whose `type` admits `T` — a chart node declares four types at once. */
type NodeOf<T extends Drawn["type"]> = Drawn extends infer N
  ? N extends { type: infer K }
    ? T extends K
      ? N
      : never
    : never
  : never;

type NodeBody<T extends Drawn["type"]> = (props: {
  node: NodeOf<T>;
  compact: boolean;
}) => JSX.Element;

type Registry = { [T in Drawn["type"]]: NodeBody<T> };

const chart: NodeBody<"bar" | "line" | "area" | "pie"> = ({ node, compact }) => (
  <Chart node={node} height={compact ? 180 : 240} />
);

export const NODE_BODIES: Registry = {
  kpi: ({ node }) => <Kpi node={node} />,
  bar: chart,
  line: chart,
  area: chart,
  pie: chart,
  table: ({ node }) => <DataTable node={node} />,
  list: ({ node }) => <DataList node={node} />,
  markdown: ({ node }) => <MiniMarkdown text={node.text} className="nx-in-md" />,
  callout: ({ node }) => (
    <div className={`nx-in-callout is-${node.tone}`} role="note">
      {node.title && <strong>{node.title}</strong>}
      <MiniMarkdown text={node.text} />
    </div>
  ),
  progress: ({ node }) => <ProgressBlock node={node} />,
  comparison: ({ node }) => <Comparison node={node} />,
  timeline: ({ node }) => <TimelineBlock node={node} />,
};

/** The body of one drawn node, from the registry. */
export function NodeBody({ node, compact }: { node: Drawn; compact: boolean }) {
  const Body = NODE_BODIES[node.type] as NodeBody<Drawn["type"]>;
  return <Body node={node as never} compact={compact} />;
}
