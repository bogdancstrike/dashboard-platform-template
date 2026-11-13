import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";

import { groupsApi } from "@/api/groups";
import { usePageCommands } from "@/commands/CommandContext";
import { useListSearch } from "@/hooks/useListSearch";
import { useUrlOverlay } from "@/hooks/useUrlOverlay";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The groups page's address, reads and the one removal it starts. */
export function useGroupsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const search = useListSearch();
  const { term, set } = search;
  const kind = search.params.get("kind") ?? "";
  const overlay = useUrlOverlay("group");
  const opened = overlay.value;
  const [creating, setCreating] = useState(false);

  const catalogue = useQuery({
    queryKey: queryKeys.groups("catalogue"),
    queryFn: ({ signal }) => groupsApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const listing = useQuery({
    queryKey: queryKeys.groups("list", term, kind),
    queryFn: ({ signal }) =>
      groupsApi.list(
        { ...(term ? { q: term } : {}), ...(kind ? { kind } : {}), page_size: 100 },
        signal,
      ),
  });

  const detail = useQuery({
    queryKey: queryKeys.groups("entry", opened),
    queryFn: ({ signal }) => groupsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.groups() });
  };

  const failed = apiMessageToast(message, "That was refused.");

  const remove = useMutation({
    mutationFn: (id: string) => groupsApi.remove(id),
    onSuccess: async (result) => {
      message.success(
        result.permissions_withdrawn.length > 0 && result.members_affected > 0
          ? `${result.name} removed — ${result.members_affected} people lost ${result.permissions_withdrawn.join(", ")}.`
          : `${result.name} removed.`,
      );
      overlay.close();
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-groups", [
    { id: "groups.new", label: "Make a group", keywords: "group create new team permissions", run: () => setCreating(true) },
    { id: "groups.all", label: "Show every group", keywords: "groups all clear filter search", run: () => set({ q: null }) },
    {
      id: "groups.roles",
      label: "See what a role may do instead",
      keywords: "roles permissions grants what may do",
      run: () => navigate("/admin/roles"),
    },
    {
      id: "groups.people",
      label: "See the people",
      keywords: "users people accounts members directory",
      run: () => navigate("/admin/users"),
    },
  ]);

  return { search, kind, overlay, creating, setCreating, catalogue, listing, detail, refresh, failed, remove };
}
