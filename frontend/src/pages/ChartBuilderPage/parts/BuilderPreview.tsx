import { Button, Card, Col, Row } from "antd";

import { ChartCard } from "@/components/ChartCard";
import { ChartPreview } from "@/components/charts/ChartPreview";

import type { ChartBuilderPageData } from "../useChartBuilderPage";

/** The chosen picture, as large as the window allows, and on request in both themes. */
export function BuilderPreview({ page }: { page: ChartBuilderPageData }) {
  const { bothThemes, setBothThemes, chartHeight, preview, chosen, blocked, panel } = page;
  return (
    <>
      <div className="nx-ov-builder-main">
        {/* The chosen picture, as large as the window allows, with the chrome
          every chart in the product has: read it as a table, take the
          numbers away. */}
        <div className="nu-block" data-testid="chart-preview">
          <ChartCard
            id="chart-builder"
            panel={blocked ? undefined : panel}
            height={chartHeight}
            loading={preview.isFetching && !preview.data}
            error={preview.error ?? undefined}
            onRetry={() => void preview.refetch()}
            extra={
              <Button
                type="text"
                aria-pressed={bothThemes}
                onClick={() => setBothThemes(!bothThemes)}
                data-testid="toggle-themes"
              >
                {bothThemes ? "Hide themes" : "Both themes"}
              </Button>
            }
            empty={
              blocked
                ? {
                    title: `${chosen?.label ?? "This picture"} ${blocked}`,
                    hint: "Pick a tile that fits the question, or add what it needs on the left.",
                  }
                : undefined
            }
          />
        </div>

        {/* The same chart in both appearances, on request: a chart checked only
          in the theme its author uses is a chart nobody checked in the other —
          but it is a check, not the page, so it waits to be asked for. */}
        {bothThemes && (
          <Card size="small" title="In both themes" className="nu-block" data-testid="chart-themes">
            <Row gutter={[12, 12]}>
              {(["light", "dark"] as const).map((mode) => (
                <Col xs={24} xl={12} key={mode}>
                  <ChartPreview
                    panel={blocked ? undefined : panel}
                    mode={mode}
                    height={340}
                    label={mode === "light" ? "Light" : "Dark"}
                  />
                </Col>
              ))}
            </Row>
          </Card>
        )}
      </div>
    </>
  );
}
