import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChartPanel } from "@/api/dashboard";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { renderWithProviders } from "@/test/render";

/**
 * A chart at the size it is drawn (§45, §61).
 *
 * The option handed to ECharts is the thing worth asserting: a thumbnail has
 * every word taken out so the shape shows, and a short gauge keeps its number
 * but drops the scale that would land on it. The shared stub only reports the
 * series type, so this file keeps the whole option.
 */
const drawn: { option: Record<string, unknown> | null } = { option: null };

vi.mock("echarts-for-react", () => ({
  default: ({ option, onChartReady }: { option: Record<string, unknown>; onChartReady?: (chart: unknown) => void }) => {
    drawn.option = option;
    onChartReady?.({ getDataURL: () => "data:image/png;base64,AAAA" });
    return <div data-testid="echarts" />;
  },
}));

const series = [
  { name: "Critical", value: 4, group: "Web" },
  { name: "High", value: 11, group: "Mail" },
  { name: "Normal", value: 26, group: "Web" },
];

const panel = (kind: ChartPanel["kind"], extra: Partial<ChartPanel> = {}): ChartPanel => ({ kind, title: "Tickets by severity", series, ...extra });

beforeEach(() => {
  drawn.option = null;
});

describe("at full size", () => {
  it("keeps every label, names itself, and hands over the chart for export", () => {
    const onChart = vi.fn();
    renderWithProviders(<ChartPreview panel={panel("bar")} label="Bars" onChart={onChart} />);
    expect(screen.getByText("Bars")).toBeInTheDocument();
    expect(drawn.option?.["legend"]).not.toEqual({ show: false });
    expect(onChart).toHaveBeenCalledWith(expect.objectContaining({ getDataURL: expect.any(Function) }));
  });

  it("draws an empty frame when there is nothing to draw", () => {
    const { container } = renderWithProviders(<ChartPreview panel={undefined} height={120} />);
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
    expect(container.querySelector(".nu-chart-preview-empty")).not.toBeNull();
  });

  it("draws in the appearance it is asked for, not only the reader's", () => {
    const { container } = renderWithProviders(<ChartPreview panel={panel("line")} mode="dark" />);
    expect(container.querySelector(".nu-chart-preview--dark")).not.toBeNull();
  });
});

describe("as a thumbnail", () => {
  it.each(["bar", "hbar", "line", "stacked-bar", "pie", "funnel"] as ChartPanel["kind"][])("takes every word out of a %s and keeps the marks", (kind) => {
    renderWithProviders(<ChartPreview panel={panel(kind, { groups: ["Web", "Mail"] })} compact height={104} />);
    const option = drawn.option!;
    expect(option["legend"]).toEqual({ show: false });
    expect(option["tooltip"]).toEqual({ show: false });
    expect(option["animation"]).toBe(false);
    for (const item of option["series"] as Record<string, unknown>[]) expect(item["label"]).toEqual({ show: false });
  });

  it("keeps a gauge's arc and nothing written on it", () => {
    renderWithProviders(<ChartPreview panel={panel("gauge", { series: [{ name: "Done", value: 72 }] })} compact height={104} />);
    const gauge = (drawn.option!["series"] as Record<string, unknown>[])[0]!;
    expect(gauge["detail"]).toEqual({ show: false });
    expect(gauge["axisLabel"]).toEqual({ show: false });
  });

  it("hides a heatmap's scale and a radar's axis names", () => {
    renderWithProviders(
      <ChartPreview panel={panel("heatmap", { groups: ["Web", "Mail"] })} compact height={104} />,
    );
    const heat = drawn.option!;
    if (heat["visualMap"]) expect((heat["visualMap"] as { show: boolean }).show).toBe(false);
    renderWithProviders(<ChartPreview panel={panel("radar" as ChartPanel["kind"])} compact height={104} />);
    const radar = drawn.option!;
    if (radar["radar"]) expect((radar["radar"] as { axisName: unknown }).axisName).toEqual({ show: false });
  });
});

describe("in a short box", () => {
  it("keeps a gauge's number and drops the scale that would land on it", () => {
    renderWithProviders(<ChartPreview panel={panel("gauge", { series: [{ name: "Done", value: 72 }] })} height={120} />);
    const gauge = (drawn.option!["series"] as Record<string, unknown>[])[0]!;
    expect(gauge["axisLabel"]).toEqual({ show: false });
    expect((gauge["detail"] as { fontSize: number }).fontSize).toBe(22);
  });

  it("leaves a chart that is not a gauge alone", () => {
    renderWithProviders(<ChartPreview panel={panel("bar")} height={120} />);
    const bar = (drawn.option!["series"] as Record<string, unknown>[])[0]!;
    expect(bar["detail"]).toBeUndefined();
  });
});
