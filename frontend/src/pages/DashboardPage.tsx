import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Grid, Segmented, Select, Skeleton, Space, Tag, Timeline, Typography } from "antd";
import {
  AlertOutlined,
  ApiOutlined,
  AreaChartOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeploymentUnitOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FolderOutlined,
  FundOutlined,
  LayoutOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import {
  CHART_KEYS,
  dashboardApi,
  type ChartKind,
  type ChartPanel,
  type DashboardAlert,
} from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { FailureAlert } from "@/components/FailureAlert";
import { AutoRefresh } from "@/components/AutoRefresh";
import { withOrigin } from "@/entities/drilldown";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { StatCard } from "@/components/StatCard";
import { HIDDEN_ON_DASHBOARD, balancedColumns, packSpans } from "@/pages/dashboardLayout";

const { Text } = Typography;

/** Backend icon name → the glyph that stands for it. */
const ICONS: Record<string, React.ReactNode> = {
  euro: <DollarOutlined />,
  "shopping-cart": <ShoppingCartOutlined />,
  users: <TeamOutlined />,
  user: <UserOutlined />,
  "life-buoy": <ApiOutlined />,
  "alert-triangle": <WarningOutlined />,
  "check-square": <CheckSquareOutlined />,
  clock: <ClockCircleOutlined />,
  folder: <FolderOutlined />,
  activity: <FundOutlined />,
  cpu: <DeploymentUnitOutlined />,
  "x-circle": <CloseCircleOutlined />,
  shield: <ExclamationCircleOutlined />,
};

/**
 * How much room each chart kind needs.
 *
 * A twenty-four-column heatmap squeezed into a third of the width is a smear;
 * a gauge given two thirds is mostly whitespace. Sizing by kind rather than by
 * position also means adding a panel does not reshuffle the ones after it.
 */
const SHAPES: Partial<Record<ChartKind, { span: number; height: number }>> = {
  area: { span: 16, height: 280 },
  "stacked-area": { span: 16, height: 280 },
  "stacked-bar": { span: 8, height: 280 },
  funnel: { span: 8, height: 260 },
  hbar: { span: 16, height: 260 },
  "multi-line": { span: 16, height: 260 },
  gauge: { span: 8, height: 260 },
  heatmap: { span: 24, height: 260 },
  scatter: { span: 12, height: 300 },
  "stacked-hbar": { span: 12, height: 300 },
  pie: { span: 8, height: 240 },
  radar: { span: 8, height: 300 },
  treemap: { span: 16, height: 300 },
  bar: { span: 8, height: 240 },
  line: { span: 8, height: 240 },
};

/**
 * Which list a chart's category drills into (§44).
 *
 * A chart nobody can click through is a picture. Only the panels whose
 * categories *are* a filter value are listed; a revenue trend has no such
 * category, and inventing one would send the reader somewhere arbitrary.
 */
const DRILL_DOWN: Record<string, string> = {
  revenue_by_channel: "/orders?f.channel=",
  tickets_by_category: "/tickets?f.category=",
  tasks_by_status: "/tasks?f.status=",
  projects_by_health: "/projects?f.health=",
  device_health: "/devices?f.kind=",
};

/**
 * Severity → the AntD tag preset that carries it.
 *
 * A *preset* rather than one of our own hexes, and that is the fix rather than
 * the shortcut: a custom `color` makes AntD paint the fill and write white on
 * it, and white on our amber is 2.87:1 — an alert tag a reader cannot read,
 * which is the one tag on the page that matters. The presets are tinted
 * grounds with ink text, and `index.css` already names the readable half of
 * the ramp for each of them (§55). `processing` is the preset for informational
 * blue; there is no `info` one.
 */
const SEVERITY: Record<DashboardAlert["severity"], string> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "processing",
};

export default function DashboardPage() {
  const navigate = useNavigate();
  // The *router's* location, not the window's: under a MemoryRouter — which is
  // what the component tests use — the two are different addresses, and the
  // window's is the one that is wrong.
  const location = useLocation();
  const here = () => `${location.pathname}${location.search}`;
  const screens = Grid.useBreakpoint();
  const [params, setParams] = useSearchParams();
  // The period lives in the URL, so a dashboard somebody is looking at can be
  // sent to a colleague and arrive showing the same thing (§69).
  const period = params.get("period") ?? "last_30_days";

  const { data, isLoading, isError, error, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: ({ signal }) => dashboardApi.summary({ period }, signal),
  });

  const panels = useMemo(() => {
    if (!data) return [];
    return CHART_KEYS.map((key) => ({
      key,
      panel: data.charts[key] as ChartPanel | undefined,
    })).flatMap((entry) =>
      // `flatMap` rather than `filter`: a type predicate that narrows one
      // property of a tuple element needs the whole element's type restated,
      // and restating it is how the two drift.
      entry.panel && !HIDDEN_ON_DASHBOARD.has(entry.key) ? [{ key: entry.key, panel: entry.panel }] : [],
    );
  }, [data]);

  const [kpiRef, kpiWidth] = useWidth();
  // At most four across on a laptop, more only when the screen is very wide.
  const kpiColumns = kpiWidth
    ? balancedColumns(kpiWidth, data?.kpis.length ?? 12, 260, kpiWidth >= 2000 ? 6 : 4)
    : 4;
  const [chartRef, chartWidth] = useWidth();
  const chartColumns = chartWidth >= 2000 ? 3 : chartWidth >= 820 ? 2 : 1;

  // Charts with data, packed so every row is full: wide kinds (heatmap,
  // treemap) take a row, the rest one column, and the last of a run widens to
  // close its row. Recent activity is the run's final cell.
  const withData = panels.filter(({ panel }) => !isEmptyPanel(panel));
  const quiet = panels.filter(({ panel }) => isEmptyPanel(panel));
  const spans = packSpans(
    [...withData.map(({ panel }) => (SHAPES[panel.kind]?.span ?? 8) >= 24), false],
    chartColumns,
  );
  const filled = withData.map((entry, index) => ({ ...entry, span: spans[index] ?? 1 }));
  const activitySpan = spans[spans.length - 1] ?? 1;

  const periodOptions = data?.period.options.filter((option) => option.key !== "custom") ?? [];
  const choosePeriod = (next: string) => {
    const updated = new URLSearchParams(params);
    updated.set("period", next);
    setParams(updated, { replace: true });
  };

  /**
   * What this page can do, for the palette (§31).
   *
   * The period and the refresh are the two things somebody actually reaches
   * for here, and both are otherwise a mouse journey to the top-right corner.
   * The periods are the server's own options rather than a list typed here, so
   * the palette cannot offer a window the dashboard would refuse.
   */
  usePageCommands("dashboard", [
    {
      id: "dashboard.refresh",
      label: "Refresh the numbers",
      icon: <ReloadOutlined />,
      keywords: "reload update refetch current",
      run: () => void refetch(),
    },
    ...periodOptions
      .filter((option) => option.key !== period)
      .map((option) => ({
        id: `dashboard.period.${option.key}`,
        label: `Measure over ${option.label.toLowerCase()}`,
        icon: <CalendarOutlined />,
        keywords: "period range window compare",
        run: () => choosePeriod(option.key),
      })),
    {
      id: "dashboard.analytics",
      label: "Ask a question of my own",
      icon: <AreaChartOutlined />,
      keywords: "analytics analyse group cut explore",
      run: () => navigate("/analytics"),
    },
    {
      id: "dashboard.mine",
      label: "Open my dashboards",
      icon: <LayoutOutlined />,
      keywords: "custom layout widgets board personal",
      run: () => navigate("/dashboards"),
    },
  ]);

  return (
    <>
      <PageHeader
        title={
          <span>
            Organisation <em>dashboard</em>
          </span>
        }
        subtitle={
          data
            ? `${new Date(data.period.from).toLocaleDateString()} — ${new Date(
                data.period.to,
              ).toLocaleDateString()} · compared with the previous period of equal length`
            : "Loading the overview…"
        }
      />

      {/* The toolbar under the title, as on the canvas: how fresh the
          numbers are, and the window they cover. */}
      <div className="nx-ov-dashbar">
        {/* The page people leave open all day, so it says how old its
            numbers are and offers to keep them current (§53). The cache is
            invalidated by writes, so this is for the writes that happen
            *elsewhere* — somebody else closing a ticket. */}
        <AutoRefresh
          page="dashboard"
          updatedAt={dataUpdatedAt}
          busy={isFetching}
          refresh={() => void refetch()}
        />
        {periodOptions.length > 0 &&
          (screens.md !== false ? (
            <Segmented
              size="middle"
              value={period}
              onChange={choosePeriod}
              options={periodOptions.map((option) => ({
                label: option.label,
                value: option.key,
              }))}
            />
          ) : (
            <Select
              aria-label="Dashboard period"
              value={period}
              onChange={choosePeriod}
              style={{ minWidth: 170 }}
              options={periodOptions.map((option) => ({
                label: option.label,
                value: option.key,
              }))}
            />
          ))}
      </div>

      {isError && (
        <FailureAlert
          className="nu-block"
          error={error}
          titles={{
            forbidden: "Your role does not include the dashboard",
            failed: "The dashboard could not be loaded",
          }}
          onRetry={() => void refetch()}
        />
      )}

      {/* ── alerts (§66): only what is actually wrong, each one clickable ── */}
      {data && data.alerts.length > 0 && (
        <Card size="small" className="nu-alert-strip" data-testid="dashboard-alerts" style={{ marginBottom: 16 }}>
          <Space size={6} wrap>
            <AlertOutlined style={{ color: "var(--nu-warning-ink)" }} />
            <Text strong style={{ marginRight: 4 }}>
              Needs attention
            </Text>
            {data.alerts.map((alert) => (
              <Tag
                key={alert.key}
                color={SEVERITY[alert.severity]}
                className="nu-alert-tag"
                onClick={() => navigate(withOrigin(alert.link, here()))}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(withOrigin(alert.link, here()));
                  }
                }}
              >
                {alert.message}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

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
        {isLoading && [0, 1, 2, 3].map((index) => (
          <Card key={`loading-${index}`} style={{ minHeight: 330 }}><Skeleton active paragraph={{ rows: 6 }} /></Card>
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
        <div className="nx-ov-cell nx-ov-activitycell" style={{ gridColumn: `span ${activitySpan}` }}>
          <Card size="small" title="Recent activity" className="nu-activity-card" data-testid="dashboard-activity">
            {isLoading ? (
              <Skeleton active paragraph={{ rows: 6 }} />
            ) : (
              // The scroller is this region, focusable, so the feed can be
              // read with the keyboard (axe scrollable-region-focusable).
              <div className="nu-activity-scroll" tabIndex={0} role="region" aria-label="Recent activity">
              <Timeline
                items={(data?.activity ?? []).map((entry) => ({
                  color: "gray",
                  children: (
                    <div className="nu-activity-item">
                      <Text strong>{entry.actor}</Text> <Text type="secondary">{entry.summary}</Text>
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

      {/* Panels with nothing in this period: one quiet line naming them, not
          a field of tall blank cards. Pick a longer period to bring them back. */}
      {quiet.length > 0 && !isLoading && (
        <section className="nx-ov-quiet nx-glass" aria-label="Nothing in this period" data-testid="dashboard-quiet">
          <span className="nx-fd-eyebrow">Nothing in this period</span>
          {quiet.map(({ key, panel }) => (
            <span key={key} className="nx-fd-pill" data-chart-id={key}>{panel.title}</span>
          ))}
        </section>
      )}
    </>
  );
}

/** A panel with nothing to draw — moved into a compact strip at the end. */
function isEmptyPanel(panel: ChartPanel): boolean {
  return panel.series.length === 0 || panel.series.every((point) => !point.value && point.x === undefined);
}

/** Watch an element's width. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
