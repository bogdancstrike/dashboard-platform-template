import { Button, Dropdown, Popconfirm, Tooltip } from "antd";
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  LockOutlined,
  PushpinFilled,
  PushpinOutlined,
} from "@ant-design/icons";

import type { SavedInsight } from "@/api/insights";
import { KnIcon } from "@/components/icons/KnIcon";
import { FEATURES, useFeature } from "@/settings/features";

export function SavedActions({
  insight,
  refreshing,
  canShare,
  onRefresh,
  onPin,
  onScope,
  onRename,
  onDashboard,
  onRemove,
}: {
  insight: SavedInsight;
  refreshing: boolean;
  canShare: boolean;
  onRefresh: () => void;
  onPin: (pinned: boolean) => void;
  onScope: (scope: "PRIVATE" | "PUBLIC") => void;
  onRename: () => void;
  onDashboard: () => void;
  onRemove: () => void;
}) {
  const dashboardsOn = useFeature(FEATURES.dashboardBuilder);
  return (
    <>
      <Tooltip title="Re-run its queries for today's numbers — the AI is not asked again">
        <Button
          icon={<KnIcon name="refresh" />}
          loading={refreshing}
          onClick={onRefresh}
          data-testid="insight-refresh"
        >
          Refresh
        </Button>
      </Tooltip>
      {dashboardsOn && (
        <Button
          icon={<AppstoreAddOutlined />}
          onClick={onDashboard}
          data-testid="insight-dashboard"
        >
          Add to dashboard
        </Button>
      )}
      {insight.can_edit && (
        <>
          <Tooltip title={insight.pinned ? "Unpin" : "Pin to the top"}>
            <Button
              shape="circle"
              aria-label={insight.pinned ? "Unpin" : "Pin"}
              icon={insight.pinned ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => onPin(!insight.pinned)}
              data-testid="insight-pin"
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "rename", label: "Rename", icon: <EditOutlined /> },
                ...(canShare
                  ? [
                      insight.scope === "PUBLIC"
                        ? { key: "private", label: "Make private", icon: <LockOutlined /> }
                        : { key: "public", label: "Share with everyone", icon: <GlobalOutlined /> },
                    ]
                  : []),
              ],
              onClick: ({ key }) => {
                if (key === "rename") onRename();
                if (key === "public") onScope("PUBLIC");
                if (key === "private") onScope("PRIVATE");
              },
            }}
          >
            <Button shape="circle" aria-label="More" data-testid="insight-more">
              ⋯
            </Button>
          </Dropdown>
          <Popconfirm title="Remove this insight?" okText="Remove" onConfirm={onRemove}>
            <Button shape="circle" danger aria-label="Remove insight" icon={<DeleteOutlined />} />
          </Popconfirm>
        </>
      )}
    </>
  );
}
