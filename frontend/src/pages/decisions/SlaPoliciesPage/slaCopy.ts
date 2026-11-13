import type { BusinessCalendar, Escalation, Priority, SlaCatalogue, SlaPolicy } from "@/api/sla";
import { humanStatus } from "@/components/StatusTag";

export const PRIORITIES: Priority[] = ["CRITICAL", "HIGH", "NORMAL", "LOW"];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const ACTION_LABEL: Record<string, string> = { NOTIFY: "Notify", ASSIGN: "Assign to", RAISE_PRIORITY: "Raise priority" };
export const TARGET_LABEL: Record<string, string> = { assignee: "the assignee", manager: "the assignee's manager", user: "a person" };

export function words(value: string): string {
  return humanStatus(value);
}

/** Which tickets a policy matches, as the pills on its card. */
export function conditionLabels(policy: SlaPolicy, catalogue?: SlaCatalogue): string[] {
  const c = policy.conditions;
  const pills: string[] = [];
  if (c.segments?.length) pills.push(`Segment: ${c.segments.map(words).join(", ")}`);
  if (c.categories?.length) pills.push(`Type: ${c.categories.map(words).join(", ")}`);
  if (c.channels?.length) pills.push(`Channel: ${c.channels.map(words).join(", ")}`);
  if (c.customer_ids?.length) {
    const names = c.customer_ids.map((id) => catalogue?.customers.find((item) => item.id === id)?.name ?? "a customer");
    pills.push(`Customer: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`);
  }
  if (pills.length === 0) pills.push("Every ticket");
  return pills;
}

/** The form's shape: targets in hours, conditions flattened. */
export interface PolicyForm {
  name: string;
  description: string;
  active: boolean;
  segments: string[];
  categories: string[];
  channels: string[];
  customer_ids: string[];
  calendar_id: string;
  pause_statuses: string[];
  targets: Record<Priority, { first_response?: number; resolution?: number }>;
  escalations: Escalation[];
}

/**
 * A policy as the form's initial values. Initial values rather than an effect:
 * a drawer opened straight from the address mounts its form in the same pass,
 * before an effect could fill it.
 */
export function initialPolicy(policy: SlaPolicy | undefined, calendars: BusinessCalendar[]): PolicyForm {
  const hoursOf = (minutes?: number) => (minutes ? Math.round((minutes / 60) * 100) / 100 : undefined);
  return {
    name: policy?.name ?? "",
    description: policy?.description ?? "",
    active: policy?.active ?? true,
    segments: policy?.conditions.segments ?? [],
    categories: policy?.conditions.categories ?? [],
    channels: policy?.conditions.channels ?? [],
    customer_ids: policy?.conditions.customer_ids ?? [],
    calendar_id: policy?.calendar_id ?? calendars.find((cal) => cal.is_default)?.id ?? "",
    pause_statuses: policy?.pause_statuses ?? ["WAITING_CUSTOMER"],
    targets: Object.fromEntries(PRIORITIES.map((priority) => [priority, {
      first_response: hoursOf(policy?.targets[priority]?.first_response),
      resolution: hoursOf(policy?.targets[priority]?.resolution),
    }])) as PolicyForm["targets"],
    escalations: policy?.escalations ?? [{ at_percent: 75, action: "NOTIFY", target: "assignee" }],
  };
}

/** The form's values as the policy the API stores, hours back to minutes. */
export function policyBody(values: PolicyForm): Partial<SlaPolicy> {
  const toMinutes = (value?: number) => (value ? Math.round(value * 60) : undefined);
  return {
    name: values.name,
    description: values.description,
    active: values.active,
    conditions: { segments: values.segments, categories: values.categories, channels: values.channels, customer_ids: values.customer_ids },
    calendar_id: values.calendar_id || null,
    pause_statuses: values.pause_statuses,
    targets: Object.fromEntries(PRIORITIES.map((priority) => [priority, {
      first_response: toMinutes(values.targets[priority]?.first_response),
      resolution: toMinutes(values.targets[priority]?.resolution),
    }])),
    escalations: values.escalations,
  };
}
