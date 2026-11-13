import { Card, DatePicker, Input, Select, Space } from "antd";
import dayjs from "dayjs";

import { humaniseAction } from "@/components/audit/vocabulary";

import type { useAuditPage } from "./useAuditPage";

const { RangePicker } = DatePicker;

type Page = ReturnType<typeof useAuditPage>;

/** Search, action, result, resource type, dates and impersonation — every filter in the address. */
export function AuditFilters({ page }: { page: Page }) {
  const { search, setSearch, actions, results, resourceTypes, from, to, impersonated, set, catalogue, resourceOptions } = page;
  return (
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
  );
}
