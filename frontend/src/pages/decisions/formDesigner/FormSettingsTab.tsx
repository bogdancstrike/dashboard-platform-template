import { useMemo, useState } from "react";
import { Button, Card, Input, InputNumber, Segmented, Select, Space, Switch, Typography } from "antd";

import type { FormDetail, FormSettings, FormTarget } from "@/api/forms";
import { TdIcon } from "@/components/icons/TdIcon";
import { PeoplePicker } from "@/components/PeoplePicker";

const { Text } = Typography;

interface SettingsProps {
  draft: FormDetail;
  editable: boolean;
  change: (patch: Partial<FormDetail>) => void;
  changeSettings: (patch: Partial<FormSettings>) => void;
}

/** What the form is and where it lives, and what happens to each answer. */
export function FormSettingsTab(props: SettingsProps) {
  return (
    <div className="nx-td-designer" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
      <TheForm {...props} />
      <Answers {...props} />
    </div>
  );
}

function TheForm({ draft, editable, change, changeSettings }: SettingsProps) {
  return (
    <Card size="small" title="The form">
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <label>Name<Input value={draft.name} disabled={!editable} onChange={(e) => change({ name: e.target.value })} aria-label="Form name" /></label>
        <label>Description<Input.TextArea rows={3} value={draft.description} disabled={!editable} onChange={(e) => change({ description: e.target.value })} /></label>
        <label>Creates
          <Select value={draft.target} disabled={!editable || draft.submission_count > 0} onChange={(value) => change({ target: value, fields: draft.fields.map((f) => ({ ...f, map_to: undefined })) })}
            options={draft.targets.map((item) => ({ value: item.key, label: item.label }))} style={{ width: "100%" }} aria-label="Creates" />
        </label>
        <label>Public address
          <Input addonBefore={`${window.location.origin}/f/`} value={draft.slug} disabled={!editable} placeholder="support"
            onChange={(e) => change({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} aria-label="Address" />
        </label>
        <label>Who can answer
          <Segmented block value={draft.settings.visibility} disabled={!editable} onChange={(value) => changeSettings({ visibility: value as "PUBLIC" | "INTERNAL" })}
            options={[{ value: "PUBLIC", label: "Anyone with the link" }, { value: "INTERNAL", label: "Signed-in colleagues" }]} />
        </label>
      </Space>
    </Card>
  );
}

function Answers({ draft, editable, changeSettings }: SettingsProps) {
  const target = draft.targets.find((item) => item.key === draft.target);
  return (
    <Card size="small" title="Answers">
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <label>Button text<Input value={draft.settings.submit_label} disabled={!editable} onChange={(e) => changeSettings({ submit_label: e.target.value })} /></label>
        <label>Confirmation message<Input.TextArea rows={2} value={draft.settings.confirmation} disabled={!editable} onChange={(e) => changeSettings({ confirmation: e.target.value })} /></label>
        <Space><Switch checked={draft.settings.captcha} disabled={!editable} onChange={(captcha) => changeSettings({ captcha })} aria-label="Challenge" /> Ask a question only a person answers (public answers)</Space>
        <label>At most this many answers per address per hour
          <InputNumber min={1} max={1000} value={draft.settings.rate_limit_per_hour} disabled={!editable} onChange={(value) => changeSettings({ rate_limit_per_hour: Number(value) || 10 })} style={{ width: "100%" }} />
        </label>
        <label>Tell these people about each answer
          <PeoplePicker value={draft.settings.notify_user_ids} onChange={(ids) => changeSettings({ notify_user_ids: ids })} />
        </label>
        <RecordDefaults draft={draft} target={target} editable={editable} changeSettings={changeSettings} />
      </Space>
    </Card>
  );
}

/** Values every record the form creates gets, whatever was answered. */
function RecordDefaults({ draft, target, editable, changeSettings }: Omit<SettingsProps, "change"> & { target?: FormTarget }) {
  const defaults = draft.settings.defaults ?? {};
  const [defaultField, setDefaultField] = useState<string | undefined>();
  const choices = useMemo(() => (target?.fields ?? []).filter((item) => item.choices.length > 0), [target]);
  return (
    <div>
      <Text>Every record it creates gets</Text>
      {Object.entries(defaults).map(([name, value]) => (
        <div key={name} className="nx-td-logged-row" style={{ marginTop: 6 }}>
          <span>{target?.fields.find((f) => f.name === name)?.label ?? name}: <b>{String(value)}</b></span>
          {editable && <Button type="text" icon={<TdIcon name="x" />} aria-label={`Remove ${name}`}
            onClick={() => { const next = { ...defaults }; delete next[name]; changeSettings({ defaults: next }); }} />}
        </div>
      ))}
      {editable && (
        <Space.Compact style={{ width: "100%", marginTop: 8 }}>
          <Select placeholder="Field" value={defaultField} onChange={setDefaultField} style={{ width: "50%" }}
            options={choices.filter((f) => !(f.name in defaults)).map((f) => ({ value: f.name, label: f.label }))} aria-label="Default field" />
          <Select placeholder="Value" disabled={!defaultField} style={{ width: "50%" }} value={undefined}
            options={(choices.find((f) => f.name === defaultField)?.choices ?? []).map((c) => ({ value: c, label: c }))}
            onChange={(value: string) => { if (defaultField) { changeSettings({ defaults: { ...defaults, [defaultField]: value } }); setDefaultField(undefined); } }} aria-label="Default value" />
        </Space.Compact>
      )}
    </div>
  );
}
