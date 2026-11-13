import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { approvalsApi, type ApprovalScope } from "@/api/approvals";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { errorToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { askDecision } from "./askDecision";

export type SetParams = (next: Record<string, string | null>, replace?: boolean) => void;

/** One scope of the queue: its filters, page, selection, and the decisions made from the list. */
export function useApprovalQueue(scope: ApprovalScope, params: URLSearchParams, set: SetParams) {
  const { message, modal } = App.useApp();
  const client = useQueryClient();
  const [box, setBox] = useState(params.get("q") ?? "");
  const q = useDebouncedValue(box, 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const kind = params.get("kind") ?? "";
  const requester = params.get("requester") ?? "";
  const ageFilter = params.get("age") ?? "";

  useEffect(() => {
    if ((params.get("q") ?? "") !== q) set({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { setPage(1); setSelected([]); }, [scope, kind, requester, ageFilter, q]);

  const query = { scope, kind, requester_id: requester, age: ageFilter, q, page, page_size: 20 };
  const list = useQuery({
    queryKey: queryKeys.approvals("list", query),
    queryFn: ({ signal }) => approvalsApi.list(query, signal),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.approvals() });
    void client.invalidateQueries({ queryKey: queryKeys.notifications("counts") });
    void client.invalidateQueries({ queryKey: queryKeys.time() });
  };

  const bulk = useMutation({
    mutationFn: ({ decision, comment }: { decision: "approve" | "reject"; comment: string }) =>
      approvalsApi.bulk(selected, decision, comment),
    onSuccess: (result) => {
      refresh();
      setSelected([]);
      if (result.failed) {
        message.warning(`${result.decided} decided, ${result.failed} could not be: ${result.results.find((r) => !r.ok)?.error ?? ""}`);
      } else {
        message.success(`${result.decided} decided`);
      }
    },
    onError: errorToast(message, { action: "decide these" }),
  });

  const quick = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment: string }) =>
      approvalsApi.decide(id, decision, comment),
    onSuccess: (row) => { refresh(); message.success(`${row.reference} ${row.status.toLowerCase()}`); },
    onError: errorToast(message, { action: "decide this" }),
  });

  const ask = (decision: "approve" | "reject", run: (comment: string) => void, count = 1) =>
    askDecision(modal, decision, run, count);

  usePageCommands("approvals", selected.length ? [
    { id: "approvals.bulk-approve", label: `Approve ${selected.length} selected`, run: () => ask("approve", (comment) => bulk.mutate({ decision: "approve", comment }), selected.length) },
  ] : []);

  return { box, setBox, page, setPage, selected, setSelected, kind, requester, ageFilter, list, bulk, quick, ask };
}
