import { Button, Space, Tag as AntTag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import type { Tag } from "@/api/tags";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { formatNumber } from "@/lib/formats";

const { Text } = Typography;

/** The vocabulary's columns; the actions only for a reader who may curate it. */
export function tagColumns({
  canManage,
  onEdit,
  onRemove,
}: {
  canManage: boolean;
  onEdit: (tag: Tag) => void;
  onRemove: (tag: Tag) => void;
}): ColumnsType<Tag> {
  return [
    {
      title: "Tag",
      dataIndex: "name",
      render: (_name: string, tag) => (
        <Space size={8} wrap>
          <AntTag
            className="nu-tag-chip nx-ad-tagchip"
            // A leading dot, as on record pages: a 3px start border on a pill
            // curves into a "(" rather than reading as a colour mark.
            style={{ ["--tag-color" as string]: tag.color }}
          >
            {tag.name}
          </AntTag>
          {tag.is_system && (
            <Tooltip title="Automations, saved searches and reports quote this tag by name, so it cannot be renamed or removed.">
              <AntTag color="processing">system</AntTag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: "Category", dataIndex: "category", width: 140 },
    {
      title: "Used on",
      dataIndex: "usage_count",
      width: 140,
      sorter: (left, right) => left.usage_count - right.usage_count,
      defaultSortOrder: "descend",
      render: (count: number, tag) =>
        count === 0 ? (
          // Said rather than shown as a zero: this is the row somebody came to
          // the page to find.
          <Text type="secondary">nothing</Text>
        ) : (
          // The count is the link, through the list's own filter — so it opens
          // exactly the records it counted.
          <Link
            to={`/tasks?f.tags__contains=${encodeURIComponent(tag.name)}`}
            data-testid={`tag-usage-${tag.slug}`}
          >
            {formatNumber(count)} records
          </Link>
        ),
    },
    { title: "What it means", dataIndex: "description", render: (text: string) => text || "—" },
    ...(canManage ? [actionsColumn(onEdit, onRemove)] : []),
  ];
}

function actionsColumn(onEdit: (tag: Tag) => void, onRemove: (tag: Tag) => void) {
  return {
    title: "",
    key: "actions",
    width: 96,
    render: (_unused: unknown, tag: Tag) => (
      <Space size={4}>
        <Tooltip title="Rename, recolour or describe">
          <Button type="text" icon={<EditOutlined />} aria-label={`Edit ${tag.name}`} onClick={() => onEdit(tag)} />
        </Tooltip>
        <Tooltip
          title={tag.is_system ? "A system tag cannot be removed" : `Remove it from ${formatNumber(tag.usage_count)} records`}
        >
          <Button
            type="text"
            danger
            disabled={tag.is_system}
            icon={<DeleteOutlined />}
            aria-label={`Remove ${tag.name}`}
            data-testid={`tag-remove-${tag.slug}`}
            onClick={() => onRemove(tag)}
          />
        </Tooltip>
      </Space>
    ),
  };
}

/** The same row as a card on a phone. */
export function tagCard(row: Tag): RowCard {
  return {
    title: row.name,
    meta: row.description || row.category.toLowerCase(),
    pill: <AntTag bordered={false}>{row.category.toLowerCase()}</AntTag>,
    right: `${row.usage_count} records`,
  };
}
