import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";

import { contractsApi, money } from "@/api/recordsAnalytics";
import { Kpi } from "@/components/recordsAnalytics/parts";
import { FailureAlert } from "@/components/FailureAlert";
import { queryKeys } from "@/lib/queryKeys";
import { PanelHeader } from "@/components/layout/PanelHeader";

export function Forecast() {
  const forecast = useQuery({ queryKey: queryKeys.contracts("forecast"), queryFn: ({ signal }) => contractsApi.forecast({ quarters: 4 }, signal) });
  if (forecast.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;
  if (forecast.isError) return <FailureAlert error={forecast.error} onRetry={() => void forecast.refetch()} />;
  const data = forecast.data!;
  const max = Math.max(1, ...data.quarters.map((q) => q.pipeline + q.renewed + q.churned));
  return (
    <div className="nx-ra-stack" data-testid="contract-forecast">
      <div className="nx-ra-kpis">
        <Kpi label="Up for renewal" value={money(data.totals.pipeline)} hint="open, next four quarters" />
        <Kpi label="Weighted forecast" value={money(data.totals.weighted)} hint="incl. renewed" />
        <Kpi label="Renewed" value={money(data.totals.renewed)} tone="ok" />
        <Kpi label="Churned" value={money(data.totals.churned)} tone={data.totals.churned ? "bad" : undefined} />
      </div>
      <section className="nx-ra-panel nx-ra-forecast">
        <PanelHeader title="Renewal ARR by quarter" extra={<span className="nx-ra-sub">By the quarter the contract ends</span>} />
        <div className="nx-ra-scroll">
          <table>
            <thead>
              <tr>
                <th>Quarter</th><th>Contracts</th><th>Open</th><th>Committed</th><th>Weighted</th><th>Renewed</th><th>Churned</th><th>At risk</th>
                <th style={{ minWidth: 140 }} aria-label="Shape" />
              </tr>
            </thead>
            <tbody>
              {data.quarters.map((quarter) => (
                <tr key={quarter.key} className={quarter.current ? "is-current" : ""}>
                  <td>{quarter.label}{quarter.current ? " · now" : ""}</td>
                  <td>{quarter.count}</td>
                  <td>{money(quarter.pipeline)}</td>
                  <td>{money(quarter.committed)}</td>
                  <td><b>{money(quarter.weighted)}</b></td>
                  <td>{money(quarter.renewed)}</td>
                  <td>{money(quarter.churned)}</td>
                  <td>{quarter.at_risk ? money(quarter.at_risk) : "—"}</td>
                  <td>
                    <div className="nx-ra-dist" style={{ margin: 0, height: 10 }} aria-hidden>
                      {quarter.renewed > 0 && <i className="HEALTHY" style={{ width: `${(quarter.renewed / max) * 100}%` }} />}
                      {quarter.pipeline > 0 && <i style={{ width: `${(quarter.pipeline / max) * 100}%`, background: "var(--nu-accent)" }} />}
                      {quarter.churned > 0 && <i className="CRITICAL" style={{ width: `${(quarter.churned / max) * 100}%` }} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
