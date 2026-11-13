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

import { Skeleton } from "antd";

import type { SeriesPoint } from "@/api/explorer";
import { ChartCard } from "@/components/ChartCard";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import { NewRecordButton } from "@/components/records/useRecordEditing";
import { usePageCommands } from "@/commands/CommandContext";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { EntityTable, useEntityBulk, useEntityList } from "@/entities/list";

import { orderColumns } from "./columns";
import { LedgerTotal } from "./LedgerTotal";
import { COLUMNS, type OrderRow } from "./types";

export default function OrdersLedgerPage() {
  const list = useEntityList<OrderRow>("order", "/orders", { columns: COLUMNS, defaultSort: "placed_at" });
  const { view, rows, records } = list;
  const insights = view.insights.data;
  const bulk = useEntityBulk(view);

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

  /** The order being peeked at, from the address rather than from state. */
  const previewing = view.params.get("preview") ?? "";

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

      <EntityTable<OrderRow>
        list={list}
        bulk={bulk}
        data-testid="order-ledger"
        className="nu-ledger nx-rec-table"
        columns={orderColumns(view, records)}
        pageSizeOptions={[25, 50, 100, 200]}
        scroll={{ x: 1040 }}
        empty={
          <EntityEmpty
            view={view}
            title="No orders have been placed yet"
            hint="An order is what a customer bought, and what is owed for it."
            action={<NewRecordButton records={records} resource={view.resource} />}
          />
        }
        summary={() => (rows.length > 0 && insights ? <LedgerTotal insights={insights} /> : null)}
      />

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
