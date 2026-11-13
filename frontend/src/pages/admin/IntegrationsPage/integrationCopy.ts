import type { Integration, IntegrationState } from "@/api/integrations";

/**
 * The tone a state earns.
 *
 * NOT_CONFIGURED is deliberately neutral rather than a warning: nobody has
 * finished setting it up, which is not a fault — treating it as one would put
 * eight untouched providers in the same colour as the two that are actually
 * broken (§64).
 */
export function stateTone(state: IntegrationState): string | undefined {
  switch (state) {
    case "CONNECTED":
      return "success";
    case "ERROR":
      return "error";
    case "DISCONNECTED":
      return "default";
    default:
      return undefined;
  }
}

/**
 * What an integration's two facts come to, in one sentence.
 *
 * Exported and asserted directly, because this is where intent and outcome
 * meet and a single word would lose one of them. "Error" alone does not say
 * whether anybody expects it to be running; "switched on and failing" does,
 * and that is the row somebody has to act on.
 */
export function situation(row: Integration): string {
  if (!row.configured) {
    const count = row.missing_settings.length;
    return `Needs ${row.missing_settings.join(" and ")} — ${count === 1 ? "one setting" : `${count} settings`} away from usable`;
  }
  if (row.enabled && row.state === "ERROR") return "Switched on and failing";
  if (row.enabled && row.state === "CONNECTED") return "On, and working";
  if (row.enabled) return "Switched on, not connected yet";
  if (row.state === "ERROR") return "Off, and it was failing when it stopped";
  return "Configured, switched off";
}

/**
 * The rows somebody has to act on first: switched on and not working, then
 * broken, then unconfigured, then the rest — by name within each.
 */
export function byAttention(items: Integration[]): Integration[] {
  return [...items].sort((left, right) => {
    const rank = (row: Integration) =>
      row.enabled && row.state !== "CONNECTED" ? 0 : row.state === "ERROR" ? 1 : !row.configured ? 2 : 3;
    return rank(left) - rank(right) || left.name.localeCompare(right.name);
  });
}
