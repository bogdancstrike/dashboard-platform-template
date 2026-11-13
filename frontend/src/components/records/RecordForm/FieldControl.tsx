import { DatePicker, Input, InputNumber, Select, Switch } from "antd";
import { type Dayjs } from "dayjs";

import { humanStatus } from "@/components/StatusTag";
import { PeoplePicker } from "@/components/PeoplePicker";
import { asText } from "@/lib/text";

import { RecordPicker } from "./RecordPicker";
import { StructuredValue } from "./StructuredValue";
import { EditableField } from "./fields";

/** How one declared field is drawn. Nothing here knows what a ticket is. */
export function FieldControl({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  // Supplied by `Form.Item`, which clones this element with them.
  value?: unknown;
  onChange?: (value: unknown) => void;
}) {
  if (field.references === "user") {
    return (
      <PeoplePicker
        multiple={false}
        aria-label={field.label}
        placeholder={`Search people for ${field.label.toLowerCase()}`}
        value={value ? [asText(value)] : []}
        onChange={(ids) => onChange?.(ids[0] ?? null)}
      />
    );
  }

  if (field.references) {
    return (
      <RecordPicker
        resourceType={field.references}
        label={field.label}
        value={value ? asText(value) : undefined}
        onChange={(next) => onChange?.(next ?? null)}
      />
    );
  }

  if (field.kind === "enum") {
    return (
      <Select
        allowClear
        showSearch
        aria-label={field.label}
        placeholder={`Choose a ${field.label.toLowerCase()}`}
        value={value as string | undefined}
        // Typed as always present, but `allowClear` does hand back undefined —
        // and a cleared field has to reach the API as an explicit null.
        onChange={(next: string | undefined) => onChange?.(next ?? null)}
        options={field.choices.map((choice) => ({ value: choice, label: humanStatus(choice) }))}
      />
    );
  }

  if (field.kind === "bool") {
    // Named like the select above: a bare switch was announced as "switch,
    // off" with no hint of what it turns on (axe button-name).
    return <Switch aria-label={field.label} checked={Boolean(value)} onChange={(next) => onChange?.(next)} />;
  }

  if (field.kind === "number") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        aria-label={field.label}
        min={field.minimum ?? undefined}
        max={field.maximum ?? undefined}
        value={value as number | undefined}
        onChange={(next) => onChange?.(next)}
      />
    );
  }

  if (field.kind === "datetime") {
    return (
      <DatePicker
        style={{ width: "100%" }}
        showTime
        aria-label={field.label}
        value={(value as Dayjs | undefined) ?? null}
        onChange={(next) => onChange?.(next)}
      />
    );
  }

  if (field.kind === "json" || field.kind === "array") {
    return <StructuredValue field={field} value={value} onChange={onChange} />;
  }

  if (field.prose) {
    return (
      <Input.TextArea
        rows={5}
        aria-label={field.label}
        value={value as string | undefined}
        onChange={(event) => onChange?.(event.target.value)}
      />
    );
  }

  return (
    <Input
      aria-label={field.label}
      value={value as string | undefined}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}
