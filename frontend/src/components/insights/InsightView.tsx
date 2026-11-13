import { useMemo } from "react";
import { Typography } from "antd";

import { EmptyState } from "@/components/EmptyState";

import { NodeBody } from "./registry";
import { parseBlocks, type InsightNode } from "./spec";

const { Text } = Typography;

/**
 * An insight, drawn from its bound spec with the registry's components (§43).
 *
 * Every node passes `parseBlocks` first, so an unknown or malformed component
 * is simply absent. A component whose query failed for this viewer shows why
 * in its own place; the rest of the page is unaffected.
 */
export function InsightView({ blocks, compact = false }: { blocks: unknown; compact?: boolean }) {
  const nodes = useMemo(() => parseBlocks(blocks), [blocks]);
  if (!nodes.length) return <EmptyState compact title="Nothing to show" hint="This insight has no components this version can draw." />;
  return (
    <div className={`nx-in-grid${compact ? " is-compact" : ""}`} data-testid="insight-view">
      {nodes.map((node, index) => (
        <Block key={index} node={node} compact={compact} />
      ))}
    </div>
  );
}

function Block({ node, compact }: { node: InsightNode; compact: boolean }) {
  const body = node.error ? (
    <Text type="secondary" className="nx-in-error" data-testid="insight-node-error">
      {node.error}
    </Text>
  ) : (
    node.type !== "section" && <NodeBody node={node} compact={compact} />
  );
  if (node.type === "section") {
    return (
      <section className="nx-in-section nx-in-w-full" data-type="section">
        {node.title && <h3 className="nx-in-section-title">{node.title}</h3>}
        <div className="nx-in-grid">
          {node.blocks.map((child, index) => (
            <Block key={index} node={child} compact={compact} />
          ))}
        </div>
      </section>
    );
  }
  const framed = node.type !== "markdown" && node.type !== "callout";
  return (
    <div
      className={`nx-in-node nx-in-w-${node.width}${framed ? " nx-in-card" : ""} nx-in-${node.type}`}
      data-type={node.type}
      data-testid="insight-node"
    >
      {node.title && node.type !== "kpi" && node.type !== "callout" && <div className="nx-in-title">{node.title}</div>}
      {body}
    </div>
  );
}
