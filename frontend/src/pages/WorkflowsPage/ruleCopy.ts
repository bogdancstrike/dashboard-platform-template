import type { AutomationRule } from "@/api/automations";
import { relativeTime } from "@/lib/time";

/**
 * How a rule is doing, in words.
 *
 * Pure and exported so the test can state the rule without a table: "never
 * fired" and "fired 40 times, last 2h ago" are the two states this page exists
 * to distinguish, and a rule that is enabled but has never matched anything is
 * the one worth a second look.
 */
export function firingSummary(rule: AutomationRule): { text: string; quiet: boolean } {
  if (rule.trigger_count === 0) {
    return {
      text: rule.enabled ? "Never fired" : "Never fired · paused",
      // Quiet is not the same as broken — a rule guarding against something
      // rare *should* be silent — so this is a tone, not a warning.
      quiet: true,
    };
  }
  const times = `${rule.trigger_count} time${rule.trigger_count === 1 ? "" : "s"}`;
  return {
    text: rule.last_triggered_at
      ? `${times} · last ${relativeTime(rule.last_triggered_at)}`
      : times,
    quiet: false,
  };
}

/** The compiled condition on one line, for a table cell. */
export function oneLine(text: string | null): string {
  return (text ?? "").split("\n").map((part) => part.trim()).filter(Boolean).join(" ");
}

export function cooldownLabel(minutes: number): string {
  if (minutes === 0) return "every run";
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  return `${Math.round(minutes / 60)} h`;
}
