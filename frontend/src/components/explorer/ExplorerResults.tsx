import { Card, Empty, List, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";

import type { ExplorerField, ExplorerResult, ExplorerView } from "@/api/explorer";

const { Text } = Typography;

export function ExplorerResults({
  result,
  view,
  loading,
  onPage,
  onSort,
}: {
  result?: ExplorerResult;
  view: ExplorerView;
  loading: boolean;
  onPage: (page: number, pageSize: number) => void;
  onSort: (field: string, order: "asc" | "desc") => void;
}) {
  const fields = new Map((result?.fields ?? []).map((field) => [field.name, field]));
  const columns: ColumnsType<Record<string, unknown>> = (result?.columns ?? []).map((name) => {
    const field = fields.get(name);
    return {
      key: name,
      dataIndex: name,
      title: field?.label ?? title(name),
      sorter: field?.sortable,
      sortOrder: result?.sort === name ? (result.order === "asc" ? "ascend" : "descend") : null,
      ellipsis: true,
      render: (value: unknown) => <Value value={value} field={field} />,
    };
  });

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
        locale={{ emptyText: <Empty description="No records match this question" /> }}
      />
    );
  }

  const items = result?.items ?? [];
  return (
    <List
      loading={loading}
      dataSource={items}
      grid={view === "cards" ? { gutter: 12, xs: 1, sm: 2, lg: 3, xl: 4 } : undefined}
      locale={{ emptyText: <Empty description="No records match this question" /> }}
      pagination={items.length ? {
        current: result?.page ?? 1,
        pageSize: result?.page_size ?? 25,
        total: result?.total ?? 0,
        onChange: onPage,
        showSizeChanger: true,
      } : false}
      renderItem={(item) => {
        const body = (
          <div className={`nu-result nu-result--${view}`}>
            {(result?.columns ?? []).map((name, index) => (
              <div className="nu-result-field" key={name}>
                {view !== "compact" && index > 0 && <Text type="secondary">{fields.get(name)?.label ?? title(name)}</Text>}
                <Value value={item[name]} field={fields.get(name)} primary={index === 0} />
              </div>
            ))}
          </div>
        );
        return view === "cards" ? <List.Item><Card size="small">{body}</Card></List.Item> : <List.Item>{body}</List.Item>;
      }}
    />
  );
}

function Value({ value, field, primary = false }: { value: unknown; field?: ExplorerField; primary?: boolean }) {
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
  return primary ? <Text strong>{String(value)}</Text> : <Text>{formatNumber(value)}</Text>;
}

function formatNumber(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
}

function title(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
