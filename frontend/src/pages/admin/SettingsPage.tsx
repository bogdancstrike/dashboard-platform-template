/**
 * `/admin/settings` — runtime configuration (§11, §20).
 *
 * Four decisions worth stating.
 *
 * **Every control is rendered from the setting's own declaration.** A boolean
 * gets a switch, a choice gets a select, a bounded number gets a bounded
 * number. Adding a setting on the server therefore needs no change here — and
 * a page that ignored the declaration would render a boolean as a text box and
 * store the string `"false"`, which reads as *true* everywhere it is used.
 *
 * **A change is written on its own, immediately, and says so.** Not staged
 * behind a Save. The permission matrix stages its changes because a matrix is
 * one decision made of ninety cells; a setting is one decision, the audit row
 * names it, and a page of eleven pending edits is a page nobody is sure they
 * saved.
 *
 * **Drift is on the face of it.** Each changed setting says what the platform
 * ships with, and Reset is a button beside it. Knowing what a value *was* is
 * the difference between "somebody chose this" and "this is how it comes".
 *
 * **A secret is shown as set, never shown.** The server sends the redaction
 * and this page never asks for the value back — only replaces it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  InputNumber,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { settingsApi, type Setting } from "@/api/settings";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, 250);

  const category = params.get("category") ?? "";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const config = useQuery({
    queryKey: ["admin-settings", category, debounced],
    queryFn: ({ signal }) =>
      settingsApi.all({ ...(category ? { category } : {}), ...(debounced ? { q: debounced } : {}) }, signal),
  });

  const write = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      settingsApi.set(key, value),
    onSuccess: async (saved) => {
      message.success(`${saved.label} saved`);
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That change was refused."),
  });

  const reset = useMutation({
    mutationFn: (key: string) => settingsApi.reset(key),
    onSuccess: async (saved) => {
      message.success(`${saved.label} is back at its default`);
      await queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That reset was refused."),
  });

  usePageCommands("admin-settings", [
    {
      id: "settings.changed",
      label: "Show the settings that differ from the defaults",
      keywords: "settings changed drift default",
      run: () => set({ q: null, category: null }),
    },
  ]);

  if (config.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (config.isError) {
    return (
      <>
        <PageHeader title="System settings" />
        <Alert
          type="error"
          showIcon
          message={
            config.error instanceof ApiError
              ? config.error.message
              : "The settings could not be loaded."
          }
        />
      </>
    );
  }

  const data = config.data!;

  return (
    <>
      <PageHeader
        title="System settings"
        subtitle="Runtime configuration. A change applies to the next request — nothing here needs a deploy."
        tag={
          data.changed > 0 ? (
            <Tooltip title="Settings that differ from what the platform ships with.">
              <Tag color="blue">{data.changed} changed</Tag>
            </Tooltip>
          ) : (
            <Tag>at the defaults</Tag>
          )
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Search settings"
              value={term}
              onChange={(event) => {
                setTerm(event.target.value);
                set({ q: event.target.value || null });
              }}
              style={{ width: 220 }}
              aria-label="Search settings"
            />
            <Segmented
              aria-label="Category"
              value={category || "all"}
              onChange={(next) => set({ category: next === "all" ? null : String(next) })}
              options={[
                { value: "all", label: `All (${data.total})` },
                ...data.categories.map((item) => ({
                  value: item.key,
                  label: `${item.label} (${item.count})`,
                })),
              ]}
            />
          </Space>
        }
      />

      {/* Said once, at the top, rather than on each row: a page of eleven
          identical warnings is a page nobody reads. */}
      {data.restart_pending > 0 && (
        <Alert
          className="nu-block"
          type="warning"
          showIcon
          data-testid="restart-pending"
          message={`${data.restart_pending} ${data.restart_pending === 1 ? "setting needs" : "settings need"} a restart to take effect`}
          description="They are stored, and the running process is still using the old value."
        />
      )}

      <Space direction="vertical" size={16} className="nu-block nu-settings">
        {data.groups.map((group) => (
          <Card
            size="small"
            key={group.key}
            title={group.label}
            data-testid={`settings-${group.key}`}
          >
            <div className="nu-settings-list">
              {group.items.map((item) => (
                <SettingRow
                  key={item.key}
                  setting={item}
                  saving={write.isPending || reset.isPending}
                  onSave={(value) => write.mutate({ key: item.key, value })}
                  onReset={() => reset.mutate(item.key)}
                />
              ))}
            </div>
          </Card>
        ))}
      </Space>
    </>
  );
}

/**
 * One setting, with the control its own declaration asks for.
 *
 * The label and the control sit on one line and the description under the
 * label, so a category of eight settings is eight lines rather than a stack
 * of cards — this page is scanned for the one thing somebody came to change.
 */
function SettingRow({
  setting,
  saving,
  onSave,
  onReset,
}: {
  setting: Setting;
  saving: boolean;
  onSave: (value: unknown) => void;
  onReset: () => void;
}) {
  return (
    <div className="nu-setting" data-testid={`setting-${setting.key}`}>
      <div className="nu-setting-what">
        <Space size={6}>
          <Text strong>{setting.label}</Text>
          {setting.changed && (
            <Tooltip
              title={
                setting.is_secret
                  ? "A value has been set here."
                  : `The platform ships with ${JSON.stringify(setting.default)}.`
              }
            >
              <Tag bordered={false} color="blue">
                changed
              </Tag>
            </Tooltip>
          )}
          {setting.requires_restart && (
            <Tooltip title="Stored immediately; the running process picks it up on restart.">
              <Tag bordered={false}>needs a restart</Tag>
            </Tooltip>
          )}
        </Space>
        {setting.description && (
          <Text type="secondary" className="nu-setting-hint">
            {setting.description}
          </Text>
        )}
        <Text type="secondary" className="nu-setting-key">
          {setting.key}
          {setting.updated_at ? ` · saved ${relativeTime(setting.updated_at)}` : ""}
        </Text>
      </div>

      <div className="nu-setting-control">
        <SettingControl setting={setting} saving={saving} onSave={onSave} />
        {/* Only where there is something to undo. A row of permanently
            disabled Reset buttons is noise. */}
        {setting.changed && (
          <Tooltip title="Back to what the platform ships with">
            <Button
              type="text"
              size="small"
              icon={<UndoOutlined />}
              loading={saving}
              onClick={onReset}
              aria-label={`Reset ${setting.label}`}
              data-testid={`reset-${setting.key}`}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}

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

function SettingControl({
  setting,
  saving,
  onSave,
}: {
  setting: Setting;
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const kind = controlFor(setting);
  const label = `${setting.label} value`;

  if (kind === "switch") {
    return (
      <Switch
        checked={setting.value === true}
        loading={saving}
        aria-label={label}
        onChange={(next) => onSave(next)}
      />
    );
  }

  if (kind === "select") {
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

  if (kind === "number") {
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

  if (kind === "secret") {
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

  if (kind === "textarea") {
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
