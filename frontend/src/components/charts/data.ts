/** Lossless table/CSV projection shared by all chart kinds. */
import type { ChartPanel, ChartPoint } from "@/api/dashboard";

export interface ChartColumn {
  key: keyof ChartPoint;
  label: string;
}

export function chartColumns(panel: ChartPanel): ChartColumn[] {
  const time = panel.series.some((point) => point.bucket !== undefined);
  return [
    { key: time ? "bucket" : "name", label: time ? "Date" : "Name" },
    ...(panel.series.some((point) => point.group !== undefined)
      ? [{ key: "group" as const, label: "Group" }] : []),
    ...(panel.kind === "scatter" ? [
      { key: "x" as const, label: "Budget spent (%)" },
      { key: "y" as const, label: "Work done (%)" },
    ] : []),
    { key: "value", label: panel.kind === "scatter" ? "Budget" : "Value" },
  ];
}

/** Neutralize spreadsheet formulas in text while preserving numeric measures. */
function csvCell(value: string | number | undefined): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function chartCsv(panel: ChartPanel): string {
  const columns = chartColumns(panel);
  return "\uFEFF" + [
    columns.map((column) => csvCell(column.label)).join(","),
    ...panel.series.map((row) => columns.map((column) => csvCell(row[column.key])).join(",")),
  ].join("\r\n");
}
