/** The noticeboard's vocabulary and helpers. */

/** Severity → the tag colour that already means it elsewhere in the product. */
export const SEVERITY_COLOUR: Record<string, string | undefined> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: undefined,
};
