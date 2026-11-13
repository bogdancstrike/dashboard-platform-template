import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";

import { securityApi } from "@/api/security";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { queryKeys } from "@/lib/queryKeys";

/** The overview, sessions, sign-ins and events, and what the reader can do about them. */
export function useSecurityPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [signInFilter, setSignInFilter] = useState<"all" | "FAILURE">("all");

  const overview = useQuery({
    queryKey: queryKeys.security("overview"),
    queryFn: ({ signal }) => securityApi.overview(signal),
  });
  const sessions = useQuery({
    queryKey: queryKeys.security("sessions"),
    queryFn: ({ signal }) => securityApi.sessions(signal),
  });
  const signIns = useQuery({
    queryKey: queryKeys.security("sign-ins", signInFilter),
    queryFn: ({ signal }) =>
      securityApi.signIns(
        { ...(signInFilter === "all" ? {} : { result: signInFilter }), page_size: 25 },
        signal,
      ),
  });
  const events = useQuery({
    queryKey: queryKeys.security("events"),
    queryFn: ({ signal }) => securityApi.events({ page_size: 25 }, signal),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.security() });
  };

  const revoked = useMutation({
    mutationFn: (id: string) => securityApi.revoke(id),
    onSuccess: async () => {
      await refresh();
      message.success("That device has been signed out.");
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "sign that device out" }));
    },
  });

  const sweptOthers = useMutation({
    mutationFn: () => securityApi.revokeOthers(),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.revoked === 0
          ? "There was nowhere else signed in."
          : answer.revoked === 1
            ? "One other device has been signed out."
            : `${formatNumber(answer.revoked)} other devices have been signed out.`,
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "sign the other devices out" }));
    },
  });

  const trusted = useMutation({
    mutationFn: (input: { id: string; trusted: boolean }) =>
      securityApi.trust(input.id, input.trusted),
    onSuccess: refresh,
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change that" }));
    },
  });

  const resolved = useMutation({
    mutationFn: (input: { id: string; resolved: boolean }) =>
      securityApi.resolve(input.id, input.resolved),
    onSuccess: refresh,
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change that" }));
    },
  });

  usePageCommands("security", [
    {
      id: "security.sign-out-others",
      label: "Sign out every other device",
      keywords: "security session sign out revoke devices password stolen",
      run: () => sweptOthers.mutate(),
    },
    { id: "security.failures", label: "Show the failed sign-ins", keywords: "security failed sign in attempts password", run: () => setSignInFilter("FAILURE") },
  ]);

  return { signInFilter, setSignInFilter, overview, sessions, signIns, events, refresh, revoked, sweptOthers, trusted, resolved };
}
