import type { VersionField, VersionHistory as History } from "@/api/recordsAnalytics";
import { humanStatus } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { absoluteTime } from "@/lib/time";

/** One field's value in a version, as a person reads it — references by name, enums in words. */
export function displayValue(
  field: VersionField,
  value: unknown,
  references: History["references"],
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.references) {
    const named = references[field.references]?.[asText(value)];
    return named ?? `${asText(value).slice(0, 8)}…`;
  }
  if (field.kind === "bool") return value ? "Yes" : "No";
  if (field.kind === "enum") return humanStatus(asText(value));
  if (field.kind === "datetime") return absoluteTime(asText(value)) || asText(value);
  if (field.kind === "number") return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return asText(value);
}
