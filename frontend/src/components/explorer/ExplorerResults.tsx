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
import type { ColumnsType, ColumnType, TablePaginationConfig } from "antd/es/table";

import type { ExplorerField, ExplorerResult, ExplorerView } from "@/api/explorer";
import { HighlightedText } from "@/components/HighlightedText";
import { asText } from "@/lib/text";

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
}: ExplorerResultsProps) {
  const fields = new Map((result?.fields ?? []).map((field) => [field.name, field]));
  const term = result?.query_text ?? "";
  const searchable = new Set(result?.searchable ?? []);
  const empty = <Empty description="No records match this question" />;

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
              <PreviewButton record={item} onPreview={onPreview} />
            </div>
          );
          const open = onOpen;
          const clickable = open
            ? { onClick: () => open(item), style: { cursor: "pointer" } }
            : {};
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
  if (field?.kind === "enum") return <Tag>{asText(value).replaceAll("_", " ")}</Tag>;
  if (field?.kind === "datetime") {
    const parsed = new Date(asText(value));
    return <Text>{Number.isNaN(parsed.valueOf()) ? asText(value) : parsed.toLocaleString()}</Text>;
  }
  if (Array.isArray(value)) {
    return <Space size={4} wrap>{value.map((entry) => <Tag key={asText(entry)}>{asText(entry)}</Tag>)}</Space>;
  }
  if (typeof value === "number") {
    return <Text>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>;
  }
  const text = <HighlightedText text={asText(value)} term={term} />;
  return primary ? <Text strong>{text}</Text> : <Text>{text}</Text>;
}

interface Section {
  value: string;
  label: string;
  rows: ExplorerRecord[];
  /** How many the whole result holds, from the facet counts. */
  total: number;
}

/**
 * Section a result by one field, biggest first.
 *
 * The sections come from the **facet counts**, which the server computed over
 * the whole result, and the loaded rows are filed into them. Building them
 * from the loaded rows instead — which is what this did — silently drops any
 * group with nothing on the first page: at 500 tasks the 34 blocked ones had
 * no row among the first 25, so the section vanished and the headings stopped
 * adding up to the total. The reader was looking at a breakdown of the answer
 * that was missing a part of the answer, with nothing to say so.
 *
 * A section with no rows yet is therefore kept, showing what it holds. It is
 * the difference between "there are no blocked tasks" and "you have not
 * scrolled to them".
 */
function group(rows: ExplorerRecord[], field: string, result?: ExplorerResult): Section[] {
  const totals = new Map(
    (result?.facets[field] ?? []).map((entry) => [entry.value, entry.count] as const),
  );

  // Every group the server reported, in the order it reported them, and then
  // any value a loaded row carries that the facet list did not mention — the
  // facet query is capped, so a high-cardinality field can hand back rows from
  // outside the top of the list.
  const sections = new Map<string, ExplorerRecord[]>();
  for (const value of totals.keys()) sections.set(value, []);
  for (const row of rows) {
    const value = asText(row[field]);
    const bucket = sections.get(value);
    if (bucket) bucket.push(row);
    else sections.set(value, [row]);
  }

  return [...sections.entries()]
    .map(([value, sectionRows]) => ({
      value,
      // An absent value is a group of its own, and saying so beats an empty
      // heading the reader has to guess at.
      label: value === "" ? "No value" : value.replaceAll("_", " "),
      rows: sectionRows,
      total: totals.get(value) ?? 0,
    }))
    .sort((a, b) => (b.total || b.rows.length) - (a.total || a.rows.length));
}

function title(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
