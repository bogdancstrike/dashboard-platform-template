import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";

import { integrationsApi } from "@/api/integrations";
import { usePageCommands } from "@/commands/CommandContext";
import { useListSearch } from "@/hooks/useListSearch";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The integrations, the open one, and switching, checking and configuring it. */
export function useIntegrationsPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const search = useListSearch();
  const { term, set } = search;
  const category = search.params.get("category") ?? "";
  const overlay = useUrlOverlay("integration");
  const opened = overlay.value;

  const catalogue = useQuery({
    queryKey: queryKeys.integrations("catalogue"),
    queryFn: ({ signal }) => integrationsApi.catalogue(signal),
    staleTime: STALE.short,
  });

  const listing = useQuery({
    queryKey: queryKeys.integrations("list", term, category),
    queryFn: ({ signal }) =>
      integrationsApi.list(
        { ...(term ? { q: term } : {}), ...(category ? { category } : {}), page_size: 100 },
        signal,
      ),
  });

  const detail = useQuery({
    queryKey: queryKeys.integrations("entry", opened),
    queryFn: ({ signal }) => integrationsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.integrations() });
  };
  const failed = apiMessageToast(message, "That was refused.");

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      integrationsApi.setEnabled(id, enabled),
    onSuccess: async (row) => {
      message.success(`${row.name} is ${row.enabled ? "on" : "off"}.`);
      await refresh();
    },
    // The server's sentence, which names the missing settings.
    onError: failed,
  });

  const check = useMutation({
    mutationFn: (id: string) => integrationsApi.check(id),
    onSuccess: async (result) => {
      // Both outcomes say what was established: "checked" alone tells nobody whether they can stop worrying.
      if (result.configured) {
        message.success(`${result.name}: every required setting is present.`);
      } else {
        message.warning(`${result.name}: ${result.missing_settings.join(", ")} still missing.`);
      }
      await refresh();
    },
    onError: failed,
  });

  const configure = useMutation({
    mutationFn: ({ id, configuration }: { id: string; configuration: Record<string, unknown> }) =>
      integrationsApi.configure(id, configuration),
    onSuccess: async (row) => {
      message.success(
        row.configured
          ? `${row.name} has everything it needs.`
          : `Saved. ${row.name} still needs ${row.missing_settings.join(", ")}.`,
      );
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-integrations", [
    {
      id: "integrations.attention",
      label: "Show the integrations that need attention",
      keywords: "integrations broken failing error connected",
      run: () => set({ category: null, q: null }),
    },
    { id: "integrations.recheck", label: "Check every integration now", keywords: "refresh probe recheck reachable connection test", run: () => void listing.refetch() },
    { id: "integrations.health", label: "See the platform's own dependencies", keywords: "health status database storage cache uptime", run: () => navigate("/admin/health") },
  ]);

  return { search, category, overlay, catalogue, listing, detail, toggle, check, configure };
}
