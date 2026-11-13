import { Button, Popconfirm, Space, Tooltip } from "antd";
import { DeleteOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";

import type { useLogsPage } from "./useLogsPage";

/** Live/pause, refresh, and applying the retention policy. */
export function LogActions({ page, retention }: { page: ReturnType<typeof useLogsPage>; retention: number | null }) {
  const { tail, tailOn, listing, canPrune, prune } = page;
  const { live, setLive } = tail;
  return (
    <Space size={8}>
      <Tooltip
        title={
          live
            ? "Stop asking for new lines. Resuming carries on from here."
            : "Ask for new lines every few seconds."
        }
      >
        <Button
          icon={live ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          type={live ? "primary" : "default"}
          onClick={() => setLive((current) => !current)}
          data-testid="toggle-live"
          hidden={!tailOn}
        >
          {live ? "Pause" : "Live"}
        </Button>
      </Tooltip>
      {!live && (
        <Tooltip title="Read it again">
          <Button
            icon={<ReloadOutlined />}
            aria-label="Refresh the log"
            loading={listing.isFetching}
            onClick={() => void listing.refetch()}
          />
        </Tooltip>
      )}
      {/* Absent rather than disabled for a reader who may not enact the
          policy — the button belongs to whoever owns the bound (§76). */}
      {canPrune && retention !== null && (
        <Popconfirm
          title={`Remove lines older than ${retention} days?`}
          description="The bound is the retention setting, not a choice made here."
          okText="Apply the policy"
          onConfirm={() => prune.mutate()}
        >
          <Button
            icon={<DeleteOutlined />}
            loading={prune.isPending}
            data-testid="prune-logs"
          >
            Apply retention
          </Button>
        </Popconfirm>
      )}
    </Space>
  );
}
