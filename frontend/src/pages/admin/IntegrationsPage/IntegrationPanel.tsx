import { useState } from "react";
import { Alert, Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import { CheckCircleOutlined, LinkOutlined } from "@ant-design/icons";

import type { IntegrationDetail } from "@/api/integrations";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";

import { situation, stateTone } from "./integrationCopy";

const { Text, Paragraph } = Typography;

interface IntegrationPanelProps {
  row: IntegrationDetail;
  redacted: string;
  busy: boolean;
  checking: boolean;
  lastCheck: { configured: boolean; note: string; reached_provider: false } | null;
  onCheck: () => void;
  onSave: (configuration: Record<string, unknown>) => void;
}

/** One integration: what it needs, what it has, and what a check established. */
export function IntegrationPanel(props: IntegrationPanelProps) {
  const { row } = props;
  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={stateTone(row.state)} bordered={false}>
            {row.state.replace(/_/g, " ").toLowerCase()}
          </Tag>
          <Tag bordered={false}>{row.enabled ? "switched on" : "switched off"}</Tag>
        </Space>
        <Paragraph className="nu-int-situation-detail">{situation(row)}</Paragraph>
        {row.description && <Text type="secondary">{row.description}</Text>}
      </div>

      {row.last_error && (
        <Alert
          type={row.enabled ? "error" : "warning"}
          showIcon
          data-testid="int-error"
          message={row.enabled ? "It is failing" : "It was failing when it stopped"}
          description={
            <>
              {row.last_error}
              {row.last_error_at && (
                <Text type="secondary"> · {relativeTime(row.last_error_at)}</Text>
              )}
            </>
          }
        />
      )}

      <SettingsSection {...props} />
    </Space>
  );
}

function SettingsSection({ row, redacted, busy, checking, lastCheck, onCheck, onSave }: IntegrationPanelProps) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const settings = [
    ...row.required_settings,
    ...Object.keys(row.configuration).filter((name) => !row.required_settings.includes(name)),
  ];
  const dirty = Object.keys(edits).length > 0;

  return (
    <section data-testid="int-settings">
      <Text strong>Settings</Text>
      <p>
        <Text type="secondary">
          A secret is held in your deployment&apos;s own store and referenced here by name —
          never pasted in.
        </Text>
      </p>

      <div className="nu-int-fields">
        {settings.map((name) => (
          <SettingField
            key={name}
            name={name}
            row={row}
            value={edits[name]}
            busy={busy}
            onChange={(value) => setEdits((current) => ({ ...current, [name]: value }))}
          />
        ))}
      </div>

      <Space size={8} className="nu-block">
        <Button
          type="primary"
          disabled={!dirty || busy}
          onClick={() => {
            onSave(edits);
            setEdits({});
          }}
          data-testid="save-settings"
        >
          Save settings
        </Button>
        <Tooltip title="Checks that every required setting is present. It does not contact the provider.">
          <Button
            icon={<CheckCircleOutlined />}
            loading={checking}
            disabled={busy && !checking}
            onClick={onCheck}
            data-testid="check-settings"
          >
            Check settings
          </Button>
        </Tooltip>
        {row.docs_url && (
          <Button
            type="text"
            icon={<LinkOutlined />}
            href={row.docs_url}
            target="_blank"
            rel="noreferrer"
          >
            How to set this up
          </Button>
        )}
      </Space>

      {lastCheck && (
        <Alert
          className="nu-block"
          type={lastCheck.configured ? "success" : "warning"}
          showIcon
          data-testid="check-result"
          message={
            lastCheck.configured ? "Every required setting is present" : "Something is missing"
          }
          // The note says the provider was not contacted. A green tick
          // claiming a connection nothing attempted would be the worst lie
          // available on this screen.
          description={lastCheck.note}
        />
      )}
      {redacted && <span hidden data-testid="redaction">{redacted}</span>}
    </section>
  );
}

interface SettingFieldProps {
  name: string;
  row: IntegrationDetail;
  value: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
}

/** One setting; a redacted one asks for a replacement rather than showing what is there. */
function SettingField({ name, row, value, busy, onChange }: SettingFieldProps) {
  const isRedacted = row.redacted_settings.includes(name);
  const required = row.required_settings.includes(name);
  const absent = row.missing_settings.includes(name);
  return (
    <label className="nu-int-field">
      <span className="nu-int-field-name">
        {name}
        {required && <Text type="secondary"> · required</Text>}
        {absent && <Text type="warning"> · not set</Text>}
      </span>
      <Input
        aria-label={`${name} for ${row.name}`}
        data-testid={`setting-${name}`}
        value={value ?? (isRedacted ? "" : asText(row.configuration[name]))}
        // A redacted field asks for a replacement rather than showing what is
        // there — and leaving it blank changes nothing, because the page never
        // sends the redaction.
        placeholder={isRedacted ? "Set — type to replace" : absent ? "Not set" : ""}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
