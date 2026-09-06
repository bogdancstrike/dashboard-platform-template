/**
 * `/analytics` — one question asked of any dataset (§2, §44, §53, §71).
 *
 * The dashboard answers a fixed set of questions well. This answers the ones
 * nobody anticipated: pick the dataset, the period and the way to cut it, and
 * every panel on the page moves together.
 *
 * Three decisions are what make it an analysis workspace rather than a second
 * dashboard:
 *
 * * **One context, in the URL.** Dataset, period, grouping, granularity and
 *   filters are query parameters, so a finding can be pasted to somebody else
 *   and arrives as the same finding (§69, §72). Every panel reads that one
 *   context — a page where the tiles and the chart can disagree about the
 *   period is a page whose numbers nobody trusts.
 * * **Every number is computed in PostgreSQL** over the whole selection, not
 *   over a page of rows. The headline, the trend and the breakdown are three
 *   calls to one endpoint, and their totals reconcile because they are the
 *   same query with different `GROUP BY`s (§71).
 * * **Every chart is a way into the records.** Clicking a bar leaves for the
 *   entity list with that value filtered, which is what makes an analysis
 *   actionable rather than decorative (§44).
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Row, Segmented, Select, Skeleton, Space, Tag, Typography } from "antd";
import { ExportOutlined, SearchOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  analysisApi,
  panelFor,
  type AnalysisMeasure,
  type AnalysisRequest,
  type AnalysisResult,
} from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { usePageCommands } from "@/commands/CommandContext";

const { Text } = Typography;

/** How a breakdown of one dimension is drawn, by how many values it has. */
const BREAKDOWN_KINDS: ChartKind[] = ["bar", "pie", "hbar", "treemap"];

export default function AnalyticsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  const datasets = catalogue.data?.datasets ?? [];
  const resourceKey = params.get("resource") ?? datasets[0]?.key ?? "";
  const dataset = datasets.find((item) => item.key === resourceKey);
  const period = params.get("period") ?? "last_90_days";
  const granularity = params.get("grain") ?? "month";
  const groupBy = params.get("group") ?? dataset?.dimensions[0]?.name ?? "";
  const measureName = params.get("measure") ?? "";
  const kind = (params.get("chart") ?? "bar") as ChartKind;

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  /**
   * What the page measures.
   *
   * The dataset's first numeric column unless the reader chose another, plus
   * the row count — which is the one measure every dataset can answer and the
   * one a reader falls back to when a sum makes no sense.
   */
  const measures = useMemo<AnalysisMeasure[]>(() => {
    const chosen = measureName || dataset?.measures[0]?.name;
    return chosen
      ? [{ aggregation: "count" }, { aggregation: "sum", field: chosen }]
      : [{ aggregation: "count" }];
  }, [measureName, dataset]);

  const base: AnalysisRequest | null = dataset
    ? { resource_type: dataset.key, measures, period }
    : null;

  const headline = useAnalysis("headline", base);
  const trend = useAnalysis(
    "trend",
    base && dataset?.default_date
      ? { ...base, dimensions: [{ field: dataset.default_date, granularity }] }
      : null,
  );
  const breakdown = useAnalysis(
    "breakdown",
    base && groupBy ? { ...base, dimensions: [groupBy], limit: 12 } : null,
  );
  const stackBy = secondDimension(dataset?.dimensions ?? [], groupBy);
  const composition = useAnalysis(
    "composition",
    base && groupBy && stackBy
      ? { ...base, dimensions: [groupBy, stackBy], limit: 40 }
      : null,
  );

  usePageCommands("analytics", [
    {
      id: "analytics.records",
      label: "Open these records in Data Explorer",
      keywords: "explore list rows",
      run: () => navigate(`/explore?resource=${resourceKey}`),
    },
    {
      id: "analytics.year",
      label: "Widen the period to a year",
      keywords: "period range",
      run: () => set({ period: "last_365_days" }),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;
  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Alert
          type={catalogue.error instanceof ApiError && catalogue.error.isForbidden ? "warning" : "error"}
          showIcon
          message={
            catalogue.error instanceof ApiError ? catalogue.error.message : "Analytics is unavailable."
          }
          description={
            catalogue.error instanceof ApiError ? (
              <Text code copyable={{ text: catalogue.error.correlationId }}>
                {catalogue.error.correlationId}
              </Text>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void catalogue.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  /** Where a clicked value goes: the records behind it, already filtered (§44). */
  const drillInto = (field: string) => (value: string) => {
    if (!dataset || value === "Other" || value === "Not set") return;
    navigate(`${dataset.path}?f.${field}=${encodeURIComponent(value)}`);
  };

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle={headline.data?.description ?? "Cut any dataset by any column, over any period."}
        tag={
          headline.data ? (
            <Tag color="blue" data-testid="analysis-matched">
              {headline.data.matched.toLocaleString()} rows
            </Tag>
          ) : undefined
        }
        actions={
          <>
            <Button
              icon={<SearchOutlined />}
              onClick={() => navigate(`/explore?resource=${resourceKey}`)}
            >
              See the records
            </Button>
            <Button
              type="primary"
              icon={<ExportOutlined />}
              onClick={() =>
                navigate(
                  `/reports/builder?resource=${resourceKey}&group=${groupBy}` +
                    `&period=${period}&chart=${kind}` +
                    (measureName ? `&measure=${measureName}` : ""),
                )
              }
            >
              Save as a report
            </Button>
          </>
        }
      />

      <Card size="small" className="nu-filter-bar" data-testid="analysis-context">
        <Space wrap size={8} align="center">
          <Select
            aria-label="Dataset"
            style={{ minWidth: 170 }}
            value={resourceKey}
            onChange={(next) => set({ resource: next, group: null, measure: null })}
            options={datasets.map((item) => ({ value: item.key, label: item.label }))}
          />
          <Select
            aria-label="Period"
            style={{ minWidth: 160 }}
            value={period}
            onChange={(next) => set({ period: next })}
            options={[
              ...(catalogue.data?.periods ?? []).map((item) => ({
                value: item.key,
                label: item.label,
              })),
              { value: "all_time", label: "All time" },
            ]}
          />
          <Select
            aria-label="Group by"
            style={{ minWidth: 170 }}
            value={groupBy || undefined}
            placeholder="Group by"
            onChange={(next) => set({ group: next })}
            options={(dataset?.dimensions ?? []).map((item) => ({
              value: item.name,
              label: item.label,
            }))}
          />
          <Select
            aria-label="Measure"
            style={{ minWidth: 190 }}
            value={measureName || dataset?.measures[0]?.name}
            placeholder="Measure"
            disabled={(dataset?.measures.length ?? 0) === 0}
            onChange={(next) => set({ measure: next })}
            options={(dataset?.measures ?? []).map((item) => ({
              value: item.name,
              label: `Total ${item.label.toLowerCase()}`,
            }))}
          />
          <Segmented
            aria-label="Granularity"
            value={granularity}
            onChange={(next) => set({ grain: String(next) })}
            options={(catalogue.data?.granularities ?? []).map((item) => ({
              value: item,
              label: item,
            }))}
          />
        </Space>
      </Card>

      <div className="nu-metric-strip" data-testid="analysis-headline">
        {(headline.data?.measures ?? []).map((measure, index) => (
          <StatCard
            key={measure.key}
            label={capitalise(measure.label)}
            value={0}
            displayValue={formatMeasure(
              headline.data?.totals[measure.key] ?? 0,
              measure.field,
            )}
            accent={index === 0 ? "accent" : "info"}
            hint={`Over the ${periodLabel(period)}, computed across all ${headline.data?.matched.toLocaleString() ?? ""} rows`}
          />
        ))}
        {headline.data && (
          <StatCard
            label="Values in view"
            value={0}
            displayValue={(breakdown.data?.rows.length ?? 0).toLocaleString()}
            accent="neutral"
            hint={
              breakdown.data?.truncated
                ? "The rest are folded into “Other”, so the parts still add up"
                : "Every value in the selection is drawn"
            }
          />
        )}
      </div>

      <Row gutter={[12, 12]} className="nu-block">
        <Col xs={24} xl={14}>
          <ChartCard
            id="analytics-trend"
            height={300}
            loading={trend.isLoading}
            panel={panelFor(trend.data, "area", primaryKey(trend.data), "Over time")}
          />
        </Col>
        <Col xs={24} xl={10}>
          <ChartCard
            id="analytics-breakdown"
            height={300}
            loading={breakdown.isLoading}
            panel={panelFor(breakdown.data, kind, primaryKey(breakdown.data), "By " + labelOf(dataset?.dimensions, groupBy))}
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
          panel={panelFor(
            composition.data,
            "stacked-bar",
            primaryKey(composition.data),
            `${labelOf(dataset?.dimensions, groupBy)} by ${composition.data.dimensions[1]?.label ?? ""}`,
          )}
          onSelect={drillInto(groupBy)}
        />
      )}

      {headline.isError && (
        <Alert
          className="nu-block"
          type="error"
          showIcon
          message={
            headline.error instanceof ApiError
              ? headline.error.message
              : "That analysis could not be run."
          }
          description={
            headline.error instanceof ApiError ? (
              <Text code copyable={{ text: headline.error.correlationId }}>
                {headline.error.correlationId}
              </Text>
            ) : undefined
          }
        />
      )}
    </>
  );
}

/** One analysis, keyed by the whole request so a changed period refetches. */
function useAnalysis(name: string, request: AnalysisRequest | null) {
  return useQuery({
    queryKey: ["analysis", name, request],
    queryFn: ({ signal }) => analysisApi.run(request!, signal),
    enabled: Boolean(request),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

/** The measure a chart draws: the chosen sum where there is one, else the count. */
function primaryKey(result: AnalysisResult | undefined): string | undefined {
  const sum = result?.measures.find((measure) => measure.aggregation === "sum");
  return (sum ?? result?.measures[0])?.key;
}

/**
 * A dimension to stack the composition chart by.
 *
 * A closed vocabulary only. Stacking by a free-text column means one stack per
 * record — a chart with six hundred colours, which is a list drawn badly. When
 * a dataset has no second vocabulary, the panel is simply not shown.
 */
function secondDimension(
  dimensions: { name: string; kind: string }[],
  groupBy: string,
): string {
  const usable = dimensions.find(
    (item) => item.name !== groupBy && (item.kind === "enum" || item.kind === "bool"),
  );
  return usable?.name ?? "";
}

function labelOf(dimensions: { name: string; label: string }[] | undefined, name: string): string {
  return (dimensions ?? []).find((item) => item.name === name)?.label.toLowerCase() ?? name;
}

function periodLabel(key: string): string {
  if (key === "all_time") return "whole dataset";
  const days = key.replace(/\D/g, "");
  return days ? `last ${days} days` : key.replace(/_/g, " ");
}

/**
 * A measured number, read the way its column is read.
 *
 * Money is money wherever it appears; a count is a count. Derived from the
 * field name rather than carried per panel, because the alternative is a
 * formatting decision repeated in four places.
 */
function formatMeasure(value: number | null, field: string): string {
  const amount = Number(value ?? 0);
  if (!field) return Math.round(amount).toLocaleString();
  if (/total|value|budget|spent|revenue|price/.test(field)) {
    return amount >= 1_000_000
      ? `€${(amount / 1_000_000).toFixed(1)}M`
      : `€${Math.round(amount).toLocaleString()}`;
  }
  return amount >= 10_000
    ? Math.round(amount).toLocaleString()
    : amount.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
