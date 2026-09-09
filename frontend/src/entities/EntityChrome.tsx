/**
 * The parts every entity page keeps in common (§7).
 *
 * Not a layout — a layout is what made the six pages indistinguishable in the
 * first place. These are the three pieces that must behave identically
 * everywhere because they are about the *contract* rather than the subject:
 * how a dataset says how many rows it has and where to export them, how a
 * facet becomes a filter, and how a declared metric is rendered.
 *
 * Everything else — lanes, timelines, gauges, ledgers — belongs to the page
 * that knows what it is looking at.
 */

import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { ClearOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { qualityApi } from "@/api/quality";
import { explorerApi, type ExplorerRequest, type InsightMetric } from "@/api/explorer";
import { exportsApi, type ExportRequest } from "@/api/exports";
import { ExportButton } from "@/components/ExportButton";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import type { EntityView } from "@/entities/useEntityView";

const { Text } = Typography;

/** Title, live count, export and the escape hatch to the Data Explorer. */
export function EntityHeader({
  view,
  title,
  subtitle,
  actions,
}: {
  view: EntityView;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { resource, rows, request, filterCount, clearFilters } = view;

  return (
    <PageHeader
      title={title ?? resource?.label ?? ""}
      subtitle={subtitle ?? resource?.description ?? ""}
      tag={
        rows.data && resource ? (
          <>
            <Tag color="blue" data-testid="entity-total">
              {rows.data.total.toLocaleString()} of {resource.record_count.toLocaleString()}
            </Tag>
            <QualityChip resourceKey={resource.key} />
          </>
        ) : undefined
      }
      actions={
        <>
          {actions}
          {filterCount > 0 && (
            <Button icon={<ClearOutlined />} onClick={clearFilters}>
              Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
            </Button>
          )}
          <Button
            icon={<SearchOutlined />}
            onClick={() => navigate(`/explore?resource=${resource?.key ?? ""}`)}
          >
            Ask a wider question
          </Button>
          {/* Both take the same request, so an export that had to be queued
              because it was large is provably the question on screen (§30).
              Every entity list gets this by being here. */}
          <ExportButton
            disabled={!request}
            onExport={(format) =>
              explorerApi.export({ ...(request as ExplorerRequest), page: 1, format })
            }
            onQueue={async (format) => {
              const made = await exportsApi.queue({
                ...(request as unknown as ExportRequest),
                format,
              });
              message.success(
                `${made.reference} queued. It will appear on the Exports page.`,
              );
              navigate("/exports");
            }}
          />
        </>
      }
    />
  );
}

/**
 * "3 data issues", beside the count, on every list (§65).
 *
 * Here rather than on each page, so a dataset gets the indicator by being a
 * dataset. It is a *chip and a link* and nothing more: the explanations, the
 * remedies and the rows live on `/admin/quality`, and putting them on every
 * list would be that page rendered six times.
 *
 * Absent when there is nothing wrong, deliberately. A green "0 issues" on six
 * lists is six pieces of chrome a reader learns to skip, and then the one that
 * says 3 is skipped too.
 */
function QualityChip({ resourceKey }: { resourceKey: string }) {
  const found = useQuery({
    queryKey: ["quality-summary", resourceKey],
    queryFn: ({ signal }) => qualityApi.summary(resourceKey, signal),
    staleTime: 60_000,
  });
  const summary = found.data;
  if (!summary || summary.failing === 0) return null;

  return (
    <Tooltip
      title={`${summary.records.toLocaleString()} records across ${summary.failing} check${
        summary.failing === 1 ? "" : "s"
      }. Open the data-quality page to see what and why.`}
    >
      <Link to={`/admin/quality?resource_type=${resourceKey}`}>
        <Tag
          color={summary.worst === "CRITICAL" ? "error" : summary.worst === "WARNING" ? "warning" : "processing"}
          data-testid="entity-quality"
        >
          {summary.failing} data {summary.failing === 1 ? "issue" : "issues"}
        </Tag>
      </Link>
    </Tooltip>
  );
}

/**
 * Search plus one select per faceted field.
 *
 * Facets rather than free selects: the options and their counts come from the
 * rows actually reachable under the other filters, so the menu can never offer
 * a value that finds nothing.
 */
export function EntityFilters({
  view,
  only,
  children,
}: {
  view: EntityView;
  /** Restrict to these fields — a triage queue wants two, not six. */
  only?: string[];
  children?: React.ReactNode;
}) {
  const { resource, rows, filters, search, setSearch, setFilter } = view;
  const fields = (resource?.fields ?? []).filter(
    (field) => field.facet && (!only || only.includes(field.name)),
  );

  return (
    <Card size="small" className="nu-filter-bar">
      <Space wrap size={8} align="center">
        <Input.Search
          allowClear
          placeholder={`Search ${resource?.label.toLowerCase() ?? ""}`}
          aria-label={`Search ${resource?.label.toLowerCase() ?? ""}`}
          style={{ width: 260 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {fields.map((field) => (
          <Select
            key={field.name}
            allowClear
            showSearch
            placeholder={field.label}
            aria-label={field.label}
            style={{ minWidth: 170 }}
            value={filters[field.name] ?? undefined}
            options={(rows.data?.facets[field.name] ?? []).map((facet) => ({
              value: facet.value,
              label: `${facet.value} · ${facet.count.toLocaleString()}`,
            }))}
            onChange={(value?: string) => setFilter(field.name, value ?? null)}
          />
        ))}
        {children}
      </Space>
    </Card>
  );
}

/** A declared metric as a number a person can read. */
export function formatMetric(metric: InsightMetric): { value: string; unit: string } {
  const { value, format } = metric;
  switch (format) {
    case "currency":
      return Math.abs(value) >= 1_000_000
        ? { value: `€${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`, unit: "" }
        : { value: `€${Math.round(value).toLocaleString()}`, unit: "" };
    case "percent":
      return { value: value.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "%" };
    case "hours":
      return { value: Math.round(value).toLocaleString(), unit: "h" };
    case "minutes":
      // Minutes are what the column holds; hours or days are what a person
      // says. Converting on the way out beats storing a second column.
      return value >= 1440
        ? { value: (value / 1440).toFixed(1), unit: "d" }
        : { value: (value / 60).toFixed(1), unit: "h" };
    case "score":
      return { value: value.toFixed(1), unit: "/10" };
    default:
      return { value: Math.round(value).toLocaleString(), unit: "" };
  }
}

/**
 * The dataset's declared headline numbers, over the rows currently in view.
 *
 * A tile with a `filter` is a control: clicking it narrows the list to the
 * rows it counted (§44). One without is a total, and totals are not filters.
 */
export function MetricStrip({
  view,
  accents = [],
}: {
  view: EntityView;
  /** Per-tile accent, in declaration order. */
  accents?: string[];
}) {
  const metrics = view.insights.data?.metrics ?? [];
  if (metrics.length === 0) return null;

  return (
    <div className="nu-metric-strip" data-testid="entity-metrics">
      {metrics.map((metric, index) => {
        const shown = formatMetric(metric);
        const field = Object.keys(metric.filter)[0];
        const values = field ? metric.filter[field] : undefined;
        const applies = Boolean(field && values && values.length === 1);
        return (
          <StatCard
            key={metric.key}
            label={metric.label}
            value={0}
            displayValue={shown.value}
            unit={shown.unit}
            accent={accents[index] ?? "accent"}
            hint={metric.hint}
            onClick={
              applies
                ? () => view.setFilter(field!, values![0] ?? null)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}

/** One place where a dataset that will not load says why (§34, §76). */
export function EntityError({ view }: { view: EntityView }) {
  const error = view.rows.error ?? view.catalogue.error;
  if (!view.rows.isError && !view.catalogue.isError) return null;

  return (
    <Alert
      className="nu-block"
      type={error instanceof ApiError && error.isForbidden ? "warning" : "error"}
      showIcon
      message={
        error instanceof ApiError && error.isForbidden
          ? "Your role does not include this dataset"
          : error instanceof ApiError
            ? error.message
            : "Those records could not be loaded"
      }
      description={
        error instanceof ApiError ? (
          <Space direction="vertical" size={4}>
            {error.missingPermissions.length > 0 && (
              <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
            )}
            <Text code copyable={{ text: error.correlationId }}>
              {error.correlationId}
            </Text>
          </Space>
        ) : undefined
      }
      action={
        <Button size="small" onClick={() => void view.rows.refetch()}>
          Retry
        </Button>
      }
    />
  );
}
