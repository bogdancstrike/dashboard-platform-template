/** How a metric watch and one of its anomalies read in a row — shared by the alerts page and a watch's own page. */

import dayjs from "dayjs";

import type { Anomaly, MetricWatch } from "@/api/recordsAnalytics";
import { absoluteTime } from "@/lib/time";

const STATUS_LABEL: Record<string, string> = { OK: "Normal", ANOMALY: "Anomaly", NO_DATA: "No data", ERROR: "Error" };

export function WatchStatus({ watch }: { watch: Pick<MetricWatch, "last_status" | "muted" | "snoozed_until"> }) {
  const key = watch.last_status ?? "none";
  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <span className={`nx-ra-status nx-ra-status--${key}`} data-testid="watch-status">{STATUS_LABEL[key] ?? "Not evaluated"}</span>
      {watch.muted && <span className="nx-ra-pill">Muted</span>}
      {watch.snoozed_until && <span className="nx-ra-pill">Snoozed until {dayjs(watch.snoozed_until).format("D MMM HH:mm")}</span>}
    </span>
  );
}

export function describeWatch(watch: Pick<MetricWatch, "measure" | "measure_field" | "dataset" | "granularity" | "method" | "sensitivity">): string {
  const measure = watch.measure === "count" ? "Count" : `${watch.measure === "sum" ? "Sum" : "Average"} of ${watch.measure_field}`;
  return `${measure} · ${watch.dataset}s per ${watch.granularity} · ${watch.method === "seasonal" ? "seasonal" : "rolling"} · ${watch.sensitivity}`;
}

export function AnomalyRow({ anomaly, onOpen, selected }: { anomaly: Anomaly; onOpen: () => void; selected?: boolean }) {
  const up = anomaly.direction === "up";
  return (
    <div className={`nx-ra-anomaly${selected ? " is-selected" : ""}`} tabIndex={0} role="button" onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()} data-testid="anomaly-row">
      <span className={`nx-ra-anomaly-icon ${up ? "is-up" : "is-down"}`} aria-hidden>{up ? "↑" : "↓"}</span>
      <div className="nx-ra-row-main">
        <b>{anomaly.watch_name ?? "Watch"} — unusual {up ? "spike" : "drop"}</b>
        <span>
          {anomaly.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} vs expected{" "}
          {anomaly.expected.toLocaleString(undefined, { maximumFractionDigits: 1 })} · z {anomaly.zscore > 0 ? "+" : ""}
          {anomaly.zscore.toFixed(1)} · {absoluteTime(anomaly.bucket_at)}
        </span>
      </div>
      {anomaly.suppressed_reason && <span className="nx-ra-pill">{anomaly.suppressed_reason}</span>}
      <span className={`nx-ra-status nx-ra-status--${anomaly.status === "OPEN" ? "ANOMALY" : "NO_DATA"}`}>
        {anomaly.status === "OPEN" ? "Open" : "Seen"}
      </span>
    </div>
  );
}
