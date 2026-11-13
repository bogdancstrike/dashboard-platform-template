import "@/styles/decisions.css";

import { Button, Card, Tooltip, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";

import { clock, hours, timeApi, type SubjectType } from "@/api/time";
import { relativeTime } from "@/lib/time";

import { EntryModal } from "./EntryModal";
import { TdIcon } from "./TdIcon";
import { useTimer } from "./useTimer";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/**
 * Start/stop on a task or a ticket, beside its Edit button. Running here shows
 * the clock; running elsewhere, starting here switches (the other is stopped
 * and logged — one timer per person).
 */
export function RecordTimerButton({
  subjectType,
  subjectId,
  label,
}: {
  subjectType: SubjectType;
  subjectId: string;
  label?: string;
}) {
  const timer = useTimer();
  const [logging, setLogging] = useState(false);
  if (!timer.allowed) return null;
  const here = timer.running?.subject_type === subjectType && timer.running.subject_id === subjectId;
  const elsewhere = Boolean(timer.running) && !here;

  return (
    <span className="nx-td-timer">
      <Tooltip title={elsewhere ? `Stops the timer on ${timer.running?.subject_label} first` : ""}>
        <Button
          className={here ? "is-running" : undefined}
          icon={<TdIcon name={here ? "stop" : "play"} size={13} />}
          loading={timer.start.isPending || timer.stop.isPending}
          onClick={() =>
            here ? timer.stop.mutate({}) : timer.start.mutate({ subject_type: subjectType, subject_id: subjectId })
          }
          data-testid="record-timer"
        >
          {here ? `Stop · ${clock(timer.elapsed)}` : "Start timer"}
        </Button>
      </Tooltip>
      <Button onClick={() => setLogging(true)} data-testid="record-log-time">
        Log time
      </Button>
      <EntryModal
        open={logging}
        onClose={() => setLogging(false)}
        subject={{ subject_type: subjectType, subject_id: subjectId, label: label ?? "", recent: false }}
      />
    </span>
  );
}

/** The time logged on this record: the total, mine, and the latest entries. */
export function RecordTimeCard({ subjectType, subjectId }: { subjectType: SubjectType; subjectId: string }) {
  const timer = useTimer();
  const logged = useQuery({
    queryKey: ["time", "on", subjectType, subjectId],
    queryFn: ({ signal }) => timeApi.on(subjectType, subjectId, signal),
    enabled: timer.allowed,
  });
  if (!timer.allowed) return null;
  const data = logged.data;
  return (
    <Card size="small" title="Time logged" className="nu-block" data-testid="record-time">
      {!data || data.entries.length === 0 ? (
        <EmptyState compact title="No time logged yet" />
      ) : (
        <div className="nx-td-logged">
          <div className="nx-td-logged-row">
            <Text type="secondary">Everyone</Text>
            <b className="nx-td-num">{hours(data.total_minutes)}</b>
          </div>
          <div className="nx-td-logged-row">
            <Text type="secondary">You</Text>
            <b className="nx-td-num">{hours(data.my_minutes)}</b>
          </div>
          {data.entries.map((entry) => (
            <div key={entry.id} className="nx-td-logged-row">
              <span className="nx-td-faint">
                {entry.user_name} · {relativeTime(entry.ended_at ?? entry.started_at ?? entry.work_date)}
                {entry.note ? ` · ${entry.note}` : ""}
              </span>
              <span className="nx-td-num">{entry.running ? "running" : hours(entry.minutes)}</span>
            </div>
          ))}
          <Link to="/time?tab=entries">All entries</Link>
        </div>
      )}
    </Card>
  );
}
