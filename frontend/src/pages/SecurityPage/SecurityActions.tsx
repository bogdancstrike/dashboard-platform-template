import { Button, Popconfirm, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";

import { formatNumber } from "@/lib/formats";

import type { useSecurityPage } from "./useSecurityPage";

/** Refresh, and sign out every other device. */
export function SecurityActions({ page }: { page: ReturnType<typeof useSecurityPage> }) {
  const { sessions, sweptOthers, refresh } = page;
  return (
    <Space>
      <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
        Refresh
      </Button>
      <Popconfirm
        title="Sign out every other device?"
        description="Every other session is signed out on its next request. This one stays, so you can see the result."
        okText="Sign the others out"
        cancelText="Leave them"
        onConfirm={() => sweptOthers.mutate()}
      >
        <Button
          danger
          data-testid="revoke-others"
          loading={sweptOthers.isPending}
          disabled={!sessions.data?.others}
        >
          {sessions.data?.others
            ? `Sign out ${formatNumber(sessions.data.others)} other ${
                sessions.data.others === 1 ? "device" : "devices"
              }`
            : "Nowhere else signed in"}
        </Button>
      </Popconfirm>
    </Space>
  );
}
