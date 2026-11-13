import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useSearchParams } from "react-router-dom";

import { slaApi, type BusinessCalendar, type SlaPolicy } from "@/api/sla";
import { usePageCommands } from "@/commands/CommandContext";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { errorToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The policies and calendars, the open policy, and applying, reordering and toggling. */
export function useSlaPage() {
  const { message } = App.useApp();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "calendars" ? "calendars" : "policies";
  const policyOverlay = useUrlOverlay("policy");
  const [calendar, setCalendar] = useState<Partial<BusinessCalendar> | null>(null);

  const overview = useQuery({ queryKey: queryKeys.sla("overview"), queryFn: ({ signal }) => slaApi.overview(signal) });
  const catalogue = useQuery({ queryKey: queryKeys.sla("catalogue"), queryFn: ({ signal }) => slaApi.catalogue(signal), staleTime: STALE.long });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.sla() });
    void client.invalidateQueries({ queryKey: queryKeys.record() });
  };
  const apply = useMutation({
    mutationFn: slaApi.apply,
    onSuccess: (result) => { refresh(); message.success(`${result.tickets} tickets recomputed, ${result.escalations.fired} escalations fired`); },
    onError: errorToast(message, { action: "apply the policies" }),
  });
  const reorder = useMutation({
    mutationFn: slaApi.reorder,
    onSuccess: (next) => { client.setQueryData(queryKeys.sla("overview"), next); refresh(); },
    onError: errorToast(message, { action: "reorder policies" }),
  });
  const toggle = useMutation({
    mutationFn: (policy: SlaPolicy) => slaApi.update(policy.id, { active: !policy.active }),
    onSuccess: refresh,
    onError: errorToast(message, { action: "change this policy" }),
  });

  const canManage = Boolean(overview.data?.can_manage);
  usePageCommands("sla", canManage ? [
    { id: "sla.new", label: "New SLA policy", run: () => policyOverlay.open("new") },
    { id: "sla.apply", label: "Recompute ticket SLAs now", run: () => apply.mutate() },
  ] : []);

  const move = (index: number, delta: number) => {
    const ids = (overview.data?.items ?? []).map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved!);
    reorder.mutate(ids);
  };

  return { setParams, tab, policyOverlay, calendar, setCalendar, overview, catalogue, refresh, apply, toggle, canManage, move };
}
