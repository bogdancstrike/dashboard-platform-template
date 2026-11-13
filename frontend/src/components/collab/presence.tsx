/**
 * Live presence (§47): the green and amber dots.
 *
 * One query holds everybody's status; the live channel's `presence` hints
 * patch it in place. Patching rather than refetching is right *here* (unlike
 * a conversation, which is re-read): a status has no permissions behind it
 * and nothing else derives from it, so the hint *is* the data.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tooltip } from "antd";

import { chatApi, type PresenceStatus } from "@/api/chat";
import { useLiveEvents } from "@/live/LiveProvider";

const KEY = ["chat-presence"] as const;

export function usePresence(): Record<string, PresenceStatus> {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => chatApi.presence(signal),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  useLiveEvents((message) => {
    if (message.type !== "presence" || typeof message["user_id"] !== "string") return;
    const user = message["user_id"];
    const status = message["status"] as PresenceStatus;
    queryClient.setQueryData<{ statuses: Record<string, PresenceStatus> }>(KEY, (old) => ({
      statuses: { ...(old?.statuses ?? {}), [user]: status },
    }));
  });
  return query.data?.statuses ?? {};
}

const LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

export function PresenceDot({
  status = "offline",
  className,
}: {
  status?: PresenceStatus;
  className?: string;
}) {
  return (
    <Tooltip title={LABEL[status]}>
      <span
        className={`nx-co-dot is-${status}${className ? ` ${className}` : ""}`}
        role="img"
        aria-label={LABEL[status]}
        data-presence={status}
      />
    </Tooltip>
  );
}
