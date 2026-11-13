/**
 * Customer health across the book (§12): how the accounts split between
 * healthy, at risk and critical, the shape of the scores, who moved most,
 * who dropped a band lately — and the model behind it all, which an
 * administrator tunes here.
 */
import "@/styles/records-analytics.css";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input, Pagination, Segmented, Skeleton } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { usePageCommands } from "@/commands/CommandContext";
import { BAND_LABEL, healthApi, type HealthBand } from "@/api/recordsAnalytics";
import { Kpi } from "@/components/recordsAnalytics/parts";
import { FailureAlert } from "@/components/FailureAlert";
import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";
import { errorToast } from "@/lib/errors";
import { EmptyState } from "@/components/EmptyState";
import { queryKeys } from "@/lib/queryKeys";
import { PanelHeader } from "@/components/layout/PanelHeader";

import { BandDrops, DistributionPanel } from "./HealthPanels";
import { ModelDrawer } from "./ModelDrawer";
import { Movers, PortfolioRow } from "./PortfolioRows";

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
    queryKey: queryKeys.healthPortfolio(band, period, q, page, sort),
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
      void client.invalidateQueries({ queryKey: queryKeys.healthPortfolio() });
    },
    onError: errorToast(message),
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
            <DistributionPanel data={data} band={band} onBand={(next) => set({ band: next })} />

            <section className="nx-ra-panel" aria-label="Movers">
              <PanelHeader title="Movers" extra={<Segmented
                  size="small"
                  value={period}
                  onChange={(value) => set({ period: value === "7d" ? "7d" : null })}
                  options={[{ label: "7 days", value: "7d" }, { label: "30 days", value: "30d" }]}
                  aria-label="Movement period"
                />} />
              <h3 className="nx-ra-sub" style={{ margin: "0 0 6px" }}>Falling</h3>
              <Movers rows={data.movers.down} period={period} onOpen={(id) => navigate(`/customers/${id}?tab=health`)} />
              <h3 className="nx-ra-sub" style={{ margin: "12px 0 6px" }}>Rising</h3>
              <Movers rows={data.movers.up} period={period} onOpen={(id) => navigate(`/customers/${id}?tab=health`)} />
            </section>
          </div>

          <div className="nx-ra-grid nx-ra-grid--2">
            <section className="nx-ra-panel" aria-label="Customers by health">
              <PanelHeader title="Customers" extra={<span className="nx-ra-sub">{data.matching} matching</span>} />
              <div className="nx-ra-chips">
                <div className="nx-ra-chips-tabs" role="tablist" aria-label="Health band">
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
                </div>
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
                <div className="nx-ra-rows" data-testid="health-list">
                  {data.items.map((row) => (
                    <PortfolioRow key={row.id} row={row} period={period} onOpen={() => navigate(`/customers/${row.id}?tab=health`)} />
                  ))}
                </div>
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

            <BandDrops drops={data.drops} onOpen={(id) => navigate(`/customers/${id}?tab=health`)} />
          </div>
        </>
      )}

      <ModelDrawer open={model.value === "model"} onClose={model.close} />
    </div>
  );
}
