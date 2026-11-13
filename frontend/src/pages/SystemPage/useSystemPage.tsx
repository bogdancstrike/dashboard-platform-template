import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClockCircleOutlined, FileTextOutlined, ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import { useNavigate } from "react-router-dom";

import { healthApi, metaApi } from "@/api/meta";
import { usePageCommands } from "@/commands/CommandContext";
import { queryKeys } from "@/lib/queryKeys";

/** How each window is named on the control. */
export const PERIOD_LABELS: Record<string, string> = {
  "8h": "8 hours",
  "1d": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/** The service facts, the live snapshot, the history window (named or custom), and the palette. */
export function useSystemPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("1d");
  /** A custom window, as two moments. Empty until somebody picks one. */
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const meta = useQuery({ queryKey: queryKeys.meta("app"), queryFn: ({ signal }) => metaApi.app(signal) });
  const health = useQuery({
    queryKey: queryKeys.health("status"),
    queryFn: ({ signal }) => healthApi.status(signal),
    refetchInterval: 15_000,
  });

  const window = range
    ? { from: range[0].toISOString(), to: range[1].toISOString() }
    : { period };
  const history = useQuery({
    queryKey: queryKeys.health("history", window),
    queryFn: ({ signal }) => healthApi.history(window, signal),
    // Slower than the snapshot on purpose: a month of history does not change
    // meaningfully every fifteen seconds, and refetching it that often would
    // redraw eight charts under somebody's pointer.
    refetchInterval: 60_000,
  });

  /**
   * What this page can do, for the palette (§31).
   *
   * The window is the whole interaction on this screen — "was it unhealthy
   * last night" is a different press from "is it unhealthy now" — and the
   * named windows are the server's own, so the palette cannot ask for one the
   * history endpoint would refuse.
   */
  usePageCommands("health", [
    ...(history.data?.periods ?? ["8h", "1d", "7d", "30d"])
      .filter((key) => range !== null || key !== period)
      .map((key) => ({
        id: `health.period.${key}`,
        label: `Show the last ${(PERIOD_LABELS[key] ?? key).toLowerCase()}`,
        icon: <ClockCircleOutlined />,
        keywords: "window period range history hours days",
        run: () => {
          setRange(null);
          setPeriod(key);
        },
      })),
    {
      id: "health.refresh",
      label: "Check the dependencies now",
      icon: <ReloadOutlined />,
      keywords: "refresh probe recheck current status",
      run: () => {
        void health.refetch();
        void history.refetch();
      },
    },
    {
      id: "health.jobs",
      label: "See what the platform is running",
      icon: <ThunderboltOutlined />,
      keywords: "jobs queue background workers",
      run: () => navigate("/admin/jobs"),
    },
    {
      id: "health.logs",
      label: "Open the logs",
      icon: <FileTextOutlined />,
      keywords: "log errors warnings trace lines",
      run: () => navigate("/admin/logs"),
    },
  ]);

  return { period, setPeriod, range, setRange, meta, health, history };
}
