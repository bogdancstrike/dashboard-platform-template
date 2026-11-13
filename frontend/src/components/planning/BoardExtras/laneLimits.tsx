import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, InputNumber, Modal, Space, Typography } from "antd";
import { useEffect, useState } from "react";

import { planningApi } from "@/api/planning";

import { STALE, queryKeys } from "@/lib/queryKeys";
import { apiMessageToast } from "@/lib/errors";

export function useLaneSettings() {
  return useQuery({ queryKey: queryKeys.taskLanes(), queryFn: ({ signal }) => planningApi.lanes(signal), staleTime: STALE.short });
}

/** Set the work-in-progress limit of every lane at once. */
export function WipLimitsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const lanes = useLaneSettings();
  const [limits, setLimits] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (open && lanes.data) setLimits(Object.fromEntries(lanes.data.items.map((item) => [item.status, item.wip_limit])));
  }, [open, lanes.data]);
  const save = useMutation({
    mutationFn: () => planningApi.setLanes(limits),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.taskLanes(), saved);
      message.success("Lane limits saved");
      onClose();
    },
    onError: apiMessageToast(message, "Those limits could not be saved."),
  });
  return (
    <Modal open={open} title="Work-in-progress limits" okText="Save" confirmLoading={save.isPending} onCancel={onClose} onOk={() => save.mutate()}>
      <Typography.Paragraph type="secondary">
        A limit warns and never refuses: a lane over its limit turns red, and the drop still lands.
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }}>
        {(lanes.data?.items ?? []).map((lane) => (
          <Space key={lane.status} style={{ width: "100%", justifyContent: "space-between" }}>
            <span>
              {lane.status.replace(/_/g, " ").toLowerCase()} <Typography.Text type="secondary">· {lane.count} now</Typography.Text>
            </span>
            <InputNumber
              aria-label={`Limit for ${lane.status}`}
              min={1}
              max={999}
              placeholder="No limit"
              value={limits[lane.status] ?? null}
              onChange={(value) => setLimits((current) => ({ ...current, [lane.status]: value ?? null }))}
            />
          </Space>
        ))}
      </Space>
    </Modal>
  );
}
