import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useSearchParams } from "react-router-dom";

import { metaApi } from "@/api/meta";
import { settingsApi, type FeatureFlag } from "@/api/settings";
import { usePageCommands } from "@/commands/CommandContext";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { applyParamChanges } from "@/hooks/useUrlState";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { blastRadius } from "./flagReach";

/** The flags, the filters and preview in the address, and the writes on a flag. */
export function useFlagsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<FeatureFlag | null>(null);
  const drawer = useUrlOverlay("flag");

  const state = params.get("state") ?? "";
  const term = params.get("q") ?? "";
  const previewRole = params.get("as") ?? "";
  const [search, setSearch] = useState(term);
  useEffect(() => setSearch(term), [term]);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      { replace: true },
    );

  const flags = useQuery({
    queryKey: queryKeys.adminFlags(state),
    queryFn: ({ signal }) => settingsApi.flags(state && state !== "PARTIAL" ? { state } : {}, signal),
  });
  const roles = useQuery({ queryKey: queryKeys.metaRoles(), queryFn: ({ signal }) => metaApi.roles(signal), staleTime: STALE.long });
  const preview = useQuery({
    queryKey: queryKeys.adminFlags("preview", previewRole),
    queryFn: ({ signal }) => settingsApi.flagPreview({ role: previewRole }, signal),
    enabled: Boolean(previewRole),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminFlags() });
    // And the profile, which carries the features that are on for this
    // reader — the menu and the pages follow at once.
    void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
  };

  const write = useMutation({
    mutationFn: ({ key, body }: { key: string; body: Record<string, unknown> }) =>
      settingsApi.updateFlag(key, body),
    onSuccess: (flag) => {
      message.success(`${flag.name} is ${flag.enabled ? "on" : "off"}`);
      refresh();
    },
    onError: apiMessageToast(message, "That change was refused."),
  });

  const remove = useMutation({
    mutationFn: (key: string) => settingsApi.removeFlag(key),
    onSuccess: (answer) => {
      message.success(`${answer.key} is gone`);
      refresh();
    },
    onError: apiMessageToast(message, "That flag could not be removed."),
  });

  usePageCommands("admin-flags", [
    { id: "flags.new", label: "Add a feature flag", keywords: "flag feature rollout toggle", run: () => setCreating(true) },
    { id: "flags.on", label: "Show the flags that are on", keywords: "flag enabled live", run: () => set({ state: "ON" }) },
    { id: "flags.off", label: "Show the flags that are off", keywords: "flag disabled hidden switched off", run: () => set({ state: "OFF" }) },
    { id: "flags.partial", label: "Show the flags mid-rollout", keywords: "flag rollout percentage partial gradual some", run: () => set({ state: "PARTIAL" }) },
    { id: "flags.all", label: "Show every flag", keywords: "flag all clear filter everything", run: () => set({ state: null, q: null }) },
  ]);

  const names = useMemo(
    () => Object.fromEntries((flags.data?.items ?? []).map((flag) => [flag.key, flag.name])),
    [flags.data],
  );

  /** A switch flipped. Off, for a flag that gates something, is confirmed first. */
  const toggle = (row: FeatureFlag, next: boolean) => {
    if (!next && blastRadius(row.controls).length > 0) {
      setConfirming(row);
      return;
    }
    write.mutate({ key: row.key, body: { enabled: next } });
  };

  return {
    state, term, previewRole, search, setSearch, set, drawer, creating, setCreating, confirming, setConfirming,
    flags, roles, preview, refresh, write, remove, names, toggle,
  };
}
