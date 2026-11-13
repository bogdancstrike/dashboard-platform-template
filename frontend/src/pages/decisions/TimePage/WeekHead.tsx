import { Button, Space } from "antd";
import dayjs from "dayjs";

import { hours, mondayOf, type Week } from "@/api/time";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";

import { SHEET_LABEL, SHEET_TONE, weekLabel, type Go } from "./timeCopy";

interface WeekHeadProps {
  data: Week;
  mine: boolean;
  go: Go;
  onLog: () => void;
  onSubmit: () => void;
}

/** The week's navigation, its status and actions, its numbers, and why it is locked. */
export function WeekHead({ data, mine, go, onLog, onSubmit }: WeekHeadProps) {
  const status = data.timesheet.status;
  const daysLogged = Object.values(data.day_totals).filter(Boolean).length;
  return (
    <>
      <div className="nx-td-weekhead">
        <Button aria-label="Previous week" icon={<NxIcon name="chevronLeft" />} onClick={() => go({ week: data.previous_week })} />
        <Button aria-label="Next week" icon={<NxIcon name="chevronRight" />} onClick={() => go({ week: data.next_week })} />
        <h2 data-testid="week-label">{weekLabel(data.week_start)}</h2>
        {data.week_start !== mondayOf() && <Button onClick={() => go({ week: null })}>This week</Button>}
        {!mine && <span className="nx-td-pilltag nx-td-pilltag--plain">{data.user.name}</span>}
        <span className={SHEET_TONE[status]} data-testid="week-status">{SHEET_LABEL[status]}</span>
        <span style={{ flex: 1 }} />
        {mine && (
          <Space wrap>
            <Button icon={<NxIcon name="plus" />} disabled={!data.can_edit} onClick={onLog}>
              Log time
            </Button>
            <Button
              type="primary"
              icon={<TdIcon name="stamp" />}
              disabled={!data.can_submit}
              onClick={onSubmit}
              data-testid="week-submit"
            >
              {status === "REJECTED" ? "Resubmit week" : "Submit week"}
            </Button>
          </Space>
        )}
      </div>

      <div className="nx-td-kpis">
        <div className="nx-td-kpi"><small>Total</small><strong data-testid="week-total">{hours(data.total_minutes)}</strong><span>this week</span></div>
        <div className="nx-td-kpi"><small>Billable</small><strong>{hours(data.billable_minutes)}</strong>
          <span>{data.total_minutes ? Math.round((data.billable_minutes * 100) / data.total_minutes) : 0}% of the week</span></div>
        <div className="nx-td-kpi"><small>Days logged</small><strong>{daysLogged}</strong><span>of 5 working days</span></div>
        <div className="nx-td-kpi"><small>Work items</small><strong>{data.rows.length}</strong><span>tasks, tickets, projects</span></div>
      </div>
      <WeekLock data={data} />
    </>
  );
}

function WeekLock({ data }: { data: Week }) {
  const status = data.timesheet.status;
  return (
    <>
      {status === "SUBMITTED" && (
        <div className="nx-td-lock" data-testid="week-locked">
          <TdIcon name="hourglass" /> Submitted {data.timesheet.submitted_at ? dayjs(data.timesheet.submitted_at).format("ddd D MMM, HH:mm") : ""} — locked until it is approved or sent back.
        </div>
      )}
      {status === "APPROVED" && (
        <div className="nx-td-lock nx-td-lock--ok" data-testid="week-locked">
          <NxIcon name="check" /> Approved — this week is closed.
        </div>
      )}
      {status === "REJECTED" && (
        <div className="nx-td-lock nx-td-lock--bad">
          <TdIcon name="x" /> Sent back{data.timesheet.decision_comment ? `: “${data.timesheet.decision_comment}”` : ""}. Fix it and resubmit.
        </div>
      )}
    </>
  );
}
