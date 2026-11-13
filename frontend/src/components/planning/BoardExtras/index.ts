/**
 * What the task board borrows from Jira and Taiga (§18): swimlanes, WIP limits,
 * a card's cover, points, checklist progress, flag, epic and age, an inline
 * "add a card" in every lane, templates, and keyboard shortcuts.
 *
 * Kept beside the board rather than inside it so the board's own decisions
 * (one query per lane, the drag, the optimistic move) stay readable, and so
 * each of these can be tested on its own.
 */

export * from "./swimlanes";
export * from "./cardBits";
export * from "./laneLimits";
export { QuickCreate } from "./QuickCreate";
export { TemplatePicker } from "./TemplatePicker";
export * from "./shortcuts";
export { usePeopleNames } from "./people";
