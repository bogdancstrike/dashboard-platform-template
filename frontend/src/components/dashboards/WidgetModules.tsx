/**
 * The widgets that are *pages of this product*, drawn small (§45).
 *
 * A dashboard whose widgets are only charts is a reporting page. These are the
 * other half: the work waiting in Tasks, the thread nobody has answered in
 * Mail, what lands in the calendar this week, the file somebody uploaded an
 * hour ago. They are what makes a dashboard the place a person starts their
 * day rather than the place they go to check a number.
 *
 * Three rules hold for every one of them, and they are the same three that
 * hold for the chart widgets in `WidgetBody`.
 *
 * **The module's own endpoint answers it.** Not one of these computes
 * anything. Mail is `/api/mail/threads`, tasks are the explorer query the
 * board itself uses, the calendar is the same window `/calendar` expands. A
 * widget that fetched differently from its page would be a second answer to
 * one question, and the two would drift the first week somebody changed
 * either.
 *
 * **It is the page in miniature, and it says so.** Every one of these carries
 * a link back to the page it mirrors, because the honest purpose of a module
 * widget is to tell you whether it is worth opening the page. A card that
 * shows six of two hundred rows and offers no way through is a card that makes
 * somebody hunt through the navigation for what they were just looking at.
 *
 * **The permission is the page's.** The server does not offer a Mail widget to
 * somebody without `mail.access`, and if a shared dashboard carries one
 * anyway, the body says which permission is missing rather than drawing an
 * empty box (§34, §76).
 */

import { useQuery } from "@tanstack/react-query";
import { List, Progress, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
import {
  CheckCircleTwoTone,
  ClockCircleOutlined,
  FileOutlined,
  PaperClipOutlined,
  PushpinFilled,
  StarFilled,
} from "@ant-design/icons";
import { Link } from "react-router-dom";

import { announcementsApi } from "@/api/announcements";
import { calendarApi } from "@/api/calendar";
import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { favoritesApi } from "@/api/favorites";
import { filesApi } from "@/api/files";
import { kanbanApi } from "@/api/kanban";
import { mailApi } from "@/api/mail";
import { notificationsApi } from "@/api/notifications";
import { relationshipsApi } from "@/api/relationships";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StatusTag } from "@/components/StatusTag";
import { asText } from "@/lib/text";
import { absoluteTime, relativeTime } from "@/lib/time";
import { knownStatusColor, SEMANTIC } from "@/theme/tokens";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/** Rows a module widget shows. More than this and it is a page, not a card. */
const ROWS = 6;

/** Every module body takes the same two things: the widget, and the catalogue. */
export interface ModuleBodyProps {
  widget: DashboardWidget;
  resources: ExplorerResource[];
  /** Drawn in place when a module answers with a refusal or an error. */
  fallback: (error: Error, subject: string) => JSX.Element;
}

/**
 * A loading state the size of the answer.
 *
 * Every module body uses it, so a dashboard mid-load is a grid of cards
 * settling rather than a grid of spinners of five different sizes.
 */
function Loading() {
  return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
}

function Nothing({ what }: { what: string }) {
  return <EmptyState compact title={what} />;
}

/** The footer every module carries: the whole of it, one press away. */
function MoreLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="nu-widget-more">
      {children}
    </Link>
  );
}

// ── tasks ────────────────────────────────────────────────────────────────

/**
 * Work in flight — either one kanban board's lanes, or the task dataset.
 *
 * Two modes because they answer different questions. A *board* is a team's
 * agreed process, so its lanes are the ones that team named; the *dataset* is
 * every task there is, and its lanes are the status vocabulary. Somebody
 * choosing this widget is picking one of those two questions, not a data
 * source.
 *
 * Either way the lane counts come from the server. A card that counted the
 * rows it had loaded would say "3 in progress" about a lane holding ninety —
 * which is the specific lie a board exists to prevent.
 */
export function TasksBody({ widget, fallback }: ModuleBodyProps) {
  const board = widget.config.board_id ?? "";
  return board ? <BoardLanes id={board} fallback={fallback} /> : <TaskLanes widget={widget} fallback={fallback} />;
}

function BoardLanes({ id, fallback }: { id: string; fallback: ModuleBodyProps["fallback"] }) {
  const detail = useQuery({
    queryKey: ["kanban-board", id, {}],
    queryFn: ({ signal }) => kanbanApi.board(id, {}, signal),
    staleTime: 30_000,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.isError) return fallback(detail.error, "this board");

  const lanes = detail.data?.lanes ?? [];
  if (lanes.length === 0) return <Nothing what="This board has no lanes yet" />;

  return (
    <>
      <div className="nu-widget-lanes">
        {lanes.map((lane) => (
          <Link
            key={lane.id}
            to={`/kanban?board=${id}`}
            className={`nu-widget-lane${lane.over_limit ? " is-over" : ""}`}
          >
            <span className="nu-widget-lane-count">{lane.total.toLocaleString()}</span>
            <span className="nu-widget-lane-name">{lane.name}</span>
            {lane.wip_limit !== null && (
              <span className="nu-widget-lane-limit">of {lane.wip_limit}</span>
            )}
          </Link>
        ))}
      </div>
      <MoreLink to={`/kanban?board=${id}`}>Open {detail.data?.board.name}</MoreLink>
    </>
  );
}

function TaskLanes({ widget, fallback }: { widget: DashboardWidget; fallback: ModuleBodyProps["fallback"] }) {
  const config = widget.config;
  const filters: Record<string, unknown> = { ...(config.filters ?? {}) };
  if (config.status) filters["status"] = config.status;

  const request = {
    resource_type: "task",
    filters,
    columns: ["reference", "title", "status", "priority", "due_date", "progress"],
    sort: "updated_at",
    order: "desc" as const,
    page_size: ROWS,
    // The lane counts are the point of this widget, and they are a GROUP BY
    // the server only runs when asked.
    facets: true,
  };

  const rows = useQuery({
    queryKey: ["entity-rows", request],
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    staleTime: 30_000,
  });

  if (rows.isLoading) return <Loading />;
  if (rows.isError) return fallback(rows.error, "task");

  const lanes = (rows.data?.facets["status"] ?? []).filter((lane) => lane.count > 0);
  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No work items match" />;

  return (
    <>
      {lanes.length > 0 && (
        <div className="nu-widget-lanes">
          {lanes.slice(0, 5).map((lane) => (
            <Link
              key={lane.value}
              to={`/tasks?f.status=${encodeURIComponent(lane.value)}`}
              className="nu-widget-lane"
              style={{ borderTopColor: knownStatusColor(lane.value) ?? undefined }}
            >
              <span className="nu-widget-lane-count">{lane.count.toLocaleString()}</span>
              <span className="nu-widget-lane-name">{lane.value.replace(/_/g, " ")}</span>
            </Link>
          ))}
        </div>
      )}
      <List
        size="small"
        dataSource={items}
        renderItem={(row) => (
          <List.Item>
            <Link to={`/tasks/${row["id"]}`} className="nu-widget-row">
              <Text ellipsis>{asText(row["title"])}</Text>
              <Space size={4}>
                {Number(row["progress"] ?? 0) > 0 && (
                  <Text type="secondary" className="nu-widget-dim">
                    {Math.round(Number(row["progress"]))}%
                  </Text>
                )}
                <StatusTag status={asText(row["status"])} bordered={false} />
              </Space>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/tasks">All {(rows.data?.total ?? 0).toLocaleString()} tasks</MoreLink>
    </>
  );
}

// ── projects ─────────────────────────────────────────────────────────────

/**
 * Delivery, project by project.
 *
 * A progress bar per row rather than a status tag, because "how far along" is
 * the question a portfolio is read for and a state name answers it only
 * coarsely — `IN_PROGRESS` covers a project at 5% and one at 95%.
 */
export function ProjectsBody({ widget, fallback }: ModuleBodyProps) {
  const filters: Record<string, unknown> = { ...(widget.config.filters ?? {}) };
  if (widget.config.status) filters["status"] = widget.config.status;

  const request = {
    resource_type: "project",
    filters,
    columns: ["name", "status", "progress", "health", "end_date"],
    sort: "updated_at",
    order: "desc" as const,
    page_size: ROWS,
  };

  const rows = useQuery({
    queryKey: ["entity-rows", request],
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    staleTime: 30_000,
  });

  if (rows.isLoading) return <Loading />;
  if (rows.isError) return fallback(rows.error, "project");

  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No projects match" />;

  return (
    <>
      <ul className="nu-widget-projects">
        {items.map((row) => {
          const done = Math.round(Number(row["progress"] ?? 0));
          return (
            <li key={row.id}>
              <Link to={`/projects/${row.id}`} className="nu-widget-project">
                <span className="nu-widget-project-head">
                  <Text ellipsis>{asText(row["name"])}</Text>
                  <Text type="secondary" className="nu-widget-dim">
                    {done}%
                  </Text>
                </span>
                <Progress
                  percent={done}
                  size="small"
                  showInfo={false}
                  strokeColor={knownStatusColor(asText(row["status"])) ?? undefined}
                  aria-label={`${asText(row["name"])}: ${done}% complete`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink to="/projects">All {(rows.data?.total ?? 0).toLocaleString()} projects</MoreLink>
    </>
  );
}

// ── mail ─────────────────────────────────────────────────────────────────

/**
 * What is waiting in the inbox.
 *
 * The sender and the subject, and the unread ones in a heavier weight — which
 * is the whole scan somebody does on a mail list. The snippet is dropped: at
 * widget width it wraps to three lines and pushes the next thread off the
 * card, and a subject a person recognises is worth more than the first eight
 * words of a body they do not.
 */
export function MailBody({ widget, fallback }: ModuleBodyProps) {
  const folder = widget.config.folder || "INBOX";
  const params = {
    folder,
    ...(widget.config.unread_only ? { unread: "true" } : {}),
  };

  const list = useQuery({
    queryKey: ["mail-threads", params],
    queryFn: ({ signal }) => mailApi.threads(params, signal),
    staleTime: 30_000,
  });

  if (list.isLoading) return <Loading />;
  if (list.isError) return fallback(list.error, "mail");

  const items = (list.data?.items ?? []).slice(0, ROWS);
  const unread = list.data?.folders.find((entry) => entry.key === folder)?.unread ?? 0;

  if (items.length === 0) {
    return <Nothing what={widget.config.unread_only ? "Nothing unread" : "Nothing in this folder"} />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(thread) => {
          const who = thread.participants[0];
          return (
            <List.Item className={thread.unread_count > 0 ? "is-unread" : undefined}>
              <Link to={`/mail?thread=${thread.id}`} className="nu-widget-mail">
                <PersonAvatar name={who?.name ?? who?.email ?? "?"} size={22} />
                <span className="nu-widget-mail-body">
                  <Text ellipsis strong={thread.unread_count > 0} className="nu-widget-mail-subject">
                    {thread.subject || "(no subject)"}
                  </Text>
                  <Text type="secondary" ellipsis className="nu-widget-dim">
                    {who?.name ?? who?.email ?? "Unknown sender"}
                    {thread.message_count > 1 ? ` · ${thread.message_count}` : ""}
                  </Text>
                </span>
                <Space size={4} className="nu-widget-mail-marks">
                  {thread.is_starred && <StarFilled className="nu-widget-star" aria-label="Starred" />}
                  {thread.has_attachments && <PaperClipOutlined aria-label="Has an attachment" />}
                  {thread.last_message_at && (
                    <Tooltip title={absoluteTime(thread.last_message_at)}>
                      <Text type="secondary" className="nu-widget-dim">
                        {relativeTime(thread.last_message_at)}
                      </Text>
                    </Tooltip>
                  )}
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to={`/mail?folder=${folder}`}>
        {unread > 0 ? `${unread} unread in ${folder.toLowerCase()}` : `Open ${folder.toLowerCase()}`}
      </MoreLink>
    </>
  );
}

// ── files ────────────────────────────────────────────────────────────────

/** What has been uploaded lately, largest facts first: name, size, when. */
export function FilesBody({ widget, fallback }: ModuleBodyProps) {
  const params = {
    ...(widget.config.folder_id ? { folder_id: widget.config.folder_id } : {}),
    page_size: ROWS,
  };

  const page = useQuery({
    queryKey: ["files", params],
    queryFn: ({ signal }) => filesApi.list(params, signal),
    staleTime: 30_000,
  });

  if (page.isLoading) return <Loading />;
  if (page.isError) return fallback(page.error, "files");

  const items = page.data?.items ?? [];
  if (items.length === 0) return <Nothing what="No files here yet" />;

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(file) => (
          <List.Item>
            <Link to="/files" className="nu-widget-row">
              <Space size={6} className="nu-widget-file">
                <FileOutlined aria-hidden />
                <Text ellipsis>{file.name}</Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {bytes(file.size_bytes)}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/files">All {(page.data?.total ?? 0).toLocaleString()} files</MoreLink>
    </>
  );
}

/** Sizes the way a file manager writes them, not in raw bytes. */
function bytes(value: number | null | undefined): string {
  const size = Number(value ?? 0);
  if (!size) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const scaled = size / 1024 ** index;
  return `${scaled >= 10 || index === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${units[index]}`;
}

// ── notifications ────────────────────────────────────────────────────────

/** What the platform has told this reader, newest first. */
export function NotificationsBody({ widget, fallback }: ModuleBodyProps) {
  const params = {
    read: widget.config.unread_only ? "unread" : "all",
    ...(widget.config.category ? { category: widget.config.category } : {}),
    page_size: ROWS,
  };

  const page = useQuery({
    queryKey: ["notifications", params],
    queryFn: ({ signal }) => notificationsApi.list(params, signal),
    staleTime: 20_000,
  });

  if (page.isLoading) return <Loading />;
  if (page.isError) return fallback(page.error, "notifications");

  const items = page.data?.items ?? [];
  if (items.length === 0) {
    return <Nothing what={widget.config.unread_only ? "Nothing unread" : "Nothing yet"} />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(entry) => (
          <List.Item className={entry.is_read ? undefined : "is-unread"}>
            <Link to={entry.link || "/notifications"} className="nu-widget-row">
              <Space size={6}>
                <span
                  className="nu-widget-severity"
                  data-severity={entry.severity.toLowerCase()}
                  aria-label={entry.severity.toLowerCase()}
                />
                <Text ellipsis strong={!entry.is_read}>
                  {entry.title}
                </Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {relativeTime(entry.created_at)}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/notifications">
        {(page.data?.unread ?? 0) > 0
          ? `${page.data?.unread} unread`
          : `All ${(page.data?.total ?? 0).toLocaleString()}`}
      </MoreLink>
    </>
  );
}

// ── announcements ────────────────────────────────────────────────────────

/** What has been announced, pinned first — the order the page itself uses. */
export function AnnouncementsBody({ widget, fallback }: ModuleBodyProps) {
  const params = widget.config.category ? { category: widget.config.category } : {};

  const feed = useQuery({
    queryKey: ["announcements", params],
    queryFn: ({ signal }) => announcementsApi.feed(params, signal),
    staleTime: 60_000,
  });

  if (feed.isLoading) return <Loading />;
  if (feed.isError) return fallback(feed.error, "announcements");

  const items = (feed.data?.items ?? []).slice(0, ROWS);
  if (items.length === 0) return <Nothing what="Nothing has been announced" />;

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item className={item.read_at ? undefined : "is-unread"}>
            <Link to="/announcements" className="nu-widget-row">
              <Space size={6}>
                {item.is_pinned && <PushpinFilled aria-label="Pinned" />}
                <Text ellipsis strong={!item.read_at}>
                  {item.title}
                </Text>
              </Space>
              <Space size={4}>
                {item.requires_acknowledgement && !item.acknowledged_at && (
                  <Tag bordered={false} color="warning">
                    acknowledge
                  </Tag>
                )}
                <Text type="secondary" className="nu-widget-dim">
                  {relativeTime(item.publish_at ?? item.created_at)}
                </Text>
              </Space>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/announcements">
        {(feed.data?.unread ?? 0) > 0 ? `${feed.data?.unread} unread` : "All announcements"}
      </MoreLink>
    </>
  );
}

// ── data explorer ────────────────────────────────────────────────────────

/**
 * The questions this reader saved, ready to be asked again.
 *
 * Deliberately *not* the answers. A `SEARCH` widget runs one saved search and
 * shows its rows; this one is the shelf they sit on — the dozen questions
 * somebody built, so opening the one that matters today is a press rather than
 * a trip through the explorer's drawer.
 *
 * Running all of them to put a count beside each would be a dozen queries per
 * dashboard load, and a dashboard that costs twelve queries to render is one
 * people stop leaving open.
 */
export function ExplorerBody({ widget, resources, fallback }: ModuleBodyProps) {
  const entity = widget.config.entity || undefined;
  const saved = useQuery({
    queryKey: ["saved-searches", entity ?? "all"],
    queryFn: ({ signal }) => explorerApi.saved(entity, signal),
    staleTime: 120_000,
  });

  if (saved.isLoading) return <Loading />;
  if (saved.isError) return fallback(saved.error, entity ?? "saved searches");

  const items = (saved.data?.items ?? []).slice(0, ROWS);
  if (items.length === 0) {
    return <Nothing what="No saved searches yet — build one in the explorer" />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => {
          const resource = resources.find((entry) => entry.key === item.resource_type);
          return (
            <List.Item>
              <Link
                to={`/explore?resource=${item.resource_type}&search=${item.id}`}
                className="nu-widget-row"
              >
                <Space size={6}>
                  {item.is_favorite && <StarFilled className="nu-widget-star" aria-hidden />}
                  <Text ellipsis>{item.name}</Text>
                </Space>
                <Space size={4}>
                  <Text type="secondary" className="nu-widget-dim">
                    {resource?.label ?? item.resource_type}
                  </Text>
                  {item.rule_count > 0 && (
                    <Tag bordered={false}>{item.rule_count} rules</Tag>
                  )}
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to={`/explore${entity ? `?resource=${entity}` : ""}`}>Open the explorer</MoreLink>
    </>
  );
}

// ── relationships ────────────────────────────────────────────────────────

/**
 * The records everything else hangs off.
 *
 * The overview's hubs, which is the one part of a connection map that reads at
 * card size: a graph drawn 300 pixels wide is decoration, but "this customer
 * is on 48 things" is a fact somebody acts on.
 */
export function RelationshipsBody({ resources, fallback }: ModuleBodyProps) {
  const map = useQuery({
    queryKey: ["relationship-overview"],
    queryFn: ({ signal }) => relationshipsApi.overview(signal),
    staleTime: 300_000,
  });

  if (map.isLoading) return <Loading />;
  if (map.isError) return fallback(map.error, "relationships");

  const hubs = (map.data?.hubs ?? []).slice(0, ROWS);
  if (hubs.length === 0) return <Nothing what="Nothing is connected yet" />;

  return (
    <>
      <List
        size="small"
        dataSource={hubs}
        renderItem={(hub) => {
          const resource = resources.find((entry) => entry.key === hub.resource_type);
          return (
            <List.Item>
              <Link
                to={`/explore?resource=${hub.resource_type}&record=${hub.id}`}
                className="nu-widget-row"
              >
                <Text ellipsis>{hub.label}</Text>
                <Space size={4}>
                  <Text type="secondary" className="nu-widget-dim">
                    {resource?.label ?? hub.resource_type}
                  </Text>
                  <Tooltip title={`Connected through ${hub.via_label}`}>
                    <Tag bordered={false}>{hub.connections}</Tag>
                  </Tooltip>
                </Space>
              </Link>
            </List.Item>
          );
        }}
      />
      <MoreLink to="/find/relationships">
        {(map.data?.totals.links ?? 0).toLocaleString()} links across{" "}
        {map.data?.totals.entities ?? 0} datasets
      </MoreLink>
    </>
  );
}

// ── favourites ───────────────────────────────────────────────────────────

/**
 * The places this reader keeps coming back to.
 *
 * Two views, and they are genuinely different things: bookmarks are a decision
 * somebody made and kept in an order they chose; recents are a by-product with
 * a visit count. A widget that mixed them would make the deliberate list
 * indistinguishable from the automatic one.
 */
export function FavoritesBody({ widget, fallback }: ModuleBodyProps) {
  const recents = widget.config.view === "recents";

  const bookmarks = useQuery({
    queryKey: ["favorites"],
    queryFn: ({ signal }) => favoritesApi.list(signal),
    enabled: !recents,
    staleTime: 60_000,
  });
  const visits = useQuery({
    queryKey: ["recents"],
    queryFn: ({ signal }) => favoritesApi.recents(signal),
    enabled: recents,
    staleTime: 60_000,
  });

  const active = recents ? visits : bookmarks;
  if (active.isLoading) return <Loading />;
  if (active.isError) return fallback(active.error, "favourites");

  // Narrowed to one row shape before rendering. A union of the two would
  // render *neither* faithfully: a bookmark has an arrangement and a recent
  // has a visit count, and the whole reason the two lists are separate is that
  // those are different facts.
  const rows = recents
    ? (visits.data?.items ?? []).slice(0, ROWS).map((item) => ({
        key: item.id,
        url: item.url,
        label: item.label,
        note: item.visit_count > 1 ? `${item.visit_count} visits` : item.resource_type,
      }))
    : (bookmarks.data?.items ?? []).slice(0, ROWS).map((item) => ({
        key: item.id,
        url: item.url,
        label: item.label,
        note: item.resource_type,
      }));

  if (rows.length === 0) {
    return (
      <Nothing
        what={recents ? "Nowhere visited yet" : "Nothing starred yet — the star is on every record"}
      />
    );
  }

  return (
    <>
      <List
        size="small"
        dataSource={rows}
        renderItem={(item) => (
          <List.Item>
            <Link to={item.url} className="nu-widget-row">
              <Space size={6}>
                {!recents && <StarFilled className="nu-widget-star" aria-hidden />}
                <Text ellipsis>{item.label}</Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {item.note}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/favorites">{recents ? "All recents" : "All favourites"}</MoreLink>
    </>
  );
}

// ── calendar ─────────────────────────────────────────────────────────────

/**
 * What is coming up, grouped by the day it lands on.
 *
 * An agenda rather than a month grid, because a month at card size is
 * forty-two boxes with nothing readable in them. What a person wants from a
 * calendar on a dashboard is the next few things and whether they have
 * answered the invitation.
 */
export function CalendarBody({ widget, fallback }: ModuleBodyProps) {
  const days = Math.max(1, Math.min(60, Number(widget.config.days ?? 7)));
  // Whole days, so the window is stable between renders and the query is not
  // refetched every time the clock ticks a second.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const from = start.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);

  const ahead = useQuery({
    queryKey: ["calendar-window", from, to],
    queryFn: ({ signal }) => calendarApi.window({ from, to }, signal),
    staleTime: 60_000,
  });

  if (ahead.isLoading) return <Loading />;
  if (ahead.isError) return fallback(ahead.error, "calendar");

  const items = (ahead.data?.items ?? [])
    .slice()
    .sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""))
    .slice(0, ROWS);

  if (items.length === 0) {
    return <Nothing what={`Nothing in the next ${days} ${days === 1 ? "day" : "days"}`} />;
  }

  const awaiting = ahead.data?.counts.awaiting_response ?? 0;

  return (
    <>
      <ul className="nu-widget-agenda">
        {items.map((event, index) => {
          const newDay = index === 0 || event.day !== items[index - 1]?.day;
          return (
            <li key={event.id}>
              {newDay && <span className="nu-widget-agenda-day">{dayLabel(event.day)}</span>}
              <Link to={`/calendar?event=${event.event_id}`} className="nu-widget-agenda-row">
                <span className="nu-widget-agenda-time">
                  {event.all_day ? "all day" : timeOf(event.starts_at)}
                </span>
                <span className="nu-widget-agenda-bar" style={{ background: event.color }} aria-hidden />
                <Text ellipsis>{event.title}</Text>
                {event.my_response === "NEEDS_ACTION" && (
                  <Tag bordered={false} color="warning">
                    reply
                  </Tag>
                )}
                {event.my_response === "ACCEPTED" && (
                  <CheckCircleTwoTone twoToneColor={SEMANTIC.success} aria-label="Accepted" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <MoreLink to="/calendar">
        {awaiting > 0 ? `${awaiting} awaiting your reply` : "Open the calendar"}
      </MoreLink>
    </>
  );
}

/** "Today", "Tomorrow", then the weekday — how a person reads an agenda. */
function dayLabel(day: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${day}T00:00:00`);
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return target.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function timeOf(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Exported for the card header, which shows how far ahead a calendar looks. */
export { ClockCircleOutlined };
