/**
 * The pure half of the bulk-edit grid (§18): reading a pasted block, turning
 * a typed or pasted string into the value a column stores, writing a block
 * back out, and the undo history. No React here, so every rule is a unit
 * test away.
 */

export * from "./columns";
export * from "./clipboard";
export * from "./selection";
export * from "./edits";
