import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Collapse,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";
import { UserSwitchOutlined } from "@ant-design/icons";

import { ApiError } from "@/api/client";
import { auditApi, type AuditEntry } from "@/api/audit";
import { EmptyState } from "@/components/EmptyState";
import { absoluteTime, relativeTime } from "@/lib/time";
import { AuditDiff } from "./AuditDiff";
import { actionColor, humaniseAction } from "./vocabulary";

const { Text } = Typography;

/**
 * One record's history, as it appears on every entity detail page (§21, §48).
 *
 * The same component the audit explorer's drawer uses for its diff, fed by the
 * scoped timeline endpoint rather than the ledger — so a reader who may open a
 * project can read that project's history without being granted the right to
 * read everything anybody has ever done.
 *
 * Entries are collapsed to one line each, because a timeline is read by
 * scanning *when* and *who* and expanding the one row that looks relevant. Ten
 * open diffs is a page nobody scrolls.
 *
 * **And it widens to a thread** (§48). A record's own history says when its
 * severity changed; the thread says that the account it was filed against was
 * edited an hour earlier and an order of theirs was refunded the day before —
 * which is usually the actual story, and reading it otherwise means opening
 * four history tabs and merging them by eye. Off by default, because "what
 * happened to *this*" is the question the tab is for; the switch is one click
 * and each entry then says which record it belongs to.
 */
export function AuditTimeline({
  resourceType,
  resourceId,
  limit = 25,
}: {
  resourceType: string;
  resourceId: string;
  limit?: number;
}) {
  const [thread, setThread] = useState(false);
  const timeline = useQuery({
    queryKey: ["audit", "timeline", resourceType, resourceId, limit, thread],
    queryFn: ({ signal }) =>
      auditApi.timeline(
        { resource_type: resourceType, resource_id: resourceId, limit, thread },
        signal,
      ),
    enabled: Boolean(resourceType && resourceId),
    // Kept while the wider query runs, so flipping the switch does not blank
    // the history somebody is reading.
    placeholderData: (previous) => previous,
  });

  /** The switch, rendered above every state so it is never the thing missing. */
  const scope = (
    <div className="nu-timeline-scope">
      <Segmented
        size="small"
        value={thread ? "thread" : "record"}
        onChange={(next) => setThread(next === "thread")}
        options={[
          { value: "record", label: "This record" },
          { value: "thread", label: "And what it touches" },
        ]}
        data-testid="timeline-scope"
      />
      {thread && timeline.data?.subjects && (
        // Whose history is being merged, by name: a merged feed that does not
        // say what it merged is a feed nobody can check.
        <Text type="secondary" data-testid="timeline-subjects">
          {timeline.data.subjects.length} record
          {timeline.data.subjects.length === 1 ? "" : "s"} in this thread
        </Text>
      )}
    </div>
  );

  if (timeline.isLoading) {
    return (
      <>
        {scope}
        <Skeleton active title={false} paragraph={{ rows: 4 }} />
      </>
    );
  }

  if (timeline.isError) {
    const error = timeline.error;
    const forbidden = error instanceof ApiError && error.isForbidden;
    return (
      <Alert
        type={forbidden ? "warning" : "error"}
        showIcon
        message={
          forbidden
            ? "You do not have permission to read this record's history"
            : "Could not load this record's history"
        }
        description={
          error instanceof ApiError ? (
            <Space direction="vertical" size={2}>
              {forbidden && error.missingPermissions.length > 0 && (
                <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
              )}
              <Text code copyable={{ text: error.correlationId }}>
                {error.correlationId}
              </Text>
            </Space>
          ) : undefined
        }
        action={
          <Button size="small" onClick={() => void timeline.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const items = timeline.data?.items ?? [];
  if (items.length === 0) {
    return (
      <>
        {scope}
        <EmptyState
          compact
          title={
            thread
              ? "Nothing has happened to this record or the ones it touches"
              : "Nothing has happened to this record yet"
          }
          hint="Every create, update and delete against it will appear here."
        />
      </>
    );
  }

  return (
    <div className="nu-timeline">
      {scope}
      <Collapse
        ghost
        items={items.map((entry) => ({
          key: entry.id,
          // Which record an entry belongs to matters only in the thread: on a
          // record's own history every row is about the same record, and
          // repeating its name twelve times is noise.
          label: <TimelineHeading entry={entry} showSubject={thread} />,
          children: <TimelineBody entry={entry} />,
        }))}
      />
      {timeline.data && timeline.data.total > items.length && (
        <Text type="secondary" className="nu-timeline-more">
          Showing the {items.length} most recent of {timeline.data.total.toLocaleString()}.
        </Text>
      )}
    </div>
  );
}

function TimelineHeading({
  entry,
  showSubject = false,
}: {
  entry: AuditEntry;
  showSubject?: boolean;
}) {
  return (
    <span className="nu-audit-head">
      <Tag color={actionColor(entry.action)}>{humaniseAction(entry.action)}</Tag>
      {showSubject && (
        <Text strong className="nu-audit-subject">
          {entry.resource_label || entry.resource_type}
        </Text>
      )}
      <Text strong>{entry.actor_label}</Text>
      {entry.impersonated && (
        // Both identities, never just the effective one: "Uma did this" is
        // materially different from "Ada did this while acting as Uma".
        <Tooltip title={`Acting as this user: ${entry.impersonator_label || "an administrator"}`}>
          <Tag icon={<UserSwitchOutlined />} color="purple">
            via {entry.impersonator_label || "an administrator"}
          </Tag>
        </Tooltip>
      )}
      {entry.result !== "SUCCESS" && <Tag color="red">{entry.result}</Tag>}
      <Tooltip title={absoluteTime(entry.occurred_at)}>
        <Text type="secondary">{relativeTime(entry.occurred_at)}</Text>
      </Tooltip>
    </span>
  );
}

function TimelineBody({ entry }: { entry: AuditEntry }) {
  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      {entry.message && <Text type="secondary">{entry.message}</Text>}
      <AuditDiff changes={entry.changes} />
      <Space size={12} wrap>
        {entry.ip_address && <Text type="secondary">from {entry.ip_address}</Text>}
        {entry.correlation_id && (
          <Text type="secondary" copyable={{ text: entry.correlation_id }}>
            {entry.correlation_id}
          </Text>
        )}
      </Space>
    </Space>
  );
}
