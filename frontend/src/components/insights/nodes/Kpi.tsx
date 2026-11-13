import { Typography } from "antd";

import { formatValue, type KpiNode } from "../spec";

const { Text } = Typography;

export function Kpi({ node }: { node: KpiNode }) {
  const delta = node.delta ?? null;
  return (
    <div className="nx-in-kpi-body">
      <span className="nx-in-kpi-label">{node.label}</span>
      <span className="nx-in-kpi-value" data-testid="insight-kpi-value">
        {formatValue(node.value, node.format, true)}
      </span>
      <span className="nx-in-kpi-foot">
        {delta !== null && (
          <span
            className={`nx-in-delta ${delta >= 0 ? "is-up" : "is-down"}`}
            data-testid="insight-kpi-delta"
          >
            {delta >= 0 ? "▲" : "▼"}{" "}
            {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
          </span>
        )}
        {node.hint && <Text type="secondary">{node.hint}</Text>}
      </span>
    </div>
  );
}
