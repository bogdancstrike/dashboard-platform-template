/**
 * A record's state, coloured in a way that can be read (§55, §59).
 *
 * The obvious rendering is `<Tag color={statusColour}>`, which fills the tag
 * with the status colour and puts white text on it. AntD picks that white
 * without measuring anything: white on the amber this platform uses for
 * "warning" is 2.9:1, and on the green it uses for "resolved" 3.3:1. Both are
 * below the bar for text of any size, and the labels most worth reading — a
 * breach, a failure — are the ones that fail worst.
 *
 * So the tag is a *tint* of its meaning with the meaning's own dark ink on it
 * and a dot of the same ink in front — the glass design's pill. Every tone's
 * ink is a token chosen to hold 4.5:1 on its own tint in both themes, and the
 * dot keeps a colour cue for a reader skimming a column.
 *
 * It is a component rather than a style because the alternative — every page
 * remembering to write the same inline styles — is exactly how six pages ended
 * up with three different status tags.
 */

import { knownStatusColor, SEMANTIC, NEUTRAL } from "@/theme/tokens";

export type StatusTone = "ok" | "warn" | "bad" | "acc" | "neutral";

/**
 * Which values *mean* something, and what.
 *
 * Colour only where the value carries a judgement: "Discovery" is a phase, not
 * news, so it stays neutral; "Execution" is where the work is, so it is the
 * accent. The rest falls back to the vocabulary colour in `tokens.ts`, so a
 * value added there gets a tone without anyone remembering this table.
 */
const TONES: Record<string, StatusTone> = {
  NEW: "neutral",
  ASSIGNED: "acc",
  IN_PROGRESS: "acc",
  BLOCKED: "bad",
  IN_REVIEW: "warn",
  DONE: "ok",
  CANCELLED: "neutral",
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warn",
  CRITICAL: "bad",
  ON_TRACK: "ok",
  AT_RISK: "warn",
  OFF_TRACK: "bad",
  DISCOVERY: "neutral",
  DESIGN: "neutral",
  EXECUTION: "acc",
  ROLLOUT: "acc",
  CLOSURE: "neutral",
  MINOR: "neutral",
  MODERATE: "acc",
  MAJOR: "warn",
  OPEN: "acc",
  WAITING_CUSTOMER: "neutral",
  ESCALATED: "bad",
  RESOLVED: "ok",
  CLOSED: "neutral",
  PENDING: "neutral",
  CONFIRMED: "acc",
  PROCESSING: "acc",
  SHIPPED: "acc",
  DELIVERED: "ok",
  REFUNDED: "warn",
  RETURNED: "warn",
  PAID: "ok",
  UNPAID: "warn",
  PARTIAL: "warn",
  OVERDUE: "bad",
  ONLINE: "ok",
  OFFLINE: "bad",
  DEGRADED: "warn",
  MAINTENANCE: "acc",
  DECOMMISSIONED: "neutral",
  ACTIVE: "ok",
  INACTIVE: "neutral",
};

const BY_COLOUR: Record<string, StatusTone> = {
  [SEMANTIC.success]: "ok",
  [SEMANTIC.warning]: "warn",
  [SEMANTIC.danger]: "bad",
  [SEMANTIC.info]: "acc",
  [NEUTRAL[400]]: "neutral",
  [NEUTRAL[500]]: "neutral",
};

/** The tone a vocabulary value is drawn in — exported for the pages that draw their own chips. */
export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  const key = status.toUpperCase();
  const named = TONES[key];
  if (named) return named;
  const colour = knownStatusColor(key);
  if (!colour) return "neutral";
  return BY_COLOUR[colour] ?? "acc";
}

/**
 * `AT_RISK` → "At risk". Three letters or fewer stay as they are, because
 * those are acronyms (`SLA`, `VIP`), not words — and so does anything that is
 * not all capitals, which is a name rather than a vocabulary value.
 */
export function humanStatus(status: string): string {
  // Only the vocabulary is shouted; "Munich — Warehouse" is already a name.
  if (status.length <= 3 || status !== status.toUpperCase()) return status;
  const words = status.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusTag({
  status,
  bordered: _bordered = true,
  label,
  ...rest
}: {
  /** The vocabulary value the API returned — `OPEN`, `AT_RISK`, `DELIVERED`. */
  status: string | null | undefined;
  /** Kept for callers written against the old tag; the pill has no border. */
  bordered?: boolean;
  /** Overrides the readable label, e.g. "Behind · time" for a derived value. */
  label?: React.ReactNode;
  /** Overrides the vocabulary's tone. */
  tone?: StatusTone;
  "data-testid"?: string;
  title?: string;
}) {
  if (!status) return null;
  const { tone, ...attributes } = rest;

  return (
    <span
      {...attributes}
      // The vocabulary verbatim stays on the element: it is what the API
      // returns, what a filter URL carries and what a test or a reader quoting
      // a ticket matches on. The label is for reading.
      data-status={status}
      className={`nu-status-tag nx-pill nx-pill--${tone ?? statusTone(status)}`}
    >
      <i aria-hidden className="nx-pill-dot" />
      {label ?? humanStatus(status)}
    </span>
  );
}
