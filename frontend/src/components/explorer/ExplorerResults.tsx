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

import { Button, Card, Empty, List, Space, Table, Tag, Tooltip, Typography } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";

import type { ExplorerField, ExplorerResult, ExplorerView } from "@/api/explorer";
import { HighlightedText } from "@/components/HighlightedText";

const { Text } = Typography;

export type ExplorerRecord = Record<string, unknown> & { id: string };

export interface ExplorerResultsProps {
  result?: ExplorerResult;
  view: ExplorerView;
  loading: boolean;
  /** Rows accumulated by "Load more" in the scanning modes, if any. */
  rows?: ExplorerRecord[];
  onPage: (page: number, pageSize: number) => void;
  onSort: (field: string, order: "asc" | "desc") => void;
  onPreview: (record: ExplorerRecord) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

export function ExplorerResults({
  result,
  view,
  loading,
  rows,
  onPage,
  onSort,
  onPreview,
  onLoadMore,
  loadingMore,
}: ExplorerResultsProps) {
  const fields = new Map((result?.fields ?? []).map((field) => [field.name, field]));
  const term = result?.query_text ?? "";
  const searchable = new Set(result?.searchable ?? []);
  const empty = <Empty description="No records match this question" />;

  const columns: ColumnsType<ExplorerRecord> = [
    ...(result?.columns ?? []).map((name) => {
      const field = fields.get(name);
      return {
        key: name,
        dataIndex: name,
        title: field?.label ?? title(name),
        sorter: field?.sortable,
        sortOrder: result?.sort === name ? (result.order === "asc" ? "ascend" : "descend") : null,
        ellipsis: true,
        render: (value: unknown) => (
          <Value value={value} field={field} term={searchable.has(name) ? term : ""} />
        ),
      } as ColumnsType<ExplorerRecord>[number];
    }),
    {
      key: "actions",
      width: 56,
      fixed: "right",
      align: "center",
      title: "",
      render: (_value: unknown, record: ExplorerRecord) => (
        <PreviewButton record={record} onPreview={onPreview} />
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
        onRow={(record) => ({
          onClick: () => onPreview(record),
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

  return (
    <>
      <List
        loading={loading}
        dataSource={items}
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
              <PreviewButton record={item} onPreview={onPreview} />
            </div>
          );
          return view === "cards" ? (
            <List.Item><Card size="small">{body}</Card></List.Item>
          ) : (
            <List.Item>{body}</List.Item>
          );
        }}
      />
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

function PreviewButton({
  record,
  onPreview,
}: {
  record: ExplorerRecord;
  onPreview: (record: ExplorerRecord) => void;
}) {
  return (
    <Tooltip title="Preview this record">
      <Button
        type="text"
        size="small"
        icon={<EyeOutlined />}
        aria-label={`Preview ${String(record.id)}`}
        onClick={(event) => {
          // The table row opens the same preview; without this the click runs
          // twice and the drawer flickers shut.
          event.stopPropagation();
          onPreview(record);
        }}
      />
    </Tooltip>
  );
}

function Value({
  value,
  field,
  term,
  primary = false,
}: {
  value: unknown;
  field?: ExplorerField;
  term: string;
  primary?: boolean;
}) {
  if (value === null || value === undefined || value === "") return <Text type="secondary">—</Text>;
  if (field?.kind === "bool") return <Tag color={value ? "green" : "default"}>{value ? "Yes" : "No"}</Tag>;
  if (field?.kind === "enum") return <Tag>{String(value).replaceAll("_", " ")}</Tag>;
  if (field?.kind === "datetime") {
    const parsed = new Date(String(value));
    return <Text>{Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString()}</Text>;
  }
  if (Array.isArray(value)) {
    return <Space size={4} wrap>{value.map((entry) => <Tag key={String(entry)}>{String(entry)}</Tag>)}</Space>;
  }
  if (typeof value === "number") {
    return <Text>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>;
  }
  const text = <HighlightedText text={String(value)} term={term} />;
  return primary ? <Text strong>{text}</Text> : <Text>{text}</Text>;
}

function title(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
