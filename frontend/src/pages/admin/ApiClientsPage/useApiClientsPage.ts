import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { apiClientsApi, type Minted } from "@/api/apiClients";
import { usePageCommands } from "@/commands/CommandContext";
import { useListSearch } from "@/hooks/useListSearch";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The clients, the open one, and the key operations on it. */
export function useApiClientsPage() {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const search = useListSearch();
  const { term, set } = search;
  const overlay = useUrlOverlay("client");
  const opened = overlay.value;
  const [creating, setCreating] = useState(false);
  // The one piece of state that must not be lost: a minted secret exists
  // nowhere else.
  const [minted, setMinted] = useState<(Minted & { about: string }) | null>(null);

  const catalogue = useQuery({
    queryKey: queryKeys.apiClients("catalogue"),
    queryFn: ({ signal }) => apiClientsApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const listing = useQuery({
    queryKey: queryKeys.apiClients("list", term),
    queryFn: ({ signal }) =>
      apiClientsApi.list({ ...(term ? { q: term } : {}), page_size: 100 }, signal),
  });

  const detail = useQuery({
    queryKey: queryKeys.apiClients("entry", opened),
    queryFn: ({ signal }) => apiClientsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.apiClients() });
  };
  const failed = apiMessageToast(message, "That was refused.");

  const rotate = useMutation({
    mutationFn: ({ id, credentialId }: { id: string; credentialId?: string }) =>
      apiClientsApi.rotate(id, credentialId ? { credential_id: credentialId } : {}),
    onSuccess: async (result) => {
      setMinted({ ...result, about: detail.data?.name ?? "this client" });
      await refresh();
    },
    onError: failed,
  });

  const revoke = useMutation({
    mutationFn: (credentialId: string) => apiClientsApi.revoke(credentialId),
    onSuccess: async (credential) => {
      message.success(`${credential.prefix}… is revoked. Anything using it will fail now.`);
      await refresh();
    },
    onError: failed,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClientsApi.remove(id),
    onSuccess: async (result) => {
      message.success(
        result.credentials_revoked > 0
          ? `${result.name} retired, and ${result.credentials_revoked} live ${result.credentials_revoked === 1 ? "key" : "keys"} revoked.`
          : `${result.name} retired.`,
      );
      overlay.close();
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-api", [
    { id: "api.new", label: "Register an API client", keywords: "api client credential key token scope", run: () => setCreating(true) },
    {
      id: "api.live",
      label: "Show the clients with a live key",
      keywords: "api clients active live key enabled working",
      run: () => set({ status: "ACTIVE" }),
    },
    { id: "api.all", label: "Show every client", keywords: "api clients all clear filter retired", run: () => set({ status: null, q: null }) },
    { id: "api.refresh", label: "Check the traffic again", keywords: "refresh reload requests errors now", run: () => void listing.refetch() },
  ]);

  return { search, overlay, creating, setCreating, minted, setMinted, catalogue, listing, detail, refresh, failed, rotate, revoke, remove };
}
