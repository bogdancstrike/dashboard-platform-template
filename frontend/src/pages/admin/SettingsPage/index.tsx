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

import { Alert, Card, Input, Segmented, Skeleton, Space, Tag, Tooltip } from "antd";

import { PageHeader } from "@/components/PageHeader";
import { apiMessage } from "@/lib/errors";

import { SettingRow } from "./SettingRow";
import { useSettingsPage } from "./useSettingsPage";

export { controlFor } from "./settingControls";

type Page = ReturnType<typeof useSettingsPage>;

export default function SettingsPage() {
  const page = useSettingsPage();
  const { config, write, reset } = page;

  if (config.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (config.isError) {
    return (
      <div className="nx-ad nx-ad--settings">
        <PageHeader title={<>System <em>settings</em></>} />
        <Alert type="error" showIcon message={apiMessage(config.error, "The settings could not be loaded.")} />
      </div>
    );
  }

  const data = config.data!;

  return (
    <div className="nx-ad nx-ad--settings">
      <PageHeader
        title={<>System <em>settings</em></>}
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
        actions={<SettingsFilters page={page} total={data.total} categories={data.categories} />}
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

      <Space direction="vertical" size={16} className="nu-block nu-settings" data-testid="settings-groups">
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
    </div>
  );
}

function SettingsFilters({ page, total, categories }: {
  page: Page;
  total: number;
  categories: Array<{ key: string; label: string; count: number }>;
}) {
  const { term, setTerm, set, category } = page;
  return (
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
        data-testid="settings-categories"
        aria-label="Category"
        value={category || "all"}
        // A section is a place: pushed, so back returns to the previous one.
        onChange={(next) => set({ category: next === "all" ? null : String(next) }, false)}
        options={[
          { value: "all", label: `All (${total})` },
          ...categories.map((item) => ({
            value: item.key,
            label: `${item.label} (${item.count})`,
          })),
        ]}
      />
    </Space>
  );
}
