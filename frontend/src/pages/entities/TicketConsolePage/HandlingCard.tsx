import { Card, Tooltip, Typography } from "antd";

import type { RecordPage } from "@/components/records/useRecordPage";
import { duration, type slaStanding } from "@/entities/sla";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

import { titleCase } from "./words";

const { Text } = Typography;

/**
 * One moment in the handling of a ticket: when it happened, and how long after
 * the one before it.
 *
 * `reached` rather than a boolean called `done`: a deadline that has *passed*
 * has been reached and is not an achievement, and the sequence has to be able
 * to draw both.
 */
function Moment({
  label,
  at,
  note,
  reached,
  tone,
}: {
  label: string;
  at: string | null;
  note: string;
  reached: boolean;
  tone?: "danger";
}) {
  return (
    <li className={`nu-moment${reached ? " is-reached" : ""}`}>
      <span className="nu-moment-label">{label}</span>
      <span className="nu-moment-when">
        {at ? (
          <Tooltip title={absoluteTime(at)}>
            <Text type={tone}>{relativeTime(at)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        )}
      </span>
      <span className="nu-moment-note">
        <Text type={tone ?? "secondary"}>{note}</Text>
      </span>
    </li>
  );
}

/**
 * The four moments a support desk is measured on, in the order they happen.
 * Four rows of a `Descriptions` table are four facts; laid out in sequence they
 * are the *shape* of the response — which is what a review of it is actually
 * looking at.
 */
export function HandlingCard({ page, sla }: { page: RecordPage; sla: ReturnType<typeof slaStanding> }) {
  const ticket = page.record!;
  return (
    <Card size="small" title="How it has been handled" className="nu-block"
          data-testid="ticket-response">
      <ol className="nu-moments">
        <Moment
          label="Raised"
          at={ticket.created_at}
          note={asText(page.value("channel")) ? `via ${titleCase(asText(page.value("channel")))}` : ""}
          reached
        />
        <Moment
          label="First answered"
          at={asText(page.value("first_response_at")) || null}
          note={sla.responseMinutes === null ? "Nobody has answered yet" : `after ${duration(sla.responseMinutes)}`}
          reached={sla.responseMinutes !== null}
        />
        <Moment
          label="Promised by"
          at={asText(page.value("due_at")) || null}
          // What the deadline *means* now, not the same interval twice:
          // the column beside it already says when it was.
          note={
            sla.minutesLeft === null
              ? "No deadline was set"
              : sla.minutesLeft < 0
                ? page.value("resolved_at")
                  ? "Passed before it was resolved"
                  : "Missed, and still open"
                : `${duration(sla.minutesLeft)} left`
          }
          reached={sla.minutesLeft !== null && sla.minutesLeft < 0}
          tone={
            sla.minutesLeft !== null && sla.minutesLeft < 0 && !page.value("resolved_at")
              ? "danger"
              : undefined
          }
        />
        <Moment
          label="Resolved"
          at={asText(page.value("resolved_at")) || null}
          note={
            sla.resolutionMinutes === null
              ? "Still open"
              : `after ${duration(sla.resolutionMinutes)}`
          }
          reached={Boolean(page.value("resolved_at"))}
        />
      </ol>
    </Card>
  );
}
