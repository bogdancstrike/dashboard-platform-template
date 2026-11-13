import { Input, Segmented, Select } from "antd";

import { NxIcon } from "@/components/NxIcon";

import type { SetParams, useApprovalQueue } from "./useApprovalQueue";

/** Search, kind, requester and age — the queue's filters, in the address. */
export function QueueFilters({ queue, set }: { queue: ReturnType<typeof useApprovalQueue>; set: SetParams }) {
  const { box, setBox, kind, requester, ageFilter } = queue;
  const data = queue.list.data;
  return (
    <div className="nx-td-bar" role="search">
      <Input
        className="nx-td-grow"
        allowClear
        prefix={<NxIcon name="search" size={16} />}
        placeholder="Search by title, reference or record"
        aria-label="Search requests"
        value={box}
        onChange={(event) => setBox(event.target.value)}
      />
      <Select
        aria-label="Kind"
        value={kind}
        style={{ minWidth: 170 }}
        popupMatchSelectWidth={false}
        onChange={(value) => set({ kind: value })}
        options={[
          { value: "", label: "Kind: any" },
          ...(data?.kinds ?? []).map((item) => ({
            value: item.kind,
            label: `${item.label} (${data?.facets.kind[item.kind] ?? 0})`,
          })),
        ]}
      />
      <Select
        aria-label="Requester"
        value={requester}
        showSearch
        optionFilterProp="label"
        style={{ minWidth: 170 }}
        popupMatchSelectWidth={false}
        onChange={(value) => set({ requester: value })}
        options={[
          { value: "", label: "Requester: anyone" },
          ...(data?.facets.requester ?? []).map((item) => ({ value: item.id, label: `${item.name} (${item.count})` })),
        ]}
      />
      <Segmented
        value={ageFilter}
        onChange={(value) => set({ age: String(value) })}
        options={[
          { value: "", label: "Any age" }, { value: "today", label: "Today" }, { value: "week", label: "This week" },
          { value: "older", label: "Older" }, { value: "overdue", label: "Overdue" },
        ]}
      />
    </div>
  );
}
