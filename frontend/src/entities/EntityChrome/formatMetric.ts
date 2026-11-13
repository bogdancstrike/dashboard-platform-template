import type { InsightMetric } from "@/api/explorer";

/** A declared metric as a number a person can read. */
export function formatMetric(metric: InsightMetric): { value: string; unit: string } {
  const { value, format } = metric;
  switch (format) {
    case "currency":
      return Math.abs(value) >= 1_000_000
        ? { value: `€${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`, unit: "" }
        : { value: `€${Math.round(value).toLocaleString()}`, unit: "" };
    case "percent":
      return { value: value.toLocaleString(undefined, { maximumFractionDigits: 1 }), unit: "%" };
    case "hours":
      return { value: Math.round(value).toLocaleString(), unit: "h" };
    case "minutes":
      // Minutes are what the column holds; hours or days are what a person
      // says. Converting on the way out beats storing a second column.
      return value >= 1440
        ? { value: (value / 1440).toFixed(1), unit: "d" }
        : { value: (value / 60).toFixed(1), unit: "h" };
    case "score":
      return { value: value.toFixed(1), unit: "/10" };
    default:
      return { value: Math.round(value).toLocaleString(), unit: "" };
  }
}
