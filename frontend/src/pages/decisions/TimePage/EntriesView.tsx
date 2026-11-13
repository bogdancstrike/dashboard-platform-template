import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Pagination, Segmented, Select, Skeleton, Typography } from "antd";
import dayjs from "dayjs";

import { hours, isoDay, mondayOf, timeApi, type TimeEntry } from "@/api/time";
import { EntryModal } from "@/components/decisions/EntryModal";
import { errorText, errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { EntryRows } from "./EntryRows";

const { Text } = Typography;

const RANGES: Record<string, () => [string, string]> = {
  week: () => [mondayOf(), isoDay(new Date())],
  last7: () => [isoDay(dayjs().subtract(6, "day").toDate()), isoDay(new Date())],
  month: () => [isoDay(dayjs().startOf("month").toDate()), isoDay(new Date())],
  last30: () => [isoDay(dayjs().subtract(29, "day").toDate()), isoDay(new Date())],
};

/** Every entry in a range, filtered by billable. */
export function EntriesView() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [range, setRange] = useState("last30");
  const [billable, setBillable] = useState<string>("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [from, to] = RANGES[range]!();
  const list = useQuery({
    queryKey: queryKeys.time("entries", range, billable, page),
    queryFn: ({ signal }) => timeApi.entries({ from, to, billable, page, page_size: 25 }, signal),
  });
  const remove = useMutation({
    mutationFn: timeApi.remove,
    onSuccess: () => { void client.invalidateQueries({ queryKey: queryKeys.time() }); message.success("Entry removed"); },
    onError: errorToast(message, { action: "remove this entry" }),
  });
  return (
    <>
      <div className="nx-td-bar">
        <Segmented
          value={range}
          onChange={(value) => { setRange(String(value)); setPage(1); }}
          options={[
            { value: "week", label: "This week" }, { value: "last7", label: "7 days" },
            { value: "month", label: "This month" }, { value: "last30", label: "30 days" },
          ]}
        />
        <Select
          aria-label="Billable"
          value={billable}
          onChange={(value) => { setBillable(value); setPage(1); }}
          style={{ minWidth: 150 }}
          options={[{ value: "", label: "Billable: any" }, { value: "true", label: "Billable only" }, { value: "false", label: "Non-billable" }]}
        />
        <span style={{ flex: 1 }} />
        {list.data && <Text strong>{hours(list.data.total_minutes)} in {list.data.total} entries</Text>}
      </div>
      {list.isLoading ? <Skeleton active /> : list.isError ? (
        <Alert type="error" showIcon message={errorText(list.error)} />
      ) : (
        <EntryRows entries={list.data!.items} editable onEdit={setEditing} onRemove={(entry) => remove.mutate(entry.id)} />
      )}
      {list.data && list.data.total > 25 && (
        <Pagination current={page} pageSize={25} total={list.data.total} onChange={setPage} showSizeChanger={false} align="end" />
      )}
      <EntryModal open={Boolean(editing)} entry={editing} onClose={() => setEditing(null)} />
    </>
  );
}
