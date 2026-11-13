import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { automationsApi } from "@/api/automations";
import { workflowGraphApi } from "@/api/workflowGraph";
import { usePageCommands } from "@/commands/CommandContext";
import { starterGraph } from "@/components/workflows/graph";
import { applyParamChanges } from "@/hooks/useUrlState";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { FEATURES, useFeature } from "@/settings/features";

const PLACES = new Set(["rule"]);

/** The automations, the open one in the address, and switching, rehearsing, withdrawing and building one. */
export function useWorkflowsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const state = params.get("state") ?? "";
  const open = params.get("rule");

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      // Where the reader *is* ("rule") is a place back returns to, so it
      // is pushed; everything else is an adjustment and replaces.
      { replace: !Object.entries(changes).some(([key, value]) => PLACES.has(key) && value) },
    );

  const catalogue = useQuery({
    queryKey: queryKeys.automationCatalogue(),
    queryFn: ({ signal }) => automationsApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const rules = useQuery({
    queryKey: queryKeys.automations(state),
    queryFn: ({ signal }) => automationsApi.list({ state }, signal),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.automations() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.automation(open) });
  };

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      automationsApi.update(id, { enabled }),
    onSuccess: (rule) => {
      message.success(rule.enabled ? `${rule.name} is live` : `${rule.name} is paused`);
      refresh();
    },
    onError: apiMessageToast(message, "That change was refused."),
  });

  const rehearse = useMutation({
    mutationFn: (id: string) => automationsApi.run(id, true),
    onSuccess: (run) =>
      message.info(
        run.error
          ? "That automation could not be evaluated — open it to see why."
          : `${run.matched} matched, ${run.fired} would fire, ${run.suppressed} held back.`,
      ),
    onError: apiMessageToast(message, "That run was refused."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => automationsApi.remove(id),
    onSuccess: () => {
      message.success("Automation withdrawn");
      refresh();
    },
    onError: apiMessageToast(message, "That could not be withdrawn."),
  });

  // The canvas starts from a working two-step workflow, created paused, so
  // there is a definition to save drafts against from the first drag.
  const build = useMutation({
    mutationFn: () => workflowGraphApi.create("Untitled workflow", starterGraph()),
    onSuccess: (rule) => {
      refresh();
      navigate(`/workflows/${rule.id}/canvas`);
    },
    onError: apiMessageToast(message, "The canvas could not be opened."),
  });

  const canvasOn = useFeature(FEATURES.workflowCanvas);
  usePageCommands("workflows", [
    ...(canvasOn
      ? [{
          id: "workflows.canvas",
          label: "Build a workflow on the canvas",
          keywords: "visual node graph flow builder branch",
          run: () => build.mutate(),
        }]
      : []),
    {
      id: "workflows.new",
      label: "Write an automation",
      keywords: "rule alert automation trigger notify",
      run: () => setCreating(true),
    },
    {
      id: "workflows.paused",
      label: "Show automations that are paused",
      keywords: "off disabled stopped",
      run: () => set({ state: "PAUSED" }),
    },
  ]);

  return { state, open, set, creating, setCreating, catalogue, rules, refresh, toggle, rehearse, remove, build, canvasOn, navigate, modal };
}
