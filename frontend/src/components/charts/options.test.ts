import { describe, expect, it } from "vitest";

import type { ChartPanel } from "@/api/dashboard";
import { buildOption, compactNumber } from "@/components/charts/options";
import { buildChartTheme } from "@/theme/echarts";

/**
 * What each picture *claims*, asserted on the option rather than the canvas.
 *
 * ECharts draws to a canvas, so a screenshot review is the only way to see one
 * of these — and the two mistakes below are invisible in a screenshot review
 * anyway: a donut whose hole is empty looks finished, and a stacked area
 * rendered without `stack` looks like a perfectly good multi-line chart of the
 * same numbers. The option is where the claim lives.
 */

const theme = buildChartTheme("light", "comfortable");
const option = (panel: ChartPanel) => buildOption(panel, theme);

/** ECharts series entries, typed as far as these assertions need. */
type Series = { type: string; stack?: string; areaStyle?: unknown; data?: unknown[] };
const seriesOf = (drawn: Record<string, unknown>) => drawn["series"] as Series[];

describe("a donut", () => {
  const shares: ChartPanel = {
    kind: "pie",
    title: "Projects by health",
    series: [
      { name: "ON_TRACK", value: 14 },
      { name: "AT_RISK", value: 5 },
      { name: "OFF_TRACK", value: 2 },
    ],
  };

  it("puts the total in the hole, which was empty", () => {
    // "What share is each?" raises "of how many?" immediately, and the middle
    // of a ring is the most legible spot on the chart.
    const title = option(shares)["title"] as { text: string; subtext: string };
    expect(title.text).toBe("21");
    expect(title.subtext).toBe("total");
  });

  it("totals what is drawn, so the figure cannot disagree with the picture", () => {
    // A truncated breakdown folds its tail into "Other", and the sum of the
    // slices is then the whole. A total computed from anywhere else would be
    // a second number about the same question.
    const truncated: ChartPanel = {
      ...shares,
      series: [...shares.series, { name: "Other", value: 979 }],
    };
    const title = option(truncated)["title"] as { text: string };
    expect(title.text).toBe(compactNumber(1000));
  });
});

describe("a stacked area", () => {
  const revenue: ChartPanel = {
    kind: "stacked-area",
    title: "What the revenue is made of",
    groups: ["WEB", "PARTNER"],
    series: [
      { bucket: "2026-08-04", group: "WEB", value: 900 },
      { bucket: "2026-08-04", group: "PARTNER", value: 300 },
      { bucket: "2026-08-05", group: "WEB", value: 1500 },
      { bucket: "2026-08-05", group: "PARTNER", value: 900 },
    ],
  };

  it("stacks and fills, so the top edge is the total", () => {
    const drawn = seriesOf(option(revenue));

    expect(drawn).toHaveLength(2);
    for (const series of drawn) {
      expect(series.type).toBe("line");
      expect(series.stack).toBe("total");
      // Unfilled, a stack reads as lines that happen not to cross — the
      // opposite of what a stacked chart says.
      expect(series.areaStyle).toBeTruthy();
    }
  });

  it("is the same shape as multi-line, minus the stacking", () => {
    // The two differ by one word in the question, and drawing them from two
    // renderers is how the second one drifts.
    const drawn = seriesOf(option({ ...revenue, kind: "multi-line" }));

    expect(drawn.map((series) => series.data)).toEqual(
      seriesOf(option(revenue)).map((series) => series.data),
    );
    for (const series of drawn) {
      expect(series.stack).toBeUndefined();
      expect(series.areaStyle).toBeUndefined();
    }
  });

  it("fills an absent cell with zero rather than a hole", () => {
    // A stack with a gap is drawn shorter, and the reader cannot tell "no
    // partner orders that day" from "the partner row was missing".
    const drawn = seriesOf(
      option({
        ...revenue,
        series: revenue.series.filter((point) => point.group !== "PARTNER" || point.value !== 300),
      }),
    );

    expect(drawn[1]!.data).toEqual([0, 900]);
  });
});
