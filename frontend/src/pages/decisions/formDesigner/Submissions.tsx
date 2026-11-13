import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Pagination, Skeleton } from "antd";
import { Link } from "react-router-dom";

import { formsApi, type Submission } from "@/api/forms";
import { TdIcon } from "@/components/icons/TdIcon";
import { NxIcon } from "@/components/NxIcon";
import { errorText, errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";

const TONE = { CONVERTED: "nx-td-pilltag nx-td-pilltag--ok", FAILED: "nx-td-pilltag nx-td-pilltag--bad", SPAM: "nx-td-pilltag" } as const;

/** What came in through the form, by outcome, with a retry for the ones that failed. */
export function Submissions({ formId }: { formId: string }) {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: queryKeys.forms("submissions", formId, status, page),
    queryFn: ({ signal }) => formsApi.submissions(formId, { status, page }, signal),
  });
  const retry = useMutation({
    mutationFn: (submissionId: string) => formsApi.retry(formId, submissionId),
    onSuccess: (item) => { void client.invalidateQueries({ queryKey: queryKeys.forms() }); message.success(item.status === "CONVERTED" ? "It became a record" : "Still failing — see why"); },
    onError: errorToast(message, { action: "retry this submission" }),
  });
  if (list.isLoading) return <Skeleton active />;
  if (list.isError || !list.data) return <Alert type="error" showIcon message={errorText(list.error)} />;
  const data = list.data;
  return (
    <>
      <div className="nx-td-chips">
        {["", "CONVERTED", "FAILED", "SPAM"].map((key) => (
          <button key={key || "all"} type="button" className={`nx-td-chip${status === key ? " is-on" : ""}`} onClick={() => { setStatus(key); setPage(1); }}>
            {key ? key.toLowerCase() : "All"} <b>{key ? data.counts[key] ?? 0 : Object.values(data.counts).reduce((a, b) => a + b, 0)}</b>
          </button>
        ))}
      </div>
      {data.items.length === 0 ? <div className="nx-td-empty">No submissions.</div> : (
        <div className="nx-td-list" data-testid="form-submissions">
          {data.items.map((item) => (
            <SubmissionRow
              key={item.id}
              item={item}
              open={open === item.id}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              retrying={retry.isPending}
              onRetry={() => retry.mutate(item.id)}
            />
          ))}
        </div>
      )}
      {data.total > data.page_size && <Pagination current={page} pageSize={data.page_size} total={data.total} onChange={setPage} showSizeChanger={false} align="end" />}
    </>
  );
}

interface SubmissionRowProps {
  item: Submission;
  open: boolean;
  onToggle: () => void;
  retrying: boolean;
  onRetry: () => void;
}

function SubmissionRow({ item, open, onToggle, retrying, onRetry }: SubmissionRowProps) {
  return (
    <div className="nx-td-row nx-td-row--nocheck">
      <span className="nx-td-row-icon"><NxIcon name="inbox" /></span>
      <div className="nx-td-row-main">
        <button type="button" className="nx-td-row-title" onClick={onToggle}>
          {item.reference} · {asText(item.answers.find((a) => a.label)?.value) || (item.submitter_email ?? "")}
        </button>
        <div className="nx-td-row-meta">
          <span title={absoluteTime(item.created_at)}>{relativeTime(item.created_at)}</span>
          {item.submitter_email && <span>{item.submitter_email}</span>}
          {item.error && <span style={{ color: "var(--nu-bad)" }}>{item.error}</span>}
        </div>
        {open && (
          <dl className="nx-td-facts" style={{ marginTop: 8 }}>
            {item.answers.map((answer) => (
              <Fragment key={answer.id}><dt>{answer.label}</dt><dd>{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value)}</dd></Fragment>
            ))}
          </dl>
        )}
      </div>
      <div className="nx-td-row-side">
        <span className={TONE[item.status]}>{item.status.toLowerCase()}</span>
        {item.record_path && <Link to={item.record_path}><Button icon={<TdIcon name="link" />}>{item.record_label || "Record"}</Button></Link>}
        {item.status === "FAILED" && <Button loading={retrying} onClick={onRetry}>Try again</Button>}
      </div>
    </div>
  );
}
