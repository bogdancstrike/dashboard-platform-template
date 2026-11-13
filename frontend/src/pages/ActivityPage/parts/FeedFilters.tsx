import { Button, Card, Select, Space } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";

import { PERIODS } from "../model";
import type { ActivityPageData } from "../useActivityPage";

/** The feed's filters: period, actor, search. */
export function FeedFilters({ view }: { view: ActivityPageData }) {
  const { setParams, kind, resourceType, actorId, period, set, catalogue } = view;
  return (
    <Card size="small" className="nu-filter-bar nu-block nx-ov-feedfilters">
      <Space size={8} wrap>
        <Select
          aria-label="Period"
          style={{ minWidth: 150 }}
          value={period}
          onChange={(next) => set({ period: next })}
          options={PERIODS}
        />
        <Select
          aria-label="Dataset"
          style={{ minWidth: 170 }}
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Any dataset"
          value={resourceType || undefined}
          onChange={(next: string | undefined) => set({ resource_type: next ?? null })}
          options={(catalogue.data?.items ?? []).map((item) => ({
            value: item.key,
            label: item.label,
          }))}
        />
        {/* One person, searched in the directory rather than typed: an
            actor filter that takes a UUID is a filter for whoever wrote it. */}
        <div style={{ minWidth: 240 }}>
          <PeoplePicker
            multiple={false}
            aria-label="Actor"
            data-testid="activity-actor"
            placeholder="Anybody"
            value={actorId ? [actorId] : []}
            onChange={(ids) => set({ actor_id: ids[0] ?? null })}
          />
        </div>
        {(kind || resourceType || actorId || period !== "last_30_days") && (
          <Button type="text" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear
          </Button>
        )}
      </Space>
    </Card>
  );
}
