import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { ApiError } from "@/api/client";
import { workflowGraphApi, type GraphDetail, type GraphProblem, type TraceResult, type WorkflowGraph } from "@/api/workflowGraph";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The workflow's draft: loaded once, then the canvas's own state is the truth.
 * Every edit is saved a moment later; publishing first saves whatever is
 * pending, and the server's answer refreshes only what it knows better — the
 * problems and the versions.
 */
export function useWorkflowDraft(ruleId: string) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [problems, setProblems] = useState<GraphProblem[]>([]);
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [pending, setPending] = useState(false);
  const edits = useRef(0);

  const detail = useQuery({
    queryKey: queryKeys.workflowGraph(ruleId),
    queryFn: ({ signal }) => workflowGraphApi.get(ruleId, signal),
    enabled: Boolean(ruleId),
  });

  // Load once: after that the canvas's own state is the truth, and a save's
  // answer only refreshes what the server knows better (problems, versions).
  useEffect(() => {
    if (detail.data && graph === null) {
      setGraph(detail.data.draft);
      setProblems(detail.data.problems);
    }
  }, [detail.data, graph]);

  const accept = useCallback((next: GraphDetail) => {
    queryClient.setQueryData(queryKeys.workflowGraph(ruleId), next);
    setProblems(next.problems);
  }, [queryClient, ruleId]);

  const save = useMutation({
    mutationFn: (next: WorkflowGraph) => workflowGraphApi.saveDraft(ruleId, next),
    onSuccess: (next) => { accept(next); setPending(false); },
    onError: (error) => {
      setPending(false);
      message.error(error instanceof ApiError ? error.message : "The draft could not be saved.");
    },
  });

  const debounced = useDebouncedValue(graph, 700);
  useEffect(() => {
    if (debounced && edits.current > 0 && detail.data?.can_edit) {
      edits.current = 0;
      save.mutate(debounced);
    }
    // `save` is stable enough; depending on it would re-save on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const change = (next: WorkflowGraph) => {
    edits.current += 1;
    setPending(true);
    setGraph(next);
    setTrace(null);
  };

  const publish = useMutation({
    mutationFn: async () => {
      if (graph && (edits.current > 0 || pending)) {
        edits.current = 0;
        accept(await workflowGraphApi.saveDraft(ruleId, graph));
        setPending(false);
      }
      return workflowGraphApi.publish(ruleId);
    },
    onSuccess: (next) => {
      accept(next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.automations() });
      message.success(`Published version ${next.version}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && Array.isArray(error.details.problems)) {
        setProblems(error.details.problems as GraphProblem[]);
      }
      message.error(error instanceof ApiError ? error.message : "That could not be published.");
    },
  });

  const discard = useMutation({
    mutationFn: () => workflowGraphApi.saveDraft(ruleId, null),
    onSuccess: (next) => { accept(next); setGraph(next.draft); edits.current = 0; message.info("Draft discarded"); },
  });

  const restore = useMutation({
    mutationFn: (version: number) => workflowGraphApi.restore(ruleId, version),
    onSuccess: (next) => { accept(next); setGraph(next.draft); edits.current = 0; message.success("Restored into the draft — publish to make it live."); },
  });

  /** Save anything not yet saved, so a test or a publish sees the canvas as drawn. */
  const flush = async () => {
    if (graph && edits.current > 0) {
      edits.current = 0;
      accept(await workflowGraphApi.saveDraft(ruleId, graph));
      setPending(false);
    }
  };

  return { graph, problems, trace, setTrace, pending, detail, save, change, publish, discard, restore, flush };
}
