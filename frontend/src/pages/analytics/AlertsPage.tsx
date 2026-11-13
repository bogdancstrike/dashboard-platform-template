/**
 * Anomaly alerts (§22): the watches — each a metric with its recent shape
 * and status — and the history of everything they flagged.
 * `?tab=history` switches to the feed; `?watch=new` opens the editor.
 */
import "@/styles/analytics.css";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Empty, Input, Pagination, Skeleton } from "antd";
import dayjs from "dayjs";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { useAuth } from "@/auth/AuthProvider";
import { alertsApi, type Anomaly, type MetricWatch } from "@/api/recordsAnalytics";
import { Kpi, Sparkline } from "@/components/analytics/parts";
import { WatchForm } from "@/components/analytics/WatchForm";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";

export const STATUS_LABEL: Record<string, string> = { OK: "Normal", ANOMALY: "Anomaly", NO_DATA: "No data", ERROR: "Error" };

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
    <li className={`nx-ra-anomaly${selected ? " is-selected" : ""}`} tabIndex={0} role="button" onClick={onOpen}
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
    </li>
  );
}

export default function AlertsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "history" ? "history" : "watches";
  const q = params.get("q") ?? "";
  const editor = useUrlOverlay("watch");
  const { can } = useAuth();
  const canManage = can("alerts.manage");
  const client = useQueryClient();
  const { message } = App.useApp();

  const set = (key: string, value: string | null, push = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: !push });
  };

  const watches = useQuery({
    queryKey: ["alerts", "watches", q],
    queryFn: ({ signal }) => alertsApi.watches({ q: q || undefined }, signal), 
    placeholderData: keepPreviousData,
  });
  const runAll = useMutation({
    mutationFn: () =>
      // No dedicated client call for the job: evaluating each is what it does.
      Promise.all((watches.data?.items ?? []).map((w) => alertsApi.evaluate(w.id))),
    onSuccess: (results) => {
      const fired = results.reduce((sum, r) => sum + r.new, 0);
      void message.success(fired ? `${fired} new anomal${fired === 1 ? "y" : "ies"}.` : "Every watch evaluated — nothing new.");
      void client.invalidateQueries({ queryKey: ["alerts"] });
    },
    onError: (error) => void message.error(errorText(error)),
  });

  usePageCommands("alerts", [
    { id: "alerts.new", label: "Watch a metric", keywords: "anomaly alert spike drop", run: () => editor.open("new") },
    { id: "alerts.history", label: "Show alert history", keywords: "anomalies", run: () => set("tab", "history", true) },
  ]);

  const items = watches.data?.items ?? [];
  const anomalous = items.filter((w) => w.last_status === "ANOMALY").length;
  const silenced = items.filter((w) => w.muted || w.snoozed_until).length;

  return (
    <div data-testid="alerts-page">
      <PageHeader
        title={<>Anomaly <em>alerts</em></>}
        subtitle="Watch a metric and hear about it when it spikes or drops against its own history."
        actions={
          <>
            <Button onClick={() => runAll.mutate()} loading={runAll.isPending} disabled={!items.length}>Evaluate all</Button>
            {canManage && (
              <Button type="primary" icon={<NxIcon name="plus" />} onClick={() => editor.open("new")} data-testid="watch-new">
                Watch a metric
              </Button>
            )}
          </>
        }
      />
      <div className="nx-ra-kpis">
        <Kpi label="Watches" value={items.length} hint={`${items.filter((w) => w.enabled).length} enabled`} />
        <Kpi label="In anomaly now" value={anomalous} tone={anomalous ? "bad" : "ok"} />
        <Kpi label="Open alerts" value={watches.data?.open_anomalies ?? 0} tone={watches.data?.open_anomalies ? "warn" : undefined} />
        <Kpi label="Silenced" value={silenced} hint="muted or snoozed" />
      </div>
      <div className="nx-ra-chips" role="tablist" aria-label="Alert views">
        <button type="button" role="tab" className="nx-ra-chip" aria-selected={tab === "watches"} onClick={() => set("tab", null, true)}>Watches</button>
        <button type="button" role="tab" className="nx-ra-chip" aria-selected={tab === "history"} onClick={() => set("tab", "history", true)}>History</button>
        {tab === "watches" && (
          <Input.Search allowClear defaultValue={q} placeholder="Find a watch" onSearch={(v) => set("q", v || null)}
            style={{ maxWidth: 240 }} aria-label="Find a watch" />
        )}
      </div>

      {tab === "watches" ? (
        watches.isLoading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : watches.isError ? (
          <FailureAlert error={watches.error} onRetry={() => void watches.refetch()} />
        ) : items.length === 0 ? (
          <Empty description="Nothing watched yet">
            {canManage && <Button type="primary" onClick={() => editor.open("new")}>Watch a metric</Button>}
          </Empty>
        ) : (
          <div className="nx-ra-watch-grid" data-testid="watch-grid">
            {items.map((watch) => (
              <article
                key={watch.id}
                className="nx-ra-panel nx-ra-watch"
                tabIndex={0}
                role="link"
                onClick={() => navigate(`/alerts/${watch.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/alerts/${watch.id}`)}
                data-testid={`watch-${watch.name}`}
              >
                <div className="nx-ra-watch-meta">
                  <WatchStatus watch={watch} />
                  {watch.open_anomalies ? <span className="nx-ra-pill nx-ra-pill--bad">{watch.open_anomalies} open</span> : null}
                </div>
                <h3>{watch.name}</h3>
                <Sparkline values={watch.sparkline ?? []} label={`${watch.name} — recent values`} />
                <div className="nx-ra-watch-meta">
                  <span>{describeWatch(watch)}</span>
                  <span>{watch.last_anomaly_at ? `last ${relativeTime(watch.last_anomaly_at)}` : "never flagged"}</span>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        <History onOpen={(a) => navigate(`/alerts/${a.watch_id}?anomaly=${a.id}`)} />
      )}

      <WatchForm open={editor.value === "new"} onClose={editor.close} onSaved={(saved) => navigate(`/alerts/${saved.id}`, { replace: true })} />
    </div>
  );
}

function History({ onOpen }: { onOpen: (anomaly: Anomaly) => void }) {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const feed = useQuery({
    queryKey: ["alerts", "anomalies", status, page],
    queryFn: ({ signal }) => alertsApi.anomalies({ status: status || undefined, page, page_size: 20 }, signal), 
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  return (
    <section className="nx-ra-panel" data-testid="alert-history">
      <div className="nx-ra-chips">
        {[["", "All"], ["OPEN", "Open"], ["ACKNOWLEDGED", "Seen"]].map(([value, label]) => (
          <button key={value} type="button" className="nx-ra-chip" aria-pressed={status === value} onClick={() => set("status", value || null)}>
            {label}
          </button>
        ))}
      </div>
      {feed.isLoading ? <Skeleton active /> : feed.isError ? <FailureAlert error={feed.error} /> : feed.data!.items.length === 0 ? (
        <Empty description="Nothing flagged" />
      ) : (
        <ul className="nx-ra-rows">
          {feed.data!.items.map((anomaly) => <AnomalyRow key={anomaly.id} anomaly={anomaly} onOpen={() => onOpen(anomaly)} />)}
        </ul>
      )}
      {(feed.data?.total ?? 0) > 20 && (
        <Pagination style={{ marginTop: 12 }} size="small" current={page} pageSize={20} total={feed.data!.total}
          showSizeChanger={false} onChange={(next) => set("page", next === 1 ? null : String(next))} />
      )}
    </section>
  );
}
