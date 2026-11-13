import { Card, Input, Select, Space, Switch, Typography } from "antd";

import type { FormField, FormTarget } from "@/api/forms";
import { EmptyState } from "@/components/EmptyState";
import { asText } from "@/lib/text";

import { TYPE_LABEL, fieldSpec } from "./fieldTypes";

const { Text } = Typography;

type TargetField = NonNullable<FormTarget["fields"]>[number];

interface FieldInspectorProps {
  field: FormField | null;
  index: number;
  fields: FormField[];
  editable: boolean;
  mappable: TargetField[];
  used: Set<string | undefined>;
  update: (patch: Partial<FormField>) => void;
}

/** The selected field's settings; which controls apply comes from its type's registry entry. */
export function FieldInspector({ field, index, fields, editable, mappable, used, update }: FieldInspectorProps) {
  return (
    <Card size="small" title={field ? `${TYPE_LABEL[field.type]} field` : "Field settings"}>
      {!field ? <EmptyState compact title="Select a field to change it" /> : (
        <Space direction="vertical" style={{ width: "100%" }} size={12} data-testid="form-inspector">
          <label>Label<Input value={field.label} disabled={!editable} onChange={(e) => update({ label: e.target.value })} aria-label="Field label" /></label>
          {!fieldSpec(field.type).structural && (
            <AnswerSettings field={field} editable={editable} mappable={mappable} used={used} update={update} />
          )}
          <VisibleWhen field={field} index={index} fields={fields} editable={editable} update={update} />
          <Text type="secondary" className="nx-td-mono">id: {field.id}</Text>
        </Space>
      )}
    </Card>
  );
}

function AnswerSettings({ field, editable, mappable, used, update }: Omit<FieldInspectorProps, "index" | "fields"> & { field: FormField }) {
  const spec = fieldSpec(field.type);
  const Editor = spec.Editor;
  return (
    <>
      <label>Help text<Input value={field.help ?? ""} disabled={!editable} onChange={(e) => update({ help: e.target.value })} /></label>
      {spec.placeholder && (
        <label>Placeholder<Input value={field.placeholder ?? ""} disabled={!editable} onChange={(e) => update({ placeholder: e.target.value })} /></label>
      )}
      <Space><Switch checked={Boolean(field.required)} disabled={!editable} onChange={(required) => update({ required })} aria-label="Required" /> Required</Space>
      {Editor && <Editor field={field} editable={editable} update={update} />}
      {spec.mappable && (
        <label>Writes to
          <Select
            allowClear
            disabled={!editable}
            value={field.map_to}
            placeholder="Kept with the submission only"
            onChange={(value) => update({ map_to: value })}
            options={mappable.map((item) => ({
              value: item.name,
              label: `${item.label}${item.required ? " (required)" : ""}`,
              disabled: used.has(item.name) && item.name !== field.map_to,
            }))}
            style={{ width: "100%" }}
            aria-label="Writes to"
            data-testid="form-map-to"
          />
        </label>
      )}
    </>
  );
}

function VisibleWhen({ field, index, fields, editable, update }: Pick<FieldInspectorProps, "index" | "fields" | "editable" | "update"> & { field: FormField }) {
  return (
    <label>Show only when
      <Space.Compact style={{ width: "100%" }}>
        <Select
          allowClear
          disabled={!editable || index <= 0}
          placeholder="Always shown"
          value={field.visible_when?.field}
          onChange={(value) => update({ visible_when: value ? { field: value, equals: field.visible_when?.equals ?? "" } : undefined })}
          options={fields.slice(0, Math.max(0, index)).filter((f) => f.type !== "heading").map((f) => ({ value: f.id, label: f.label }))}
          style={{ width: "55%" }}
          aria-label="Depends on"
        />
        <Input
          disabled={!editable || !field.visible_when}
          placeholder="equals…"
          value={asText(field.visible_when?.equals)}
          onChange={(e) => field.visible_when && update({ visible_when: { ...field.visible_when, equals: e.target.value } })}
          aria-label="Equals"
        />
      </Space.Compact>
    </label>
  );
}
