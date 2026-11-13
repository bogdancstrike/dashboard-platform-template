/**
 * The four ways to read a result set (§6).
 *
 * One data source, four presentations, and the same three affordances in each:
 * a match is marked where it was found, a row opens a preview beside the list,
 * and the page size and position are the caller's to control.
 *
 * Table pagination is numbered, because "page 7 of 42" is a position somebody
 * can return to. List and card modes load more instead: they are for scanning,
 * where a page boundary interrupts a read that had no reason to stop (§52).
 */

import { Button, Card, List, Table, Typography } from "antd";
import type { ColumnsType, ColumnType, TablePaginationConfig, TableProps } from "antd/es/table";

import type { ExplorerResult, ExplorerView } from "@/api/explorer";
import { EmptyState } from "@/components/EmptyState";

import { PreviewButton, RowStar, Value } from "./cells";
import { group, title } from "./grouping";

const { Text } = Typography;

export type ExplorerRecord = Record<string, unknown> & { id: string };

export interface ExplorerResultsProps {
  result?: ExplorerResult;
  view: ExplorerView;
  loading: boolean;
  /** Rows accumulated by "Load more" in the scanning modes, if any. */
  rows?: ExplorerRecord[];
  /** Field to section the scanning modes by; empty for one flat list. */
  groupBy?: string;
  onPage: (page: number, pageSize: number) => void;
  onSort: (field: string, order: "asc" | "desc") => void;
  onPreview: (record: ExplorerRecord) => void;
  /**
   * What a row click does, when it should do something other than preview.
   *
   * The explorer is a place to ask questions, so a row there opens a drawer
   * beside the answer. An entity list is a place to work, so a row there opens
   * the record. Same table, same renderer, one prop — rather than two tables
   * that will drift in every detail except the one being compared.
   */
  onOpen?: (record: ExplorerRecord) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  /**
   * Row selection, spread from `useBulk`.
   *
   * Passed in rather than owned here, because a selection is only meaningful
   * beside the bar that acts on it and the dialog that confirms it — and those
   * belong to the page. Absent means the list is read-only, which is the
   * state every scanning view is in: a card grid with tick boxes on it is a
   * table wearing a costume.
   */
  selection?: TableProps<ExplorerRecord>["rowSelection"];
  /** Where each record lives, so a star can store an address that survives. */
  path?: string;
  /** Star each row. Off where a list is a preview rather than a place to work. */
  starrable?: boolean;
}

export function ExplorerResults({
  result,
  view,
  loading,
  rows,
  groupBy,
  onPage,
  onSort,
  onPreview,
  onOpen,
  onLoadMore,
  loadingMore,
  selection,
  path = "",
  starrable = false,
}: ExplorerResultsProps) {
  const fields = new Map((result?.fields ?? []).map((field) => [field.name, field]));
  const term = result?.query_text ?? "";
  const searchable = new Set(result?.searchable ?? []);
  const empty = <EmptyState title="No records match this question" />;

  const columns: ColumnsType<ExplorerRecord> = [
    ...(result?.columns ?? []).map((name): ColumnType<ExplorerRecord> => {
      const field = fields.get(name);
      return {
        key: name,
        dataIndex: name,
        title: field?.label ?? title(name),
        ...(field?.sortable ? { sorter: true } : {}),
        // Which arrow the header shows, driven by what the server sorted by
        // rather than by what the table last remembered.
        sortOrder: result?.sort === name ? (result.order === "asc" ? "ascend" : "descend") : null,
        ellipsis: true,
        render: (value: unknown) => (
          <Value value={value} field={field} term={searchable.has(name) ? term : ""} />
        ),
      };
    }),
    {
      key: "actions",
      width: starrable ? 92 : 56,
      fixed: "right",
      align: "center",
      title: "",
      render: (_value: unknown, record: ExplorerRecord) => (
        <span className="nu-result-actions">
          {starrable && <RowStar record={record} result={result} path={path} />}
          <PreviewButton record={record} onPreview={onPreview} />
        </span>
      ),
    },
  ];

  if (view === "table") {
    return (
      <Table
        className="nu-explorer-table"
        rowKey={(row) => String(row.id)}
        loading={loading}
        dataSource={result?.items ?? []}
        columns={columns}
        size="middle"
        scroll={{ x: "max-content" }}
        rowSelection={selection}
        onRow={(record) => ({
          onClick: () => (onOpen ?? onPreview)(record),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: result?.page ?? 1,
          pageSize: result?.page_size ?? 25,
          total: result?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 25, 50, 100, 200],
          showTotal: (total, range) => `${range[0]}–${range[1]} of ${total.toLocaleString()}`,
        }}
        onChange={(pagination: TablePaginationConfig, _filters, sorter) => {
          if (pagination.current !== result?.page || pagination.pageSize !== result?.page_size) {
            onPage(pagination.current ?? 1, pagination.pageSize ?? 25);
          }
          const active = Array.isArray(sorter) ? sorter[0] : sorter;
          if (active?.field && active.order) {
            onSort(String(active.field), active.order === "ascend" ? "asc" : "desc");
          }
        }}
        locale={{ emptyText: empty }}
      />
    );
  }

  const items = rows ?? result?.items ?? [];
  const more = items.length < (result?.total ?? 0);
  const sections = groupBy ? group(items, groupBy, result) : null;

  const renderList = (data: ExplorerRecord[]) => (
    <List
      loading={loading}
      dataSource={data}
      grid={view === "cards" ? { gutter: 12, xs: 1, sm: 2, lg: 3, xl: 4 } : undefined}
      locale={{ emptyText: empty }}
      renderItem={(item) => {
          const body = (
            <div className={`nu-result nu-result--${view}`}>
              <div className="nu-result-fields">
                {(result?.columns ?? []).map((name, index) => (
                  <div className="nu-result-field" key={name}>
                    {view !== "compact" && index > 0 && (
                      <Text type="secondary">{fields.get(name)?.label ?? title(name)}</Text>
                    )}
                    <Value
                      value={item[name]}
                      field={fields.get(name)}
                      term={searchable.has(name) ? term : ""}
                      primary={index === 0}
                    />
                  </div>
                ))}
              </div>
              <span className="nu-result-actions">
                {starrable && <RowStar record={item} result={result} path={path} />}
                <PreviewButton record={item} onPreview={onPreview} />
              </span>
            </div>
          );
          const open = onOpen ?? onPreview;
          const clickable = { onClick: () => open(item), style: { cursor: "pointer" } };
          return view === "cards" ? (
            <List.Item>
              <Card size="small" {...clickable}>{body}</Card>
            </List.Item>
          ) : (
            <List.Item {...clickable}>{body}</List.Item>
          );
      }}
    />
  );

  return (
    <>
      {sections
        ? sections.map((section) => (
            <section key={section.value} className="nu-result-section">
              <header className="nu-result-section-head">
                <Text strong>{section.label}</Text>
                {/* Loaded here, of the whole result: a section header that
                    counted only the rows on screen would shrink as the reader
                    scrolls, which is the opposite of what a count is for. */}
                <Text type="secondary">
                  {section.rows.length}
                  {section.total > 0 && section.total !== section.rows.length
                    ? ` of ${section.total.toLocaleString()}`
                    : ""}
                </Text>
              </header>
              {section.rows.length > 0 ? (
                renderList(section.rows)
              ) : (
                // The group exists and the server counted it; these rows are
                // simply further down the result. Saying so is the difference
                // between "there are none" and "you have not reached them".
                <Text type="secondary" className="nu-result-section-unloaded">
                  Not loaded yet — continue below to reach these.
                </Text>
              )}
            </section>
          ))
        : renderList(items)}
      {items.length > 0 && (
        <div className="nu-load-more">
          <Text type="secondary">
            {items.length.toLocaleString()} of {(result?.total ?? 0).toLocaleString()}
          </Text>
          {more && onLoadMore && (
            <Button onClick={onLoadMore} loading={loadingMore}>Load more</Button>
          )}
        </div>
      )}
    </>
  );
}
