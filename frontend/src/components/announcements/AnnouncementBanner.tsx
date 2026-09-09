import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Tooltip } from "antd";
import {
  CloseOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
  PushpinFilled,
  WarningFilled,
} from "@ant-design/icons";
import { Link } from "react-router-dom";

import { announcementsApi, type Announcement } from "@/api/announcements";
import { useAuth } from "@/auth/AuthProvider";

/**
 * The platform's own voice, in the shell (§17).
 *
 * `/announcements` is where notices are *read*; this is where the ones that
 * cannot wait are *seen*. A maintenance window nobody opened a page to look at
 * is a maintenance window nobody knows about.
 *
 * Four decisions worth the reader's attention.
 *
 * **Not every notice earns a band.** A banner is an interruption, and a
 * release note is not one. Only a pinned notice or one above `INFO` appears
 * here; the rest are on the page and in the count beside its menu item. A
 * shell that announced everything would be a shell people learn to ignore,
 * and then the maintenance notice is ignored too.
 *
 * **One at a time, loudest first.** Two bands stacked is a page that has lost
 * its header; the others are counted and one click away.
 *
 * **Dismissing writes a receipt.** Server-side, not `localStorage`: a notice
 * dismissed on a laptop is dismissed on the phone, and "who has seen this" is
 * a question the author can already answer (§17's reach).
 *
 * **A notice that requires acknowledgement cannot be dismissed.** That is what
 * "requires" means. The only way past it is to agree to it, which is also the
 * receipt the author is waiting for.
 */

/** The notices that interrupt: pinned, or louder than news. */
export function interrupts(notice: Announcement): boolean {
  if (notice.read_at) return false;
  if (notice.requires_acknowledgement && !notice.acknowledged_at) return true;
  return notice.is_pinned || notice.severity !== "INFO";
}

/** Loudest first, and a pinned notice outranks a merely severe one. */
export function ranked(notices: Announcement[]): Announcement[] {
  const weight = (notice: Announcement) =>
    (notice.requires_acknowledgement && !notice.acknowledged_at ? 8 : 0) +
    (notice.is_pinned ? 4 : 0) +
    (notice.severity === "CRITICAL" ? 2 : notice.severity === "WARNING" ? 1 : 0);
  return [...notices].sort((left, right) => weight(right) - weight(left));
}

const ICONS = {
  CRITICAL: <ExclamationCircleFilled />,
  WARNING: <WarningFilled />,
  INFO: <InfoCircleFilled />,
} as const;

export function AnnouncementBanner() {
  const { message } = AntApp.useApp();
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const feed = useQuery({
    queryKey: ["announcement-banner"],
    queryFn: ({ signal }) => announcementsApi.feed({ unread: true }, signal),
    // Only once somebody is signed in: the shell renders before the profile
    // arrives, and an unauthenticated call would 401 on every boot.
    enabled: Boolean(profile),
    // A notice published while somebody is looking at a page should reach
    // them without a reload — and every ten minutes is often enough for a
    // maintenance window, which is what these are for.
    refetchInterval: 600_000,
    staleTime: 60_000,
  });

  const mark = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) =>
      announcementsApi.mark(id, acknowledged),
    onSuccess: (_notice, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["announcement-banner"] });
      // The page and the sidebar's count read the same notices.
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["nav-badges"] });
      if (variables.acknowledged) message.success("Acknowledged");
    },
    onError: (error: Error) => message.error(error.message),
  });

  const waiting = ranked((feed.data?.items ?? []).filter(interrupts));
  const notice = waiting[0];
  if (!notice) return null;

  const mustAgree = notice.requires_acknowledgement && !notice.acknowledged_at;
  const others = waiting.length - 1;

  return (
    <div
      className={`nu-notice-band nu-notice-band--${notice.severity.toLowerCase()}`}
      role="status"
      data-testid="announcement-banner"
    >
      <span className="nu-notice-band-icon" aria-hidden>
        {notice.is_pinned ? <PushpinFilled /> : ICONS[notice.severity]}
      </span>
      <span className="nu-notice-band-text">
        <strong>{notice.title}</strong>
        {notice.body && <span className="nu-notice-band-body"> — {notice.body}</span>}
      </span>

      {notice.link && (
        <Link className="nu-notice-band-link" to={notice.link}>
          Open
        </Link>
      )}
      {others > 0 && (
        <Link className="nu-notice-band-link" to="/announcements">
          {others} more {others === 1 ? "notice" : "notices"}
        </Link>
      )}

      {mustAgree ? (
        <Button
          size="small"
          data-testid="announcement-acknowledge"
          loading={mark.isPending}
          onClick={() => mark.mutate({ id: notice.id, acknowledged: true })}
        >
          Acknowledge
        </Button>
      ) : (
        <Tooltip title="Dismiss — it stays on the announcements page">
          <Button
            size="small"
            type="text"
            aria-label={`Dismiss ${notice.title}`}
            data-testid="announcement-dismiss"
            icon={<CloseOutlined />}
            loading={mark.isPending}
            onClick={() => mark.mutate({ id: notice.id, acknowledged: false })}
          />
        </Tooltip>
      )}
    </div>
  );
}
