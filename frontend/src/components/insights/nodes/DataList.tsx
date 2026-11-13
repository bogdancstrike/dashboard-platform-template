import { Typography } from "antd";
import { Link } from "react-router-dom";

import { StatusTag } from "@/components/StatusTag";

import { formatValue, type ListNode } from "../spec";

const { Text } = Typography;

export function DataList({ node }: { node: ListNode }) {
  if (!node.items.length) return <Text type="secondary">Nothing to list.</Text>;
  return (
    <ul className="nx-in-list">
      {node.items.map((item, index) => {
        const title = item.href ? <Link to={item.href}>{item.title}</Link> : item.title;
        return (
          <li key={index}>
            <span className="nx-in-list-main">
              <span className="nx-in-list-title">{title}</span>
              {item.subtitle && (
                <span className="nx-in-list-sub">{item.subtitle.replace(/_/g, " ")}</span>
              )}
            </span>
            {item.status && <StatusTag status={item.status} />}
            {item.value !== null && item.value !== undefined && (
              <span className="nx-in-list-value">{formatValue(item.value, "number", true)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
