/**
 * One metric watch (§22): the series as the detector sees it — the expected
 * band and every flagged point marked — what it flagged, and the controls:
 * evaluate now, snooze, mute, edit, delete. `?anomaly=<id>` selects an alert
 * and shows the window it was judged against.
 */
import "@/styles/analytics.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Dropdown, Modal, Skeleton } from "antd";
import dayjs from "dayjs";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useSmartBack } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { alertsApi } from "@/api/recordsAnalytics";
import { TrendChart } from "@/components/analytics/TrendChart";
import { WatchForm } from "@/components/analytics/WatchForm";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorToast } from "@/lib/errors";
import { absoluteTime, relativeTime } from "@/lib/time";

import { AnomalyRow, describeWatch, WatchStatus } from "./AlertsPage";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";
import { PanelHeader } from "@/components/layout/PanelHeader";

export default function WatchDetailPage() {
  const { id = "" } = useParams();
  const back = useSmartBack();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get("anomaly");
  const editor = useUrlOverlay("edit");
  const client = useQueryClient();
  const { message } = App.useApp();

  const chart = useQuery({ queryKey: queryKeys.alerts("chart", id), queryFn: ({ signal }) => alertsApi.chart(id, 45, signal), enabled: Boolean(id) });
  const history = useQuery({
    queryKey: queryKeys.alerts("anomalies", "watch", id),
    queryFn: ({ signal }) => alertsApi.anomalies({ watch_id: id, page_size: 50 }, signal),
    enabled: Boolean(id),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.alerts() });
  };

  const evaluate = useMutation({
    mutationFn: () => alertsApi.evaluate(id),
    onSuccess: (result) => {
      if (result.status === "ERROR") void message.error(result.error ?? "The watch could not be evaluated.");
      else void message.success(result.new ? `Anomaly detected — ${result.new} new alert${result.new === 1 ? "" : "s"}.` : "Evaluated — nothing unusual.");
      refresh();
    },
    onError: errorToast(message),
  });
  const silence = useMutation({
    mutationFn: (body: { hours?: number; muted?: boolean; clear?: boolean }) => alertsApi.silence(id, body),
    onSuccess: () => {
      void message.success("Saved.");
      refresh();
    },
    onError: errorToast(message, { action: "silence alerts" }),
  });
  const acknowledge = useMutation({
    mutationFn: (anomalyId: string) => alertsApi.acknowledge(anomalyId),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: () => alertsApi.remove(id),
    onSuccess: () => {
      refresh();
      navigate("/alerts", { replace: true });
    },
    onError: errorToast(message, { action: "delete watches" }),
  });

  usePageCommands("watch-detail", [
    { id: "watch.evaluate", label: "Evaluate this watch now", keywords: "check anomaly run", run: () => evaluate.mutate() },
    ...(chart.data?.watch.can_edit ? [{ id: "watch.edit", label: "Edit this watch", keywords: "threshold sensitivity", run: () => editor.open("1") }] : []),
  ]);

  if (chart.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (chart.isError) {
    return (
      <>
        <PageHeader title="Watch" onBack={() => back("/alerts")} />
        <FailureAlert error={chart.error} titles={{ not_found: "No watch at this address" }} onRetry={() => void chart.refetch()} />
      </>
    );
  }
  const { watch, points } = chart.data!;
  const marked = new Set(chart.data!.anomalies.map((a) => a.bucket_at));
  const fmt = watch.granularity === "hour" ? "DD MMM HH:00" : "DD MMM";
  const items = history.data?.items ?? [];
  const focus = items.find((a) => a.id === selected);
  const select = (anomalyId: string | null) => {
    const next = new URLSearchParams(params);
    if (anomalyId) next.set("anomaly", anomalyId);
    else next.delete("anomaly");
    setParams(next, { replace: true });
  };

  return (
    <div data-testid="watch-detail">
      <PageHeader
        title={watch.name}
        onBack={() => back("/alerts")}
        subtitle={<span>{describeWatch(watch)} · threshold z {watch.threshold_effective}{watch.last_evaluated_at ? ` · evaluated ${relativeTime(watch.last_evaluated_at)}` : ""}</span>}
        tag={<WatchStatus watch={watch} />}
        actions={
          <>
            <Button onClick={() => evaluate.mutate()} loading={evaluate.isPending} data-testid="watch-evaluate">Evaluate now</Button>
            {watch.can_edit && (
              <>
                <Dropdown
                  menu={{
                    items: [
                      { key: "1", label: "Snooze 1 hour", onClick: () => silence.mutate({ hours: 1 }) },
                      { key: "24", label: "Snooze 1 day", onClick: () => silence.mutate({ hours: 24 }) },
                      { key: "168", label: "Snooze 1 week", onClick: () => silence.mutate({ hours: 168 }) },
                      { type: "divider" },
                      watch.muted
                        ? { key: "unmute", label: "Unmute", onClick: () => silence.mutate({ muted: false }) }
                        : { key: "mute", label: "Mute until unmuted", onClick: () => silence.mutate({ muted: true }) },
                      ...(watch.muted || watch.snoozed_until
                        ? [{ key: "clear", label: "Clear snooze and mute", onClick: () => silence.mutate({ clear: true }) }]
                        : []),
                    ],
                  }}
                >
                  <Button data-testid="watch-silence">Snooze / mute</Button>
                </Dropdown>
                <Button icon={<NxIcon name="pen" />} onClick={() => editor.open("1")}>Edit</Button>
                <Button danger onClick={() => Modal.confirm({ title: `Stop watching “${watch.name}”?`, okText: "Delete", okButtonProps: { danger: true }, onOk: () => remove.mutateAsync() })}>
                  Delete
                </Button>
              </>
            )}
          </>
        }
      />
      {watch.last_error && <FailureAlert error={new Error(watch.last_error)} titles={{ failed: "The last evaluation failed" }} />}
      <section className="nx-ra-panel" style={{ marginBottom: 14 }}>
        <PanelHeader title={<>Last {points.length} {watch.granularity}s</>} extra={<span className="nx-ra-sub">Shaded: the expected range · red: flagged</span>} />
        {points.length ? (
          <TrendChart
            label={watch.name}
            height={280}
            dateFormat={(at) => dayjs(at).format(fmt)}
            points={points.map((p) => ({ ...p, marked: marked.has(p.at) || p.unusual }))}
          />
        ) : (
          <EmptyState title="No data yet" />
        )}
      </section>
      <div className="nx-ra-grid nx-ra-grid--2">
        <section className="nx-ra-panel" aria-label="Alert history">
          <PanelHeader title="Flagged" extra={<span className="nx-ra-sub">{history.data?.total ?? 0} in total</span>} />
          {items.length === 0 ? <EmptyState compact title="Nothing flagged yet" /> : (
            <div className="nx-ra-rows">
              {items.map((anomaly) => (
                <AnomalyRow key={anomaly.id} anomaly={anomaly} selected={anomaly.id === selected}
                  onOpen={() => select(anomaly.id === selected ? null : anomaly.id)} />
              ))}
            </div>
          )}
        </section>
        <section className="nx-ra-panel" aria-label="Selected alert">
          {focus ? (
            <>
              <PanelHeader title={<>{focus.direction === "up" ? "Spike" : "Drop"} on {absoluteTime(focus.bucket_at)}</>} extra={focus.status === "OPEN" && (
                  <Button onClick={() => acknowledge.mutate(focus.id)} loading={acknowledge.isPending}>Mark as seen</Button>
                )} />
              <p className="nx-ra-sub" style={{ margin: "0 0 8px" }}>
                {focus.value.toLocaleString()} against an expected {focus.expected.toLocaleString(undefined, { maximumFractionDigits: 1 })} ± {focus.stddev.toLocaleString(undefined, { maximumFractionDigits: 1 })} — z {focus.zscore.toFixed(2)}, {focus.severity.toLowerCase()}.
                {focus.notified ? " People were notified." : focus.suppressed_reason ? ` Nobody was told: the watch was ${focus.suppressed_reason}.` : ""}
              </p>
              <TrendChart
                label="Window"
                height={180}
                dateFormat={(at) => dayjs(at).format(fmt)}
                points={(focus.series ?? []).map((p) => ({ ...p, marked: p.at === focus.bucket_at }))}
              />
            </>
          ) : (
            <EmptyState compact title="Select an alert to see the window it was judged against" />
          )}
        </section>
      </div>
      <WatchForm open={editor.value === "1"} onClose={editor.close} watch={watch} />
    </div>
  );
}
