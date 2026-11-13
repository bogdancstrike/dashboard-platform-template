import "@/styles/decisions.css";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { approvalsApi, type ApprovalScope } from "@/api/approvals";
import { PageHeader } from "@/components/PageHeader";
import { queryKeys } from "@/lib/queryKeys";

import { ApprovalDrawer } from "./ApprovalDrawer";
import { Queue } from "./Queue";
import { RulesView } from "./RulesView";
import { SCOPES } from "./approvalKinds";

/**
 * One queue for every "needs a decision" item: timesheets, access requests,
 * edits a rule held back, reports somebody wants to publish. The scope is a
 * place (pushed), the filters are filters (replaced), and the open request is
 * a URL overlay so back closes it.
 */
export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as ApprovalScope | "rules" | null) ?? "inbox";
  const set = (next: Record<string, string | null>, replace = true) => {
    const copy = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) copy.delete(key);
      else copy.set(key, value);
    }
    setParams(copy, { replace });
  };

  const counts = useQuery({
    queryKey: queryKeys.approvals("list", { scope: "inbox", page_size: 1 }),
    queryFn: ({ signal }) => approvalsApi.list({ scope: "inbox", page_size: 1 }, signal),
  });

  return (
    <div className="nx-td" data-testid="approvals-page">
      <PageHeader
        title={<>Approvals <em>inbox</em></>}
        subtitle={
          counts.data
            ? `${counts.data.counts.inbox} waiting on you · ${counts.data.counts.overdue} overdue · ${counts.data.counts.mine_pending} of yours pending`
            : "Everything that needs a decision, in one place."
        }
      />
      <div className="nx-td-chips" role="tablist" aria-label="Approval views">
        {SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={scope === item.key}
            className={`nx-td-chip${scope === item.key ? " is-on" : ""}`}
            onClick={() => set({ scope: item.key === "inbox" ? null : item.key, kind: null, requester: null, age: null, q: null }, false)}
            data-testid={`approvals-scope-${item.key}`}
          >
            {item.label}
            {item.key === "inbox" && counts.data ? <b>{counts.data.counts.inbox}</b> : null}
            {item.key === "mine" && counts.data ? <b>{counts.data.counts.mine_pending}</b> : null}
          </button>
        ))}
      </div>
      {scope === "rules" ? <RulesView /> : <Queue scope={scope} params={params} set={set} />}
      <ApprovalDrawer />
    </div>
  );
}
