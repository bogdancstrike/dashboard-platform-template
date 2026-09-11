/**
 * `/home` — where a person arrives (§40, §20).
 *
 * Five decisions worth stating.
 *
 * **This is not the dashboard, and the difference is the whole point.**
 * `/dashboard` answers "how is the business doing" with the organisation's
 * numbers. This answers "what is waiting for *me*" — and a landing page that
 * opened on revenue is a landing page somebody scrolls past every morning to
 * find the three things they actually have to do.
 *
 * **It adds no endpoint.** Every number here comes from the endpoint the
 * dedicated page uses: the notices from `/api/announcements`, the
 * notification count from `/notifications/counts`, today from the calendar's
 * own window, unread mail from the mailbox's own list, the tasks from the same
 * explorer query the board runs. A `/api/home/summary` would be a second place
 * every one of those is computed, and the first time the two disagreed nobody
 * would know which was right. Six parallel requests, each cached and shared
 * with the page it belongs to, is the cheaper mistake.
 *
 * **Only actionable things are counted.** "1,284 tasks exist" is a fact nobody
 * acts on; "3 invitations you have not answered" is three clicks of work. Each
 * count is a link to the narrowed view that shows exactly those rows, so the
 * number and the page behind it cannot disagree about what it meant.
 *
 * **A count of nought is not shown as nought** — it is not shown. A row of
 * zeroes teaches a reader to stop looking at the strip, and then the one that
 * is not zero is invisible too. When everything is clear, the strip says so in
 * a sentence instead.
 *
 * **What a reader lacks permission for is absent, not empty.** Somebody with
 * no mailbox does not get a mailbox card reading nought; they get one fewer
 * card. An empty card for a feature you cannot use is a worse answer than no
 * card at all (§76).
 *
 * **It is a front door, not a report.** The page used to be a greeting, a
 * strip of counts and four identical cards of lists — correct, and about as
 * welcoming as a spreadsheet. Three things changed that without adding an
 * endpoint or a claim:
 *
 * * a **hero band** carrying the date, who you are signed in as, and one
 *   sentence saying what the day looks like — because the first thing a
 *   landing page should do is orient somebody, and "Good morning" alone does
 *   not;
 * * **shortcuts into the modules**, permission-aware, because a front door
 *   with no doors is a lobby;
 * * **"jump back in"**, from `/recents` — the single most useful thing a
 *   landing page can offer, since most mornings start by reopening whatever
 *   was being worked on yesterday.
 *
 * The layout is a wide column and a rail rather than four equal cards: what
 * is *yours* (today, your work, what happened) reads left to right and gets
 * the width; what is *the platform's* (notices, shortcuts, where you have
 * been) sits beside it.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  AreaChartOutlined,
  ArrowRightOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  FolderOpenOutlined,
  HeartOutlined,
  LayoutOutlined,
  MailOutlined,
  NotificationOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

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
import { clock } from "@/components/calendar/MonthGrid";
import { rangeFor } from "@/lib/calendarGrid";
import { relativeTime } from "@/lib/time";
import { PersonAvatar } from "@/components/PersonAvatar";
import { EmptyState } from "@/components/EmptyState";

const { Paragraph, Text, Title } = Typography;

/**
 * How to greet somebody, by their own clock.
 *
 * Pure and exported: it is the one piece of arithmetic on this page, and
 * "good evening" at nine in the morning is the sort of thing that makes a
 * whole page feel careless.
 */
export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** One thing waiting for the reader, and where to go and do it. */
export interface Waiting {
  key: string;
  count: number;
  label: string;
  to: string;
  icon: ReactNode;
}

/**
 * The things that are actually waiting, in the order they should be dealt with.
 *
 * Pure and exported, because the *rule* is the interesting part: a count of
 * nought is dropped rather than rendered, and the order is by urgency and not
 * by size. Twelve unread notifications are less urgent than one policy nobody
 * has agreed to, and sorting by count would put them first every time.
 */
export function whatIsWaiting(counts: {
  acknowledgements: number;
  invitations: number;
  mail: number;
  notifications: number;
  overdue: number;
}): Waiting[] {
  /** Singular or plural, because "1 of your tasks are past due" reads as a bug. */
  const both = (count: number, one: string, many: string) => (count === 1 ? one : many);

  const all: Waiting[] = [
    {
      key: "acknowledgements",
      count: counts.acknowledgements,
      label: both(counts.acknowledgements, "notice to agree to", "notices to agree to"),
      to: "/announcements",
      icon: <NotificationOutlined />,
    },
    {
      key: "overdue",
      count: counts.overdue,
      label: both(
        counts.overdue,
        "of your tasks is past its due date",
        "of your tasks are past their due date",
      ),
      to: "/tasks",
      icon: <CheckSquareOutlined />,
    },
    {
      key: "invitations",
      count: counts.invitations,
      label: both(counts.invitations, "invitation to answer", "invitations to answer"),
      to: "/calendar?view=agenda&mine=1",
      icon: <CalendarOutlined />,
    },
    {
      key: "mail",
      count: counts.mail,
      label: both(counts.mail, "unread conversation", "unread conversations"),
      to: "/mail?only=unread",
      icon: <MailOutlined />,
    },
    {
      key: "notifications",
      count: counts.notifications,
      label: both(counts.notifications, "unread notification", "unread notifications"),
      to: "/notifications",
      icon: <BellOutlined />,
    },
  ];
  // Nought is dropped, never drawn: a row of zeroes teaches a reader to stop
  // looking at the strip, and then the one that is not zero is invisible too.
  return all.filter((item) => item.count > 0);
}

/** One door out of the lobby: where it goes, and what it needs to be open. */
export interface Shortcut {
  key: string;
  label: string;
  hint: string;
  to: string;
  icon: ReactNode;
  /** The permission it needs. Absent means everybody. */
  permission?: string;
}

/**
 * The modules a person actually starts in.
 *
 * Deliberately *destinations* and not "create" buttons. A tile labelled
 * "New email" that lands on an inbox is a lie somebody only falls for once,
 * and the pages own their own creating — this is a front door, not a second
 * set of verbs. Each names the permission that gates its page, so the row
 * holds no door that opens onto a 403 (§76).
 *
 * Exported and pure, because "which of these does this role see" is the
 * interesting part and it is worth asserting without rendering a page.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    key: "explore",
    label: "Explore data",
    hint: "Ask anything of any dataset",
    to: "/explore",
    icon: <SearchOutlined />,
    permission: "records.view",
  },
  {
    key: "dashboards",
    label: "Dashboards",
    hint: "The layouts you composed",
    to: "/dashboards",
    icon: <LayoutOutlined />,
    permission: "dashboards.manage",
  },
  {
    key: "analytics",
    label: "Analytics",
    hint: "Trends, breakdowns, comparisons",
    to: "/analytics",
    icon: <AreaChartOutlined />,
    permission: "records.view",
  },
  {
    key: "mail",
    label: "Mail",
    hint: "Your conversations",
    to: "/mail",
    icon: <MailOutlined />,
    permission: "mail.access",
  },
  {
    key: "files",
    label: "Files",
    hint: "Documents and uploads",
    to: "/files",
    icon: <FolderOpenOutlined />,
    permission: "files.view",
  },
  {
    key: "favorites",
    label: "Favourites",
    hint: "What you starred",
    to: "/favorites",
    icon: <HeartOutlined />,
  },
];

/** Today, written the way somebody would say it out loud. */
export function longDate(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * One sentence describing the day, from the same counts the strip draws.
 *
 * The strip says *what* is waiting; this says whether the day is busy — which
 * is the thing somebody actually wants from a glance at a landing page, and
 * which no arrangement of five tiles conveys. Pure, so the wording is
 * testable without a page around it.
 */
export function dayInAWord(waiting: Waiting[], meetings: number): string {
  const jobs = waiting.reduce((sum, item) => sum + item.count, 0);
  const diary =
    meetings === 0
      ? "nothing in your calendar"
      : meetings === 1
        ? "one thing in your calendar"
        : `${meetings} things in your calendar`;
  if (jobs === 0) return `Nothing is waiting for you, and ${diary}.`;
  const items = waiting.length === 1 ? "one thing" : `${waiting.length} kinds of thing`;
  return `${items} waiting on you, and ${diary}.`;
}

export default function HomePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const can = (permission: string) => profile?.permissions.includes(permission) ?? false;
  const me = profile?.user;

  const app = useQuery({
    queryKey: ["meta-app"],
    queryFn: ({ signal }) => metaApi.app(signal),
    staleTime: 3_600_000,
  });

  const notices = useQuery({
    queryKey: ["announcements", "", false],
    queryFn: ({ signal }) =>
      announcementsApi.feed({ category: "", include_expired: false }, signal),
  });

  const notifications = useQuery({
    queryKey: ["notification-counts"],
    queryFn: ({ signal }) => notificationsApi.counts(signal),
  });

  // Today, through the calendar's own window function — so "today" means the
  // same thing here and there, including at the midnight boundary.
  const today = rangeFor("day", new Date());
  const events = useQuery({
    queryKey: ["calendar", today.from.toISOString(), today.to.toISOString(), "", true],
    queryFn: ({ signal }) =>
      calendarApi.window(
        { from: today.from.toISOString(), to: today.to.toISOString(), mine: "1" },
        signal,
      ),
    enabled: can("calendar.view"),
  });

  const mail = useQuery({
    queryKey: ["mail", "INBOX", "", "", "unread", 1],
    queryFn: ({ signal }) =>
      mailApi.threads({ folder: "INBOX", unread: "1", page: 1 }, signal),
    enabled: can("mail.access"),
  });

  const tasks = useQuery({
    queryKey: ["home-tasks", me?.id],
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
    queryKey: ["activity-home"],
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
    queryKey: ["favorites", "recents"],
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

  if (!profile) return <Skeleton active paragraph={{ rows: 10 }} />;

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
  const settling = [notices, notifications, events, mail, tasks].some(
    (query) => query.isLoading,
  );

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

  const doors = SHORTCUTS.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="nu-home">
      {/* The band that orients somebody: who they are signed in as, what day
          it is, and one sentence about the day. A greeting on its own is
          decoration; a greeting that answers "is today busy" is a landing
          page doing its job. */}
      <header className="nu-hero">
        <div className="nu-hero-who">
          <PersonAvatar size={52} src={me?.avatar_url} initials={me?.initials} />
          <div className="nu-hero-words">
            <Title level={3} className="nu-home-greeting">
              {greeting()}, {me?.first_name || me?.full_name}
            </Title>
            <Text type="secondary" className="nu-hero-line">
              {longDate()} · {profile.role.name} · {app.data?.name ?? "Nucleus"}{" "}
              {app.data?.version ? `v${app.data.version}` : ""}
              {app.data && app.data.environment !== "production" && (
                <Tooltip title="Set by ENVIRONMENT. A demo that looked like production would be a demo somebody trusted.">
                  <Tag className="nu-home-env" bordered={false}>
                    {app.data.environment}
                  </Tag>
                </Tooltip>
              )}
            </Text>
            {/* Held back until the counts have settled, for the same reason
                the strip is: a reassuring sentence that turns out to be wrong
                is worse than a moment with no sentence at all. */}
            {!settling && (
              <Text className="nu-hero-summary" data-testid="home-summary">
                {dayInAWord(waiting, mine.length)}
              </Text>
            )}
          </div>
        </div>

        <Space size={8} wrap>
          <Link to="/settings/preferences">
            <Button>How you like things</Button>
          </Link>
          <Link to="/dashboard">
            <Button type="primary" icon={<ArrowRightOutlined />} iconPosition="end">
              The numbers
            </Button>
          </Link>
        </Space>
      </header>

      {/* Only what is actually waiting, each one a link to the rows it
          counted. A strip of zeroes teaches a reader to ignore the strip. */}
      <section
        aria-label="Waiting for you"
        data-testid="waiting"
        // Published so a test can wait for the answer rather than sample the
        // strip mid-flight and believe whichever branch it caught — which is
        // how the flake that found this read an empty strip and then waited
        // fifteen seconds for a sentence the data had already ruled out.
        data-settled={settling ? "no" : "yes"}
      >
        {settling ? (
          <Skeleton active paragraph={{ rows: 1 }} title={false} />
        ) : waiting.length === 0 ? (
          <Alert
            type="success"
            showIcon
            message="Nothing is waiting for you"
            description="No unanswered invitations, no unread mail, nothing past its due date. The numbers are on the dashboard when you want them."
          />
        ) : (
          <div className="nu-home-waiting">
            {waiting.map((item) => (
              <Link key={item.key} to={item.to} className="nu-waitcard" data-testid={`waiting-${item.key}`}>
                <span className="nu-waitcard-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="nu-waitcard-count">{item.count}</span>
                <span className="nu-waitcard-label">{item.label}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* A wide column and a rail. What is *yours* — today, your work, what
          happened — reads left to right and gets the width; what is the
          platform's — the doors, where you have been, the noticeboard — sits
          beside it. Four equal cards gave a diary the same weight as a
          shortcut, which is how the page read as a wall of lists. */}
      <div className="nu-home-columns">
      <div className="nu-home-main">
        {can("calendar.view") && (
          <Card
            size="small"
            title="Today"
            data-testid="home-today"
            extra={
              <Link to="/calendar?view=day" className="nu-quiet-link">
              The calendar
            </Link>
            }
          >
            {events.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : mine.length === 0 ? (
              <EmptyState compact title="Nothing in your calendar today" />
            ) : (
              <Space direction="vertical" size={6} className="nu-block">
                {mine.map((event) => (
                  <div key={event.id} className="nu-home-event">
                    <Text strong className="nu-home-event-when">
                      {event.all_day ? "All day" : clock(event.starts_at)}
                    </Text>
                    <Link to={`/calendar?view=day&on=${event.day}`} className="nu-home-event-what">
                      {event.title}
                    </Link>
                    {event.clashes_with.length > 0 && (
                      <Tooltip title={`Clashes with ${event.clashes_with.join(", ")}`}>
                        <Tag color="warning" bordered={false}>
                          clash
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                ))}
              </Space>
            )}
          </Card>
        )}

        {can("tasks.view") && (
          <Card
            size="small"
            title="Your work"
            data-testid="home-tasks"
            extra={
              <Link to="/tasks" className="nu-quiet-link">
              The queue
            </Link>
            }
          >
            {tasks.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : (tasks.data?.items.length ?? 0) === 0 ? (
              <EmptyState compact title="Nothing is assigned to you" />
            ) : (
              <Space direction="vertical" size={6} className="nu-block">
                {(tasks.data?.items ?? []).map((row) => (
                  <div key={String(row["id"])} className="nu-home-task">
                    <Link to={`/tasks/${String(row["id"])}`} className="nu-home-task-title">
                      {String(row["title"])}
                    </Link>
                    <Space size={4}>
                      <Tag bordered={false}>{String(row["status"]).toLowerCase()}</Tag>
                      {typeof row["due_date"] === "string" && (
                        <Text
                          type={
                            new Date(row["due_date"]).valueOf() < Date.now()
                              ? "danger"
                              : "secondary"
                          }
                        >
                          {relativeTime(row["due_date"])}
                        </Text>
                      )}
                    </Space>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        )}

        <Card
          size="small"
          title="What has been happening"
          data-testid="home-activity"
          extra={
            <Link to="/activity" className="nu-quiet-link">
              The feed
            </Link>
          }
        >
          {feed.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (feed.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title="Nothing has happened this week" />
          ) : (
            <Space direction="vertical" size={6} className="nu-block">
              {(feed.data?.items ?? []).slice(0, 6).map((entry) => (
                <div key={entry.id} className="nu-home-feed">
                  <Text>{entry.summary}</Text>
                  <Text type="secondary" className="nu-home-feed-when">
                    {relativeTime(entry.occurred_at)}
                  </Text>
                </div>
              ))}
            </Space>
          )}
        </Card>
      </div>

      <aside className="nu-home-rail">
        {/* A front door with no doors is a lobby. Permission-aware, so the row
            holds nothing that opens onto a refusal (§76). */}
        <Card size="small" title="Where to start" data-testid="home-shortcuts">
          <div className="nu-home-doors">
            {doors.map((door) => (
              <Link key={door.key} to={door.to} className="nu-door" data-testid={`door-${door.key}`}>
                <span className="nu-door-icon" aria-hidden>
                  {door.icon}
                </span>
                <span className="nu-door-text">
                  <span className="nu-door-label">{door.label}</span>
                  <span className="nu-door-hint">{door.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>

        {/* Most mornings start by reopening whatever was open yesterday. The
            visit count is what separates a place somebody works from one they
            wandered into once, so it is on the row rather than implied by the
            order. */}
        <Card
          size="small"
          title="Jump back in"
          data-testid="home-recents"
          extra={
            <Link to="/favorites" className="nu-quiet-link">
              Favourites
            </Link>
          }
        >
          {recents.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          ) : (recents.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title="Nowhere yet — the trail fills itself as you work" />
          ) : (
            <Space direction="vertical" size={4} className="nu-block">
              {(recents.data?.items ?? []).slice(0, 6).map((visit) => (
                <Link key={visit.id} to={visit.url} className="nu-home-recent">
                  <ClockCircleOutlined aria-hidden />
                  <Text ellipsis className="nu-home-recent-label">
                    {visit.label}
                  </Text>
                  <Text type="secondary" className="nu-home-recent-note">
                    {visit.visit_count > 1 ? `${visit.visit_count} visits` : visit.resource_type}
                  </Text>
                </Link>
              ))}
            </Space>
          )}
        </Card>

        <Card
          size="small"
          title="What the platform has said"
          data-testid="home-notices"
          extra={
            <Link to="/announcements" className="nu-quiet-link">
              The noticeboard
            </Link>
          }
        >
          {notices.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : live.length === 0 ? (
            <EmptyState compact title="No notices are live" />
          ) : (
            <Space direction="vertical" size={10} className="nu-block">
              {live.map((notice) => (
                <div key={notice.id} className="nu-home-notice">
                  <Space size={6}>
                    <Tag
                      color={
                        notice.severity === "CRITICAL"
                          ? "error"
                          : notice.severity === "WARNING"
                            ? "warning"
                            : undefined
                      }
                      bordered={false}
                    >
                      {notice.severity.toLowerCase()}
                    </Tag>
                    <Link to="/announcements">
                      <Text strong>{notice.title}</Text>
                    </Link>
                  </Space>
                  <Paragraph className="nu-home-notice-body" ellipsis={{ rows: 2 }}>
                    {notice.body}
                  </Paragraph>
                </div>
              ))}
            </Space>
          )}
        </Card>

      </aside>
      </div>
    </div>
  );
}
