import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { organizationsApi } from "@/api/organizations";
import { usePageCommands } from "@/commands/CommandContext";
import { apiMessageToast } from "@/lib/errors";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** The tenants, the chosen one's tree, and the moves and retirements on it. */
export function useOrganizationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null);

  const chosen = params.get("org");

  const catalogue = useQuery({
    queryKey: queryKeys.orgs("catalogue"),
    queryFn: ({ signal }) => organizationsApi.catalogue(signal),
    staleTime: STALE.minute,
  });

  const listing = useQuery({
    queryKey: queryKeys.orgs("list"),
    queryFn: ({ signal }) => organizationsApi.list({ page_size: 100 }, signal),
  });

  // The reader's own tenant when nothing is chosen: a page that opened on
  // whichever organisation sorted first would open on somebody else's.
  const opened =
    chosen ??
    catalogue.data?.own_organization_id ??
    listing.data?.items[0]?.id ??
    null;

  const tree = useQuery({
    queryKey: queryKeys.orgs("tree", opened),
    queryFn: ({ signal }) => organizationsApi.tree(opened!, signal),
    enabled: opened !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.orgs() });
  };

  const failed = apiMessageToast(message, "That was refused.");

  const moveDepartment = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      organizationsApi.editDepartment(id, { parent_id: parentId }),
    onSuccess: async () => {
      message.success("Moved.");
      await refresh();
    },
    // The server's sentence, which names the path that would close the loop.
    onError: failed,
  });

  const removeDepartment = useMutation({
    mutationFn: (id: string) => organizationsApi.removeDepartment(id),
    onSuccess: async (result) => {
      message.success(`${result.name} retired.`);
      await refresh();
    },
    onError: failed,
  });

  usePageCommands("admin-orgs", [
    {
      id: "orgs.department",
      label: "Add a department",
      keywords: "department org structure team",
      run: () => setAdding({ parentId: null }),
    },
    {
      id: "orgs.people",
      label: "See the people instead",
      keywords: "users people accounts staff directory",
      run: () => navigate("/admin/users"),
    },
    {
      id: "orgs.groups",
      label: "See the groups instead",
      keywords: "groups teams membership sharing",
      run: () => navigate("/admin/groups"),
    },
  ]);

  const choose = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("org", id);
        return next;
      },
      { replace: true },
    );

  return { catalogue, listing, opened, tree, refresh, failed, adding, setAdding, moveDepartment, removeDepartment, choose };
}
