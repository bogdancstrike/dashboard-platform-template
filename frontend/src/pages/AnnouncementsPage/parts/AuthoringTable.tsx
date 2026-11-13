import { useQuery } from "@tanstack/react-query";
import { Button, Card, Dropdown, Segmented, Table, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, EditOutlined, MoreOutlined, PushpinFilled } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { announcementsApi, type Announcement } from "@/api/announcements";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime, relativeTime } from "@/lib/time";

import { SEVERITY_COLOUR } from "../model";

const { Text } = Typography;

/**
 * The author's view: every notice whatever its state, and how far it got.
 *
 * A table here and prose there, deliberately. An author is comparing twenty
 * notices by status and reach, which is what a table is for; a reader is
 * reading one, which is what prose is for. The same rows either way.
 */
export function AuthoringTable({
  drafts,
  status,
  onStatus,
  onEdit,
  onRemove,
}: {
  drafts: ReturnType<typeof useQuery<Awaited<ReturnType<typeof announcementsApi.drafts>>>>;
  status: string;
  onStatus: (status: string | null) => void;
  onEdit: (notice: Announcement) => void;
  onRemove: (notice: Announcement) => void;
}) {
  const rows = drafts.data?.items ?? [];

  const columns: ColumnsType<Announcement> = [
    {
      title: "Notice",
      dataIndex: "title",
      ellipsis: true,
      // A flex row and not a `Space`: `Space` wraps each child in an
      // inline-flex item that never shrinks, so the title measured itself
      // against its own content, its ellipsis never engaged, and the cell
      // hard-clipped the longest notice mid-word under the State tag.
      render: (title: string, row) => (
        <div className="nu-announce-cell">
          {row.is_pinned && <PushpinFilled aria-label="Pinned" />}
          <Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Text>
        </div>
      ),
    },
    {
      title: "State",
      key: "state",
      width: 112,
      // Derived, so a scheduled notice reads as scheduled and an expired one
      // as expired without either being a stored status (§71).
      render: (_value: unknown, row) => (
        <Tag
          color={row.is_live ? "success" : row.status === "DRAFT" ? undefined : "warning"}
          bordered={false}
        >
          {row.is_live
            ? "Live"
            : row.is_scheduled
              ? "Scheduled"
              : row.is_expired
                ? "Expired"
                : row.status.charAt(0) + row.status.slice(1).toLowerCase()}
        </Tag>
      ),
    },
    {
      title: "Severity",
      dataIndex: "severity",
      width: 108,
      render: (severity: string) => (
        <Tag color={SEVERITY_COLOUR[severity]} bordered={false}>
          {severity}
        </Tag>
      ),
    },
    { title: "Category", dataIndex: "category_label", width: 116 },
    {
      title: "Audience",
      key: "audience",
      width: 128,
      render: (_value: unknown, row) =>
        row.audience_roles.length === 0 ? (
          <Text type="secondary">Everybody</Text>
        ) : (
          <Tooltip title={row.audience_roles.join(", ")}>
            <Text>{row.audience_roles.length} roles</Text>
          </Tooltip>
        ),
    },
    {
      // The author's question, and the reason receipts are two columns:
      // "everybody has seen it" and "eleven agreed to it" are different.
      title: "Reach",
      key: "reach",
      width: 148,
      render: (_value: unknown, row) => (
        <Text type="secondary">
          {row.reach?.read ?? 0} read
          {row.requires_acknowledgement ? ` · ${row.reach?.acknowledged ?? 0} agreed` : ""}
        </Text>
      ),
    },
    {
      title: "Published",
      dataIndex: "publish_at",
      width: 118,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text>{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "",
      key: "actions",
      width: 48,
      align: "right",
      render: (_value: unknown, row) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "edit", icon: <EditOutlined />, label: "Edit" },
              { key: "remove", icon: <DeleteOutlined />, danger: true, label: "Withdraw" },
            ],
            onClick: ({ key }) => (key === "edit" ? onEdit(row) : onRemove(row)),
          }}
        >
          <Button type="text" icon={<MoreOutlined />} aria-label={`Actions for ${row.title}`} />
        </Dropdown>
      ),
    },
  ];

  return (
    // Filling the window rather than ending where the rows do: ten notices in
    // a 900-pixel viewport left two thirds of the page blank, and the
    // scrollbar on the document rather than on the list that is long.
    <div className="nu-fill">
      <Card
        size="small"
        className="nu-pane nu-pane--table"
        data-testid="announcement-authoring"
        title={
          <Segmented
            aria-label="Status"
            value={status || "all"}
            onChange={(next) => onStatus(next === "all" ? null : String(next))}
            options={[
              { value: "all", label: "Everything" },
              ...(drafts.data?.statuses ?? []).map((item) => ({
                value: item,
                label: item.charAt(0) + item.slice(1).toLowerCase(),
              })),
            ]}
          />
        }
      >
        <Table<Announcement>
          rowKey="id"
          size="small"
          sticky
          columns={columns}
          dataSource={rows}
          loading={drafts.isLoading}
          pagination={false}
          locale={{
            emptyText: drafts.isLoading ? (
              " "
            ) : (
              <EmptyState compact title="Nothing written in this state" />
            ),
          }}
        />
      </Card>
    </div>
  );
}
