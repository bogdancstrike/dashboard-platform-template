import { Button, Checkbox } from "antd";

import type { Approval, ApprovalScope } from "@/api/approvals";
import { absoluteTime, relativeTime } from "@/lib/time";

import { KindIcon, Standing } from "./approvalKinds";
import type { useApprovalQueue } from "./useApprovalQueue";

interface ApprovalRowProps {
  item: Approval;
  scope: ApprovalScope;
  queue: ReturnType<typeof useApprovalQueue>;
  onOpen: (id: string) => void;
}

/** One request in the queue, with its quick approve and reject. */
export function ApprovalRow({ item, scope, queue, onOpen }: ApprovalRowProps) {
  const { selected, setSelected, quick, ask } = queue;
  return (
    <div
      className={`nx-td-row${scope === "inbox" ? "" : " nx-td-row--nocheck"}${selected.includes(item.id) ? " is-selected" : ""}`}
      data-testid="approval-row"
    >
      {scope === "inbox" && (
        <Checkbox
          aria-label={`Select ${item.reference}`}
          disabled={!item.can_decide}
          checked={selected.includes(item.id)}
          onChange={(event) =>
            setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))
          }
        />
      )}
      <span className="nx-td-row-icon"><KindIcon icon={item.icon} /></span>
      <div className="nx-td-row-main">
        <button type="button" className="nx-td-row-title" onClick={() => onOpen(item.id)}>
          {item.title}
        </button>
        <div className="nx-td-row-meta">
          <span className="nx-td-mono">{item.reference}</span>
          <span>{item.kind_label}</span>
          {item.requester && <span>by {item.requester.name}</span>}
          <span title={absoluteTime(item.created_at)}>{relativeTime(item.created_at)}</span>
          {item.decided_by && <span>decided by {item.decided_by.name}</span>}
        </div>
      </div>
      <div className="nx-td-row-side">
        <Standing item={item} />
        {item.can_decide && (
          <>
            <Button
              type="primary"
              onClick={() => quick.mutate({ id: item.id, decision: "approve", comment: "" })}
              data-testid="approval-quick-approve"
            >
              Approve
            </Button>
            <Button onClick={() => ask("reject", (comment) => quick.mutate({ id: item.id, decision: "reject", comment }))}>
              Reject
            </Button>
          </>
        )}
        {!item.can_decide && <Button onClick={() => onOpen(item.id)}>Open</Button>}
      </div>
    </div>
  );
}
