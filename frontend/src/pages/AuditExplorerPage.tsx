import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { ClearOutlined, UserSwitchOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { auditApi, type AuditQuery, type AuditRow } from "@/api/audit";
import { AuditDiff } from "@/components/audit/AuditDiff";
import { actionColor, humaniseAction, resultColor } from "@/components/audit/vocabulary";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { ExportButton } from "@/components/ExportButton";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;
const { RangePicker } = DatePicker;

/**
 * The audit explorer (§21).
 *
 * Comprehensive by design: **who** (actor, role, and the impersonator when
 * there was one), **when**, **what** (action, resource type, id, label) and the
 * field-level **before → after** diff behind every row.
 *
 * Filtering, faceting, sorting and paging all happen in PostgreSQL (§71). An
 * audit screen that filters a downloaded page is the worst possible place for
 * that mistake: it answers "nobody deleted anything" from twenty-five of four
 * thousand rows, with no way for the reader to tell.
 *
 * The whole question lives in the URL (§69, §72), so an investigation can be
 * pasted into a ticket and reopened exactly as it was.
 */
export default function AuditExplorerPage() {
  const [params, setParams] = useSearchParams();

  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const sort = params.get("sort") ?? "occurred_at";
  const order = params.get("order") === "asc" ? "asc" : "desc";
  const term = params.get("q") ?? "";
  const actionParam = params.get("action") ?? "";
  const resultParam = params.get("result") ?? "";
  const resourceParam = params.get("resource_type") ?? "";
  const actor = params.get("actor_label") ?? "";
  const correlation = params.get("correlation_id") ?? "";
  const impersonated = params.get("impersonated") ?? "";
  const from = params.get("occurred_at_from") ?? "";
  const to = params.get("occurred_at_to") ?? "";
  const openEntry = params.get("entry") ?? "";

  const actions = useMemo(() => actionParam.split(",").filter(Boolean), [actionParam]);
  const results = useMemo(() => resultParam.split(",").filter(Boolean), [resultParam]);
  const resourceTypes = useMemo(() => resourceParam.split(",").filter(Boolean), [resourceParam]);

  const [search, setSearch] = useState(term);
  const debouncedSearch = useDebouncedValue(search, 280);

  useEffect(() => setSearch(term), [term]);

  useEffect(() => {
    if (debouncedSearch === term) return;
    set({ q: debouncedSearch || null, page: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      },
      { replace },
    );
  };

  const catalogue = useQuery({
    queryKey: ["audit", "catalog"],
    queryFn: ({ signal }) => auditApi.catalogue(signal),
    staleTime: 300_000,
  });

  const query = useMemo<AuditQuery>(
    () => ({
      page,
      page_size: pageSize,
      sort,
      order,
      q: term || undefined,
      action: actionParam || undefined,
      result: resultParam || undefined,
      resource_type: resourceParam || undefined,
      actor_label: actor || undefined,
      correlation_id: correlation || undefined,
      impersonated: impersonated || undefined,
      occurred_at_from: from || undefined,
      occurred_at_to: to || undefined,
    }),
    [
      page, pageSize, sort, order, term, actionParam, resultParam,
      resourceParam, actor, correlation, impersonated, from, to,
    ],
  );

  const ledger = useQuery({
    queryKey: ["audit", "ledger", query],
    queryFn: ({ signal }) => auditApi.list(query, signal),
    placeholderData: (previous) => previous,
  });

  const entry = useQuery({
    queryKey: ["audit", "entry", openEntry],
    queryFn: ({ signal }) => auditApi.entry(openEntry, signal),
    enabled: Boolean(openEntry),
  });

  const filterCount =
    actions.length +
    results.length +
    resourceTypes.length +
    (term ? 1 : 0) +
    (actor ? 1 : 0) +
    (correlation ? 1 : 0) +
    (impersonated ? 1 : 0) +
    (from || to ? 1 : 0);

  const clearFilters = () => setParams(new URLSearchParams());

  usePageCommands("audit", [
    {
      id: "audit.denied",
      label: "Show refused and failed actions only",
      keywords: "denied failure security",
      run: () => set({ result: "DENIED,FAILURE", page: null }),
    },
    {
      id: "audit.impersonated",
      label: "Show actions taken while impersonating",
      keywords: "impersonation admin acting as",
      run: () => set({ impersonated: "true", page: null }),
    },
    {
      id: "audit.deletions",
      label: "Show deletions",
      keywords: "delete removed destructive",
      run: () => set({ action: "DELETE,BULK_DELETE", page: null }),
    },
    {
      id: "audit.clear",
      label: "Clear every audit filter",
      keywords: "reset",
      run: clearFilters,
    },
  ]);

  const resourceOptions = (ledger.data?.facets["resource_type"] ?? []).map((facet) => ({
    value: facet.value,
    label: `${facet.value} (${facet.count.toLocaleString()})`,
  }));

  const columns: ColumnsType<AuditRow> = [
    {
      title: "When",
      dataIndex: "occurred_at",
      width: 150,
      sorter: true,
      defaultSortOrder: order === "asc" ? "ascend" : "descend",
      render: (value: string) => (
        <Tooltip title={absoluteTime(value)}>
          <Text>{relativeTime(value)}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Actor",
      dataIndex: "actor_label",
      width: 210,
      sorter: true,
      render: (value: string, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Space size={6}>
            <Text>{value}</Text>
            {row.impersonated && (
              <Tooltip
                title={`Acting as this user: ${row.impersonator_label || "an administrator"}`}
              >
                <Tag icon={<UserSwitchOutlined />} color="purple" data-testid="impersonated">
                  via {row.impersonator_label || "an administrator"}
                </Tag>
              </Tooltip>
            )}
          </Space>
          {row.actor_role && <Text type="secondary">{row.actor_role}</Text>}
        </Space>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      width: 170,
      sorter: true,
      render: (value: string) => <Tag color={actionColor(value)}>{humaniseAction(value)}</Tag>,
    },
    {
      title: "Resource",
      dataIndex: "resource_label",
      ellipsis: true,
      render: (value: string, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Text>{value || "—"}</Text>
          <Text type="secondary">{row.resource_type}</Text>
        </Space>
      ),
    },
    {
      title: "Changed",
      dataIndex: "changed_field_count",
      width: 100,
      align: "right",
      render: (value: number) =>
        value > 0 ? (
          <Text>{value} field{value === 1 ? "" : "s"}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Result",
      dataIndex: "result",
      width: 110,
      sorter: true,
      render: (value: string) => {
        const colour = resultColor(value);
        return colour ? <Tag color={colour}>{value}</Tag> : <Text type="secondary">{value}</Text>;
      },
    },
  ];

  const onTableChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<AuditRow> | SorterResult<AuditRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : sort;
    set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every recorded action: who did it, when, to what, and exactly what changed."
        tag={
          ledger.data ? (
            <Tag color="blue" data-testid="audit-total">
              {ledger.data.total.toLocaleString()} entries
            </Tag>
          ) : undefined
        }
        actions={
          <>
            {filterCount > 0 && (
              <Button icon={<ClearOutlined />} onClick={clearFilters}>
                Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
              </Button>
            )}
            {/* The file carries the filters on screen, not the page: an audit
                export of twenty-five of four thousand rows would be evidence
                of nothing. */}
            <ExportButton
              onExport={(format) => auditApi.export({ ...query, page: undefined, format })}
            />
          </>
        }
      />

      <Card size="small" className="nu-filter-bar">
        <Space wrap size={8} align="center">
          <Input.Search
            allowClear
            placeholder="Search actor, resource, message or correlation id"
            aria-label="Search the audit log"
            style={{ width: 320 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Action"
            aria-label="Action"
            style={{ minWidth: 200 }}
            value={actions}
            options={(catalogue.data?.actions ?? []).map((value) => ({
              value,
              label: humaniseAction(value),
            }))}
            onChange={(values: string[]) => set({ action: values.join(",") || null, page: null })}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Result"
            aria-label="Result"
            style={{ minWidth: 160 }}
            value={results}
            options={(catalogue.data?.results ?? []).map((value) => ({ value, label: value }))}
            onChange={(values: string[]) => set({ result: values.join(",") || null, page: null })}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Resource type"
            aria-label="Resource type"
            style={{ minWidth: 200 }}
            value={resourceTypes}
            // Options come from the facets, so the menu offers what the data
            // actually holds under the other filters rather than a list that
            // drifts from it.
            options={resourceOptions}
            onChange={(values: string[]) =>
              set({ resource_type: values.join(",") || null, page: null })
            }
          />
          <RangePicker
            aria-label="Date range"
            value={from && to ? [dayjs(from), dayjs(to)] : null}
            onChange={(range) =>
              set({
                occurred_at_from: range?.[0]?.startOf("day").toISOString() ?? null,
                occurred_at_to: range?.[1]?.endOf("day").toISOString() ?? null,
                page: null,
              })
            }
          />
          <Select
            allowClear
            placeholder="Impersonation"
            aria-label="Impersonation"
            style={{ minWidth: 190 }}
            value={impersonated || undefined}
            options={[
              { value: "true", label: "While impersonating" },
              { value: "false", label: "Acting as themselves" },
            ]}
            onChange={(value?: string) => set({ impersonated: value ?? null, page: null })}
          />
        </Space>
      </Card>

      {ledger.isError && (
        <Alert
          className="nu-block"
          type={ledger.error instanceof ApiError && ledger.error.isForbidden ? "warning" : "error"}
          showIcon
          message={
            ledger.error instanceof ApiError && ledger.error.isForbidden
              ? "You do not have permission to read the audit log"
              : ledger.error instanceof ApiError
                ? ledger.error.message
                : "Could not load the audit log"
          }
          description={
            ledger.error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
                {ledger.error.missingPermissions.length > 0 && (
                  <Text type="secondary">
                    Missing: {ledger.error.missingPermissions.join(", ")}
                  </Text>
                )}
                <Text code copyable={{ text: ledger.error.correlationId }}>
                  {ledger.error.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void ledger.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <Card size="small" className="nu-block">
        <Table<AuditRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={ledger.data?.items ?? []}
          loading={ledger.isLoading}
          onChange={onTableChange}
          scroll={{ x: 900 }}
          onRow={(row) => ({
            onClick: () => set({ entry: row.id }, false),
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: ledger.isLoading ? (
              " "
            ) : filterCount > 0 ? (
              <NoResults filterCount={filterCount} onClear={clearFilters} />
            ) : (
              <EmptyState
                title="Nothing has been recorded yet"
                hint="Every write through the API appends an entry here, in the same transaction as the change it describes."
              />
            ),
          }}
          pagination={{
            current: ledger.data?.page ?? page,
            pageSize: ledger.data?.page_size ?? pageSize,
            total: ledger.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100, 200],
            showTotal: (total, range) =>
              `${range[0]}–${range[1]} of ${total.toLocaleString()}`,
          }}
        />
      </Card>

      <Drawer
        width={720}
        open={Boolean(openEntry)}
        onClose={() => set({ entry: null }, false)}
        title="Audit entry"
        destroyOnClose
      >
        {entry.isLoading && <Text type="secondary">Loading…</Text>}
        {entry.isError && (
          <Alert
            type="error"
            showIcon
            message={
              entry.error instanceof ApiError ? entry.error.message : "Could not load this entry"
            }
          />
        )}
        {entry.data && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="When">
                {absoluteTime(entry.data.occurred_at)}
              </Descriptions.Item>
              <Descriptions.Item label="Actor">
                <Space size={6} wrap>
                  <Text>{entry.data.actor_label}</Text>
                  {entry.data.actor_role && <Tag>{entry.data.actor_role}</Tag>}
                  {entry.data.impersonated && (
                    <Tag icon={<UserSwitchOutlined />} color="purple">
                      acting as this user:{" "}
                      {entry.data.impersonator_label || "an administrator"}
                    </Tag>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Action">
                <Space size={6}>
                  <Tag color={actionColor(entry.data.action)}>
                    {humaniseAction(entry.data.action)}
                  </Tag>
                  {resultColor(entry.data.result) ? (
                    <Tag color={resultColor(entry.data.result)}>{entry.data.result}</Tag>
                  ) : (
                    <Text type="secondary">{entry.data.result}</Text>
                  )}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Resource">
                <Space size={6} wrap>
                  <Text>{entry.data.resource_label || "—"}</Text>
                  <Tag>{entry.data.resource_type}</Tag>
                  {entry.data.resource_id && (
                    <Text type="secondary" copyable={{ text: entry.data.resource_id }}>
                      {entry.data.resource_id}
                    </Text>
                  )}
                </Space>
              </Descriptions.Item>
              {entry.data.message && (
                <Descriptions.Item label="Message">{entry.data.message}</Descriptions.Item>
              )}
              <Descriptions.Item label="Request">
                <Space size={12} wrap>
                  {entry.data.ip_address && <Text>{entry.data.ip_address}</Text>}
                  {entry.data.correlation_id && (
                    <Text type="secondary" copyable={{ text: entry.data.correlation_id }}>
                      {entry.data.correlation_id}
                    </Text>
                  )}
                </Space>
              </Descriptions.Item>
              {entry.data.user_agent && (
                <Descriptions.Item label="Agent">
                  <Text type="secondary">{entry.data.user_agent}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <div>
              <Text strong>What changed</Text>
              <div style={{ marginTop: 8 }}>
                <AuditDiff changes={entry.data.changes} />
              </div>
            </div>
          </Space>
        )}
      </Drawer>
    </>
  );
}
