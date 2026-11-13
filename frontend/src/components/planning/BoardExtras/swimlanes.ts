export type Swimlane = "none" | "assignee" | "priority" | "epic";

export const SWIMLANES: { value: Swimlane; label: string }[] = [
  { value: "none", label: "No swimlanes" },
  { value: "assignee", label: "By assignee" },
  { value: "priority", label: "By priority" },
  { value: "epic", label: "By epic" },
];

/** The record field a swimlane is, so a drop across swimlanes can write it. */
export const SWIMLANE_FIELD: Record<Exclude<Swimlane, "none">, string> = {
  assignee: "assignee_id",
  priority: "priority",
  epic: "epic_id",
};

export const PRIORITY_ORDER = ["CRITICAL", "HIGH", "NORMAL", "LOW"];

/** A lane id that carries both its swimlane and its status. */
export function laneKey(swim: string, status: string): string {
  return `${swim}|${status}`;
}

export function parseLane(key: string): { swim: string; status: string } {
  const at = key.lastIndexOf("|");
  return at < 0 ? { swim: "all", status: key } : { swim: key.slice(0, at), status: key.slice(at + 1) };
}

/** Which swimlane a card is in — `""` is "none of them" (no assignee, no epic). */
export function swimOf(task: Record<string, unknown>, swim: Swimlane): string {
  if (swim === "none") return "all";
  const value = task[SWIMLANE_FIELD[swim]];
  return typeof value === "string" ? value : "";
}

/** The swimlanes present, in a sensible order: priorities by severity, the rest by name, "none" last. */
export function swimlaneOrder(keys: string[], swim: Swimlane, label: (key: string) => string): string[] {
  const unique = Array.from(new Set(keys));
  if (swim === "none") return ["all"];
  if (swim === "priority") {
    return unique.sort((a, b) => PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b));
  }
  return unique.sort((a, b) => (a === "" ? 1 : b === "" ? -1 : label(a).localeCompare(label(b))));
}
