/**
 * A table on a desk, a list of cards on a phone (§3).
 *
 * The canvas draws every admin list as cards below the tablet width: a title,
 * one line of facts, a pill and a number on the right. A table scrolled
 * sideways inside a 390-pixel panel is a table nobody can read, so below `md`
 * the same rows, the same click and the same pagination render as cards.
 *
 * Everything else is the AntD table's own props, passed through unchanged, so
 * a page swaps `<Table>` for `<ResponsiveTable card={…}>` and keeps its
 * columns, sorting and states for the desktop.
 *
 * "Phone" is decided by a breakpoint that *matches*, never by one that does
 * not: a test DOM answers every media query with "no", and must keep seeing
 * the table its assertions were written against.
 */
import { Grid, Pagination, Skeleton, Table, type TableProps } from "antd";
import type { ReactNode } from "react";

export interface RowCard {
  title: ReactNode;
  /** One line of facts under the title. */
  meta?: ReactNode;
  /** A status or kind, top right. */
  pill?: ReactNode;
  /** A number or a time, under the pill. */
  right?: ReactNode;
  /** Something before the title — an avatar. */
  lead?: ReactNode;
}

export function usePhoneList(): boolean {
  const screens = Grid.useBreakpoint();
  return screens.xs === true || (screens.sm === true && screens.md !== true);
}

export function ResponsiveTable<T extends object>({
  card,
  ...table
}: TableProps<T> & { card: (row: T) => RowCard }) {
  const phone = usePhoneList();
  if (!phone) return <Table<T> {...table} />;

  const rows = (table.dataSource ?? []);
  const keyOf = (row: T, index: number): string => {
    const key = table.rowKey;
    if (typeof key === "function") return String(key(row, index));
    const value = (row as Record<string, unknown>)[String(key ?? "key")];
    return typeof value === "string" || typeof value === "number" ? String(value) : String(index);
  };
  const loading = typeof table.loading === "object" ? table.loading.spinning : table.loading;
  const pagination = table.pagination;
  const empty = table.locale?.emptyText;

  return (
    <div className="nx-ad-cards" data-testid={(table as Record<string, unknown>)["data-testid"] as string | undefined}>
      {loading && rows.length === 0 ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : rows.length === 0 ? (
        <div className="nx-ad-cards-empty">{typeof empty === "function" ? empty() : empty}</div>
      ) : (
        <ul>
          {rows.map((row, index) => {
            const facts = card(row);
            const handlers = table.onRow?.(row, index) ?? {};
            const onClick = handlers.onClick as (() => void) | undefined;
            const body = (
              <>
                {facts.lead && <span className="nx-ad-card-lead">{facts.lead}</span>}
                <span className="nx-ad-card-text">
                  <b>{facts.title}</b>
                  {facts.meta && <span>{facts.meta}</span>}
                </span>
                {(facts.pill || facts.right) && (
                  <span className="nx-ad-card-side">
                    {facts.pill}
                    {facts.right && <span className="nx-ad-card-right">{facts.right}</span>}
                  </span>
                )}
              </>
            );
            return (
              <li key={keyOf(row, index)}>
                {onClick ? (
                  <button type="button" className="nx-ad-card" onClick={() => onClick()}>
                    {body}
                  </button>
                ) : (
                  <div className="nx-ad-card">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pagination && (pagination.total ?? 0) > (pagination.pageSize ?? 25) && (
        <Pagination
          simple
          className="nx-ad-cards-pages"
          current={pagination.current}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onChange={(page, size) => {
            if (pagination.onChange) pagination.onChange(page, size);
            else
              table.onChange?.(
                { current: page, pageSize: size },
                {},
                [],
                { action: "paginate", currentDataSource: rows as T[] },
              );
          }}
        />
      )}
    </div>
  );
}
