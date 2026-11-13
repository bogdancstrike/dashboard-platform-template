import { Button, Space, Tooltip, Typography } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

import { humanStatus, StatusTag } from "@/components/StatusTag";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import type { EntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";

import type { OrderRow } from "./types";

const { Text } = Typography;

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

/** The ledger's columns: money read down the right, the two chased states each their own. */
export function orderColumns(view: EntityView, records: RecordEditing): ColumnsType<OrderRow> {
  return [
    {
      title: "Reference",
      dataIndex: "reference",
      // Columns sized so the ledger fits a 1440 desk without scrolling: at
      // 1080+ the pinned actions covered the end of every total.
      width: 124,
      fixed: "left",
      sorter: true,
      render: (value: string) => <Text className="nu-mono">{value}</Text>,
    },
    {
      title: "Placed",
      dataIndex: "placed_at",
      width: 112,
      sorter: true,
      defaultSortOrder: "descend",
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <Text>{relativeTime(value)}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Order",
      dataIndex: "status",
      width: 130,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      // Two columns rather than one: an order can be paid and unshipped, or
      // shipped and unpaid, and those are the two facts anybody chases.
      title: "Payment",
      dataIndex: "payment_status",
      width: 130,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      title: "Fulfilment",
      dataIndex: "fulfilment_status",
      width: 130,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      title: "Channel",
      dataIndex: "channel",
      width: 108,
      sorter: true,
      render: (value: string | null) => (value ? humanStatus(value) : "—"),
    },
    {
      title: "Items",
      dataIndex: "item_count",
      width: 80,
      align: "right",
      sorter: true,
    },
    {
      title: "Total",
      dataIndex: "total",
      width: 140,
      align: "right",
      sorter: true,
      render: (value: number, row) => (
        <Text strong className="nu-money">
          {SYMBOL[row.currency ?? "EUR"] ?? ""}
          {Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </Text>
      ),
    },
    {
      // Last and narrow: the ledger is read left to right for money, and an
      // actions column early in the scan is a column in the way.
      title: "",
      key: "actions",
      width: 84,
      fixed: "right",
      render: (_value: unknown, row) => (
        <Space size={0}>
          {/* A peek, beside the actions (§64). A ledger is scanned — "which
              order is this refund about" — and the answer is three fields,
              which is not worth losing the reader's place in forty thousand
              rows for. The row still opens the record page, because an order
              somebody is going to *work on* deserves the page. */}
          <Tooltip title={`Look at ${row.reference ?? "this order"} without leaving the ledger`}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              aria-label={`Preview ${row.reference ?? "this order"}`}
              data-testid={`peek-${row.id}`}
              onClick={(event) => {
                event.stopPropagation();
                view.set({ preview: row.id });
              }}
            />
          </Tooltip>
          <RecordActions records={records} id={row.id} label={row.reference ?? "this order"} />
        </Space>
      ),
    },
  ];
}
