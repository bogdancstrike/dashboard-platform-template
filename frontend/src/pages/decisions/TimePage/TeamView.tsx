import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router-dom";

import { hours, isoDay, mondayOf, timeApi, type SheetStatus } from "@/api/time";
import { NxIcon } from "@/components/NxIcon";
import { PersonAvatar } from "@/components/PersonAvatar";
import { errorText } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { SHEET_LABEL, SHEET_TONE, weekLabel, type Go } from "./timeCopy";

/** The team's weeks for an approver: each person's total and where their sheet stands. */
export function TeamView({ params, go }: { params: URLSearchParams; go: Go }) {
  const weekParam = params.get("week") ?? isoDay(dayjs(mondayOf()).subtract(7, "day").toDate());
  const team = useQuery({
    queryKey: queryKeys.time("team", weekParam),
    queryFn: ({ signal }) => timeApi.team(weekParam, signal),
  });
  if (team.isLoading) return <Skeleton active />;
  if (team.isError || !team.data) return <Alert type="error" showIcon message={errorText(team.error)} />;
  const data = team.data;
  return (
    <>
      <div className="nx-td-weekhead">
        <Button aria-label="Previous week" icon={<NxIcon name="chevronLeft" />} onClick={() => go({ week: data.previous_week })} />
        <Button aria-label="Next week" icon={<NxIcon name="chevronRight" />} onClick={() => go({ week: data.next_week })} />
        <h2>{weekLabel(data.week_start)}</h2>
        <span style={{ flex: 1 }} />
        {(["SUBMITTED", "REJECTED", "DRAFT", "APPROVED"] as SheetStatus[]).map((key) => (
          <span key={key} className={SHEET_TONE[key]}>{SHEET_LABEL[key]} {data.counts[key] ?? 0}</span>
        ))}
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">Nobody logged time this week.</div> : (
        <div className="nx-td-list" data-testid="time-team">
          {data.items.map((row) => (
            <div key={row.user.id} className="nx-td-row nx-td-row--nocheck">
              <PersonAvatar name={row.user.name} src={row.user.avatar_url} size={38} />
              <div className="nx-td-row-main">
                <button type="button" className="nx-td-row-title" onClick={() => go({ tab: null, user: row.user.id, week: data.week_start })}>
                  {row.user.name}
                </button>
                <div className="nx-td-row-meta">
                  <span>{row.user.job_title ?? ""}</span>
                  <span>{hours(row.billable_minutes)} billable</span>
                </div>
              </div>
              <div className="nx-td-row-side">
                <span className={SHEET_TONE[row.status]}>{SHEET_LABEL[row.status]}</span>
                <b className="nx-td-num" style={{ minWidth: 64, textAlign: "end" }}>{hours(row.total_minutes)}</b>
                {row.status === "SUBMITTED" && row.approval_id && (
                  <Link to={`/approvals?open=${row.approval_id}`}><Button type="primary">Review</Button></Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
