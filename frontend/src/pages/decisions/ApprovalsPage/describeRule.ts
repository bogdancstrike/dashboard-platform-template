import type { ChangeRule, RuleCatalogue } from "@/api/approvals";
import { asText } from "@/lib/text";

/** A rule as the sentence a reader checks it against. */
export function describeRule(rule: ChangeRule, data: RuleCatalogue): string {
  const dataset = data.catalogue.find((item) => item.resource_type === rule.resource_type);
  const field = dataset?.fields.find((item) => item.name === rule.field)?.label ?? rule.field;
  const list = Array.isArray(rule.value) ? (rule.value as unknown[]).map(asText).join(", ") : asText(rule.value);
  const op = rule.operator === "ANY" ? "changes at all"
    : rule.operator === "EQUALS" ? `becomes ${list}`
    : rule.operator === "IN" ? `becomes one of ${list}`
    : rule.operator === "GT" ? `goes above ${list}` : `goes below ${list}`;
  return `When a ${dataset?.label.replace(/s$/, "").toLowerCase() ?? rule.resource_type}'s ${field.toLowerCase()} ${op}`;
}
