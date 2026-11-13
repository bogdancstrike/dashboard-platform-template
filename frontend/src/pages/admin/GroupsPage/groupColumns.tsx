import { Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Group } from "@/api/groups";
import type { RowCard } from "@/components/listing/ResponsiveTable";

import { grantSummary } from "./groupCopy";

const { Text } = Typography;

export const groupColumns: ColumnsType<Group> = [
  {
    title: "Group",
    dataIndex: "name",
    render: (name: string, row) => (
      <div className="nu-group-what">
        <Space size={6}>
          <Text strong>{name}</Text>
          <Tag bordered={false}>{row.kind.toLowerCase()}</Tag>
        </Space>
        <Text type="secondary" className="nu-group-slug">
          {row.description || row.slug}
        </Text>
      </div>
    ),
  },
  {
    title: "People",
    dataIndex: "member_count",
    width: 108,
    align: "right",
    render: (count: number) => (
      <Text type={count === 0 ? "secondary" : undefined}>
        {count === 0 ? "nobody" : `${count}`}
      </Text>
    ),
  },
  {
    title: "Adds",
    dataIndex: "permissions",
    width: 340,
    // Named, not counted: "3 permissions" does not answer whether being in
    // this group lets somebody export the customer list.
    render: (values: string[]) => (
      <Text type={values.length === 0 ? "secondary" : undefined} className="nu-group-grants">
        {grantSummary(values)}
      </Text>
    ),
  },
];

/** The same row as a card on a phone. */
export function groupCard(row: Group): RowCard {
  return {
    title: row.name,
    meta: row.description || row.slug,
    pill: <Tag bordered={false}>{row.kind.toLowerCase()}</Tag>,
    right: row.member_count === 0 ? "nobody" : `${row.member_count} people`,
  };
}
