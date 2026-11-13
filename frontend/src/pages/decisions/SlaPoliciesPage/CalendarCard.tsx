import { App, Button, Card, Popconfirm, Space, Typography } from "antd";

import { slaApi, type BusinessCalendar } from "@/api/sla";
import { TdIcon } from "@/components/icons/TdIcon";
import { errorText } from "@/lib/errors";

import { DAYS } from "./slaCopy";

const { Text } = Typography;

interface CalendarCardProps {
  cal: BusinessCalendar;
  canManage: boolean;
  onEdit: () => void;
  onRemoved: () => void;
}

/** One business calendar: its zone, its open hours per day, and who uses it. */
export function CalendarCard({ cal, canManage, onEdit, onRemoved }: CalendarCardProps) {
  const { message } = App.useApp();
  return (
    <Card data-testid="sla-calendar">
      <div className="nx-td-policy">
        <div className="nx-td-policy-head">
          <span className="nx-td-policy-rank"><TdIcon name="clock" size={16} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="nx-td-policy-title">{cal.name}</h3>
            <Text type="secondary">{cal.timezone} · {Math.round(cal.weekly_minutes / 60)} working hours a week · {cal.holidays.length} holidays · used by {cal.used_by}</Text>
          </div>
          {canManage && (
            <Space>
              <Button onClick={onEdit}>Edit</Button>
              <Popconfirm title="Remove this calendar?" onConfirm={() => slaApi.removeCalendar(cal.id).then(onRemoved).catch((error) => message.error(errorText(error)))}>
                <Button danger disabled={cal.used_by > 0}>Remove</Button>
              </Popconfirm>
            </Space>
          )}
        </div>
        <div className="nx-td-week7">
          {DAYS.map((day) => {
            const spans = cal.hours[day] ?? [];
            return (
              <span key={day} className={spans.length ? "is-open" : undefined} title={spans.map((s) => s.join("–")).join(", ") || "Closed"}>
                {day.slice(0, 2)} {spans.length ? spans.map((s) => (s[0] === "00:00" && s[1] === "00:00" ? "24h" : `${s[0]}–${s[1]}`)).join(" ") : "—"}
              </span>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
