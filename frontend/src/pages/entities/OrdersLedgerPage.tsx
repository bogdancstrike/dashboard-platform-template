/**
 * Orders as a ledger (§7, §3).
 *
 * Money is read down a column, aligned, in one typeface, with a total at the
 * top — so this is the densest table in the platform and makes no apology for
 * it. What a ledger adds over a list is *reconciliation*: the revenue on the
 * strip, the trend behind it and the rows below are the same query, so a
 * reader can check the page against itself.
 *
 * Two states matter more than the rest and get their own column each rather
 * than being folded into one "status": an order can be paid and not shipped,
 * or shipped and not paid, and collapsing that loses the only two facts
 * anybody chases.
 */

import { Button, Card, Skeleton, Space, Table, Tooltip, Typography } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { useNavigate } from "react-router-dom";

import type { SeriesPoint } from "@/api/explorer";
import { ChartCard } from "@/components/ChartCard";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { StatusTag } from "@/components/StatusTag";
import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
} from "@/components/records/useRecordEditing";
import { opensRecord, useBulk } from "@/components/records/useBulk";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

const COLUMNS = [
  "reference", "status", "payment_status", "fulfilment_status", "channel",
  "total", "currency", "item_count", "placed_at",
];

interface OrderRow {
  id: string;
  reference?: string;
  status?: string;
  payment_status?: string;
  fulfilment_status?: string;
  channel?: string;
  total?: number;
  currency?: string;
  item_count?: number;
  placed_at?: string | null;
}

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

export default function OrdersLedgerPage() {
  const navigate = useNavigate();
  const view = useEntityView("order", { columns: COLUMNS, defaultSort: "placed_at" });
  const rows = (view.rows.data?.items ?? []) as OrderRow[];
  const insights = view.insights.data;

  const records = useRecordEditing(view.resource, {
    onCreated: (id) => navigate(`/orders/${id}`),
  });
  // The list's own request is what "everything matching this filter" means,
  // sent unchanged — a hand-built copy of the filters would be a second
  // question, and rows nobody saw would change the first time the two differed.
  const bulk = useBulk(view.resource, {
    request: view.request,
    total: view.rows.data?.total ?? 0,
  });

  usePageCommands("entity:order", [
    {
      id: "order.new",
      label: "Create an order",
      keywords: "new add create",
      run: records.create,
    },
    {
      id: "order.unpaid",
      label: "Show orders awaiting payment",
      keywords: "money overdue unpaid",
      run: () => view.setFilter("payment_status", "UNPAID"),
    },
    {
      id: "order.unshipped",
      label: "Show orders that have not shipped",
      keywords: "fulfilment delivery pending",
      run: () => view.setFilter("fulfilment_status", "PENDING"),
    },
  ]);

  const columns: ColumnsType<OrderRow> = [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 140,
      fixed: "left",
      sorter: true,
      render: (value: string) => <Text className="nu-mono">{value}</Text>,
    },
    {
      title: "Placed",
      dataIndex: "placed_at",
      width: 130,
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
    { title: "Channel", dataIndex: "channel", width: 120, sorter: true },
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

  /** The order being peeked at, from the address rather than from state. */
  const previewing = view.params.get("preview") ?? "";

  const onChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<OrderRow> | SorterResult<OrderRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : view.sort;
    view.set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  const trend: SeriesPoint[] = insights?.trend?.series ?? [];

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="Commercial transactions, newest first — with what they are worth and where they are stuck."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "success", "info", "warning"]} />

      <ChartCard
        id="orders-revenue"
        height={200}
        panel={{
          kind: "area",
          title: "Revenue booked, by day",
          series: trend.map((point) => ({ bucket: point.name, value: point.value })),
        }}
        loading={view.insights.isLoading}
        error={view.insights.error ?? undefined}
        onRetry={() => void view.insights.refetch()}
      />

      <EntityFilters
        view={view}
        only={["status", "payment_status", "fulfilment_status", "channel", "currency"]}
      />
      <EntityError view={view} />

      <Card size="small" className="nu-block">
        {/* Above the table, not floating over it: a bar that covers the last
            row hides part of what the reader is deciding about (§43). */}
        {bulk.bar}
        <Table<OrderRow>
          rowKey="id"
          size="small"
          className="nu-ledger"
          columns={columns}
          dataSource={rows}
          rowSelection={bulk.rowSelection}
          loading={view.rows.isLoading}
          onChange={onChange}
          scroll={{ x: 1080 }}
          onRow={(row) => ({
            // Not when the click was on a control — a tick box opens nothing.
            onClick: (event) => {
              if (opensRecord(event.target)) navigate(`/orders/${row.id}`);
            },
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: (
              <EntityEmpty
                view={view}
                title="No orders have been placed yet"
                hint="An order is what a customer bought, and what is owed for it."
                action={<NewRecordButton records={records} resource={view.resource} />}
              />
            ),
          }}
          summary={() =>
            rows.length > 0 && insights ? (
              <Table.Summary fixed="bottom">
                <Table.Summary.Row className="nu-ledger-total">
                  <Table.Summary.Cell index={0} colSpan={7}>
                    <Space size={6}>
                      <Text strong>Total across the filtered set</Text>
                      <Text type="secondary">
                        — the server's, not this page's
                      </Text>
                    </Space>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">
                    <Text strong className="nu-money">
                      €
                      {Math.round(
                        insights.metrics.find((metric) => metric.key === "revenue")?.value ?? 0,
                      ).toLocaleString()}
                    </Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
          pagination={{
            current: view.rows.data?.page ?? view.page,
            pageSize: view.rows.data?.page_size ?? view.pageSize,
            total: view.rows.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (count, range) => `${range[0]}–${range[1]} of ${count.toLocaleString()}`,
          }}
        />
      </Card>

      {/* Deep-linked, like the explorer's (§64, §69): a peek is a URL, so it
          can be sent to somebody with the filters that found it. */}
      {previewing && (
        <RecordPreview
          resourceType="order"
          recordId={previewing}
          term={view.term}
          onClose={() => view.set({ preview: null })}
        />
      )}

      {records.drawer}
      {bulk.dialog}
    </>
  );
}
