/**
 * ECharts options, one builder per chart kind (§28, §44).
 *
 * Split out of `ChartCard` because the card is about *chrome* — the title, the
 * table view, the CSV download, the drill-down — and this is about the data.
 * Twelve kinds inside one `useMemo` is a four-hundred-line function with a
 * dozen early returns, which is the shape code takes just before somebody
 * copies a chart instead of adding one.
 *
 * Every builder takes the themed base and returns a complete option, so the
 * card never merges two half-options and no builder can quietly lose the
 * theme's axis colours.
 *
 * The rules they all follow:
 *
 * * **Colour means something.** A known status keeps the colour its badge has
 *   everywhere else; anything else takes the series palette in order.
 * * **Every label is present or none is.** Dropping half the category labels
 *   silently is worse than tilting them: the reader cannot tell which bar the
 *   surviving label belongs to.
 * * **Numbers are compact on an axis and full in a tooltip.** "10,000,000"
 *   costs 70px to say what "10M" says in 12.
 */

import type { ChartPanel } from "@/api/dashboard";

import { CHART_BUILDERS } from "./kinds";
import type { Theme } from "./kinds/shared";

export { compactNumber } from "./kinds/shared";

/**
 * The option for one panel, from the builder its kind names. A kind the
 * registry does not know (an older saved chart) is drawn over time, which is
 * what every kind fell back to before there were twelve.
 */
export function buildOption(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const build = CHART_BUILDERS[panel.kind] as
    | (typeof CHART_BUILDERS)[keyof typeof CHART_BUILDERS]
    | undefined;
  return (build ?? CHART_BUILDERS.line)(panel, theme);
}
