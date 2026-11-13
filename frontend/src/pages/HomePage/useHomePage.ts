/** Everything the home page reads, and what it derives from it. */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { activityApi } from "@/api/activity";
import { announcementsApi } from "@/api/announcements";
import { calendarApi } from "@/api/calendar";
import { explorerApi } from "@/api/explorer";
import { favoritesApi } from "@/api/favorites";
import { mailApi } from "@/api/mail";
import { metaApi } from "@/api/meta";
import { notificationsApi } from "@/api/notifications";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { rangeFor } from "@/lib/calendarGrid";
import { flagForPath, useFeatures } from "@/settings/features";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { SHORTCUTS, whatIsWaiting } from "./homeCopy";

/** The home page's queries, its commands, and the counts it derives. */
export function useHomePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const can = (permission: string) => profile?.permissions.includes(permission) ?? false;
  const features = useFeatures();
  const me = profile?.user;

  const app = useQuery({
    queryKey: queryKeys.metaApp(),
    queryFn: ({ signal }) => metaApi.app(signal),
    staleTime: STALE.hour,
  });

  const notices = useQuery({
    queryKey: queryKeys.announcements("", false),
    queryFn: ({ signal }) =>
      announcementsApi.feed({ category: "", include_expired: false }, signal),
  });

  const notifications = useQuery({
    queryKey: queryKeys.notificationCounts(),
    queryFn: ({ signal }) => notificationsApi.counts(signal),
  });

  // Today, through the calendar's own window function — so "today" means the
  // same thing here and there, including at the midnight boundary.
  const today = rangeFor("day", new Date());
  const events = useQuery({
    queryKey: queryKeys.calendar(today.from.toISOString(), today.to.toISOString(), "", true),
    queryFn: ({ signal }) =>
      calendarApi.window(
        { from: today.from.toISOString(), to: today.to.toISOString(), mine: "1" },
        signal,
      ),
    enabled: can("calendar.view"),
  });

  const mail = useQuery({
    queryKey: queryKeys.mail("INBOX", "", "", "unread", 1),
    queryFn: ({ signal }) => mailApi.threads({ folder: "INBOX", unread: "1", page: 1 }, signal),
    enabled: can("mail.access"),
  });

  const tasks = useQuery({
    queryKey: queryKeys.homeTasks(me?.id),
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: "task",
          filters: { assignee_id: me!.id },
          columns: ["reference", "title", "status", "priority", "due_date"],
          page: 1,
          page_size: 6,
          sort: "due_date",
          order: "asc",
        },
        signal,
      ),
    enabled: Boolean(me?.id) && can("tasks.view"),
  });

  const feed = useQuery({
    queryKey: queryKeys.activityHome(),
    queryFn: ({ signal }) => activityApi.feed({ period: "last_7_days" }, signal),
  });

  /**
   * Where this reader has been.
   *
   * The most useful thing a landing page can offer, and the one it had none
   * of: most mornings start by reopening whatever was open yesterday. Needs no
   * permission — a recent is a fact about *you*, and the rows behind each one
   * are still gated by the page it points at.
   */
  const recents = useQuery({
    queryKey: queryKeys.favorites("recents"),
    queryFn: ({ signal }) => favoritesApi.recents(signal),
  });

  usePageCommands("home", [
    {
      id: "home.preferences",
      label: "Change how the platform looks and behaves",
      keywords: "preferences settings theme density",
      // `navigate` and not `location.href`: a full page reload from inside a
      // single-page application throws away every cache the page just filled.
      run: () => navigate("/settings/preferences"),
    },
    {
      id: "home.dashboard",
      label: "Open the dashboard",
      keywords: "numbers kpi dashboard",
      run: () => navigate("/dashboard"),
    },
    {
      id: "home.explore",
      label: "Ask the data something",
      keywords: "explore query records search datasets filter",
      run: () => navigate("/explore"),
    },
    {
      id: "home.tasks",
      label: "Open my work",
      keywords: "tasks assigned mine todo work board",
      run: () => navigate("/tasks"),
    },
    {
      id: "home.mail",
      label: "Open the mailbox",
      keywords: "mail inbox email messages unread",
      run: () => navigate("/mail"),
    },
  ]);

  const overdue = (tasks.data?.items ?? []).filter(
    (row) =>
      typeof row["due_date"] === "string" &&
      new Date(row["due_date"]).valueOf() < Date.now() &&
      row["status"] !== "DONE" &&
      row["status"] !== "CANCELLED",
  ).length;

  // The strip must not answer before it knows. Five queries feed it, and
  // treating "no data yet" as "nothing waiting" made the page open on a green
  // "Nothing is waiting for you" that a moment later became "1 task past its
  // due date" — the opposite of the truth, told reassuringly, to a reader who
  // may well have glanced and moved on. `isLoading` rather than `isPending`,
  // because a query disabled for want of a permission is pending forever and
  // a viewer would wait on a skeleton that never resolves.
  const settling = [notices, notifications, events, mail, tasks].some((query) => query.isLoading);

  const waiting = whatIsWaiting({
    // A notice that needs agreeing to is the one thing here that somebody
    // else is waiting on, which is why it sorts first.
    acknowledgements: (notices.data?.items ?? []).filter(
      (item) => item.requires_acknowledgement && item.acknowledged_at === null,
    ).length,
    invitations: events.data?.counts.awaiting_response ?? 0,
    mail: mail.data?.total ?? 0,
    notifications: notifications.data?.unread ?? 0,
    overdue,
  });

  const live = (notices.data?.items ?? []).filter((item) => item.is_live).slice(0, 3);
  const mine = events.data?.items ?? [];

  const doors = SHORTCUTS.filter((item) => !item.permission || can(item.permission)).filter(
    (item) => {
      // A door onto a switched-off feature is not offered (§27).
      const flag = flagForPath(item.to);
      return !flag || features(flag);
    },
  );

  return {
    profile,
    can,
    me,
    app,
    notices,
    notifications,
    events,
    mail,
    tasks,
    feed,
    recents,
    settling,
    waiting,
    live,
    mine,
    doors,
  };
}

export type HomePageData = ReturnType<typeof useHomePage>;
