import { Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { Integration, IntegrationState } from "@/api/integrations";
import { absoluteTime, relativeTime } from "@/lib/time";

import { situation, stateTone } from "./integrationCopy";

const { Text } = Typography;

interface Toggle {
  isPending: boolean;
  mutate: (args: { id: string; enabled: boolean }) => void;
}

/** The integrations table's columns; the switch writes through `toggle`. */
export function integrationColumns(toggle: Toggle): ColumnsType<Integration> {
  return [
    {
      title: "Integration",
      dataIndex: "name",
      render: (name: string, row) => (
        // A per-row handle: several providers share a name with their own
        // product ("Slack" by Slack), so locating a row by its text is
        // ambiguous by construction.
        <div className="nu-int-what" data-testid={`int-${row.key}`}>
          <Space size={6}>
            <Text strong>{name}</Text>
            <Text type="secondary" className="nu-int-provider">
              {row.provider}
            </Text>
          </Space>
          <Text type="secondary" className="nu-int-category">
            {row.category.replace(/_/g, " ").toLowerCase()}
          </Text>
        </div>
      ),
    },
    {
      title: "Where it stands",
      dataIndex: "state",
      width: 320,
      render: (state: IntegrationState, row) => (
        <Space size={6}>
          {/* Written out as well as coloured (§64). */}
          <Tag color={stateTone(state)} bordered={false}>
            {state.replace(/_/g, " ").toLowerCase()}
          </Tag>
          <Text
            type={row.enabled && state !== "CONNECTED" ? "warning" : "secondary"}
            className="nu-int-situation"
          >
            {situation(row)}
          </Text>
        </Space>
      ),
    },
    {
      title: "On",
      dataIndex: "enabled",
      width: 76,
      render: (enabled: boolean, row) => (
        <Tooltip
          title={
            row.configured
              ? enabled
                ? `Turn ${row.name} off`
                : `Turn ${row.name} on`
              : `${row.name} needs ${row.missing_settings.join(", ")} first`
          }
        >
          <Switch
            size="small"
            checked={enabled}
            // Disabled with the reason rather than hidden: turning it on *is*
            // what somebody came to do, and the settings are the actionable
            // part (§76).
            disabled={!row.configured || toggle.isPending}
            aria-label={`${enabled ? "Turn off" : "Turn on"} ${row.name}`}
            data-testid={`toggle-${row.key}`}
            onChange={(next) => toggle.mutate({ id: row.id, enabled: next })}
            onClick={(_checked, event) => event.stopPropagation()}
          />
        </Tooltip>
      ),
    },
    {
      title: "Last connected",
      dataIndex: "last_connected_at",
      width: 132,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text type="secondary">{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">never</Text>
        ),
    },
  ];
}
