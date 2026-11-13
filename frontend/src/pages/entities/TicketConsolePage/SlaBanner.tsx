import { ClockCircleOutlined } from "@ant-design/icons";

import { humanStatus } from "@/components/StatusTag";
import { parseInstant, relativeTime } from "@/lib/time";

import { formatCount } from "./words";

/**
 * The domain's word for severity, in AntD's vocabulary.
 *
 * `sla.ts` says `danger` because that is what the platform's own semantic ramp
 * calls it; the component library says `error`. Translating here keeps the
 * widget's spelling out of a module that has nothing to do with widgets.
 */
const ALERT_TYPE = {
  success: "success",
  danger: "error",
  warning: "warning",
  info: "info",
} as const;

/**
 * The clock, first, because it decides whether this is the next thing anybody
 * does: what the deadline is doing, in words, and how much of the window
 * between "raised" and "promised by" has gone.
 */
export function SlaBanner({
  tone,
  headline,
  detail,
  severity,
  raised,
  due,
  resolved,
  reopened,
}: {
  tone: keyof typeof ALERT_TYPE;
  headline: string;
  detail: string;
  severity: string;
  raised: string | null;
  due: string | null;
  resolved: string | null;
  reopened: number;
}) {
  const start = parseInstant(raised)?.getTime() ?? null;
  const end = parseInstant(due)?.getTime() ?? null;
  const stop = parseInstant(resolved)?.getTime() ?? Date.now();
  const used =
    start !== null && end !== null && end > start
      ? Math.max(0, Math.min(1, (stop - start) / (end - start)))
      : null;
  return (
    <section
      className={`nx-rec-sla nx-rec-sla--${tone}`}
      data-testid="sla-standing"
      aria-label="Service level"
    >
      <span className="nx-rec-sla-icon" aria-hidden>
        <ClockCircleOutlined />
      </span>
      <div className="nx-rec-sla-text">
        <span className="nx-rec-sla-kicker">
          SLA{severity ? ` · ${humanStatus(severity)} severity` : ""}
        </span>
        <span className="nx-rec-sla-headline">{headline}</span>
        <span className="nx-rec-sla-detail">
          {detail}
          {reopened > 0 && <span className="nx-rec-sla-reopen">Reopened {formatCount(reopened)}</span>}
        </span>
      </div>
      {used !== null && (
        <div className="nx-rec-sla-window">
          <span className="nx-rec-sla-ends">
            <span>Raised {relativeTime(raised)}</span>
            <span>Promised {relativeTime(due)}</span>
          </span>
          <span
            className="nx-rec-sla-bar"
            role="img"
            aria-label={`${Math.round(used * 100)}% of the window used`}
          >
            <i style={{ width: `${used * 100}%` }} />
          </span>
          <span className="nx-rec-sla-used">{Math.round(used * 100)}% of the window used</span>
        </div>
      )}
    </section>
  );
}
