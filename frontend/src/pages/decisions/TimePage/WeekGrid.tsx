import dayjs from "dayjs";
import { Link } from "react-router-dom";

import { hours, type timeApi, type Week, type WeekRow } from "@/api/time";

import { CellInput } from "./CellInput";

interface WeekGridProps {
  data: Week;
  rows: WeekRow[];
  today: string;
  onCell: (cell: Parameters<typeof timeApi.cell>[0]) => void;
}

/** The week as a grid: one row per work item, a cell per day typed in hours. */
export function WeekGrid({ data, rows, today, onCell }: WeekGridProps) {
  return (
    <div className="nx-td-gridwrap">
      <table className="nx-td-grid" data-testid="week-grid">
        <thead>
          <tr>
            <th scope="col">Work item</th>
            {data.days.map((day) => (
              <th key={day} scope="col" className={day === today ? "is-today" : undefined}>
                {dayjs(day).format("ddd D")}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.subject_type}:${row.subject_id}`}>
              <td>
                <div className="nx-td-subject">
                  {row.link ? <Link to={row.link}>{row.label}</Link> : <span>{row.label}</span>}
                  <small>{row.subject_type}</small>
                </div>
              </td>
              {data.days.map((day, index) => (
                <td key={day}>
                  <CellInput
                    minutes={row.cells[day] ?? 0}
                    fixed={row.fixed[day] ?? 0}
                    disabled={!data.can_edit}
                    weekend={index >= 5}
                    label={`${row.label} on ${dayjs(day).format("dddd D MMMM")}`}
                    onCommit={(minutes) =>
                      onCell({ subject_type: row.subject_type, subject_id: row.subject_id, date: day, minutes })
                    }
                  />
                </td>
              ))}
              <td className="nx-td-total">{hours(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Day total</td>
            {data.days.map((day) => (
              <td key={day}>{data.day_totals[day] ? hours(data.day_totals[day]) : "—"}</td>
            ))}
            <td data-testid="week-grid-total">{hours(data.total_minutes)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
