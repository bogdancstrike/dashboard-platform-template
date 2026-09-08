/**
 * `/announcements` — what the platform has told everybody (§17, §34).
 *
 * Two audiences on one route, because they are looking at the same rows for
 * different reasons: a reader wants to know what applies to them *now*, and an
 * author wants to know what has been written and how far it got. So the page
 * is a segmented pair of views rather than two routes — the switch is one
 * click and the second tab simply is not there without
 * `announcements.manage`.
 *
 * Three decisions worth stating.
 *
 * **A notice is prose, so it is laid out as prose.** Not a table. The severity
 * and the window matter, but what a maintenance notice *says* is the reason
 * anybody opened the page, and a 240-character title truncated into a column
 * with the body behind a click is a page that has hidden the content.
 *
 * **Reading is recorded on arrival; acknowledging never is.** Marking a notice
 * read when it is on screen is honest — it *was* on screen. Agreeing to a
 * policy is a decision, so it takes a button, and the button says what it
 * commits the reader to.
 *
 * **Expired notices are one click away, not on the page.** A maintenance
 * window that has passed is history: worth being able to look up, not worth
 * being shown every morning. Which is also why the strip's counts are over
 * the *live* set only — a chip that counts history would send somebody
 * looking for notices that are not there.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Card,
  Dropdown,
  Empty,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { announcementsApi, type Announcement } from "@/api/announcements";
import { ApiError } from "@/api/client";
import { AnnouncementEditor } from "@/components/announcements/AnnouncementEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Paragraph, Text, Title } = Typography;

/** Severity → the tag colour that already means it elsewhere in the product. */
const SEVERITY_COLOUR: Record<string, string | undefined> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: undefined,
};

export default function AnnouncementsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);

  const view = params.get("view") === "manage" ? "manage" : "read";
  const category = params.get("category") ?? "";
  const includeExpired = params.get("history") === "1";
  const status = params.get("status") ?? "";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  const feed = useQuery({
    queryKey: ["announcements", category, includeExpired],
    queryFn: ({ signal }) =>
      announcementsApi.feed({ category, include_expired: includeExpired }, signal),
  });

  const drafts = useQuery({
    queryKey: ["announcement-drafts", status],
    queryFn: ({ signal }) => announcementsApi.drafts({ status }, signal),
    enabled: view === "manage" && (feed.data?.can_manage ?? false),
  });

  const canManage = feed.data?.can_manage ?? false;

  const mark = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) =>
      announcementsApi.mark(id, acknowledged),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => announcementsApi.remove(id),
    onSuccess: () => {
      message.success("Announcement withdrawn");
      void queryClient.invalidateQueries({ queryKey: ["announcements"] });
      void queryClient.invalidateQueries({ queryKey: ["announcement-drafts"] });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be withdrawn."),
  });

  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);

  /**
   * Mark what is on screen as read, once.
   *
   * Honest rather than clever: these notices *were* shown. The request is
   * idempotent on the server, so this needs no memory of what it has already
   * sent — and it deliberately does not acknowledge anything, because agreeing
   * to a policy is a decision and not a side effect of scrolling.
   */
  useEffect(() => {
    if (view !== "read") return;
    for (const item of items) {
      if (item.read_at === null) mark.mutate({ id: item.id, acknowledged: false });
    }
    // `items` only: re-running when the mutation object changes identity would
    // send the same marks again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, view]);

  usePageCommands("announcements", [
    {
      id: "announcements.new",
      label: "Write an announcement",
      keywords: "notice publish broadcast",
      run: () => {
        set({ view: "manage" });
        setEditing("new");
      },
    },
    {
      id: "announcements.history",
      label: "Show announcements that have expired",
      keywords: "past history old",
      run: () => set({ view: null, history: "1" }),
    },
  ]);

  if (feed.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (feed.isError) {
    return (
      <>
        <PageHeader title="Announcements" />
        <Alert
          type="error"
          showIcon
          message={
            feed.error instanceof ApiError
              ? feed.error.message
              : "Announcements could not be loaded."
          }
          action={
            <Button size="small" onClick={() => void feed.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="What the platform has told everybody — and, for an author, how far each notice got."
        tag={
          (feed.data?.unread ?? 0) > 0 ? (
            <Tag color="blue">{feed.data?.unread} unread</Tag>
          ) : undefined
        }
        actions={
          <Space size={8}>
            {canManage && (
              <Segmented
                aria-label="View"
                data-testid="announcement-view"
                value={view}
                onChange={(next) => set({ view: next === "manage" ? "manage" : null })}
                options={[
                  { value: "read", label: "Noticeboard" },
                  { value: "manage", label: "Authoring" },
                ]}
              />
            )}
            {canManage && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  set({ view: "manage" });
                  setEditing("new");
                }}
                data-testid="new-announcement"
              >
                Write one
              </Button>
            )}
          </Space>
        }
      />

      {view === "read" ? (
        <>
          {/* The strip: one chip per category over the live set, and the
              filter. Counts are the server's — a chip counting the page it
              returned would say "of the twenty I sent" (§71). */}
          <div className="nu-kindstrip" data-testid="announcement-categories">
            <button
              type="button"
              className={`nu-kindchip${category === "" ? " is-active" : ""}`}
              aria-pressed={category === ""}
              onClick={() => set({ category: null })}
            >
              <span className="nu-kindchip-count">
                {(feed.data?.categories ?? []).reduce((sum, entry) => sum + entry.count, 0)}
              </span>
              <span className="nu-kindchip-label">Everything</span>
            </button>
            {(feed.data?.categories ?? []).map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={`nu-kindchip${category === entry.key ? " is-active" : ""}${
                  entry.count === 0 ? " is-empty" : ""
                }`}
                aria-pressed={category === entry.key}
                disabled={entry.count === 0}
                onClick={() => set({ category: entry.key })}
                data-testid={`announcement-category-${entry.key}`}
              >
                <span className="nu-kindchip-count">{entry.count}</span>
                <span className="nu-kindchip-label">{entry.label}</span>
              </button>
            ))}
          </div>

          <div className="nu-noticeboard" data-testid="announcement-board">
            {items.length === 0 ? (
              <Card size="small">
                <EmptyState
                  title={includeExpired ? "Nothing has been announced" : "Nothing current"}
                  hint={
                    includeExpired
                      ? "Announcements written here will appear on everybody's noticeboard."
                      : "Notices that have run out are kept — they are just not shown by default."
                  }
                  action={
                    !includeExpired ? (
                      <Button onClick={() => set({ history: "1" })}>Look at what expired</Button>
                    ) : undefined
                  }
                />
              </Card>
            ) : (
              items.map((notice) => (
                <Notice
                  key={notice.id}
                  notice={notice}
                  acknowledging={mark.isPending}
                  onAcknowledge={() => mark.mutate({ id: notice.id, acknowledged: true })}
                />
              ))
            )}

            {/* History is one click away rather than on the page: a
                maintenance window that has passed is worth looking up, not
                worth being shown every morning. */}
            <div className="nu-noticeboard-foot">
              <Button
                type="text"
                onClick={() => set({ history: includeExpired ? null : "1" })}
                data-testid="announcement-history"
              >
                {includeExpired ? "Show only what is current" : "Include what has expired"}
              </Button>
            </div>
          </div>
        </>
      ) : (
        <AuthoringTable
          drafts={drafts}
          status={status}
          onStatus={(next) => set({ status: next })}
          onEdit={(notice) => setEditing(notice)}
          onRemove={(notice) =>
            modal.confirm({
              title: `Withdraw “${notice.title}”?`,
              content:
                "It disappears from everybody's noticeboard. The audit trail keeps what it said.",
              okText: "Withdraw",
              okButtonProps: { danger: true },
              onOk: () => remove.mutateAsync(notice.id),
            })
          }
        />
      )}

      <AnnouncementEditor
        open={editing !== null}
        notice={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: ["announcements"] });
          void queryClient.invalidateQueries({ queryKey: ["announcement-drafts"] });
        }}
      />
    </>
  );
}

/**
 * One notice, as prose.
 *
 * Not a table row: what a maintenance notice *says* is the reason somebody
 * opened the page, and a title truncated into a column with the body behind a
 * click is a page that has hidden its content.
 */
function Notice({
  notice,
  acknowledging,
  onAcknowledge,
}: {
  notice: Announcement;
  acknowledging: boolean;
  onAcknowledge: () => void;
}) {
  const needsAgreement = notice.requires_acknowledgement && notice.acknowledged_at === null;

  return (
    <Card
      size="small"
      className={`nu-notice nu-notice--${notice.severity.toLowerCase()}${
        notice.read_at === null ? " is-unread" : ""
      }`}
      data-testid="announcement"
    >
      <div className="nu-notice-head">
        <Space size={6} wrap>
          {notice.is_pinned && (
            <Tooltip title="Pinned to the top of the board">
              <PushpinFilled className="nu-notice-pin" aria-label="Pinned" />
            </Tooltip>
          )}
          <Tag color={SEVERITY_COLOUR[notice.severity]} bordered={false}>
            {notice.severity}
          </Tag>
          <Tag bordered={false}>{notice.category_label}</Tag>
          {notice.is_expired && <Tag bordered={false}>Expired</Tag>}
          {notice.audience_roles.length > 0 && (
            <Tooltip title={`Only ${notice.audience_roles.join(", ")} can see this`}>
              <Tag bordered={false}>{notice.audience_roles.length} roles</Tag>
            </Tooltip>
          )}
        </Space>

        <Space size={8}>
          <Tooltip title={absoluteTime(notice.publish_at ?? notice.created_at)}>
            <Text type="secondary" className="nu-notice-when">
              {relativeTime(notice.publish_at ?? notice.created_at)}
            </Text>
          </Tooltip>
        </Space>
      </div>

      <Title level={4} className="nu-notice-title">
        {notice.title}
      </Title>
      <Paragraph className="nu-notice-body">{notice.body}</Paragraph>

      <div className="nu-notice-foot">
        <Space size={8} wrap>
          {notice.author.name && (
            <>
              <Avatar size={20} className="nu-notice-avatar">
                {notice.author.initials}
              </Avatar>
              <Text type="secondary">{notice.author.name}</Text>
            </>
          )}
          {notice.expires_at && !notice.is_expired && (
            <Tooltip title={absoluteTime(notice.expires_at)}>
              <Text type="secondary">· until {relativeTime(notice.expires_at)}</Text>
            </Tooltip>
          )}
        </Space>

        <Space size={8}>
          {notice.link && <Link to={notice.link}>Open</Link>}
          {/* Agreeing is a decision, so it is a button — and it says what it
              commits the reader to rather than "OK". */}
          {needsAgreement && (
            <Button
              size="small"
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={acknowledging}
              onClick={onAcknowledge}
              data-testid="acknowledge"
            >
              I have read and understood this
            </Button>
          )}
          {notice.requires_acknowledgement && notice.acknowledged_at !== null && (
            <Tooltip title={absoluteTime(notice.acknowledged_at)}>
              <Tag color="success" bordered={false} icon={<CheckCircleOutlined />}>
                Acknowledged
              </Tag>
            </Tooltip>
          )}
        </Space>
      </div>
    </Card>
  );
}

/**
 * The author's view: every notice whatever its state, and how far it got.
 *
 * A table here and prose there, deliberately. An author is comparing twenty
 * notices by status and reach, which is what a table is for; a reader is
 * reading one, which is what prose is for. The same rows either way.
 */
function AuthoringTable({
  drafts,
  status,
  onStatus,
  onEdit,
  onRemove,
}: {
  drafts: ReturnType<typeof useQuery<Awaited<ReturnType<typeof announcementsApi.drafts>>>>;
  status: string;
  onStatus: (status: string | null) => void;
  onEdit: (notice: Announcement) => void;
  onRemove: (notice: Announcement) => void;
}) {
  const rows = drafts.data?.items ?? [];

  const columns: ColumnsType<Announcement> = [
    {
      title: "Notice",
      dataIndex: "title",
      ellipsis: true,
      render: (title: string, row) => (
        <Space size={6}>
          {row.is_pinned && <PushpinFilled aria-label="Pinned" />}
          <Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Text>
        </Space>
      ),
    },
    {
      title: "State",
      key: "state",
      width: 128,
      // Derived, so a scheduled notice reads as scheduled and an expired one
      // as expired without either being a stored status (§71).
      render: (_value: unknown, row) => (
        <Tag
          color={row.is_live ? "success" : row.status === "DRAFT" ? undefined : "warning"}
          bordered={false}
        >
          {row.is_live
            ? "Live"
            : row.is_scheduled
              ? "Scheduled"
              : row.is_expired
                ? "Expired"
                : row.status.charAt(0) + row.status.slice(1).toLowerCase()}
        </Tag>
      ),
    },
    {
      title: "Severity",
      dataIndex: "severity",
      width: 116,
      render: (severity: string) => (
        <Tag color={SEVERITY_COLOUR[severity]} bordered={false}>
          {severity}
        </Tag>
      ),
    },
    { title: "Category", dataIndex: "category_label", width: 124 },
    {
      title: "Audience",
      key: "audience",
      width: 150,
      render: (_value: unknown, row) =>
        row.audience_roles.length === 0 ? (
          <Text type="secondary">Everybody</Text>
        ) : (
          <Tooltip title={row.audience_roles.join(", ")}>
            <Text>{row.audience_roles.length} roles</Text>
          </Tooltip>
        ),
    },
    {
      // The author's question, and the reason receipts are two columns:
      // "everybody has seen it" and "eleven agreed to it" are different.
      title: "Reach",
      key: "reach",
      width: 132,
      render: (_value: unknown, row) => (
        <Text type="secondary">
          {row.reach?.read ?? 0} read
          {row.requires_acknowledgement ? ` · ${row.reach?.acknowledged ?? 0} agreed` : ""}
        </Text>
      ),
    },
    {
      title: "Published",
      dataIndex: "publish_at",
      width: 128,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text>{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "",
      key: "actions",
      width: 48,
      align: "right",
      render: (_value: unknown, row) => (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              { key: "edit", icon: <EditOutlined />, label: "Edit" },
              { key: "remove", icon: <DeleteOutlined />, danger: true, label: "Withdraw" },
            ],
            onClick: ({ key }) => (key === "edit" ? onEdit(row) : onRemove(row)),
          }}
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            aria-label={`Actions for ${row.title}`}
          />
        </Dropdown>
      ),
    },
  ];

  return (
    <Card size="small" data-testid="announcement-authoring">
      <Segmented
        aria-label="Status"
        className="nu-block"
        value={status || "all"}
        onChange={(next) => onStatus(next === "all" ? null : String(next))}
        options={[
          { value: "all", label: "Everything" },
          ...(drafts.data?.statuses ?? []).map((item) => ({
            value: item,
            label: item.charAt(0) + item.slice(1).toLowerCase(),
          })),
        ]}
      />

      <Table<Announcement>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={rows}
        loading={drafts.isLoading}
        pagination={false}
        scroll={{ x: 1000 }}
        locale={{
          emptyText: drafts.isLoading ? (
            " "
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing written in this state"
            />
          ),
        }}
      />
    </Card>
  );
}
