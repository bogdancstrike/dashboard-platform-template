/**
 * What a request's provider sent beyond the common facts, drawn by kind of
 * detail rather than by kind of request.
 *
 * Every approval provider on the server (timesheets, access requests, held-back
 * edits, publishing) fills the same `details` envelope with whichever parts it
 * has. This is the client half of that registry: one section per part, each
 * drawing itself only when its part is present, so a new provider that sends
 * `changes` gets the change table without anything here knowing its name.
 */
import type { ComponentType } from "react";
import dayjs from "dayjs";

import type { ApprovalDetail } from "@/api/approvals";
import { hours } from "@/api/time";
import { asText } from "@/lib/text";

type Details = ApprovalDetail["details"];

export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/** The edit a change rule held back, field by field. */
function ChangesSection({ details }: { details: Details }) {
  if (!details.changes || details.changes.length === 0) return null;
  return (
    <div>
      <p className="nx-td-section">The change it holds back</p>
      <dl className="nx-td-facts" data-testid="approval-changes">
        {details.changes.map((change) => (
          <FactRow key={change.field} label={change.field} value={`${asText(change.before) || "—"} → ${asText(change.after) || "—"}`} />
        ))}
      </dl>
    </div>
  );
}

/** A timesheet's week: hours per day, then per subject. */
function WeekSection({ details }: { details: Details }) {
  if (!details.days) return null;
  const max = Math.max(1, ...details.days.map((day) => day.minutes));
  return (
    <div>
      <p className="nx-td-section">The week</p>
      <div className="nx-td-bars" aria-label="Hours per day">
        {details.days.map((day) => (
          <div key={day.date} title={`${dayjs(day.date).format("dddd")}: ${hours(day.minutes)}`}>
            <i style={{ height: `${(day.minutes * 100) / max}%` }} />
            <small>{dayjs(day.date).format("dd")}</small>
          </div>
        ))}
      </div>
      {(details.subjects ?? []).map((subject) => (
        <div key={subject.label} className="nx-td-logged-row" style={{ marginTop: 6 }}>
          <span className="nx-td-faint">{subject.label}</span>
          <b className="nx-td-num">{hours(subject.minutes)}</b>
        </div>
      ))}
    </div>
  );
}

export const DETAIL_SECTIONS: Array<{ key: string; Section: ComponentType<{ details: Details }> }> = [
  { key: "changes", Section: ChangesSection },
  { key: "week", Section: WeekSection },
];
