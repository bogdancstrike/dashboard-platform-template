/** One step of the exploration: enough to name it and go back to it. */
export interface Step {
  resource: string;
  id: string;
  label: string;
}

/** `tickets.customer_id` → `customer_id`, the column that points back here. */
export function relationColumn(relation: string): string {
  return relation.includes(".") ? (relation.split(".")[1] as string) : relation;
}

export function parseTrail(raw: string | null): Step[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (step): step is Step =>
            typeof step === "object" && step !== null && "resource" in step && "id" in step,
        )
      : [];
  } catch {
    // A hand-edited or truncated trail is not a reason to fail the page.
    return [];
  }
}
