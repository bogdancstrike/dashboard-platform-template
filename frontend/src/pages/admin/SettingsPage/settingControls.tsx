/**
 * The control each kind of setting is edited with — a registry keyed by the
 * kind `controlFor` derives from the setting's declared type.
 *
 * A new value type is one entry here and one case in `controlFor`, rather than
 * another branch in a component that had grown one per type.
 */
import type { ComponentType } from "react";
import { Input, InputNumber, Select, Switch } from "antd";

import type { Setting } from "@/api/settings";

/**
 * The control a declared type asks for.
 *
 * Exported so a test can assert the mapping directly: "a boolean gets a
 * switch" is the claim this whole page rests on, and driving seven forms to
 * check it would be seven tests about AntD.
 */
export function controlFor(setting: Pick<Setting, "value_type" | "is_secret">): string {
  if (setting.is_secret) return "secret";
  switch (setting.value_type) {
    case "boolean":
      return "switch";
    case "choice":
      return "select";
    case "integer":
    case "duration":
      return "number";
    case "json":
      return "textarea";
    default:
      return "text";
  }
}

interface ControlProps {
  setting: Setting;
  saving: boolean;
  label: string;
  onSave: (value: unknown) => void;
}

function SwitchControl({ setting, saving, label, onSave }: ControlProps) {
  return (
    <Switch
      checked={setting.value === true}
      loading={saving}
      aria-label={label}
      onChange={(next) => onSave(next)}
    />
  );
}

function SelectControl({ setting, saving, label, onSave }: ControlProps) {
  return (
    <Select
      aria-label={label}
      value={setting.value as string | number}
      style={{ minWidth: 180 }}
      disabled={saving}
      onChange={(next) => onSave(next)}
      options={(setting.options.choices ?? []).map((item) => ({
        value: item,
        label: String(item),
      }))}
    />
  );
}

function NumberControl({ setting, saving, label, onSave }: ControlProps) {
  return (
    <InputNumber
      aria-label={label}
      defaultValue={setting.value as number}
      min={setting.options.minimum}
      max={setting.options.maximum}
      addonAfter={setting.options.unit}
      disabled={saving}
      style={{ minWidth: 180 }}
      // On blur and Enter rather than on every keystroke: a number written
      // per digit would store 2, then 25, then 250 — and audit all three.
      onBlur={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next) && next !== setting.value) onSave(next);
      }}
      onPressEnter={(event) => {
        const next = Number((event.target as HTMLInputElement).value);
        if (Number.isFinite(next) && next !== setting.value) onSave(next);
      }}
    />
  );
}

function SecretControl({ setting, saving, label, onSave }: ControlProps) {
  return (
    <Input.Password
      aria-label={label}
      placeholder={setting.value ? "A value is set — type to replace it" : "Not set"}
      disabled={saving}
      style={{ minWidth: 240 }}
      // Never pre-filled: the server does not send it, and a field that
      // showed it would put a signing key in a screenshot.
      onBlur={(event) => {
        if (event.target.value) onSave(event.target.value);
      }}
    />
  );
}

function JsonControl({ setting, saving, label, onSave }: ControlProps) {
  return (
    <Input.TextArea
      aria-label={label}
      rows={3}
      defaultValue={JSON.stringify(setting.value, null, 2)}
      disabled={saving}
      style={{ minWidth: 280 }}
      onBlur={(event) => {
        try {
          onSave(JSON.parse(event.target.value));
        } catch {
          // Refused here rather than sent: the server would reject it too,
          // and a JSON error is clearer beside the box than in a toast.
        }
      }}
    />
  );
}

function TextControl({ setting, saving, label, onSave }: ControlProps) {

  // Narrowed rather than stringified: `value` is `unknown` on purpose (a JSON
  // setting holds an object), and `String(anObject)` renders "[object
  // Object]" — a text box that showed that would offer to save it.
  const current = typeof setting.value === "string" ? setting.value : "";
  return (
    <Input
      aria-label={label}
      defaultValue={current}
      disabled={saving}
      style={{ minWidth: 240 }}
      onBlur={(event) => {
        if (event.target.value !== current) onSave(event.target.value);
      }}
    />
  );
}

const CONTROLS: Record<string, ComponentType<ControlProps>> = {
  switch: SwitchControl,
  select: SelectControl,
  number: NumberControl,
  secret: SecretControl,
  textarea: JsonControl,
  text: TextControl,
};

/** The control a declared type asks for. */
export function SettingControl({ setting, saving, onSave }: Omit<ControlProps, "label">) {
  const Control = CONTROLS[controlFor(setting)] ?? TextControl;
  return <Control setting={setting} saving={saving} label={`${setting.label} value`} onSave={onSave} />;
}
