import "@/styles/decisions.css";

import { Card, Skeleton, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { slaApi, target, type Clock, type TicketSla } from "@/api/sla";
import { useAuth } from "@/auth/AuthProvider";
import { duration } from "@/entities/sla";
import { absoluteTime } from "@/lib/time";

const { Text } = Typography;

/** The ticket's SLA, as its policy computes it — shared by the card and the banner. */
export function useTicketSla(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: ["sla", "ticket", ticketId],
    queryFn: ({ signal }) => slaApi.ticket(ticketId, signal),
    enabled: enabled && Boolean(ticketId),
    staleTime: 30_000,
  });
}

function ClockRow({ label, clock, paused }: { label: string; clock: Clock | null; paused?: boolean }) {
  if (!clock) {
    return (
      <div className="nx-td-clock-row">
        <Text type="secondary">{label}</Text>
        <span className="nx-td-faint">No target</span>
      </div>
    );
  }
  const left = clock.business_minutes_left;
  const text = clock.done_at
    ? clock.met ? "Met" : "Missed"
    : paused ? "Paused"
    : left === null ? "—"
    : left < 0 ? `${duration(Math.abs(left))} over` : `${duration(left)} left`;
  const tone = clock.done_at
    ? clock.met ? "ok" : "bad"
    : paused ? "acc" : left !== null && left < 0 ? "bad" : left !== null && left < 120 ? "warn" : "ok";
  return (
    <div className="nx-td-clock-row">
      <span>
        <Text type="secondary">{label}</Text>
        <br />
        <span className="nx-td-faint">due {absoluteTime(clock.due_at)}</span>
      </span>
      <span className={`nx-td-pilltag nx-td-pilltag--${tone}`}>{text}</span>
    </div>
  );
}

/**
 * Which SLA policy a ticket is measured against, its targets for this
 * priority, and the time left counted in that policy's business hours.
 */
export function TicketSlaCard({ ticketId }: { ticketId: string }) {
  const auth = useAuth();
  const sla = useTicketSla(ticketId);
  const data: TicketSla | undefined = sla.data;
  const percent = data?.percent_elapsed ?? null;
  return (
    <Card size="small" title="Service level" className="nu-block" data-testid="ticket-sla"
      extra={auth.can("sla.manage") ? <Link to="/admin/sla">Policies</Link> : undefined}>
      {sla.isLoading || !data ? <Skeleton active paragraph={{ rows: 3 }} /> : !data.policy ? (
        <Text type="secondary">No SLA policy covers this ticket.</Text>
      ) : (
        <div className="nx-td-clock">
          <div>
            <Text strong data-testid="ticket-sla-policy">{data.policy.name}</Text>
            <div className="nx-td-faint">
              {data.calendar ? `${data.calendar.name} · ${data.calendar.timezone}` : "Counted around the clock"}
              {" · "}{data.in_business_hours ? "open now" : "outside business hours"}
            </div>
          </div>
          <div className="nx-td-faint">
            {data.priority.toLowerCase()} priority: answer within {target(data.targets.first_response)}, resolve within {target(data.targets.resolution)}
          </div>
          <ClockRow label="First response" clock={data.first_response} />
          <ClockRow label="Resolution" clock={data.resolution} paused={data.paused} />
          {percent !== null && (
            <div>
              <div className={`nx-td-meter${percent >= 100 ? " is-bad" : percent >= 75 ? " is-warn" : ""}`} aria-label={`${Math.round(percent)}% of the resolution target used`}>
                <i style={{ width: `${Math.min(100, percent)}%` }} />
                {data.escalations.filter((step) => step.at_percent < 100).map((step, index) => (
                  <s key={index} style={{ left: `${step.at_percent}%` }} />
                ))}
              </div>
              <div className="nx-td-faint" style={{ marginTop: 4 }}>
                {percent >= 1000 ? "Long past the target" : `${Math.round(percent)}% of the target used`}{data.paused_minutes ? ` · paused ${duration(data.paused_minutes)} so far` : ""}
              </div>
            </div>
          )}
          {data.escalations.length > 0 && (
            <div className="nx-td-steps">
              {data.escalations.map((step, index) => (
                <span key={index} className={`nx-td-pilltag ${step.fired ? "nx-td-pilltag--warn" : ""}`}>
                  {step.at_percent}% · {step.action === "RAISE_PRIORITY" ? "raise priority" : `${step.action.toLowerCase()} ${step.target ?? ""}`}{step.fired ? " · done" : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
