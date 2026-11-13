import { Button } from "antd";
import dayjs from "dayjs";

import { hours, type TimeEntry, type Week, type WeekRow } from "@/api/time";

/** The week as one card per day, on a phone where the grid does not fit. */
export function DayCards({ data, rows, onOpen }: { data: Week; rows: WeekRow[]; onOpen: (entry: TimeEntry) => void }) {
  return (
    <div className="nx-td-days" data-testid="week-days">
      {data.days.map((day) => {
        const entries = data.entries.filter((entry) => entry.work_date === day);
        return (
          <div key={day} className="nx-td-day">
            <div className="nx-td-day-head">
              <span>{dayjs(day).format("dddd D MMM")}</span>
              <span className="nx-td-num">{data.day_totals[day] ? hours(data.day_totals[day]) : "—"}</span>
            </div>
            {entries.length === 0 && <span className="nx-td-faint">Nothing logged</span>}
            {entries.map((entry) => (
              <div key={entry.id} className="nx-td-day-row">
                <span>{entry.subject_label}</span>
                <Button type="text" disabled={!data.can_edit || entry.running} onClick={() => onOpen(entry)}>
                  {entry.running ? "running" : hours(entry.minutes)}
                </Button>
              </div>
            ))}
          </div>
        );
      })}
      <span className="nx-td-faint">{rows.length} work items this week</span>
    </div>
  );
}
