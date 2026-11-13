import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { UndoOutlined } from "@ant-design/icons";

import type { Setting } from "@/api/settings";
import { relativeTime } from "@/lib/time";

import { SettingControl } from "./settingControls";

const { Text } = Typography;

/**
 * One setting, with the control its own declaration asks for.
 *
 * The label and the control sit on one line and the description under the
 * label, so a category of eight settings is eight lines rather than a stack
 * of cards — this page is scanned for the one thing somebody came to change.
 */
export function SettingRow({
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
