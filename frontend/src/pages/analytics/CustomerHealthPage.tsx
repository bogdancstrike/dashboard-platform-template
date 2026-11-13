/**
 * Customer health across the book (§12): how the accounts split between
 * healthy, at risk and critical, the shape of the scores, who moved most,
 * who dropped a band lately — and the model behind it all, which an
 * administrator tunes here.
 */
import "@/styles/analytics.css";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Form, Input, InputNumber, Pagination, Segmented, Skeleton, Slider, Tooltip } from "antd";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/app/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import {
  BAND_LABEL,
  healthApi,
  money,
  type HealthBand,
  type HealthModel,
  type PortfolioEntry,
} from "@/api/recordsAnalytics";
import { BandPill, Delta, Kpi } from "@/components/analytics/parts";
import { TrendChart } from "@/components/analytics/TrendChart";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorText } from "@/lib/errors";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const BANDS: HealthBand[] = ["HEALTHY", "AT_RISK", "CRITICAL"];

export default function CustomerHealthPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const band = params.get("band") ?? "";
  const period = params.get("period") === "7d" ? "7d" : "30d";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const sort = params.get("sort") ?? "score";
  const model = useUrlOverlay("panel");
  const { message } = App.useApp();
  const client = useQueryClient();

  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: true });
  };

  const portfolio = useQuery({
    queryKey: ["health-portfolio", band, period, q, page, sort],
    queryFn: ({ signal }) =>
      healthApi.portfolio(
        { band: band || undefined, period, q: q || undefined, page, page_size: 12, sort, order: sort === "score" ? "asc" : "desc" },
        signal,
      ),
    placeholderData: keepPreviousData,
  });

  const recompute = useMutation({
    mutationFn: () => healthApi.recompute(),
    onSuccess: (result) => {
      void message.success(`Scored ${result.customers} customers${result.dropped ? ` — ${result.dropped} dropped a band` : ""}.`);
      void client.invalidateQueries({ queryKey: ["health-portfolio"] });
    },
    onError: (error) => void message.error(errorText(error)),
  });

  usePageCommands("customer-health", [
    { id: "health.critical", label: "Show critical customers", keywords: "health churn risk", run: () => set({ band: "CRITICAL" }) },
    { id: "health.model", label: "Tune the health model", keywords: "weights thresholds", run: () => model.open("model") },
  ]);

  const data = portfolio.data;
  const count = (key: HealthBand) => data?.distribution.find((item) => item.band === key)?.count ?? 0;

  return (
    <div data-testid="health-page">
      <PageHeader
        title={<>Customer <em>health</em></>}
        subtitle="A weighted score from tickets, orders, usage and renewals — with the reasons behind every number."
        actions={
          <>
            <Button icon={<NxIcon name="sliders" />} onClick={() => model.open("model")} data-testid="health-model-open">
              Model
            </Button>
            {data?.can_configure && (
              <Button type="primary" loading={recompute.isPending} onClick={() => recompute.mutate()}>
                Recompute now
              </Button>
            )}
          </>
        }
      />

      {portfolio.isError && <FailureAlert error={portfolio.error} onRetry={() => void portfolio.refetch()} />}
      {portfolio.isLoading || !data ? (
        portfolio.isError ? null : <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <>
          <div className="nx-ra-kpis">
            <Kpi label="Average score" value={data.average ?? "—"} hint={`${data.total} customers scored`} testId="health-average" />
            <Kpi label="Healthy" value={count("HEALTHY")} tone="ok" hint={`≥ ${data.thresholds.healthy}`} />
            <Kpi label="At risk" value={count("AT_RISK")} tone="warn" hint={`${data.thresholds.at_risk}–${data.thresholds.healthy - 1}`} />
            <Kpi label="Critical" value={count("CRITICAL")} tone="bad" hint={`below ${data.thresholds.at_risk}`} />
          </div>

          <div className="nx-ra-grid nx-ra-grid--2" style={{ marginBottom: 14 }}>
            <section className="nx-ra-panel" aria-label="Distribution">
              <div className="nx-ra-panel-head">
                <h2>Distribution</h2>
                <span className="nx-ra-sub">{data.computed_at ? `Scored ${relativeTime(data.computed_at)}` : "Not scored yet"}</span>
              </div>
              <div className="nx-ra-dist" aria-hidden>
                {data.distribution.map((item) =>
                  item.count ? <i key={item.band} className={item.band} style={{ flex: item.count }} /> : null,
                )}
              </div>
              <div className="nx-ra-legend">
                {data.distribution.map((item) => (
                  <button
                    key={item.band}
                    type="button"
                    aria-pressed={band === item.band}
                    onClick={() => set({ band: band === item.band ? null : item.band })}
                  >
                    <BandPill band={item.band} /> <b>{item.count}</b>
                  </button>
                ))}
              </div>
              <TrendChart
                label="Customers"
                kind="bar"
                height={300}
                points={data.histogram.map((bucket) => ({ at: `${bucket.from}–${bucket.to}`, value: bucket.count }))}
                dateFormat={(at) => at}
                format={(v) => String(Math.round(v))}
              />
            </section>

            <section className="nx-ra-panel" aria-label="Movers">
              <div className="nx-ra-panel-head">
                <h2>Movers</h2>
                <Segmented
                  size="small"
                  value={period}
                  onChange={(value) => set({ period: value === "7d" ? "7d" : null })}
                  options={[{ label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }]}
                  aria-label="Movement period"
                />
              </div>
              <h3 className="nx-ra-sub" style={{ margin: "0 0 6px" }}>Falling</h3>
              <Movers rows={data.movers.down} period={period} onOpen={(id) => navigate(`/customers/${id}?tab=health`)} />
              <h3 className="nx-ra-sub" style={{ margin: "12px 0 6px" }}>Rising</h3>
              <Movers rows={data.movers.up} period={period} onOpen={(id) => navigate(`/customers/${id}?tab=health`)} />
            </section>
          </div>

          <div className="nx-ra-grid nx-ra-grid--2">
            <section className="nx-ra-panel" aria-label="Customers by health">
              <div className="nx-ra-panel-head">
                <h2>Customers</h2>
                <span className="nx-ra-sub">{data.matching} matching</span>
              </div>
              <div className="nx-ra-chips" role="tablist" aria-label="Health band">
                {["", ...BANDS].map((key) => (
                  <button
                    key={key || "all"}
                    type="button"
                    role="tab"
                    className="nx-ra-chip"
                    aria-selected={band === key}
                    onClick={() => set({ band: key || null })}
                  >
                    {key ? BAND_LABEL[key as HealthBand] : "All"}
                  </button>
                ))}
                <Input.Search
                  allowClear
                  placeholder="Find a customer"
                  defaultValue={q}
                  onSearch={(value) => set({ q: value || null })}
                  style={{ maxWidth: 220 }}
                  aria-label="Find a customer"
                />
                <Segmented
                  size="small"
                  value={sort}
                  onChange={(value) => set({ sort: value === "score" ? null : String(value) })}
                  options={[{ label: "Lowest", value: "score" }, { label: "Value", value: "value" }, { label: "Moved", value: "delta" }]}
                  aria-label="Sort customers"
                />
              </div>
              {data.items.length === 0 ? (
                <EmptyState title="No customers match" />
              ) : (
                <ul className="nx-ra-rows" data-testid="health-list">
                  {data.items.map((row) => (
                    <PortfolioRow key={row.id} row={row} period={period} onOpen={() => navigate(`/customers/${row.id}?tab=health`)} />
                  ))}
                </ul>
              )}
              {data.matching > data.page_size && (
                <Pagination
                  style={{ marginTop: 12 }}
                  size="small"
                  current={data.page}
                  pageSize={data.page_size}
                  total={data.matching}
                  showSizeChanger={false}
                  onChange={(next) => set({ page: next === 1 ? null : String(next) })}
                />
              )}
            </section>

            <section className="nx-ra-panel" aria-label="Recent band drops">
              <div className="nx-ra-panel-head">
                <h2>Dropped a band</h2>
                <span className="nx-ra-sub">Account managers were alerted</span>
              </div>
              {data.drops.length === 0 ? (
                <EmptyState compact title="No recent drops" />
              ) : (
                <ul className="nx-ra-rows">
                  {data.drops.map((row) => (
                    <li key={row.id} className="nx-ra-row" tabIndex={0} role="link"
                      onClick={() => navigate(`/customers/${row.id}?tab=health`)}
                      onKeyDown={(e) => e.key === "Enter" && navigate(`/customers/${row.id}?tab=health`)}>
                      <div className="nx-ra-row-main">
                        <b>{row.name}</b>
                        <span>
                          {row.previous_band ? BAND_LABEL[row.previous_band] : "—"} → {BAND_LABEL[row.band]} ·{" "}
                          {relativeTime(row.band_changed_at)}
                        </span>
                      </div>
                      <BandPill band={row.band} score={row.score} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}

      <ModelDrawer open={model.value === "model"} onClose={model.close} />
    </div>
  );
}

function Movers({ rows, period, onOpen }: { rows: PortfolioEntry[]; period: string; onOpen: (id: string) => void }) {
  if (rows.length === 0) return <p className="nx-ra-muted">Nobody moved much.</p>;
  return (
    <ul className="nx-ra-rows">
      {rows.slice(0, 4).map((row) => (
        <PortfolioRow key={row.id} row={row} period={period} onOpen={() => onOpen(row.id)} />
      ))}
    </ul>
  );
}

function PortfolioRow({ row, period, onOpen }: { row: PortfolioEntry; period: string; onOpen: () => void }) {
  return (
    <li className="nx-ra-row" tabIndex={0} role="link" onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <div className="nx-ra-row-main">
        <b>{row.name}</b>
        <span>
          {row.code} · {money(row.lifetime_value)} lifetime
        </span>
      </div>
      <Delta value={period === "7d" ? row.delta_7d : row.delta_30d} />
      <BandPill band={row.band} />
      <span className="nx-ra-row-score">{row.score}</span>
    </li>
  );
}

/** The weights and thresholds — read by anyone, changed by `health.configure`. */
function ModelDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<HealthModel>();
  const model = useQuery({ queryKey: ["health-model"], queryFn: ({ signal }) => healthApi.model(signal), enabled: open });
  const weights = Form.useWatch("weights", form) as HealthModel["weights"] | undefined;
  const total = weights ? Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0) : 0;

  useEffect(() => {
    if (model.data) form.setFieldsValue(model.data);
  }, [model.data, form]);

  const save = useMutation({
    mutationFn: (values: HealthModel) =>
      healthApi.saveModel({ name: values.name, weights: values.weights, thresholds: values.thresholds }),
    onSuccess: (saved) => {
      void message.success(`Model saved — ${saved.recomputed.customers} customers rescored.`);
      void client.invalidateQueries({ queryKey: ["health-model"] });
      void client.invalidateQueries({ queryKey: ["health-portfolio"] });
      void client.invalidateQueries({ queryKey: ["customer-health"] });
      onClose();
    },
    onError: (error) => void message.error(errorText(error)),
  });

  const editable = Boolean(model.data?.can_configure);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Health model"
      width={460}
      rootClassName={URL_OVERLAY}
      extra={
        editable && (
          <Button type="primary" loading={save.isPending} onClick={() => form.submit()} data-testid="health-model-save">
            Save and rescore
          </Button>
        )
      }
    >
      {model.isLoading ? (
        <Skeleton active />
      ) : model.isError ? (
        <FailureAlert error={model.error} />
      ) : (
        <Form form={form} layout="vertical" disabled={!editable} onFinish={(values) => save.mutate(values)}>
          {!editable && <p className="nx-ra-muted">Your role can read the model; changing it needs “Change the customer health model”.</p>}
          <Form.Item name="name" label="Name">
            <Input maxLength={120} />
          </Form.Item>
          <h3 className="nx-ra-sub">Weights <Tooltip title="Relative — they are normalised to 100%"><span>· total {total}</span></Tooltip></h3>
          <div className="nx-ra-weights">
            {model.data?.signals.map((signal) => (
              <Form.Item key={signal.key} name={["weights", signal.key]} label={signal.label} style={{ marginBottom: 0 }}>
                <Slider min={0} max={100} ariaLabelForHandle={`${signal.label} weight`} />
              </Form.Item>
            ))}
          </div>
          <h3 className="nx-ra-sub" style={{ marginTop: 16 }}>Bands</h3>
          <Form.Item name={["thresholds", "bands", "healthy"]} label="Healthy from">
            <InputNumber min={1} max={100} />
          </Form.Item>
          <Form.Item name={["thresholds", "bands", "at_risk"]} label="At risk from (below is critical)">
            <InputNumber min={1} max={100} />
          </Form.Item>
          <h3 className="nx-ra-sub">Tickets — points off per item</h3>
          <Form.Item name={["thresholds", "tickets", "open"]} label="Open ticket"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name={["thresholds", "tickets", "escalated"]} label="Escalated ticket"><InputNumber min={1} max={100} /></Form.Item>
          <Form.Item name={["thresholds", "tickets", "breached"]} label="SLA breach (90 days)"><InputNumber min={1} max={100} /></Form.Item>
          <h3 className="nx-ra-sub">Orders, usage and renewal (days)</h3>
          <Form.Item name={["thresholds", "orders", "recency_days"]} label="No order for this long scores 0"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "orders", "window_days"]} label="Volume window"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "usage", "contact_days"]} label="No contact for this long scores 0"><InputNumber min={1} max={3650} /></Form.Item>
          <Form.Item name={["thresholds", "renewal", "window_days"]} label="Renewal starts to weigh within"><InputNumber min={1} max={3650} /></Form.Item>
        </Form>
      )}
    </Drawer>
  );
}
