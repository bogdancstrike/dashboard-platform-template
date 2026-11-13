import { Input, Select, Typography } from "antd";

import { str } from "../graph";
import { Field } from "./Field";
import type { EditorProps } from "./types";

const { Text } = Typography;

const SCHEDULES = [
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "0 * * * *", label: "Every hour" },
  { value: "0 8 * * 1-5", label: "Weekdays at 08:00" },
  { value: "0 9 * * 1", label: "Mondays at 09:00" },
  { value: "0 0 1 * *", label: "First of the month" },
];

/** What starts the workflow: the event, the dataset, and the event's own settings. */
export function TriggerFields({ data, set, catalogue, dataset }: EditorProps) {
  const datasetKey = str(data.resource_type) || "task";
  return (
    <>
      <Field label="Starts when">
        <Select aria-label="Trigger" value={str(data.event) || undefined}
          onChange={(event: string) => set({ event })}
          options={catalogue.triggers.map((item) => ({ value: item.event, label: item.label }))} />
        <Text type="secondary" className="nx-wf-hint">
          {catalogue.triggers.find((item) => item.event === data.event)?.description}
        </Text>
      </Field>
      <Field label="Dataset">
        <Select aria-label="Dataset" value={datasetKey} showSearch optionFilterProp="label"
          onChange={(resource_type: string) => set({ resource_type, field: undefined, to: undefined })}
          options={catalogue.resources.map((item) => ({ value: item.key, label: item.label }))} />
      </Field>
      {data.event === "FIELD_CHANGED" && (
        <>
          <Field label="Field">
            <Select aria-label="Changed field" value={str(data.field) || undefined} showSearch
              optionFilterProp="label" placeholder="Choose a field"
              onChange={(field: string) => set({ field, to: undefined })}
              options={(dataset?.fields ?? []).map((field) => ({ value: field.name, label: field.label }))} />
          </Field>
          <Field label="Only when it becomes (optional)">
            <ChangesTo data={data} set={set} dataset={dataset} />
          </Field>
        </>
      )}
      {data.event === "SCHEDULE" && (
        <Field label="Schedule (cron)">
          <Select aria-label="Schedule presets" placeholder="A common schedule" value={undefined}
            onChange={(schedule: string) => set({ schedule })} options={SCHEDULES} />
          <Input aria-label="Cron expression" value={str(data.schedule)} placeholder="0 8 * * 1-5"
            onChange={(event) => set({ schedule: event.target.value })} />
          <Text type="secondary" className="nx-wf-hint">
            Minute, hour, day, month, weekday. Each run looks at the records the first condition selects.
          </Text>
        </Field>
      )}
      {data.event === "FORM_SUBMITTED" && (
        <Field label="Form">
          <Select aria-label="Form" allowClear placeholder="Any form" value={str(data.form) || undefined}
            onChange={(form?: string) => set({ form: form ?? "" })}
            options={catalogue.forms.filter((form) => form.target === datasetKey)
              .map((form) => ({ value: form.slug, label: form.name }))} />
        </Field>
      )}
      {data.event === "WEBHOOK" && (
        <Text type="secondary" className="nx-wf-hint">
          Publishing gives this workflow its own address. POST <code>{"{\"record_id\": \"…\"}"}</code> to it.
        </Text>
      )}
    </>
  );
}

/** The value a watched field must change to, as a choice when the field has them. */
function ChangesTo({ data, set, dataset }: Pick<EditorProps, "data" | "set" | "dataset">) {
  const field = dataset?.fields.find((item) => item.name === data.field);
  return field?.choices.length ? (
    <Select aria-label="Changes to" allowClear value={str(data.to) || undefined}
      onChange={(to?: string) => set({ to: to ?? "" })}
      options={field.choices.map((choice) => ({ value: choice, label: choice }))} />
  ) : (
    <Input aria-label="Changes to" value={str(data.to)} placeholder="Any value"
      onChange={(event) => set({ to: event.target.value })} />
  );
}
