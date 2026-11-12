import { DatePicker, TimePicker } from "antd";

export default function DatePickerBasic() {
  return (
    <div className="nx-doc-grid">
      <DatePicker aria-label="Due date" />
      <DatePicker.RangePicker aria-label="Window" />
      <DatePicker picker="month" aria-label="Month" />
      <TimePicker format="HH:mm" aria-label="Time" />
      <DatePicker showTime aria-label="Date and time" />
      <DatePicker disabled aria-label="Disabled date" />
    </div>
  );
}
