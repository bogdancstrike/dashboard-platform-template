import { Space, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";

import type { ComparedField, Comparison } from "@/api/compare";
import { StatusTag } from "@/components/StatusTag";

import { readable } from "./compare";

const { Text } = Typography;

/** A column for the field names, then one per record — each cell its value, marked where the records disagree. */
export function compareColumns(comparison: Comparison | undefined): ColumnsType<ComparedField> {
  if (!comparison) return [];
  return [
    {
      title: "Field",
      dataIndex: "label",
      width: 190,
      render: (label: string, field) => (
        <Space size={6}>
          <Text strong={field.differs}>{label}</Text>
          {/* A marker as well as the colour: colour alone is not a signal
              (§64), and this is the only thing distinguishing the rows a
              reader came here to find. */}
          {field.differs && (
            <span className="nx-pill nx-pill--warn nx-pill--sm" title="These records disagree about this field">
              differs
            </span>
          )}
        </Space>
      ),
    },
    ...comparison.records.map((record, index) => ({
      title: (
        <Link to={record.path}>
          {record.title}
          {record.status ? <StatusTag status={record.status} /> : null}
        </Link>
      ),
      key: record.id,
      render: (_: unknown, field: ComparedField) => {
        const value = field.values[index];
        return value === null || value === "" || value === undefined ? (
          <Text type="secondary">—</Text>
        ) : (
          <span className={field.differs ? "nx-rec-differs" : undefined}>
            {readable(value, field.kind)}
          </span>
        );
      },
    })),
  ];
}
