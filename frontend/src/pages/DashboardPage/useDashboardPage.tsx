/** What the page reads, what it keeps in the address, and what it derives. */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Grid } from "antd";
import {
  AreaChartOutlined,
  CalendarOutlined,
  LayoutOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { CHART_KEYS, dashboardApi, type ChartPanel } from "@/api/dashboard";
import { usePageCommands } from "@/commands/CommandContext";
import { HIDDEN_ON_DASHBOARD, balancedColumns, packSpans } from "@/lib/dashboardLayout";
import { queryKeys } from "@/lib/queryKeys";

import { SHAPES, isEmptyPanel, useWidth } from "./model";

/** The page's state, queries and actions. */
export function useDashboardPage() {
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
    queryKey: queryKeys.dashboard(period),
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
      entry.panel && !HIDDEN_ON_DASHBOARD.has(entry.key)
        ? [{ key: entry.key, panel: entry.panel }]
        : [],
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

  return {
    navigate,
    here,
    screens,
    period,
    data,
    isLoading,
    isError,
    error,
    refetch,
    dataUpdatedAt,
    isFetching,
    kpiRef,
    kpiColumns,
    chartRef,
    chartColumns,
    quiet,
    filled,
    activitySpan,
    periodOptions,
    choosePeriod,
  };
}

export type DashboardPageData = ReturnType<typeof useDashboardPage>;
