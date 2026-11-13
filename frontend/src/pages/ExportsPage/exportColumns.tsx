import { Button, Popconfirm, Progress, Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, RedoOutlined } from "@ant-design/icons";

import type { ExportRow } from "@/api/exports";
import { readableSize } from "@/api/files";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { StatusTag } from "@/components/StatusTag";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";

import { STATUS_LABELS, situation, tone, working } from "./exportCopy";
import type { useExportsPage } from "./useExportsPage";

const { Text } = Typography;

type Page = ReturnType<typeof useExportsPage>;

/** What a row is and where it stands — the columns that act on nothing. */
const ROW_COLUMNS: ColumnsType<ExportRow> = [
  {
    title: "Export",
    dataIndex: "name",
    ellipsis: true,
    render: (value: string, row) => (
      <div className="nu-exp-what">
        <Text strong>{value}</Text>
        {/* The stored query, re-derived on the server from the field
            catalogue — never a sentence saved beside it. */}
        <Text type="secondary" className="nu-exp-question">
          {row.description}
        </Text>
      </div>
    ),
  },
  {
    title: "Where it stands",
    dataIndex: "status",
    render: (_value, row) => {
      const colour = tone(row);
      return (
        <Space size={6} className="nu-exp-state">
          <Tag color={colour} bordered={false}>
            {STATUS_LABELS[row.status]}
          </Tag>
          <Text type={colour === "error" ? "danger" : "secondary"}>{situation(row)}</Text>
        </Space>
      );
    },
  },
  {
    title: "Rows",
    dataIndex: "rows",
    width: 100,
    align: "right",
    render: (value: number | null, row) =>
      // The file's count, once there is a file. Before that, progress over
      // the total counted when it was queued — never a number for a file
      // nobody has written.
      value === null ? (
        working(row) ? (
          <Progress
            // The only thing in the cell while the file is being written,
            // so it is named rather than hidden.
            aria-label={`${row.reference}: ${row.progress}% written`}
            percent={row.progress}
            size="small"
            showInfo={false}
            className="nu-exp-progress"
          />
        ) : (
          <Text type="secondary">—</Text>
        )
      ) : (
        <Text>{formatNumber(value)}</Text>
      ),
  },
  {
    title: "Size",
    dataIndex: "size_bytes",
    width: 90,
    align: "right",
    render: (value: number | null) =>
      value === null ? <Text type="secondary">—</Text> : readableSize(value),
  },
  {
    title: "Requested",
    dataIndex: "requested_at",
    width: 120,
    render: (value: string | null) => (
      <Tooltip title={absoluteTime(value)}>
        <span>{relativeTime(value)}</span>
      </Tooltip>
    ),
  },
];

/** The exports table's columns; the reference opens the row, the last column acts on it. */
export function exportColumns(page: Page): ColumnsType<ExportRow> {
  return [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 130,
      render: (value: string, row) => (
        <Button
          type="text"
          className="nu-exp-open"
          data-testid={`exp-${row.reference}`}
          onClick={() => page.openExport(row.id)}
        >
          {value}
        </Button>
      ),
    },
    ...ROW_COLUMNS,
    {
      title: "",
      // Wide enough for "Request again" beside "Remove": at 210 the second
      // button was pushed past the table's edge.
      width: 260,
      align: "right",
      render: (_value, row) => <RowActions row={row} page={page} />,
    },
  ];
}

function RowActions({ row, page }: { row: ExportRow; page: Page }) {
  const { fetched, asked, discarded } = page;
  return (
      <Space size={4}>
        {row.downloadable ? (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            data-testid={`download-${row.reference}`}
            loading={fetched.isPending && fetched.variables === row.id}
            onClick={() => fetched.mutate(row.id)}
          >
            Download
          </Button>
        ) : (
          // Offered wherever there is no file, which is the only useful
          // action left on such a row.
          <Button
            icon={<RedoOutlined />}
            data-testid={`again-${row.reference}`}
            loading={asked.isPending && asked.variables === row.id}
            onClick={() => asked.mutate(row.id)}
          >
            Request again
          </Button>
        )}
        {/* Two presses, and the copy has to change between them: the first
            takes a copy of production data out of storage, the second tidies
            away a note. Telling somebody "the record is kept" and then
            removing it on the next press would be the page contradicting
            itself. */}
        <Popconfirm
          title={row.has_file ? "Discard this file?" : "Remove this record?"}
          description={
            row.has_file
              ? "The file is deleted. The record of having asked for it is kept."
              : "The export leaves your list. What you asked for and when stays in the audit trail."
          }
          okText={row.has_file ? "Discard the file" : "Remove it"}
          cancelText="Keep it"
          onConfirm={() => discarded.mutate(row.id)}
        >
          <Button
            type="text"
            data-testid={`discard-${row.reference}`}
            disabled={working(row)}
          >
            {row.has_file ? "Discard" : "Remove"}
          </Button>
        </Popconfirm>
      </Space>
  );
}

/** The same row as a card on a phone. */
export function exportCard(row: ExportRow): RowCard {
  return {
    title: row.name,
    meta: `${row.reference} · ${row.format.toUpperCase()} · ${situation(row)}`,
    pill: <StatusTag status={row.status} label={STATUS_LABELS[row.status]} />,
    right: row.rows === null ? undefined : `${row.rows.toLocaleString()} rows`,
  };
}
