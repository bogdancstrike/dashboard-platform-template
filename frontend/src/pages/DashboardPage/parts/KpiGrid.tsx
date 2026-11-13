import { Card, Skeleton } from "antd";
import { FundOutlined } from "@ant-design/icons";

import { withOrigin } from "@/entities/drilldown";
import { StatCard } from "@/components/StatCard";

import { ICONS } from "../model";
import type { DashboardPageData } from "../useDashboardPage";

/** The KPI row (§2), as many equal columns as the width allows and the count divides into. */
export function KpiGrid({ page }: { page: DashboardPageData }) {
  const { navigate, here, data, isLoading, kpiRef, kpiColumns } = page;
  return (
    <>
      {/* ── KPI row (§2) ──────────────────────────────────────────────────
          As many equal columns as the width allows *and* the count divides
          into, so the last row is never a lone tile beside a hole. */}
      <div
        ref={kpiRef}
        className="nx-ov-kpigrid"
        data-testid="dashboard-kpis"
        style={{ gridTemplateColumns: `repeat(${kpiColumns}, minmax(0, 1fr))` }}
      >
        {isLoading
          ? // As many placeholders as the dashboard usually has, each the
            // height a tile settles at, so the grid does not reflow under the
            // reader when the numbers arrive (audit A, CLS).
            Array.from({ length: 12 }).map((_, index) => (
              <Card className="nu-statcard" key={index} style={{ minHeight: 105 }}>
                <Skeleton active paragraph={{ rows: 1 }} />
              </Card>
            ))
          : data?.kpis.map((kpi) => (
              <StatCard
                key={kpi.key}
                label={kpi.label}
                value={kpi.value}
                unit={kpi.unit}
                icon={ICONS[kpi.icon] ?? <FundOutlined />}
                accent={kpi.accent}
                hint={kpi.hint}
                trend={kpi.trend}
                polarity={kpi.polarity}
                changePercent={kpi.change_percent}
                previous={kpi.previous}
                onClick={() => navigate(withOrigin(kpi.link, here()))}
              />
            ))}
      </div>
    </>
  );
}
