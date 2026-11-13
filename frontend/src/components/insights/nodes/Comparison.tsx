import { formatValue, type ComparisonNode } from "../spec";

export function Comparison({ node }: { node: ComparisonNode }) {
  const top = Math.max(1, ...node.items.map((item) => Math.abs(item.value ?? 0)));
  return (
    <ul className="nx-in-compare">
      {node.items.map((item, index) => (
        <li key={index}>
          <span className="nx-in-compare-label">{item.label.replace(/_/g, " ")}</span>
          <span className="nx-in-compare-bar">
            <i style={{ width: `${(Math.abs(item.value ?? 0) / top) * 100}%` }} />
          </span>
          <span className="nx-in-compare-value">{formatValue(item.value, node.format, true)}</span>
        </li>
      ))}
    </ul>
  );
}
