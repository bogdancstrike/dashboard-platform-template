import { Alert, Descriptions, Drawer, Space, Tag, Typography } from "antd";
import { UserSwitchOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import type { AuditEntry } from "@/api/audit";
import { AuditDiff } from "@/components/audit/AuditDiff";
import { actionColor, humaniseAction, resultColor } from "@/components/audit/vocabulary";
import { absoluteTime } from "@/lib/time";

import type { useAuditPage } from "./useAuditPage";

const { Text } = Typography;

type Page = ReturnType<typeof useAuditPage>;

/** One entry in full: who, what, to what, from where, and exactly what changed. */
export function EntryDrawer({ page }: { page: Page }) {
  const { openEntry, set, entry } = page;
  return (
    <Drawer
      className="nx-ad-drawer"
      width={720}
      open={Boolean(openEntry)}
      onClose={() => set({ entry: null }, false)}
      title="Audit entry"
      destroyOnClose
    >
      {entry.isLoading && <Text type="secondary">Loading…</Text>}
      {entry.isError && (
        <Alert
          type="error"
          showIcon
          message={
            entry.error instanceof ApiError ? entry.error.message : "Could not load this entry"
          }
        />
      )}
      {entry.data && (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <EntryFacts data={entry.data} />
          <div>
            <Text strong>What changed</Text>
            <div style={{ marginTop: 8 }}>
              <AuditDiff changes={entry.data.changes} />
            </div>
          </div>
        </Space>
      )}
    </Drawer>
  );
}

function EntryFacts({ data }: { data: AuditEntry }) {
  return (
    <Descriptions size="small" column={1} bordered>
      <Descriptions.Item label="When">
        {absoluteTime(data.occurred_at)}
      </Descriptions.Item>
      <Descriptions.Item label="Actor">
        <Space size={6} wrap>
          <Text>{data.actor_label}</Text>
          {data.actor_role && <Tag>{data.actor_role}</Tag>}
          {data.impersonated && (
            <Tag icon={<UserSwitchOutlined />} color="purple">
              acting as this user:{" "}
              {data.impersonator_label || "an administrator"}
            </Tag>
          )}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="Action">
        <Space size={6}>
          <Tag color={actionColor(data.action)}>
            {humaniseAction(data.action)}
          </Tag>
          {resultColor(data.result) ? (
            <Tag color={resultColor(data.result)}>{data.result}</Tag>
          ) : (
            <Text type="secondary">{data.result}</Text>
          )}
        </Space>
      </Descriptions.Item>
      <Descriptions.Item label="Resource">
        <Space size={6} wrap>
          <Text>{data.resource_label || "—"}</Text>
          <Tag>{data.resource_type}</Tag>
          {data.resource_id && (
            <Text type="secondary" copyable={{ text: data.resource_id }}>
              {data.resource_id}
            </Text>
          )}
        </Space>
      </Descriptions.Item>
      {data.message && (
        <Descriptions.Item label="Message">{data.message}</Descriptions.Item>
      )}
      <Descriptions.Item label="Request">
        <Space size={12} wrap>
          {data.ip_address && <Text>{data.ip_address}</Text>}
          {data.correlation_id && (
            <Text type="secondary" copyable={{ text: data.correlation_id }}>
              {data.correlation_id}
            </Text>
          )}
        </Space>
      </Descriptions.Item>
      {data.user_agent && (
        <Descriptions.Item label="Agent">
          <Text type="secondary">{data.user_agent}</Text>
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}
