import { DatePicker, Form, InputNumber, Select } from "antd";

import { WEEKDAY_CODES } from "@/components/calendar/weekdays";

import { INTERVAL_UNIT } from "./eventForm";

/** How often a repeating event repeats, on which days, and until when. */
export function RepeatDetail({ repeat }: { repeat: string }) {
  return (
    <div className="nu-event-form-grid" data-testid="repeat-detail">
      <Form.Item name="interval" label="Every">
        <InputNumber
          min={1}
          max={52}
          style={{ width: "100%" }}
          addonAfter={INTERVAL_UNIT[repeat] ?? ""}
          aria-label="Interval"
        />
      </Form.Item>

      {repeat === "WEEKLY" && (
        <Form.Item name="byday" label="On">
          <Select
            mode="multiple"
            aria-label="Days"
            placeholder="The day it starts on"
            options={WEEKDAY_CODES.map(({ code, label }) => ({
              value: code,
              label,
            }))}
          />
        </Form.Item>
      )}

      <Form.Item
        name="until"
        label="Until"
        tooltip="A repeat needs a horizon: a series with no end is one the calendar has to expand forever."
      >
        <DatePicker style={{ width: "100%" }} aria-label="Until" />
      </Form.Item>
    </div>
  );
}
