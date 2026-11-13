import { Card, Segmented, Select, Space } from "antd";

import type { AnalyticsPageData } from "../useAnalyticsPage";

/** The question: which dataset, grouped how, over what period. */
export function QueryBar({ page }: { page: AnalyticsPageData }) {
  const {
    catalogue,
    datasets,
    resourceKey,
    dataset,
    period,
    granularity,
    groupBy,
    measureName,
    set,
  } = page;
  return (
    <Card size="small" className="nu-filter-bar nx-ov-querybar" data-testid="analysis-context">
      <Space wrap size={8} align="center">
        <Select
          aria-label="Dataset"
          prefix="Dataset"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={resourceKey}
          onChange={(next) => set({ resource: next, group: null, measure: null })}
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        />
        <Select
          aria-label="Period"
          prefix="Period"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={period}
          onChange={(next) => set({ period: next })}
          options={[
            ...(catalogue.data?.periods ?? []).map((item) => ({
              value: item.key,
              label: item.label,
            })),
            { value: "all_time", label: "All time" },
          ]}
        />
        <Select
          aria-label="Group by"
          prefix="Group by"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={groupBy || undefined}
          placeholder="Group by"
          onChange={(next) => set({ group: next })}
          options={(dataset?.dimensions ?? []).map((item) => ({
            value: item.name,
            label: item.label,
          }))}
        />
        <Select
          aria-label="Measure"
          prefix="Measure"
          popupMatchSelectWidth={false}
          className="nx-ov-labelselect"
          value={measureName || dataset?.measures[0]?.name}
          placeholder="Measure"
          disabled={(dataset?.measures.length ?? 0) === 0}
          onChange={(next) => set({ measure: next })}
          options={(dataset?.measures ?? []).map((item) => ({
            value: item.name,
            label: `Total ${item.label.toLowerCase()}`,
          }))}
        />
        <Segmented
          aria-label="Granularity"
          value={granularity}
          onChange={(next) => set({ grain: String(next) })}
          options={(catalogue.data?.granularities ?? []).map((item) => ({
            value: item,
            label: item,
          }))}
        />
      </Space>
    </Card>
  );
}
