import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Button, DatePicker, Input, Modal, Select, Space, Switch, TimePicker, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";

import { slaApi, type BusinessCalendar, type SlaCatalogue } from "@/api/sla";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { errorToast } from "@/lib/errors";

import { DAYS } from "./slaCopy";

const { Text } = Typography;

type Hours = Record<string, [Dayjs, Dayjs] | null>;
type Holiday = { date: string; name: string };

interface CalendarModalProps {
  calendar: Partial<BusinessCalendar> | null;
  catalogue: SlaCatalogue;
  onClose: () => void;
  onSaved: () => void;
}

/** A calendar's stored spans as one open–close range per day, for the pickers. */
function pickerHours(calendar: Partial<BusinessCalendar>): Hours {
  const source = calendar.hours ?? Object.fromEntries(DAYS.slice(0, 5).map((day) => [day, [["09:00", "17:00"]]]));
  return Object.fromEntries(DAYS.map((day) => {
    const spans = source[day] ?? [];
    if (!spans.length) return [day, null];
    const first = spans[0]!;
    const last = spans[spans.length - 1]!;
    return [day, [dayjs(`2000-01-01T${first[0]}`), dayjs(`2000-01-01T${last[1] === "00:00" ? "23:59" : last[1]}`)]];
  }));
}

/** The pickers' ranges back as stored spans; a close at 23:59 means midnight. */
function storedHours(hours: Hours): BusinessCalendar["hours"] {
  return Object.fromEntries(DAYS.map((day) => {
    const span = hours[day];
    if (!span) return [day, []];
    const end = span[1].format("HH:mm");
    return [day, [[span[0].format("HH:mm"), end === "23:59" ? "00:00" : end]]];
  }));
}

/** Add or change a business calendar: a zone, open hours per day, and holidays. */
export function CalendarModal({ calendar, catalogue, onClose, onSaved }: CalendarModalProps) {
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [zone, setZone] = useState("UTC");
  const [hours, setHours] = useState<Hours>({});
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  useEffect(() => {
    if (!calendar) return;
    setName(calendar.name ?? "");
    setZone(calendar.timezone ?? "Europe/Berlin");
    setHours(pickerHours(calendar));
    setHolidays(calendar.holidays ?? []);
  }, [calendar]);
  const save = useMutation({
    mutationFn: () => {
      const body: Partial<BusinessCalendar> = { name, timezone: zone, hours: storedHours(hours), holidays };
      return calendar?.id ? slaApi.updateCalendar(calendar.id, body) : slaApi.createCalendar(body);
    },
    onSuccess: () => { onSaved(); message.success("Calendar saved"); onClose(); },
    onError: errorToast(message, { action: "save this calendar" }),
  });
  return (
    <Modal open={Boolean(calendar)} title={calendar?.id ? "Edit business calendar" : "New business calendar"} onCancel={onClose} onOk={() => save.mutate()} confirmLoading={save.isPending} width={560} destroyOnHidden>
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" aria-label="Calendar name" />
        <Select showSearch value={zone} onChange={setZone} options={catalogue.timezones.map((tz) => ({ value: tz, label: tz }))} aria-label="Time zone" />
        {DAYS.map((day) => (
          <div key={day} className="nx-td-hours">
            <Switch
              checked={Boolean(hours[day])}
              onChange={(on) => setHours((current) => ({ ...current, [day]: on ? [dayjs("2000-01-01T09:00"), dayjs("2000-01-01T17:00")] : null }))}
              aria-label={`${day} open`}
              checkedChildren={day.slice(0, 2)}
              unCheckedChildren={day.slice(0, 2)}
            />
            {hours[day] ? (
              <TimePicker.RangePicker format="HH:mm" minuteStep={15} value={hours[day]} allowClear={false}
                onChange={(value) => value && value[0] && value[1] && setHours((current) => ({ ...current, [day]: [value[0]!, value[1]!] }))} />
            ) : <Text type="secondary">Closed</Text>}
          </div>
        ))}
        <Holidays holidays={holidays} setHolidays={setHolidays} />
      </Space>
    </Modal>
  );
}

function Holidays({ holidays, setHolidays }: { holidays: Holiday[]; setHolidays: (update: (list: Holiday[]) => Holiday[]) => void }) {
  return (
    <>
      <p className="nx-td-section">Holidays</p>
      {holidays.map((holiday, index) => (
        <Space key={`${holiday.date}-${index}`}>
          <DatePicker value={dayjs(holiday.date)} allowClear={false} onChange={(value) => value && setHolidays((list) => list.map((h, i) => (i === index ? { ...h, date: value.format("YYYY-MM-DD") } : h)))} />
          <Input value={holiday.name} onChange={(event) => setHolidays((list) => list.map((h, i) => (i === index ? { ...h, name: event.target.value } : h)))} aria-label="Holiday name" />
          <Button type="text" icon={<TdIcon name="x" />} aria-label="Remove holiday" onClick={() => setHolidays((list) => list.filter((_, i) => i !== index))} />
        </Space>
      ))}
      <Button icon={<NxIcon name="plus" />} onClick={() => setHolidays((list) => [...list, { date: dayjs().format("YYYY-MM-DD"), name: "Holiday" }])}>Add a holiday</Button>
    </>
  );
}
