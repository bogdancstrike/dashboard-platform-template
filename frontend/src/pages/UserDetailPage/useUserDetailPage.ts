import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { rolesApi } from "@/api/roles";
import { usersApi } from "@/api/users";
import { useImpersonation } from "@/auth/ImpersonationProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { FEATURES, useFeature } from "@/settings/features";

/** One person: the account, the roles to choose from, changing role or status, and impersonating. */
export function useUserDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const impersonation = useImpersonation();
  const impersonationOn = useFeature(FEATURES.impersonation);
  const tab = params.get("tab") ?? "access";

  const person = useQuery({
    queryKey: queryKeys.admin("user", id),
    queryFn: ({ signal }) => usersApi.get(id, signal),
    enabled: Boolean(id),
  });

  // Only fetched when there is something to do with it: a reader who cannot
  // manage anybody has no use for the list of roles.
  const roles = useQuery({
    queryKey: queryKeys.admin("roles"),
    queryFn: ({ signal }) => rolesApi.matrix(signal),
    enabled: person.data?.can_manage === true,
    staleTime: STALE.long,
  });

  const change = useMutation({
    mutationFn: (body: { status?: string; role_code?: string }) => usersApi.update(id, body),
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.admin("user", id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin("users") });
      message.success(`${updated.full_name} updated. It applies on their next request.`);
    },
    onError: (error) =>
      message.error(
        error instanceof ApiError
          ? `${error.message}${error.correlationId ? ` · ${error.correlationId}` : ""}`
          : "The change could not be saved.",
      ),
  });

  usePageCommands("user-detail", [
    {
      id: "user.audit",
      label: "Show everything this person has done",
      keywords: "audit history activity",
      run: () => navigate(`/admin/audit?actor_label=${encodeURIComponent(person.data?.full_name ?? "")}`),
    },
    {
      id: "user.back",
      label: "Back to the people",
      keywords: "users list directory accounts all",
      run: () => navigate("/admin/users"),
    },
    {
      id: "user.roles",
      label: "See what this person's role may do",
      keywords: "role permissions matrix grants may",
      run: () => navigate("/admin/roles"),
    },
  ]);

  const startImpersonating = async (userId: string) => {
    try {
      const target = await impersonation.start(userId);
      message.success(`You are now acting as ${target.full_name}.`);
      navigate("/dashboard");
    } catch (error) {
      message.error(
        error instanceof ApiError ? error.message : "That impersonation was refused.",
      );
    }
  };

  return { navigate, setParams, tab, impersonationOn, person, roles, change, startImpersonating };
}
