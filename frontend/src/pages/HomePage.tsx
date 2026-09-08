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
 */

import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Empty,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowRightOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  MailOutlined,
  NotificationOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { activityApi } from "@/api/activity";
import { announcementsApi } from "@/api/announcements";
import { calendarApi } from "@/api/calendar";
import { explorerApi } from "@/api/explorer";
import { mailApi } from "@/api/mail";
import { metaApi } from "@/api/meta";
import { notificationsApi } from "@/api/notifications";
import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";
import { clock } from "@/components/calendar/MonthGrid";
import { rangeFor } from "@/lib/calendarGrid";
import { relativeTime } from "@/lib/time";
import { PersonAvatar } from "@/components/PersonAvatar";

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

  usePageCommands("home", [
    {
      id: "home.preferences",
      label: "Change how the platform looks and behaves",
      keywords: "preferences settings theme density",
      // `navigate` and not `location.href`: a full page reload from inside a
      // single-page application throws away every cache the page just filled.
      run: () => navigate("/preferences"),
    },
    {
      id: "home.dashboard",
      label: "Open the dashboard",
      keywords: "numbers kpi dashboard",
      run: () => navigate("/dashboard"),
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

  return (
    <div className="nu-home">
      <header className="nu-home-head">
        <Space size={12} align="center">
          <PersonAvatar size={44} src={me?.avatar_url} initials={me?.initials} />
          <div>
            <Title level={3} className="nu-home-greeting">
              {greeting()}, {me?.first_name || me?.full_name}
            </Title>
            <Text type="secondary">
              {profile.role.name} · {app.data?.name ?? "Nucleus"}{" "}
              {app.data?.version ? `v${app.data.version}` : ""}
              {app.data && app.data.environment !== "production" && (
                <Tooltip title="Set by ENVIRONMENT. A demo that looked like production would be a demo somebody trusted.">
                  <Tag className="nu-home-env" bordered={false}>
                    {app.data.environment}
                  </Tag>
                </Tooltip>
              )}
            </Text>
          </div>
        </Space>

        <Space size={8}>
          <Link to="/preferences">
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

      <div className="nu-home-grid">
        {can("calendar.view") && (
          <Card
            size="small"
            title="Today"
            data-testid="home-today"
            extra={
              <Link to="/calendar?view=day">
                <Button type="link" size="small">
                  The calendar
                </Button>
              </Link>
            }
          >
            {events.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : mine.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Nothing in your calendar today"
              />
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
              <Link to="/tasks">
                <Button type="link" size="small">
                  The queue
                </Button>
              </Link>
            }
          >
            {tasks.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : (tasks.data?.items.length ?? 0) === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Nothing is assigned to you"
              />
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
          title="What the platform has said"
          data-testid="home-notices"
          extra={
            <Link to="/announcements">
              <Button type="link" size="small">
                The noticeboard
              </Button>
            </Link>
          }
        >
          {notices.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : live.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notices are live" />
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

        <Card
          size="small"
          title="What has been happening"
          data-testid="home-activity"
          extra={
            <Link to="/activity">
              <Button type="link" size="small">
                The feed
              </Button>
            </Link>
          }
        >
          {feed.isLoading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (feed.data?.items.length ?? 0) === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing has happened this week"
            />
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
    </div>
  );
}
