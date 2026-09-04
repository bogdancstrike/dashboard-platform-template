import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Collapse, Skeleton, Space, Tag, Tooltip, Typography } from "antd";
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
  const timeline = useQuery({
    queryKey: ["audit", "timeline", resourceType, resourceId, limit],
    queryFn: ({ signal }) =>
      auditApi.timeline({ resource_type: resourceType, resource_id: resourceId, limit }, signal),
    enabled: Boolean(resourceType && resourceId),
  });

  if (timeline.isLoading) {
    return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
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
      <EmptyState
        compact
        title="Nothing has happened to this record yet"
        hint="Every create, update and delete against it will appear here."
      />
    );
  }

  return (
    <div className="nu-timeline">
      <Collapse
        ghost
        items={items.map((entry) => ({
          key: entry.id,
          label: <TimelineHeading entry={entry} />,
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

function TimelineHeading({ entry }: { entry: AuditEntry }) {
  return (
    <span className="nu-timeline-head">
      <Tag color={actionColor(entry.action)}>{humaniseAction(entry.action)}</Tag>
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
