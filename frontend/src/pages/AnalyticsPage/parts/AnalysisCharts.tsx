import { Col, Row, Segmented } from "antd";

import { panelFor } from "@/api/analysis";
import { ChartCard } from "@/components/ChartCard";

import { BREAKDOWN_KINDS, primaryKey, labelOf } from "../model";
import type { AnalyticsPageData } from "../useAnalyticsPage";

/** The trend, the breakdown and the composition. */
export function AnalysisCharts({ page }: { page: AnalyticsPageData }) {
  const { dataset, groupBy, kind, set, trend, breakdown, composition, drillInto } = page;
  return (
    <>
      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} xl={14}>
          <ChartCard
            id="analytics-trend"
            height={300}
            loading={trend.isLoading}
            error={trend.error ?? undefined}
            onRetry={() => void trend.refetch()}
            panel={panelFor(trend.data, "area", primaryKey(trend.data), "Over time")}
          />
        </Col>
        <Col xs={24} xl={10}>
          <ChartCard
            id="analytics-breakdown"
            height={300}
            loading={breakdown.isLoading}
            error={breakdown.error ?? undefined}
            onRetry={() => void breakdown.refetch()}
            panel={panelFor(
              breakdown.data,
              kind,
              primaryKey(breakdown.data),
              "By " + labelOf(dataset?.dimensions, groupBy),
            )}
            onSelect={drillInto(groupBy)}
            extra={
              <Segmented
                size="small"
                aria-label="Chart type"
                value={kind}
                onChange={(next) => set({ chart: String(next) })}
                options={BREAKDOWN_KINDS.map((item) => ({ value: item, label: item }))}
              />
            }
          />
        </Col>
      </Row>

      {composition.data && composition.data.dimensions.length > 1 && (
        <ChartCard
          id="analytics-composition"
          height={320}
          loading={composition.isLoading}
          error={composition.error ?? undefined}
          onRetry={() => void composition.refetch()}
          panel={panelFor(
            composition.data,
            "stacked-bar",
            primaryKey(composition.data),
            `${labelOf(dataset?.dimensions, groupBy)} by ${composition.data.dimensions[1]?.label ?? ""}`,
          )}
          onSelect={drillInto(groupBy)}
        />
      )}
    </>
  );
}
