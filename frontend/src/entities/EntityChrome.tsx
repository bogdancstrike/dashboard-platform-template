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
  App as AntApp,
  Button,
  Card,
  Input,
  Select,
  Space,
  Tag,
  Tooltip,
} from "antd";
import { ClearOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";

import { qualityApi } from "@/api/quality";
import { explorerApi, type ExplorerRequest, type InsightMetric } from "@/api/explorer";
import { exportsApi, type ExportRequest } from "@/api/exports";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { ExportButton } from "@/components/ExportButton";
import { FailureAlert } from "@/components/FailureAlert";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { SavedViewMenu } from "@/entities/SavedViewMenu";
import type { EntityView } from "@/entities/useEntityView";

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
          {/* Here rather than on each page, for the reason the quality chip is:
              a list gets its saved views by being a list (§46). */}
          <SavedViewMenu view={view} />
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

/**
 * Which of the four things a list with no rows should say (§34).
 *
 * Six lists each wrote this ternary for themselves and all six wrote the same
 * three branches — loading, nothing-matched, nothing-yet — and all six forgot
 * the fourth: a list whose query was *refused* drew the failure alert and then
 * "No orders have been placed yet" underneath it, which tells the reader in
 * one screen both that they may not see the dataset and that it is empty.
 *
 * The branch is the contract and lives here; the sentences belong to the page,
 * because only it knows what an order is. When the query failed this renders
 * nothing at all: `EntityError` above has already said what happened, and a
 * second voice guessing at the same event is how the contradiction got there.
 */
export function EntityEmpty({
  view,
  title,
  hint,
  action,
  card = false,
}: {
  view: EntityView;
  /** "No orders have been placed yet" — the page's own words. */
  title: string;
  hint?: React.ReactNode;
  /** Usually the control that makes the first one (§34). */
  action?: React.ReactNode;
  /** Wrap it in a card, for the lists whose rows are not a table. */
  card?: boolean;
}) {
  if (view.rows.isError || view.catalogue.isError) return null;
  // A blank rather than AntD's "No data", which would flash under the skeleton
  // for as long as the first query takes.
  if (view.rows.isLoading) return <> </>;

  const message =
    view.filterCount > 0 ? (
      <NoResults filterCount={view.filterCount} onClear={view.clearFilters} />
    ) : (
      <EmptyState title={title} hint={hint} action={action} />
    );

  return card ? (
    <Card size="small" className="nu-block">
      {message}
    </Card>
  ) : (
    message
  );
}

/** One place where a dataset that will not load says why (§34, §76). */
export function EntityError({ view }: { view: EntityView }) {
  if (!view.rows.isError && !view.catalogue.isError) return null;

  return (
    <FailureAlert
      className="nu-block"
      error={view.rows.error ?? view.catalogue.error}
      titles={{
        forbidden: "Your role does not include this dataset",
        not_found: "That dataset no longer exists",
        failed: "Those records could not be loaded",
      }}
      onRetry={() => void view.rows.refetch()}
    />
  );
}
