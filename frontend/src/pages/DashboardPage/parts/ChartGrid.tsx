import { Card, Skeleton, Timeline, Typography } from "antd";

import { ChartCard } from "@/components/ChartCard";
import { withOrigin } from "@/entities/drilldown";

import { SHAPES, DRILL_DOWN } from "../model";
const { Text } = Typography;

import type { DashboardPageData } from "../useDashboardPage";

/** The charts (§2, §44), packed so every row is full, with recent activity as the last cell. */
export function ChartGrid({ page }: { page: DashboardPageData }) {
  const { navigate, here, data, isLoading, chartRef, chartColumns, filled, activitySpan } = page;
  return (
    <>
      {/* ── charts (§2, §44) ─────────────────────────────────────────────
          Sized by what each chart needs rather than by a uniform grid: a
          twenty-four-column heatmap in a third of the width is unreadable, and
          a gauge in two thirds is mostly whitespace. A grid packed densely,
          so a short chart fills the hole a long one leaves; a chart with
          nothing in it shrinks to a small card at the end instead of holding
          a tall blank quadrant open. */}
      <div
        ref={chartRef}
        className="nx-ov-chartgrid"
        data-testid="dashboard-charts"
        style={{ gridTemplateColumns: `repeat(${chartColumns}, minmax(0, 1fr))` }}
      >
        {isLoading &&
          [0, 1, 2, 3].map((index) => (
            <Card key={`loading-${index}`} style={{ minHeight: 330 }}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </Card>
          ))}
        {filled.map(({ key, panel, span }) => {
          const shape = SHAPES[panel.kind] ?? { span: 8, height: 240 };
          return (
            <div key={key} className="nx-ov-cell" style={{ gridColumn: `span ${span}` }}>
              <ChartCard
                id={key}
                panel={panel}
                loading={isLoading}
                height={shape.height}
                onSelect={
                  DRILL_DOWN[key]
                    ? (name) =>
                        navigate(
                          // Carrying where it came from, so the list offers one
                          // press back to this picture (§44).
                          withOrigin(`${DRILL_DOWN[key]}${encodeURIComponent(name)}`, here()),
                        )
                    : undefined
                }
              />
            </div>
          );
        })}
        <div
          className="nx-ov-cell nx-ov-activitycell"
          style={{ gridColumn: `span ${activitySpan}` }}
        >
          <Card
            size="small"
            title="Recent activity"
            className="nu-activity-card"
            data-testid="dashboard-activity"
          >
            {isLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              // The scroller is this region, focusable, so the feed can be
              // read with the keyboard (axe scrollable-region-focusable).
              <div
                className="nu-activity-scroll"
                tabIndex={0}
                role="region"
                aria-label="Recent activity"
              >
                <Timeline
                  items={(data?.activity ?? []).map((entry) => ({
                    color: "gray",
                    children: (
                      <div className="nu-activity-item">
                        <Text strong>{entry.actor}</Text>{" "}
                        <Text type="secondary">{entry.summary}</Text>
                        <div className="nu-activity-time">
                          {new Date(entry.occurred_at).toLocaleString()}
                        </div>
                      </div>
                    ),
                  }))}
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
