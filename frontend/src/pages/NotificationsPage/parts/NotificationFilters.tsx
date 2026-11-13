import { Button, Card, Input, Segmented, Select, Space } from "antd";
import { ClearOutlined } from "@ant-design/icons";

import { humanise } from "@/components/notifications/presentation";

import { READ_STATES } from "../model";
import type { NotificationsPageData } from "../useNotificationsPage";

/** Read state, category, severity, grouping and search. */
export function NotificationFilters({ view }: { view: NotificationsPageData }) {
  const { read, categories, severities, draft, setDraft, listing, set, filterCount, clearFilters } =
    view;
  return (
    <Card size="small" className="nu-filter-bar nx-ov-feedfilters">
      <Space wrap size={8} align="center">
        <Segmented
          options={READ_STATES}
          value={read}
          aria-label="Read state"
          onChange={(value) =>
            set({ read: String(value) === "all" ? null : String(value), page: null }, false)
          }
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Category"
          style={{ minWidth: 200 }}
          aria-label="Category"
          value={categories}
          options={(listing.data?.categories ?? []).map((value) => ({
            value,
            label: humanise(value),
          }))}
          onChange={(values: string[]) => set({ category: values.join(",") || null, page: null })}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Severity"
          style={{ minWidth: 180 }}
          aria-label="Severity"
          value={severities}
          options={(listing.data?.severities ?? []).map((value) => ({
            value,
            label: humanise(value),
          }))}
          onChange={(values: string[]) => set({ severity: values.join(",") || null, page: null })}
        />
        <Input.Search
          allowClear
          placeholder="Search titles and bodies"
          aria-label="Search notifications"
          style={{ width: 260 }}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {filterCount > 0 && (
          <Button icon={<ClearOutlined />} onClick={clearFilters}>
            Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
          </Button>
        )}
      </Space>
    </Card>
  );
}
