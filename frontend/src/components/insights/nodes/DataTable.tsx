import { Typography } from "antd";
import { Link } from "react-router-dom";

import { formatValue, type TableNode } from "../spec";

const { Text } = Typography;

function cell(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatValue(value, "number", false);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const textual = typeof value === "string" ? value : JSON.stringify(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(textual)) return new Date(textual).toLocaleDateString();
  return numeric ? textual : textual.replace(/_/g, " ");
}

export function DataTable({ node }: { node: TableNode }) {
  if (!node.rows.length) return <Text type="secondary">No records match.</Text>;
  return (
    <div className="nx-in-table-wrap">
      <table className="nx-in-table">
        <thead>
          <tr>
            {node.columns.map((column) => (
              <th key={column.key} className={column.numeric ? "is-num" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, index) => {
            const link = typeof row["href"] === "string" ? row["href"] : null;
            return (
              <tr key={index}>
                {node.columns.map((column, position) => {
                  const content = cell(
                    row[column.key],
                    column.numeric || typeof row[column.key] === "number",
                  );
                  return (
                    <td
                      key={column.key}
                      className={
                        column.numeric || typeof row[column.key] === "number" ? "is-num" : undefined
                      }
                    >
                      {position === 0 && link ? <Link to={link}>{content}</Link> : content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
