import { Button, Dropdown } from "antd";
import dayjs from "dayjs";
import { Link } from "react-router-dom";

import { hours, type TimeEntry } from "@/api/time";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";

/** Time entries as rows, each with its source, note and edit/remove. */
export function EntryRows({
  entries, editable, onEdit, onRemove, showPerson = false,
}: {
  entries: TimeEntry[];
  editable: boolean;
  onEdit: (entry: TimeEntry) => void;
  onRemove: (entry: TimeEntry) => void;
  showPerson?: boolean;
}) {
  if (entries.length === 0) return <div className="nx-td-empty">No entries.</div>;
  return (
    <div className="nx-td-list" data-testid="time-entries">
      {entries.map((entry) => (
        <div key={entry.id} className="nx-td-row nx-td-row--nocheck">
          <span className="nx-td-row-icon"><TdIcon name={entry.source === "TIMER" ? "clock" : "form"} /></span>
          <div className="nx-td-row-main">
            {entry.link ? <Link className="nx-td-row-title" to={entry.link}>{entry.subject_label}</Link>
              : <span className="nx-td-row-title">{entry.subject_label}</span>}
            <div className="nx-td-row-meta">
              <span>{dayjs(entry.work_date).format("ddd D MMM")}</span>
              {entry.started_at && entry.ended_at && (
                <span>{dayjs(entry.started_at).format("HH:mm")}–{dayjs(entry.ended_at).format("HH:mm")}</span>
              )}
              {showPerson && entry.user_name && <span>{entry.user_name}</span>}
              <span>{entry.source === "TIMER" ? "Timer" : entry.source === "GRID" ? "Week grid" : "Typed"}</span>
              {entry.note && <span>“{entry.note}”</span>}
            </div>
          </div>
          <div className="nx-td-row-side">
            {entry.billable ? <span className="nx-td-pilltag nx-td-pilltag--acc">Billable</span>
              : <span className="nx-td-pilltag">Non-billable</span>}
            <b className="nx-td-num" style={{ minWidth: 64, textAlign: "end" }}>{entry.running ? "running" : hours(entry.minutes)}</b>
            {editable && !entry.running && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    { key: "edit", label: "Edit" },
                    { key: "remove", label: "Remove", danger: true },
                  ],
                  onClick: ({ key }) => (key === "edit" ? onEdit(entry) : onRemove(entry)),
                }}
              >
                <Button type="text" aria-label={`Actions for ${entry.subject_label}`} icon={<NxIcon name="more" />} />
              </Dropdown>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
