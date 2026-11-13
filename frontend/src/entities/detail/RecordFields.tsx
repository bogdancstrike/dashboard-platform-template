/**
 * The two controls a record page's side panel is mostly made of: a declared
 * choice written as soon as it is picked, and a person. Both are disabled for
 * a reader whose role cannot edit the record.
 */

import { Select } from "antd";

import { PeoplePicker } from "@/components/PeoplePicker";
import type { RecordPage } from "@/components/records/useRecordPage";
import { humanStatus } from "@/components/StatusTag";
import { asText } from "@/lib/text";

import { Field } from "./Field";

/** One of the field's declared choices, saved on change. */
export function ChoiceField({
  page,
  field,
  label,
  value,
  loading,
}: {
  page: RecordPage;
  field: string;
  label: string;
  /** Defaults to the record's own value of `field`. */
  value?: string;
  loading?: boolean;
}) {
  return (
    <Field label={label}>
      <Select
        aria-label={label}
        style={{ width: "100%" }}
        value={value ?? asText(page.value(field))}
        disabled={!page.record?.can_edit}
        loading={loading}
        onChange={(next) => page.write({ [field]: next })}
        options={page.choices(field).map((choice) => ({
          value: choice,
          label: humanStatus(choice),
        }))}
      />
    </Field>
  );
}

/** One person, or nobody, saved on change. */
export function PersonField({
  page,
  field,
  label,
  placeholder,
}: {
  page: RecordPage;
  field: string;
  label: string;
  placeholder: string;
}) {
  return (
    <Field label={label}>
      <PeoplePicker
        multiple={false}
        aria-label={label}
        placeholder={placeholder}
        disabled={!page.record?.can_edit}
        value={page.value(field) ? [asText(page.value(field))] : []}
        onChange={(ids) => page.write({ [field]: ids[0] ?? null })}
      />
    </Field>
  );
}
