/** The chart builder's smaller hooks: the preview's height, and what the palette can do here. */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { usePageCommands } from "@/commands/CommandContext";

/** The big chart takes most of the window's height, not a fixed strip. */
export function useChartHeight(): number {
  const [chartHeight, setChartHeight] = useState(() =>
    Math.max(360, Math.round(window.innerHeight * 0.62)),
  );
  useEffect(() => {
    const resize = () => setChartHeight(Math.max(360, Math.round(window.innerHeight * 0.62)));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return chartHeight;
}

/** What this page can do, for the palette (§31). */
export function useBuilderCommands(
  params: URLSearchParams,
  resource: string,
  setSaving: (saving: boolean) => void,
): void {
  const navigate = useNavigate();
  usePageCommands("chart-builder", [
    {
      id: "chart.save",
      label: "Save this chart",
      keywords: "store keep",
      run: () => setSaving(true),
    },
    {
      id: "chart.report",
      label: "Open this question in the report builder",
      keywords: "report table",
      run: () => navigate(`/reports/builder?${params.toString()}`),
    },
    {
      id: "chart.reports",
      label: "Back to reports",
      keywords: "list saved",
      run: () => navigate("/reports"),
    },
    {
      id: "chart.records",
      label: "See the records behind this chart",
      keywords: "explore rows records underneath drill",
      run: () => navigate(`/explore?resource=${resource}`),
    },
    {
      id: "chart.restart",
      label: "Start a new chart",
      keywords: "new clear reset blank fresh question",
      run: () => navigate("/charts/builder"),
    },
  ]);
}
