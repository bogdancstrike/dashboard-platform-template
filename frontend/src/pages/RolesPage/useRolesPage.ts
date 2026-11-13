import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate } from "react-router-dom";

import { ApiError } from "@/api/client";
import { rolesApi, type RoleRow } from "@/api/roles";
import { usePageCommands } from "@/commands/CommandContext";
import { usePhoneList } from "@/components/listing/ResponsiveTable";
import { apiMessageToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

import { cellKey, pendingChanges, pendingCount } from "./matrix";

/**
 * The matrix, the staged toggles (§73: a permission change is seen whole,
 * then confirmed), the folded groups, and saving or removing roles.
 */
export function useRolesPage() {
  const phone = usePhoneList();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  /** Permission groups folded to their heading row. */
  const [folded, setFolded] = useState<Set<string>>(new Set());
  /** Staged toggles, keyed `ROLE:permission`, valued by the intended state. */
  const [staged, setStaged] = useState<Record<string, boolean>>({});

  const matrix = useQuery({
    queryKey: queryKeys.admin("roles"),
    queryFn: ({ signal }) => rolesApi.matrix(signal),
  });

  const remove = useMutation({
    mutationFn: (code: string) => rolesApi.remove(code),
    onSuccess: async (answer) => {
      message.success(`The ${answer.code} role is gone`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin("roles") });
    },
    onError: apiMessageToast(message, "That role could not be removed."),
  });

  const save = useMutation({
    mutationFn: async (changes: { code: string; permissions: string[] }[]) => {
      // One request per role rather than one for all of them: each is audited
      // as its own change, and a refusal names the role it refused.
      for (const change of changes) {
        await rolesApi.update(change.code, { permissions: change.permissions });
      }
    },
    onSuccess: async (_result, changes) => {
      setStaged({});
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin("roles") });
      // The caller's own permissions may have just changed.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me() });
      message.success(
        `${changes.length} role${changes.length === 1 ? "" : "s"} updated. It applies to the next request each holder makes.`,
      );
    },
    onError: (error) => {
      message.error(
        error instanceof ApiError
          ? `${error.message} · ${error.correlationId}`
          : "The change could not be saved.",
      );
    },
  });

  const data = matrix.data;

  /** What a cell should show: the staged value if there is one, else the truth. */
  const isGranted = (role: RoleRow, permission: string) => {
    const key = cellKey({ role: role.code, permission });
    return staged[key] ?? role.permissions.includes(permission);
  };

  const pending = useMemo(() => pendingChanges(staged, data), [staged, data]);
  const pendingCells = pendingCount(staged, data);

  usePageCommands("roles", [
    {
      id: "roles.discard",
      label: "Discard staged permission changes",
      keywords: "reset revert",
      run: () => setStaged({}),
    },
    {
      id: "roles.new",
      label: "Make a role",
      keywords: "role new create custom copy narrow",
      run: () => setCreating(true),
    },
    {
      id: "roles.reload",
      label: "Reload the permission matrix",
      keywords: "refresh reload matrix permissions catalogue",
      run: () => void matrix.refetch(),
    },
    {
      id: "roles.groups",
      label: "See the groups instead",
      keywords: "groups membership teams grants",
      run: () => navigate("/admin/groups"),
    },
  ]);

  const stage = (role: string, permission: string, granted: boolean) =>
    setStaged((current) => ({ ...current, [cellKey({ role, permission })]: granted }));
  const toggleGroup = (name: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return {
    phone, creating, setCreating, term, setTerm, folded, setFolded, staged, setStaged, matrix, data, remove, save,
    isGranted, pending, pendingCells, stage, toggleGroup, queryClient,
  };
}
