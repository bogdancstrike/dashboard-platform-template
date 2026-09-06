/** Chart exports retain all dimensions and remain safe to open in spreadsheets. */
import { describe, expect, it } from "vitest";
import { chartCsv } from "./data";
import { buildOption } from "./options";
import { buildChartTheme } from "@/theme/echarts";

describe("chart data", () => {
  it("exports scatter coordinates, grouping, and budget without treating labels as formulas", () => {
    const csv = chartCsv({ kind: "scatter", title: "Projects", series: [
      { name: '=HYPERLINK("https://example.test")', group: "AT_RISK", x: 150, y: 30, value: 10000 },
    ] });
    expect(csv).toContain('"Budget spent (%)","Work done (%)","Budget"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(csv).toContain('"AT_RISK","150","30","10000"');
  });

  it("orders independently bucketed series chronologically and fills absent cells", () => {
    const option = buildOption({ kind: "multi-line", title: "Flow", groups: ["Raised", "Resolved"], series: [
      { bucket: "2026-09-03", group: "Raised", value: 2 },
      { bucket: "2026-09-01", group: "Resolved", value: 1 },
    ] }, buildChartTheme("light", "comfortable"));
    expect(option.series).toMatchObject([{ data: [0, 2] }, { data: [1, 0] }]);
  });

  it("keeps overspent projects visible and escapes names in HTML tooltips", () => {
    const option = buildOption({ kind: "scatter", title: "Projects", series: [
      { name: "<script>bad</script>", x: 250, y: 10, value: 100 },
    ] }, buildChartTheme("dark", "comfortable"));
    expect(option.xAxis).toMatchObject({ max: 250 });
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    expect(tooltip.formatter({ data: { name: "<script>bad</script>", value: [250, 10] } }))
      .toContain("&lt;script&gt;");
  });
});
