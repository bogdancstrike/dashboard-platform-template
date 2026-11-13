import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton } from "antd";

import { alertsApi, type WatchInput } from "@/api/recordsAnalytics";
import { PanelHeader } from "@/components/layout/PanelHeader";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { errorText } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { TrendChart } from "./TrendChart";

/** What the detector would flag over the last thirty buckets with the settings as they stand. */
export function useWatchPreview(draft: WatchInput | null, open: boolean) {
  const debounced = useDebouncedValue(draft, 400);
  const ready = Boolean(debounced && (debounced.measure === "count" || debounced.measure_field));
  const preview = useQuery({
    queryKey: queryKeys.alertsPreview(debounced),
    queryFn: ({ signal }) => alertsApi.preview(debounced!, signal),
    enabled: open && ready,
  });
  return { preview, ready };
}

/** The preview chart under the watch's settings, before anything is saved. */
export function WatchPreview({ preview, ready }: ReturnType<typeof useWatchPreview>) {
  return (
    <section className="nx-ra-panel" style={{ padding: 12, marginBottom: 16 }} aria-label="Preview">
      <PanelHeader title="Preview" extra={<span className="nx-ra-sub">{preview.data ? `${preview.data.flagged} point${preview.data.flagged === 1 ? "" : "s"} would be flagged` : ""}</span>} style={{ marginBottom: 4 }} />
      {preview.isError ? (
        <Alert type="warning" showIcon message={errorText(preview.error)} />
      ) : preview.data ? (
        <TrendChart label="Value" height={160} points={preview.data.points.map((p) => ({ ...p, marked: p.unusual }))} />
      ) : !ready ? (
        // Nothing is being fetched until a number is chosen, so a
        // skeleton here would be a spinner that never ends.
        <p className="nx-ra-sub" data-testid="watch-preview-idle">Choose the number to watch to see a preview.</p>
      ) : (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      )}
    </section>
  );
}
