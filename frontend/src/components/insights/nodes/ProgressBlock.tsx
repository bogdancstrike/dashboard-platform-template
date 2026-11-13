import { Progress, Typography } from "antd";

import { formatValue, type ProgressNode } from "../spec";

const { Text } = Typography;

export function ProgressBlock({ node }: { node: ProgressNode }) {
  const percent = node.max ? Math.min(100, Math.round(((node.value ?? 0) / node.max) * 100)) : 0;
  return (
    <div className="nx-in-progress">
      <span className="nx-in-kpi-label">{node.label}</span>
      <Progress
        percent={percent}
        showInfo={false}
        strokeColor="var(--nu-accent)"
        aria-label={node.label || "Progress"}
      />
      <Text type="secondary">
        {formatValue(node.value, node.format)}
        {node.max ? ` of ${formatValue(node.max, node.format)}` : ""}
        {node.hint ? ` · ${node.hint}` : ""}
      </Text>
    </div>
  );
}
