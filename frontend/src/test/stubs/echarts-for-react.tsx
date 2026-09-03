/**
 * ECharts, stubbed for jsdom.
 *
 * ECharts draws to a canvas, and jsdom has no canvas — mounting a real chart in
 * a component test throws inside zrender on dispose. Stubbing it at the module
 * boundary keeps the surrounding card, its controls and the table view under
 * test, which is where the logic worth testing lives. Whether the chart itself
 * renders is an end-to-end question, and the Playwright suite answers it in a
 * real browser.
 */

export default function ReactEChartsStub({
  option,
  style,
}: {
  option?: Record<string, unknown>;
  style?: React.CSSProperties;
  [key: string]: unknown;
}) {
  const series = (option?.["series"] as { type?: string }[] | undefined) ?? [];
  return (
    <div data-testid="echarts" data-series-type={series[0]?.type ?? ""} style={style} />
  );
}
