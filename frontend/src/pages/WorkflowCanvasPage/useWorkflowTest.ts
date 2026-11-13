import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { workflowGraphApi, type TraceResult } from "@/api/workflowGraph";
import { apiMessageToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** Test mode: a sample record to search for, and the dry run that walks it through the draft. */
export function useWorkflowTest(ruleId: string, enabled: boolean, flush: () => Promise<void>, onTrace: (trace: TraceResult) => void) {
  const { message } = AntApp.useApp();
  const [sample, setSample] = useState<string | undefined>();
  const [sampleSearch, setSampleSearch] = useState("");
  const samples = useQuery({
    queryKey: queryKeys.workflowSamples(ruleId, sampleSearch),
    queryFn: ({ signal }) => workflowGraphApi.samples(ruleId, sampleSearch, signal),
    enabled,
  });
  const test = useMutation({
    mutationFn: async (recordId: string) => {
      await flush();
      return workflowGraphApi.test(ruleId, recordId);
    },
    onSuccess: onTrace,
    onError: apiMessageToast(message, "The test could not run."),
  });
  return { sample, setSample, setSampleSearch, samples, test };
}
