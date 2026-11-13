import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { automationsApi, type AutomationInput, type AutomationRun } from "@/api/automations";
import { explorerApi } from "@/api/explorer";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** One automation: the rule, its dataset's fields, the section shown, the latest run, and the writes. */
export function useAutomationDrawer(ruleId: string | null, onChanged: () => void, onClose: () => void) {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [tab, setTab] = useState("condition");
  const [latest, setLatest] = useState<AutomationRun | null>(null);

  const rule = useQuery({
    queryKey: queryKeys.automation(ruleId),
    queryFn: ({ signal }) => automationsApi.get(ruleId!, signal),
    enabled: Boolean(ruleId),
  });

  const detail = rule.data;
  const canEdit = detail?.can_edit ?? false;

  // The field catalogue for the dataset this rule watches — the same one the
  // advanced search builder is configured from, so the two editors offer
  // exactly the same fields and operators.
  const fields = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.minute,
  });
  const resource = fields.data?.items.find((item) => item.key === detail?.resource_type);

  // A fresh drawer starts on the condition, and a fresh rule starts with no
  // run on screen — a report left over from the previous rule would be read
  // as this one's.
  useEffect(() => {
    setTab("condition");
    setLatest(null);
  }, [ruleId]);

  const write = useMutation({
    mutationFn: (input: AutomationInput) => automationsApi.update(ruleId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.automation(ruleId), (current: typeof detail) =>
        current ? { ...current, ...updated } : current,
      );
      onChanged();
    },
    onError: apiMessageToast(message, "That change was refused."),
  });

  const evaluate = useMutation({
    mutationFn: (dryRun: boolean) => automationsApi.run(ruleId!, dryRun),
    onSuccess: (answer) => {
      setLatest(answer);
      setTab("runs");
      // Refetched either way: a rehearsal is recorded too, and the history
      // below the report would otherwise be missing the run above it. Only a
      // real one changes the *list* behind the drawer.
      void rule.refetch();
      if (!answer.dry_run) onChanged();
    },
    onError: apiMessageToast(message, "That run was refused."),
  });

  const remove = useMutation({
    mutationFn: () => automationsApi.remove(ruleId!),
    onSuccess: () => {
      message.success("Automation withdrawn");
      onChanged();
      onClose();
    },
    onError: apiMessageToast(message, "That could not be withdrawn."),
  });

  return { tab, setTab, latest, rule, detail, canEdit, resource, write, evaluate, remove };
}
