/**
 * The table every tabular entity list draws (§7): a card with the bulk bar
 * above the rows, a row that opens its record, the list's empty state, and a
 * pager and sort written to the address.
 *
 * The columns, the width and anything extra — a totals row, a class — are the
 * page's; everything about *how a list behaves* is here.
 */

import { Card, Table } from "antd";
import type { ColumnsType, TableProps } from "antd/es/table";

import { opensRecord, type Bulk } from "@/components/records/useBulk";

import type { EntityList } from "./useEntityList";
import { tableChange, tablePagination } from "./paging";

interface EntityTableProps<Row extends { id: string }>
  extends Omit<TableProps<Row>, "columns" | "dataSource" | "onChange" | "pagination" | "locale"> {
  list: EntityList<Row>;
  bulk: Bulk;
  columns: ColumnsType<Row>;
  /** The list's own words for having no rows — usually an `EntityEmpty`. */
  empty: React.ReactNode;
  pageSizeOptions?: number[];
  /**
   * Which element carries `data-testid`: the table (the default) or the card
   * around it, where the bulk bar sits too. Spelled as a plain `data-testid`
   * at the call site so the tours' source check can find its target.
   */
  testIdOn?: "card" | "table";
  "data-testid"?: string;
}

export function EntityTable<Row extends { id: string }>({
  list,
  bulk,
  columns,
  empty,
  pageSizeOptions = [25, 50, 100],
  testIdOn = "table",
  "data-testid": testId,
  className = "nx-rec-table",
  ...table
}: EntityTableProps<Row>) {
  const { view, rows, open } = list;
  return (
    <Card size="small" className="nu-block" data-testid={testIdOn === "card" ? testId : undefined}>
      {/* Above the table, not floating over it: a bar that covers the last
          row hides part of what the reader is deciding about (§43). */}
      {bulk.bar}
      <Table<Row>
        data-testid={testIdOn === "table" ? testId : undefined}
        className={className}
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        rowSelection={bulk.rowSelection}
        loading={view.rows.isLoading}
        onChange={tableChange<Row>(view)}
        onRow={(row) => ({
          // Not when the click was on a control — a tick box opens nothing.
          onClick: (event) => {
            if (opensRecord(event.target)) open(row.id);
          },
          style: { cursor: "pointer" },
        })}
        locale={{ emptyText: empty }}
        pagination={tablePagination(view, pageSizeOptions)}
        {...table}
      />
    </Card>
  );
}
