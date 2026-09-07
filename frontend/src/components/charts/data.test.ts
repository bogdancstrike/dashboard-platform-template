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
    const option = buildOption({
      kind: "scatter",
      title: "Projects",
      axes: { x: "Budget spent", y: "Work done", format: "percent" },
      series: [{ name: "<script>bad</script>", x: 250, y: 10, value: 100 }],
    }, buildChartTheme("dark", "comfortable"));
    // A percentage axis is bounded by its definition — but a project at 250%
    // of budget is the finding, so the bound grows to hold it.
    expect(option.xAxis).toMatchObject({ max: 250, name: "Budget spent" });
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    expect(tooltip.formatter({ data: { name: "<script>bad</script>", value: [250, 10] } }))
      .toContain("&lt;script&gt;");
  });

  it("lets a scatter of anything but percentages take its range from the data", () => {
    // Forcing 0–100 onto revenue against headcount draws every point in the
    // bottom-left corner. The axis names come from the panel, because a
    // renderer that knows one chart is about budgets can only draw that one.
    const option = buildOption({
      kind: "scatter",
      title: "Accounts",
      axes: { x: "Lifetime value", y: "Open orders" },
      series: [{ name: "Northwind", x: 480_000, y: 12, value: 1 }],
    }, buildChartTheme("light", "comfortable"));

    expect(option.xAxis).toMatchObject({ max: undefined, name: "Lifetime value" });
    expect(option.yAxis).toMatchObject({ max: undefined, name: "Open orders" });
  });

  it("reads a heatmap's axes off the panel rather than a calendar", () => {
    // The dashboard's heatmap is weekday by hour; a heatmap built from any two
    // declared dimensions is not, and a renderer holding the calendar could
    // only ever draw the first one.
    const option = buildOption({
      kind: "heatmap",
      title: "Where demand concentrates",
      categories: ["BILLING", "TECHNICAL"],
      groups: ["EMAIL", "PORTAL"],
      series: [
        { name: "BILLING", group: "PORTAL", value: 4 },
        { name: "TECHNICAL", group: "EMAIL", value: 9 },
      ],
    }, buildChartTheme("light", "comfortable"));

    expect(option.xAxis).toMatchObject({ data: ["EMAIL", "PORTAL"] });
    expect(option.yAxis).toMatchObject({ data: ["BILLING", "TECHNICAL"] });
    // (column, row, value) — TECHNICAL by EMAIL is the origin cell.
    expect(option.series).toMatchObject([{ data: [[1, 0, 4], [0, 1, 9]] }]);
  });
});
