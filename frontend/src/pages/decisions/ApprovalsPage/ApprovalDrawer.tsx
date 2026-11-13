import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Drawer, Input, Popconfirm, Skeleton, Space } from "antd";

import { approvalsApi } from "@/api/approvals";
import { URL_OVERLAY } from "@/app/history";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { DetailBody } from "./DetailBody";

/** The open request, from the address; its footer decides or withdraws it. */
export function ApprovalDrawer() {
  const overlay = useUrlOverlay("open");
  const { message } = App.useApp();
  const client = useQueryClient();
  const [comment, setComment] = useState("");
  const detail = useQuery({
    queryKey: queryKeys.approvals("item", overlay.value),
    queryFn: ({ signal }) => approvalsApi.get(overlay.value!, signal),
    enabled: Boolean(overlay.value),
  });
  useEffect(() => setComment(""), [overlay.value]);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => approvalsApi.decide(overlay.value!, decision, comment.trim()),
    onSuccess: (row) => {
      client.setQueryData(queryKeys.approvals("item", overlay.value), row);
      void client.invalidateQueries({ queryKey: queryKeys.approvals("list") });
      void client.invalidateQueries({ queryKey: queryKeys.notifications("counts") });
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success(`${row.reference} ${row.status.toLowerCase()}`);
    },
    onError: errorToast(message, { action: "decide this" }),
  });
  const withdraw = useMutation({
    mutationFn: () => approvalsApi.withdraw(overlay.value!),
    onSuccess: (row) => {
      client.setQueryData(queryKeys.approvals("item", overlay.value), row);
      void client.invalidateQueries({ queryKey: queryKeys.approvals("list") });
      void client.invalidateQueries({ queryKey: queryKeys.time() });
      message.success("Request withdrawn");
    },
    onError: errorToast(message, { action: "withdraw this" }),
  });
  const item = detail.data;

  return (
    <Drawer
      open={Boolean(overlay.value)}
      onClose={overlay.close}
      width={520}
      rootClassName={URL_OVERLAY}
      title={item ? item.reference : "Request"}
      destroyOnHidden
      data-testid="approval-drawer"
      footer={item?.can_decide ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comment for the requester (required to reject)"
            aria-label="Decision comment"
          />
          <Space wrap>
            <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("approve")} data-testid="approval-approve">
              Approve
            </Button>
            <Button
              danger
              disabled={!comment.trim()}
              loading={decide.isPending}
              onClick={() => decide.mutate("reject")}
              data-testid="approval-reject"
            >
              Reject
            </Button>
          </Space>
        </Space>
      ) : item?.can_withdraw ? (
        <Popconfirm title="Withdraw this request?" onConfirm={() => withdraw.mutate()}>
          <Button danger>Withdraw request</Button>
        </Popconfirm>
      ) : null}
    >
      {detail.isLoading || !item ? <Skeleton active /> : <DetailBody item={item} />}
    </Drawer>
  );
}
