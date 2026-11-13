import { Alert, Button, Checkbox, Pagination, Skeleton } from "antd";

import type { ApprovalScope } from "@/api/approvals";
import { EmptyState } from "@/components/EmptyState";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { errorText } from "@/lib/errors";

import { ApprovalRow } from "./ApprovalRow";
import { QueueFilters } from "./QueueFilters";
import { useApprovalQueue, type SetParams } from "./useApprovalQueue";

type QueueState = ReturnType<typeof useApprovalQueue>;

/** One scope of the inbox: filters, the requests, and the bulk bar once some are selected. */
export function Queue({ scope, params, set }: { scope: ApprovalScope; params: URLSearchParams; set: SetParams }) {
  const queue = useApprovalQueue(scope, params, set);
  const { selected } = queue;
  return (
    <>
      <QueueFilters queue={queue} set={set} />
      <QueueList scope={scope} queue={queue} />
      {selected.length > 0 && <BulkBar queue={queue} />}
    </>
  );
}

function QueueList({ scope, queue }: { scope: ApprovalScope; queue: QueueState }) {
  const overlay = useUrlOverlay("open");
  const { list, page, setPage, selected, setSelected } = queue;
  const data = list.data;
  const decidable = (data?.items ?? []).filter((item) => item.can_decide);
  if (list.isLoading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (list.isError || !data) {
    return <Alert type="error" showIcon message={errorText(list.error, { fallback: "The inbox could not be read." })} />;
  }
  if (data.items.length === 0) {
    return (
      <div className="nx-td-empty">
        <EmptyState title={scope === "inbox" ? "Nothing is waiting on you. Inbox zero." : "No requests match."} />
      </div>
    );
  }
  return (
    <>
      {scope === "inbox" && decidable.length > 0 && (
        <Checkbox
          checked={selected.length > 0 && selected.length === decidable.length}
          indeterminate={selected.length > 0 && selected.length < decidable.length}
          onChange={(event) => setSelected(event.target.checked ? decidable.map((item) => item.id) : [])}
        >
          Select all on this page
        </Checkbox>
      )}
      <div className="nx-td-list" data-testid="approvals-list">
        {data.items.map((item) => (
          <ApprovalRow key={item.id} item={item} scope={scope} queue={queue} onOpen={overlay.open} />
        ))}
      </div>
      {data.total > data.page_size && (
        <Pagination current={page} pageSize={data.page_size} total={data.total} onChange={setPage} showSizeChanger={false} align="end" />
      )}
    </>
  );
}

function BulkBar({ queue }: { queue: QueueState }) {
  const { selected, setSelected, bulk, ask } = queue;
  return (
    <div className="nx-td-bulk" data-testid="approvals-bulk">
      <b className="nx-td-grow">{selected.length} selected</b>
      <Button onClick={() => setSelected([])}>Clear</Button>
      <Button onClick={() => ask("reject", (comment) => bulk.mutate({ decision: "reject", comment }), selected.length)}>
        Reject
      </Button>
      <Button
        type="primary"
        loading={bulk.isPending}
        onClick={() => ask("approve", (comment) => bulk.mutate({ decision: "approve", comment }), selected.length)}
        data-testid="approvals-bulk-approve"
      >
        Approve {selected.length}
      </Button>
    </div>
  );
}
